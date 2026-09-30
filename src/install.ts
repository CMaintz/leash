// Install / uninstall the Leash hooks in a Claude Code settings.json. The pure
// merge functions (addLeashHooks / removeLeashHooks) are idempotent and unit-tested;
// the file helpers are the thin I/O around them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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

/** Global (~/.claude) or project (.claude) settings path. */
export function settingsPath(project: boolean): string {
  return project ? join('.claude', 'settings.json') : join(homedir(), '.claude', 'settings.json');
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
