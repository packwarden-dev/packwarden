# Marketplace listing draft (NOT published)

**Title:** PackWarden — Thunderstore Mod Pack Assistant (MCP)

**Tagline:** Build, audit and export Thunderstore mod packs from your AI assistant.

**Short description (≤160 chars):**
Search Thunderstore mods, resolve dependencies, catch broken/outdated packs, and export r2modman profiles—for Lethal Company, Valheim, RoR2 & more.

**Long description:**
PackWarden lets Claude, Cursor and other MCP clients work directly with Thunderstore, the mod
repository behind r2modman and the Thunderstore Mod Manager. Ask for "a stable co-op pack for
Lethal Company with more players and suits". Your assistant can search the catalogue, pull in every
transitive dependency, flag deprecated or outdated mods and version conflicts, and then write an
`.r2z` profile you import with one click.

- 5 tools: list_communities, search_mods, resolve_dependencies, check_pack_health, export_r2modman_profile
- Works with every Thunderstore community
- Respectful by design: cached index, conditional requests, rate-limited
- stdio for local use, streamable HTTP for remote use
- Unofficial. Data © respective mod authors via Thunderstore. PackWarden is not affiliated with or endorsed by Thunderstore.

**Categories/tags:** gaming, modding, developer-tools, thunderstore, r2modman, lethal-company, valheim

**Support:** support@<brand-domain> (placeholder)

## Tier proposal

| | Free (open source, self-hosted) | Pro (hosted, ~$4–6/mo) |
| --- | --- | --- |
| All 5 tools | ✅ | ✅ |
| Runs on your machine (stdio) | ✅ | — |
| Hosted HTTPS endpoint, no install, no 1.4 GB RAM cost | — | ✅ |
| Warm cache for all communities, faster first query | — | ✅ |
| Pack update watch: "what changed since last check" diff | — | ✅ (roadmap) |
| Saved packs + scheduled health reports | — | ✅ (roadmap) |
| Conflict knowledge base (known-incompatible mod pairs) | — | ✅ (roadmap) |

Rationale: keep the core MIT and free. That fits community norms, Glama/MCP Market expect open-source
repos, and charging for raw public data is the riskiest part legally. Charge for hosting,
convenience and value-added features instead. Before launching Pro, ask Thunderstore for
written OK (see TOS notes).
