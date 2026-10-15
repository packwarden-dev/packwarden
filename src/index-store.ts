import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/stream-array.js";
import chain from "stream-chain";
import { BASE_URL, CACHE_DIR, LIST_TTL_MS } from "./config.js";
import { politeFetch } from "./http.js";
import { cmpVer } from "./semver.js";

export interface SlimVersion {
  v: string;
  deps: string[];
  date: string;
  downloads: number;
  size: number;
}
export interface SlimPackage {
  fullName: string; // Owner-Name
  owner: string;
  name: string;
  url: string;
  deprecated: boolean;
  pinned: boolean;
  nsfw: boolean;
  rating: number;
  categories: string[];
  updated: string;
  description: string; // latest version description
  totalDownloads: number;
  versions: SlimVersion[]; // newest first
}
interface CacheMeta {
  fetchedAt: number;
  lastModified?: string;
  count: number;
}
export interface Index {
  community: string;
  fetchedAt: number;
  byName: Map<string, SlimPackage>;
  byLower: Map<string, SlimPackage>;
}

const mem = new Map<string, Index>();
const inflight = new Map<string, Promise<Index>>();

const safe = (c: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(c)) throw new Error(`Invalid community identifier: ${c}`);
  return c.toLowerCase();
};

function slim(p: any): SlimPackage {
  const versions: SlimVersion[] = (p.versions ?? [])
    .filter((v: any) => v.is_active !== false)
    .map((v: any) => ({
      v: v.version_number,
      deps: v.dependencies ?? [],
      date: v.date_created,
      downloads: v.downloads ?? 0,
      size: v.file_size ?? 0,
    }))
    .sort((a: SlimVersion, b: SlimVersion) => cmpVer(b.v, a.v));
  return {
    fullName: p.full_name,
    owner: p.owner,
    name: p.name,
    url: p.package_url,
    deprecated: !!p.is_deprecated,
    pinned: !!p.is_pinned,
    nsfw: !!p.has_nsfw_content,
    rating: p.rating_score ?? 0,
    categories: p.categories ?? [],
    updated: p.date_updated,
    description: p.versions?.[0]?.description ?? "",
    totalDownloads: versions.reduce((s, v) => s + v.downloads, 0),
    versions,
  };
}

function build(community: string, pkgs: SlimPackage[], fetchedAt: number): Index {
  const byName = new Map<string, SlimPackage>();
  const byLower = new Map<string, SlimPackage>();
  for (const p of pkgs) {
    byName.set(p.fullName, p);
    byLower.set(p.fullName.toLowerCase(), p);
  }
  return { community, fetchedAt, byName, byLower };
}

async function readDisk(c: string): Promise<{ meta: CacheMeta; pkgs: SlimPackage[] } | null> {
  try {
    const dir = path.join(CACHE_DIR, c);
    const meta = JSON.parse(await fsp.readFile(path.join(dir, "meta.json"), "utf8")) as CacheMeta;
    const pkgs = JSON.parse(await fsp.readFile(path.join(dir, "packages.slim.json"), "utf8")) as SlimPackage[];
    return { meta, pkgs };
  } catch {
    return null;
  }
}

async function writeDisk(c: string, meta: CacheMeta, pkgs?: SlimPackage[]) {
  const dir = path.join(CACHE_DIR, c);
  await fsp.mkdir(dir, { recursive: true });
  if (pkgs) {
    const tmp = path.join(dir, "packages.slim.json.tmp");
    await fsp.writeFile(tmp, JSON.stringify(pkgs));
    await fsp.rename(tmp, path.join(dir, "packages.slim.json"));
  }
  await fsp.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
}

async function download(c: string, lastModified?: string): Promise<{ pkgs: SlimPackage[] | null; lastModified?: string }> {
  const url = `${BASE_URL}/c/${c}/api/v1/package/`;
  const res = await politeFetch(url, { headers: lastModified ? { "If-Modified-Since": lastModified } : {} });
  if (res.status === 304) return { pkgs: null, lastModified };
  if (res.status === 404) throw new Error(`Unknown community "${c}" (404 from ${url})`);
  if (!res.ok || !res.body) throw new Error(`Thunderstore returned HTTP ${res.status} for ${url}`);
  const pkgs: SlimPackage[] = [];
  await new Promise<void>((resolve, reject) => {
    const pipeline = chain([Readable.fromWeb(res.body as any), parser(), streamArray()]);
    pipeline.on("data", ({ value }: any) => pkgs.push(slim(value)));
    pipeline.on("end", resolve);
    pipeline.on("error", reject);
  });
  return { pkgs, lastModified: res.headers.get("last-modified") ?? undefined };
}

/** Get (and lazily refresh) the cached package index for a community. */
export function getIndex(community: string, opts: { forceRefresh?: boolean } = {}): Promise<Index> {
  const c = safe(community);
  const hit = mem.get(c);
  if (hit && !opts.forceRefresh && Date.now() - hit.fetchedAt < LIST_TTL_MS) return Promise.resolve(hit);
  const running = inflight.get(c);
  if (running) return running;
  const p = (async () => {
    const disk = hit ? null : await readDisk(c);
    if (disk && !opts.forceRefresh && Date.now() - disk.meta.fetchedAt < LIST_TTL_MS) {
      const idx = build(c, disk.pkgs, disk.meta.fetchedAt);
      mem.set(c, idx);
      return idx;
    }
    const prevLM = disk?.meta.lastModified ?? (hit ? (hit as any).lastModified : undefined);
    try {
      const { pkgs, lastModified } = await download(c, (disk || hit) ? prevLM : undefined);
      const now = Date.now();
      if (!pkgs) {
        const base = hit ? [...hit.byName.values()] : disk!.pkgs;
        await writeDisk(c, { fetchedAt: now, lastModified, count: base.length });
        const idx = build(c, base, now);
        (idx as any).lastModified = lastModified;
        mem.set(c, idx);
        return idx;
      }
      await writeDisk(c, { fetchedAt: now, lastModified, count: pkgs.length }, pkgs);
      const idx = build(c, pkgs, now);
      (idx as any).lastModified = lastModified;
      mem.set(c, idx);
      return idx;
    } catch (e) {
      // Serve stale data rather than failing hard.
      if (hit) return hit;
      if (disk) {
        const idx = build(c, disk.pkgs, disk.meta.fetchedAt);
        mem.set(c, idx);
        return idx;
      }
      throw e;
    }
  })().finally(() => inflight.delete(c));
  inflight.set(c, p);
  return p;
}

export function lookup(idx: Index, fullName: string): SlimPackage | undefined {
  return idx.byName.get(fullName) ?? idx.byLower.get(fullName.toLowerCase());
}

/** List communities via the experimental API (paginated, small). */
export async function listCommunities(): Promise<{ identifier: string; name: string }[]> {
  const cacheFile = path.join(CACHE_DIR, "communities.json");
  try {
    const st = fs.statSync(cacheFile);
    if (Date.now() - st.mtimeMs < 24 * 3600 * 1000) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {}
  const out: { identifier: string; name: string }[] = [];
  let url: string | null = `${BASE_URL}/api/experimental/community/`;
  for (let i = 0; url && i < 50; i++) {
    const res = await politeFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} listing communities`);
    const j: any = await res.json();
    for (const r of j.results) out.push({ identifier: r.identifier, name: r.name });
    url = j.pagination?.next_link ?? null;
  }
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  await fsp.writeFile(cacheFile, JSON.stringify(out));
  return out;
}
