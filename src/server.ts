import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BRAND, EXPORT_DIR, VERSION } from "./config.js";
import { getIndex, listCommunities } from "./index-store.js";
import { checkPackHealth, exportR2modmanProfile, resolveDependencies, searchMods } from "./logic.js";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as any });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] });
const community = z.string().describe('Thunderstore community identifier, e.g. "lethal-company", "riskofrain2", "valheim". Use list_communities to discover.');
const modList = z.array(z.string()).min(1).max(500).describe('Mods as "Owner-Name" or "Owner-Name-1.2.3"');
const ATTRIB = "Data from Thunderstore (https://thunderstore.io). Not affiliated with or endorsed by Thunderstore.";

export function createServer() {
  const s = new McpServer({ name: `${BRAND.toLowerCase()}-thunderstore`, version: VERSION });
  const ro = { readOnlyHint: true, openWorldHint: true };

  s.registerTool("list_communities", {
    title: "List Thunderstore communities",
    description: "List game communities (identifier + name) on Thunderstore. Cached 24h.",
    inputSchema: { filter: z.string().optional() },
    annotations: ro,
  }, async ({ filter }) => {
    try {
      let c = await listCommunities();
      if (filter) c = c.filter((x) => (x.identifier + " " + x.name).toLowerCase().includes(filter.toLowerCase()));
      return ok({ count: c.length, communities: c, attribution: ATTRIB });
    } catch (e) { return fail(e); }
  });

  s.registerTool("search_mods", {
    title: "Search mods",
    description: "Search a community's mods by name/owner/description/category. First call per community downloads and caches the full package list (can take 10-60s for large games).",
    inputSchema: {
      community, query: z.string().describe("Search words; empty string lists top mods"),
      limit: z.number().int().min(1).max(100).optional(),
      category: z.string().optional(),
      sort: z.enum(["relevance", "downloads", "rating", "updated"]).optional(),
      includeDeprecated: z.boolean().optional(),
      includeNsfw: z.boolean().optional(),
    },
    annotations: ro,
  }, async (a) => {
    try { return ok({ ...searchMods(await getIndex(a.community), a), attribution: ATTRIB }); } catch (e) { return fail(e); }
  });

  s.registerTool("resolve_dependencies", {
    title: "Resolve dependencies",
    description: "Full transitive dependency closure for one or more package versions (latest if no version given). Returns final install set (highest requested version wins, as r2modman does), missing deps, multi-version pins, and the tree.",
    inputSchema: { community, packages: modList, includeTree: z.boolean().optional() },
    annotations: ro,
  }, async ({ community, packages, includeTree }) => {
    try {
      const r = resolveDependencies(await getIndex(community), packages);
      return ok({ ...r, tree: includeTree ? r.tree : undefined, attribution: ATTRIB });
    } catch (e) { return fail(e); }
  });

  s.registerTool("check_pack_health", {
    title: "Check mod pack health",
    description: "Audit a mod list: not found, removed versions, deprecated, outdated vs latest, missing dependencies, dependency version conflicts, duplicates.",
    inputSchema: { community, mods: modList },
    annotations: ro,
  }, async ({ community, mods }) => {
    try { return ok({ ...checkPackHealth(await getIndex(community), mods), attribution: ATTRIB }); } catch (e) { return fail(e); }
  });

  s.registerTool("export_r2modman_profile", {
    title: "Export r2modman profile",
    description: "Write an r2modman / Thunderstore Mod Manager profile file (.r2z) that can be imported via 'Import profile > From file'. Optionally resolves dependencies and bundles config files. Does not upload anything.",
    inputSchema: {
      community, profileName: z.string(), mods: modList,
      includeDependencies: z.boolean().optional().describe("Default true"),
      disabled: z.array(z.string()).optional().describe("Mods to include but mark disabled"),
      configFiles: z.record(z.string(), z.string()).optional().describe('Map of relative path (e.g. "BepInEx/config/foo.cfg") to file contents'),
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  }, async (a) => {
    try { return ok(await exportR2modmanProfile(await getIndex(a.community), { ...a, outDir: EXPORT_DIR })); } catch (e) { return fail(e); }
  });

  return s;
}
