// Install / uninstall the Leash hooks in a host agent's config. Claude Code and
// Codex share the exact hook contract - the same `{ hooks: { UserPromptSubmit, Stop } }`
// object, the same `{ decision: "block", reason }` Stop output - so the pure merge
// functions (addLeashHooks / removeLeashHooks) are host-agnostic; only the file they
// live in differs (Claude Code's settings.json vs Codex's hooks.json). The merge
// functions are idempotent and unit-tested; the file helpers are the thin I/O around them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** A supported host agent. Both consume the same hook object; only the path differs. */
export type Host = 'claude' | 'codex';

const HOST_CONFIG: Record<Host, { dir: string; file: string }> = {
  claude: { dir: '.claude', file: 'settings.json' },
  codex: { dir: '.codex', file: 'hooks.json' },
};

/** The two hooks Leash installs: snapshot at turn start, check at turn end. */
const LEASH_HOOKS: Record<string, string> = {
  UserPromptSubmit: 'leash snapshot',
  Stop: 'leash hook',
};

interface HookEntry {
  type: 'command';
  command: string;
}

interface HookGroup {
  hooks?: HookEntry[];
}

export interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

/** Add Leash's hook groups, skipping any already present (idempotent). */
export function addLeashHooks(settings: ClaudeSettings): ClaudeSettings {
  const hooks: Record<string, HookGroup[]> = { ...(settings.hooks ?? {}) };
  for (const [event, command] of Object.entries(LEASH_HOOKS)) {
    const groups = [...(hooks[event] ?? [])];
    if (!groups.some((group) => group.hooks?.some((hook) => hook.command === command))) {
      groups.push({ hooks: [{ type: 'command', command }] });
    }
    hooks[event] = groups;
  }
  return { ...settings, hooks };
}

/** Remove every hook group that runs a `leash` command. */
export function removeLeashHooks(settings: ClaudeSettings): ClaudeSettings {
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups.filter((group) => !group.hooks?.some((hook) => hook.command.startsWith('leash ')));
    if (kept.length > 0) hooks[event] = kept;
  }
  return { ...settings, hooks };
}

/** The host's hook-config path: project (in-repo) or global (home). */
export function hostConfigPath(host: Host, project: boolean): string {
  const { dir, file } = HOST_CONFIG[host];
  return project ? join(dir, file) : join(homedir(), dir, file);
}

export function loadSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ClaudeSettings;
  } catch {
    return {};
  }
}

export function saveSettings(path: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}
