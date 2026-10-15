import fsp from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import * as yaml from "js-yaml";
import { Index, SlimPackage, lookup } from "./index-store.js";
import { cmpVer, parseRef } from "./semver.js";

// ---------------- search ----------------
export interface SearchOpts {
  query: string;
  limit?: number;
  category?: string;
  includeDeprecated?: boolean;
  includeNsfw?: boolean;
  sort?: "relevance" | "downloads" | "rating" | "updated";
}
export function searchMods(idx: Index, o: SearchOpts) {
  const q = o.query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const results: { p: SlimPackage; score: number }[] = [];
  for (const p of idx.byName.values()) {
    if (!o.includeDeprecated && p.deprecated) continue;
    if (!o.includeNsfw && p.nsfw) continue;
    if (o.category && !p.categories.some((c) => c.toLowerCase() === o.category!.toLowerCase())) continue;
    let score = 0;
    if (terms.length) {
      const name = p.name.toLowerCase(), owner = p.owner.toLowerCase(), desc = p.description.toLowerCase();
      let all = true;
      for (const t of terms) {
        let s = 0;
        if (name === t) s = 100;
        else if (name.startsWith(t)) s = 50;
        else if (name.includes(t)) s = 30;
        else if (owner.includes(t)) s = 15;
        else if (desc.includes(t)) s = 8;
        else if (p.categories.some((c) => c.toLowerCase().includes(t))) s = 4;
        if (!s) { all = false; break; }
        score += s;
      }
      if (!all) continue;
    }
    score += Math.log10(1 + p.totalDownloads) * 2;
    results.push({ p, score });
  }
  const sort = o.sort ?? "relevance";
  results.sort((a, b) =>
    sort === "downloads" ? b.p.totalDownloads - a.p.totalDownloads
    : sort === "rating" ? b.p.rating - a.p.rating
    : sort === "updated" ? b.p.updated.localeCompare(a.p.updated)
    : b.score - a.score);
  return {
    community: idx.community,
    totalMatches: results.length,
    results: results.slice(0, Math.min(o.limit ?? 20, 100)).map(({ p }) => summarize(p)),
  };
}
export function summarize(p: SlimPackage) {
  return {
    fullName: p.fullName,
    latestVersion: p.versions[0]?.v,
    description: p.description,
    owner: p.owner,
    categories: p.categories,
    totalDownloads: p.totalDownloads,
    rating: p.rating,
    deprecated: p.deprecated,
    updated: p.updated,
    url: p.url,
  };
}

// ---------------- dependency resolution ----------------
export interface Resolution {
  root: string;
  /** Final install set: one version per package (highest requested wins, like r2modman). */
  resolved: { fullName: string; version: string; requestedVersions: string[]; requiredBy: string[]; deprecated: boolean; latestVersion?: string }[];
  missing: { ref: string; requiredBy: string }[];
  conflicts: { fullName: string; versions: string[] }[];
  tree: any;
}

function pickVersion(p: SlimPackage, v?: string) {
  return v ? p.versions.find((x) => x.v === v) : p.versions[0];
}

export function resolveDependencies(idx: Index, refs: string[], maxDepth = 25): Resolution & { roots: string[] } {
  const requested = new Map<string, { versions: Set<string>; by: Set<string> }>();
  const missing: { ref: string; requiredBy: string }[] = [];
  const visited = new Set<string>();
  const roots: string[] = [];
  const trees: any[] = [];

  const visit = (ref: string, by: string, depth: number): any => {
    const { fullName, version } = parseRef(ref);
    const p = lookup(idx, fullName);
    if (!p) { missing.push({ ref, requiredBy: by }); return { ref, missing: true }; }
    const ver = pickVersion(p, version);
    if (!ver) { missing.push({ ref, requiredBy: by }); return { ref, missing: true, reason: "version not found" }; }
    const key = `${p.fullName}-${ver.v}`;
    const r = requested.get(p.fullName) ?? { versions: new Set(), by: new Set() };
    r.versions.add(ver.v); r.by.add(by);
    requested.set(p.fullName, r);
    if (visited.has(key) || depth > maxDepth) return { ref: key, seen: true };
    visited.add(key);
    return { ref: key, deps: ver.deps.map((d) => visit(d, key, depth + 1)) };
  };
  for (const ref of refs) {
    const t = visit(ref, "(root)", 0);
    roots.push(t.ref);
    trees.push(t);
  }
  const resolved = [...requested.entries()].map(([fullName, r]) => {
    const vs = [...r.versions].sort((a, b) => cmpVer(b, a));
    const p = lookup(idx, fullName)!;
    return { fullName, version: vs[0], requestedVersions: vs, requiredBy: [...r.by], deprecated: p.deprecated, latestVersion: p.versions[0]?.v };
  }).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const conflicts = resolved.filter((r) => r.requestedVersions.length > 1).map((r) => ({ fullName: r.fullName, versions: r.requestedVersions }));
  return { root: roots.join(", "), roots, resolved, missing, conflicts, tree: trees.length === 1 ? trees[0] : trees };
}

