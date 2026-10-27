import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { projectRoot } from './cli-store.js';
import { createMcpServer } from './mcp.js';

/** Serves MCP over stdio. Hosts like Claude Desktop launch servers outside the repo, and
 * every Leash path is repo-relative, so with `repo` it first moves to that repo's root. */
export async function serveMcp(repo: string | undefined, version: string): Promise<void> {
  if (repo) {
    process.chdir(repo);
    process.chdir(projectRoot());
  }
  await createMcpServer({ version }).connect(new StdioServerTransport());
}
