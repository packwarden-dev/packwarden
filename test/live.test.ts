// Live tests: hit the real Thunderstore API (cached after first run).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import JSZip from "jszip";
import * as yaml from "js-yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const COMMUNITY = process.env.TEST_COMMUNITY ?? "valheim";
const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsmcp-export-"));
const env = { ...process.env, TSMCP_EXPORT_DIR: exportDir } as Record<string, string>;
const parse = (r: any) => JSON.parse(r.content[0].text);

const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/main.ts"], env, stderr: "ignore" }));

test("lists tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log("tools:", names.join(", "));
  for (const n of ["search_mods", "resolve_dependencies", "check_pack_health", "export_r2modman_profile", "list_communities"]) assert.ok(names.includes(n));
});

test("list_communities includes the test community", async () => {
  const r = parse(await client.callTool({ name: "list_communities", arguments: { filter: COMMUNITY } }));
  console.log("communities matching:", r.count);
  assert.ok(r.communities.some((c: any) => c.identifier === COMMUNITY));
});

test("search_mods finds Jotunn", { timeout: 180_000 }, async () => {
  const t = Date.now();
  const r = parse(await client.callTool({ name: "search_mods", arguments: { community: COMMUNITY, query: "jotunn", limit: 3 } }));
  console.log(`search (${Date.now() - t}ms) total=${r.totalMatches}:`, r.results.map((x: any) => `${x.fullName}@${x.latestVersion}`).join(", "));
  assert.equal(r.results[0].fullName, "ValheimModding-Jotunn");
});

test("search_mods is fast once cached", async () => {
  const t = Date.now();
  const r = parse(await client.callTool({ name: "search_mods", arguments: { community: COMMUNITY, query: "", sort: "downloads", limit: 5 } }));
  console.log(`cached top-5 (${Date.now() - t}ms):`, r.results.map((x: any) => x.fullName).join(", "));
  assert.ok(Date.now() - t < 5000);
});

test("resolve_dependencies pulls BepInEx for Jotunn", async () => {
  const r = parse(await client.callTool({ name: "resolve_dependencies", arguments: { community: COMMUNITY, packages: ["ValheimModding-Jotunn"] } }));
  console.log("resolved:", r.resolved.map((x: any) => `${x.fullName}@${x.version}`).join(", "));
  assert.ok(r.resolved.some((x: any) => x.fullName === "denikson-BepInExPack_Valheim"));
});

test("check_pack_health flags problems", async () => {
  const { getIndex } = await import("../src/index-store.js");
  const jot = (await getIndex(COMMUNITY)).byName.get("ValheimModding-Jotunn")!;
  const old = jot.versions[jot.versions.length - 1].v;
  const r = parse(await client.callTool({ name: "check_pack_health", arguments: { community: COMMUNITY, mods: [`ValheimModding-Jotunn-${old}`, "Nobody-DoesNotExist", "ValheimModding-Jotunn-99.0.0"] } }));
  const kinds = new Set(r.issues.map((i: any) => i.kind));
  console.log("health:", r.counts, [...kinds].join(", "));
  assert.equal(r.healthy, false);
  for (const k of ["not_found", "outdated", "version_not_found", "missing_dependency", "duplicate"]) assert.ok(kinds.has(k), k);
});

test("export_r2modman_profile writes valid .r2z", async () => {
  const r = parse(await client.callTool({ name: "export_r2modman_profile", arguments: { community: COMMUNITY, profileName: "Test Pack", mods: ["ValheimModding-Jotunn"], configFiles: { "BepInEx/config/test.cfg": "a = 1\n" } } }));
  const zip = await JSZip.loadAsync(fs.readFileSync(r.file));
  const doc: any = yaml.load(await zip.file("export.r2x")!.async("string"));
  console.log("export:", r.file, r.bytes, "bytes;", doc.mods.map((m: any) => `${m.name}@${m.version.major}.${m.version.minor}.${m.version.patch}`).join(", "));
  assert.equal(doc.profileName, "Test Pack");
  assert.ok(doc.mods.length >= 2 && doc.mods.every((m: any) => m.enabled === true && Number.isInteger(m.version.major)));
  assert.ok(zip.file("BepInEx/config/test.cfg"));
});

test("streamable HTTP transport works", { timeout: 60_000 }, async () => {
  const port = 34000 + Math.floor(Math.random() * 1000);
  const proc = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--http", "--port", String(port)], { env, stdio: ["ignore", "ignore", "pipe"] });
  await new Promise<void>((res) => proc.stderr!.on("data", (d) => String(d).includes("streamable HTTP") && res()));
  try {
    const c = new Client({ name: "http-test", version: "0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const r = parse(await c.callTool({ name: "search_mods", arguments: { community: COMMUNITY, query: "jotunn", limit: 1 } }));
    console.log("http search:", r.results[0].fullName);
    assert.equal(r.results[0].fullName, "ValheimModding-Jotunn");
    await c.close();
  } finally { proc.kill(); }
});

test.after(async () => { await client.close(); });
