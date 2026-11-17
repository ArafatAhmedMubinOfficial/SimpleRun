// packages/mcp-server/src/cliArgs.js
// Parses --token and --port arguments for MCP clients that do not forward env vars.

export function parseCliArgs(argv = []) {
  const out = {};
  const list = Array.isArray(argv) ? argv : [];
  const valueOf = (name, i) => {
    const arg = list[i];
    if (arg === `--${name}`) return list[i + 1];
    if (typeof arg === "string" && arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
    return undefined;
  };
  for (let i = 0; i < list.length; i++) {
    const token = valueOf("token", i);
    if (typeof token === "string" && token.length > 0) out.token = token;
    const port = valueOf("port", i);
    if (typeof port === "string" && port.length > 0) {
      const n = Number(port);
      if (Number.isInteger(n) && n > 0 && n <= 65535) out.port = n;
    }
  }
  return out;
}
