export interface McpJson {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ServerEntry {
  command: string;
  args: string[];
}

const NPX_ARGS = ['-y', '@cmaintz/leash', 'mcp'];
// Line-anchored so a commented-out table doesn't count; TOML also allows the quoted key.
const CODEX_HEADER = /^\s*\[mcp_servers\.(?:leash|"leash")\]/m;

/** The host entry that starts `leash mcp`. On Windows npx is npx.cmd, which can't be spawned
 * without a shell, hence `cmd /c`. */
export function leashServer(platform: NodeJS.Platform): ServerEntry {
  return platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', ...NPX_ARGS] }
    : { command: 'npx', args: NPX_ARGS };
}

/** Adds the leash entry unless one exists: that one may carry a custom repo argument. */
export function addMcpServer(config: McpJson, server: ServerEntry): McpJson {
  if (config.mcpServers?.leash) return config;
  return { ...config, mcpServers: { ...(config.mcpServers ?? {}), leash: server } };
}

export function addCodexMcpServer(toml: string, server: ServerEntry): string {
  if (CODEX_HEADER.test(toml)) return toml;
  const args = server.args.map((a) => JSON.stringify(a)).join(', ');
  const table = `[mcp_servers.leash]\ncommand = ${JSON.stringify(server.command)}\nargs = [${args}]\n`;
  return toml.trim() ? `${toml.trimEnd()}\n\n${table}` : table;
}
