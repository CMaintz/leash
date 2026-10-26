import { existsSync, readFileSync } from 'node:fs';
import type { Target } from './cli-args.js';
import { writeFileEnsuringDir } from './files.js';
import { codexConfigTomlPath, loadSettings, saveSettings } from './install.js';
import { addCodexMcpServer, addMcpServer, leashServer } from './mcp-install.js';

export function installMcp(project: boolean, host: Target): void {
  if (host === 'claude') installClaudeMcp(project);
  if (host === 'codex') installCodexMcp(project);
  printOtherHosts();
}

function installClaudeMcp(project: boolean): void {
  if (!project) return void console.log(`leash: for every Claude Code project, run: ${claudeUserCommand()}`);
  const before = loadSettings('.mcp.json');
  const after = addMcpServer(before, leashServer(process.platform));
  if (after === before) return void console.log('leash: .mcp.json already has a leash server; left as is');
  saveSettings('.mcp.json', after);
  console.log('leash: added the leash MCP server to .mcp.json');
}

function installCodexMcp(project: boolean): void {
  const path = codexConfigTomlPath(project);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const after = addCodexMcpServer(before, leashServer(process.platform));
  if (after === before) return void console.log(`leash: ${path} already has a leash server; left as is`);
  writeFileEnsuringDir(path, after);
  console.log(`leash: added the leash MCP server to ${path}`);
}

function claudeUserCommand(): string {
  const { command, args } = leashServer(process.platform);
  return `claude mcp add --scope user leash -- ${[command, ...args].join(' ')}`;
}

function printOtherHosts(): void {
  const server = leashServer(process.platform);
  const entry = { mcpServers: { leash: { ...server, args: [...server.args, '/path/to/repo'] } } };
  console.log('\nleash: for Cursor, Claude Desktop and other MCP hosts, add this server entry:');
  console.log(JSON.stringify(entry, null, 2));
}
