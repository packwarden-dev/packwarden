#!/usr/bin/env node
import http from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const args = process.argv.slice(2);
const httpMode = args.includes("--http") || process.env.MCP_TRANSPORT === "http";
const port = Number(args[args.indexOf("--port") + 1] || process.env.PORT || 3333);
const host = process.env.HOST ?? "127.0.0.1";

if (!httpMode) {
  await createServer().connect(new StdioServerTransport());
  console.error("thunderstore-mcp running on stdio");
} else {
  // Stateless streamable HTTP: fresh server+transport per request.
  const srv = http.createServer(async (req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'); return; }
    if (!req.url?.startsWith("/mcp")) { res.writeHead(404).end(); return; }
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json", allow: "POST" })
        .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null }));
      return;
    }
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 2_000_000) { res.writeHead(413).end(); return; } }
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  });
  srv.listen(port, host, () => console.error(`thunderstore-mcp streamable HTTP on http://${host}:${port}/mcp`));
}
