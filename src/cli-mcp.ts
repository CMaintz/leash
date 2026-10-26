import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { projectRoot } from './cli-store.js';
import { createMcpServer } from './mcp.js';

export async function serveMcp(repo: string | undefined, version: string): Promise<void> {
  if (repo) {
    process.chdir(repo);
    process.chdir(projectRoot());
  }
  await createMcpServer({ version }).connect(new StdioServerTransport());
}
