import { describe, expect, it } from 'vitest';
import { addCodexMcpServer, addMcpServer, leashServer } from '../src/mcp-install.js';

const NPX = leashServer('linux');

describe('addMcpServer (.mcp.json)', () => {
  it("adds leash next to the user's other servers and keys", () => {
    const out = addMcpServer({ mcpServers: { other: { command: 'other' } }, extra: 1 }, NPX);
    expect(out).toEqual({
      mcpServers: { other: { command: 'other' }, leash: { command: 'npx', args: ['-y', '@cmaintz/leash', 'mcp'] } },
      extra: 1,
    });
  });

  it('keeps a leash entry the user already customised', () => {
    const mine = { command: 'npx', args: ['-y', '@cmaintz/leash', 'mcp', '/repo'] };
    expect(addMcpServer({ mcpServers: { leash: mine } }, NPX).mcpServers?.leash).toEqual(mine);
  });
});

describe('addCodexMcpServer (config.toml)', () => {
  it('appends one leash table and is idempotent, so Codex never sees a duplicate table', () => {
    const once = addCodexMcpServer('model = "o4"\n', NPX);
    expect(addCodexMcpServer(once, NPX)).toBe(once);
    expect(once).toBe('model = "o4"\n\n[mcp_servers.leash]\ncommand = "npx"\nargs = ["-y", "@cmaintz/leash", "mcp"]\n');
  });
});

describe('Codex header detection', () => {
  it('treats a quoted leash table as installed, so no duplicate table is appended', () => {
    const toml = '[mcp_servers."leash"]\ncommand = "x"\n';
    expect(addCodexMcpServer(toml, NPX)).toBe(toml);
  });

  it('ignores a commented-out leash table', () => {
    expect(addCodexMcpServer('# [mcp_servers.leash]\n', NPX)).toContain('\n[mcp_servers.leash]\n');
  });
});

describe('leashServer on Windows', () => {
  it('wraps npx in cmd /c, since npx.cmd cannot be spawned without a shell', () => {
    expect(leashServer('win32')).toEqual({ command: 'cmd', args: ['/c', 'npx', '-y', '@cmaintz/leash', 'mcp'] });
  });
});
