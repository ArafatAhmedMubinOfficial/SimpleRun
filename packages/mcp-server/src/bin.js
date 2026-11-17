#!/usr/bin/env node
// packages/mcp-server/src/bin.js
import { ControlApiClient } from "./client.js";
import { createMcpServer } from "./server.js";
import { parseCliArgs } from "./cliArgs.js";

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const client = new ControlApiClient(cli);
  const server = createMcpServer(client);
  server.connectStdio();
}

main().catch((err) => {
  console.error("[simpletun-mcp] fatal:", err?.message || err);
  process.exit(1);
});