// ---------------- pack health ----------------
export type Severity = "error" | "warning" | "info";
export function checkPackHealth(idx: Index, mods: string[]) {
  const issues: { severity: Severity; mod: string; kind: string; message: string }[] = [];
  const pack = new Map<string, { version: string; ref: string }>();
  for (const ref of mods) {
    const { fullName, version } = parseRef(ref);
    const p = lookup(idx, fullName);
    if (!p) { issues.push({ severity: "error", mod: ref, kind: "not_found", message: `Package not found in community "${idx.community}".` }); continue; }
    const v = version ?? p.versions[0]?.v;
    if (version && !p.versions.some((x) => x.v === version))
      issues.push({ severity: "error", mod: ref, kind: "version_not_found", message: `Version ${version} does not exist (or was removed). Latest is ${p.versions[0]?.v}.` });
    if (pack.has(p.fullName)) { issues.push({ severity: "warning", mod: ref, kind: "duplicate", message: `Listed more than once (keeping first entry, ${pack.get(p.fullName)!.version}).` }); continue; }
    pack.set(p.fullName, { version: v, ref });
    if (p.deprecated) issues.push({ severity: "warning", mod: ref, kind: "deprecated", message: "Package is marked deprecated by its author/moderators." });
    if (p.nsfw) issues.push({ severity: "info", mod: ref, kind: "nsfw", message: "Package is flagged as NSFW." });
    const latest = p.versions[0]?.v;
    if (latest && cmpVer(latest, v) > 0) issues.push({ severity: "info", mod: ref, kind: "outdated", message: `Using ${v}, latest is ${latest}.` });
  }
  // dependency checks
  for (const [fullName, { version, ref }] of pack) {
    const p = lookup(idx, fullName)!;
    const ver = p.versions.find((x) => x.v === version);
    if (!ver) continue;
    for (const d of ver.deps) {
      const dr = parseRef(d);
      const dp = lookup(idx, dr.fullName);
      const inPack = dp ? pack.get(dp.fullName) : undefined;
      if (!dp) { issues.push({ severity: "error", mod: ref, kind: "dependency_unavailable", message: `Depends on ${d}, which is not on Thunderstore for this community.` }); continue; }
      if (dp.deprecated) issues.push({ severity: "warning", mod: ref, kind: "deprecated_dependency", message: `Depends on deprecated package ${dp.fullName}.` });
      if (!inPack) { issues.push({ severity: "warning", mod: ref, kind: "missing_dependency", message: `Requires ${d}, which is not in the pack (a mod manager would auto-install it).` }); continue; }
      if (dr.version && cmpVer(inPack.version, dr.version) < 0)
        issues.push({ severity: "error", mod: ref, kind: "version_conflict", message: `Requires ${dp.fullName} >= ${dr.version}, but pack has ${inPack.version}.` });
    }
  }
  // transitive conflicts across the whole pack
  const res = resolveDependencies(idx, [...pack.entries()].map(([n, x]) => `${n}-${x.version}`));
  for (const c of res.conflicts) {
    const inPack = pack.get(c.fullName);
    issues.push({ severity: "info", mod: c.fullName, kind: "multiple_pins", message: `Different versions requested across the dependency graph: ${c.versions.join(", ")}${inPack ? ` (pack pins ${inPack.version})` : ""}. Highest wins in r2modman.` });
  }
  const counts = { error: 0, warning: 0, info: 0 } as Record<Severity, number>;
  issues.forEach((i) => counts[i.severity]++);
  return {
    community: idx.community,
    modsChecked: mods.length,
    healthy: counts.error === 0,
    counts,
    issues,
    transitiveInstallCount: res.resolved.length,
    missingTransitive: res.missing,
  };
}

// ---------------- r2modman export ----------------
/**
 * r2modman / Thunderstore Mod Manager profile export (.r2z): a zip containing
 * `export.r2x` (YAML: profileName + mods[{name, version{major,minor,patch}, enabled}])
 * plus optional config files at their BepInEx-relative paths.
 * Mirrors ebkr/r2modmanPlus src/r2mm/mods/ProfileModList.ts.
 */
export async function exportR2modmanProfile(
  idx: Index,
  o: { profileName: string; mods: string[]; includeDependencies?: boolean; disabled?: string[]; configFiles?: Record<string, string>; outDir: string },
) {
  if (!/^[\w .()-]{1,64}$/.test(o.profileName)) throw new Error("profileName must be 1-64 chars of letters, digits, space, _ . ( ) -");
  const disabled = new Set((o.disabled ?? []).map((d) => parseRef(d).fullName.toLowerCase()));
  let list: { fullName: string; version: string }[];
  const warnings: string[] = [];
  if (o.includeDependencies !== false) {
    const r = resolveDependencies(idx, o.mods);
    r.missing.forEach((m) => warnings.push(`Missing: ${m.ref} (required by ${m.requiredBy})`));
    list = r.resolved.map((x) => ({ fullName: x.fullName, version: x.version }));
  } else {
    list = [];
    for (const m of o.mods) {
      const { fullName, version } = parseRef(m);
      const p = lookup(idx, fullName);
      if (!p) { warnings.push(`Missing: ${m}`); continue; }
      list.push({ fullName: p.fullName, version: version ?? p.versions[0].v });
    }
  }
  const mods = list.map(({ fullName, version }) => {
    const [major, minor, patch] = version.split(".").map(Number);
    return { name: fullName, version: { major, minor, patch }, enabled: !disabled.has(fullName.toLowerCase()) };
  });
  const r2x = yaml.dump({ profileName: o.profileName, mods });
  const zip = new JSZip();
  zip.file("export.r2x", r2x);
  for (const [rel, content] of Object.entries(o.configFiles ?? {})) {
    const norm = path.posix.normalize(rel.replace(/\\/g, "/"));
    if (norm.startsWith("..") || path.posix.isAbsolute(norm)) throw new Error(`Unsafe config path: ${rel}`);
    zip.file(norm, content);
  }
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fsp.mkdir(o.outDir, { recursive: true });
  const file = path.join(o.outDir, `${o.profileName.replace(/[^\w.-]+/g, "_")}.r2z`);
  await fsp.writeFile(file, buf);
  return { file, bytes: buf.length, modCount: mods.length, warnings, r2x, base64: buf.length < 256 * 1024 ? buf.toString("base64") : undefined };
}
