# PackWarden — Thunderstore Mod-Pack MCP Server (v0.1.0)

> **PackWarden is not affiliated with or endorsed by Thunderstore.** "Thunderstore" is used only to describe compatibility.
> Mod data comes from the public Thunderstore API (https://thunderstore.io).

An MCP server that helps AI assistants build and maintain Thunderstore mod packs
(Lethal Company, Risk of Rain 2, Valheim, and every other Thunderstore community).

## Tools

| Tool | What it does |
| --- | --- |
| `list_communities` | List Thunderstore game communities (identifier + name). |
| `search_mods` | Search a community by name/owner/description/category; sort by relevance, downloads, rating, updated. |
| `resolve_dependencies` | Full transitive dependency closure for one or more packages/versions; final install set, missing deps, multi-version pins, optional tree. |
| `check_pack_health` | Audit a mod list: not found, removed version, deprecated, outdated, missing deps, dependency version conflicts, duplicates, NSFW. |
| `export_r2modman_profile` | Write an `.r2z` profile (r2modman / Thunderstore Mod Manager "Import profile → From file"), optionally with deps and config files. Nothing is uploaded. |

Mods are referenced as `Owner-Name` (latest) or `Owner-Name-1.2.3`.

## Install

Requires Node.js ≥ 18.17.

```bash
git clone <repo> thunderstore-mcp && cd thunderstore-mcp
npm install && npm run build
```

### Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "thunderstore": {
      "command": "node",
      "args": ["/absolute/path/to/thunderstore-mcp/dist/main.js"],
      "env": { "TSMCP_EXPORT_DIR": "/absolute/path/for/profiles" }
    }
  }
}
```

Restart Claude Desktop.

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "thunderstore": {
      "command": "node",
      "args": ["/absolute/path/to/thunderstore-mcp/dist/main.js"]
    }
  }
}
```

### Streamable HTTP (remote / self-hosted)

```bash
npm run start:http            # http://127.0.0.1:3333/mcp
PORT=8080 HOST=0.0.0.0 node dist/main.js --http
```

Cursor: `{ "mcpServers": { "thunderstore": { "url": "http://127.0.0.1:3333/mcp" } } }`.
The HTTP mode is stateless (POST-only, JSON responses) and has no auth. Put it behind a reverse proxy with TLS and auth before exposing it.

## Configuration (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `TSMCP_CACHE_DIR` | `~/.cache/thunderstore-mcp` | Slim package-index cache |
| `TSMCP_LIST_TTL_MS` | `3600000` (1h) | Package-list freshness |
| `TSMCP_MIN_INTERVAL_MS` | `1000` | Minimum gap between outbound requests |
| `TSMCP_EXPORT_DIR` | `./exports` | Where `.r2z` files are written |
| `TSMCP_CONTACT` | `support@packwarden.dev` | Contact put in the User-Agent. Override if you run your own copy. |
| `TSMCP_BRAND` | `PackWarden` | Brand in server name/User-Agent |
| `TSMCP_BASE_URL` | `https://thunderstore.io` | API base |

## Be a good API citizen

- One full package list download per community per TTL, then conditional requests (`If-Modified-Since`). Results are cached on disk as a slim index.
- Outbound requests are serialized (concurrency 1) and spaced ≥1s apart. On 429/5xx the client backs off and honours `Retry-After`.
- Identifying User-Agent with a contact address.
- If the network fails, the server keeps serving stale cache.

## Tests (live API)

```bash
npm test                         # default community: valheim
TEST_COMMUNITY=valheim npm test
```

Tests cover stdio and streamable HTTP end-to-end against the live Thunderstore API.

## Limitations

- Large communities are heavy. The first load of Lethal Company is about 330 MB of JSON, takes about 14 s, and uses about 1.4 GB of RAM. After that, loads from cache take about 3 s.
- Resolution follows r2modman behaviour (highest requested version wins). It does not do semver range solving, because Thunderstore pins exact versions.
- No profile *code* sharing, which would need an upload to Thunderstore. Only file export is supported.
- Search is local keyword scoring, not Thunderstore's own search ranking.
