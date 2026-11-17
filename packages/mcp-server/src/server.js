// packages/mcp-server/src/server.js
// Lightweight zero-dependency MCP JSON-RPC 2.0 server over stdio (and testable in-process).
import readline from "node:readline";
import { createRequire } from "node:module";
import { registerTools } from "./tools.js";

const { version } = createRequire(import.meta.url)("../package.json");

export class SimpleTunMcpServer {
  constructor({ name = "simpletun", serverVersion = version } = {}) {
    this.info = { name, version: serverVersion };
    this.tools = new Map();
  }

  registerTool(name, spec, handler) {
    this.tools.set(name, {
      name,
      title: spec.title || name,
      description: spec.description || "",
      inputSchema: {
        type: "object",
        properties: spec.inputSchema || {},
        ...(spec.required ? { required: spec.required } : {}),
      },
      handler,
    });
  }

  listTools() {
    return Array.from(this.tools.values()).map(({ name, title, description, inputSchema }) => ({
      name,
      title,
      description,
      inputSchema,
    }));
  }

  async callTool(name, args = {}) {
    const tool = this.tools.get(name);
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
    return tool.handler(args || {});
  }

  async handleMessage(msg) {
    if (!msg || typeof msg !== "object") return null;
    const { id, method, params } = msg;

    // Notifications (no id) do not receive responses
    if (id === undefined || id === null) {
      return null;
    }

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: this.info,
        },
      };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: this.listTools() } };
    }

    if (method === "tools/call") {
      const result = await this.callTool(params?.name, params?.arguments || {});
      return { jsonrpc: "2.0", id, result };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  connectStdio(input = process.stdin, output = process.stdout) {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        const resp = await this.handleMessage(msg);
        if (resp) output.write(`${JSON.stringify(resp)}\n`);
      } catch (err) {
        output.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: err.message } })}\n`
        );
      }
    });
    return rl;
  }
}

export function createMcpServer(client) {
  const server = new SimpleTunMcpServer({ name: "simpletun", serverVersion: version });
  registerTools(server, client);
  return server;
}
