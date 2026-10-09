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

interface HookSpec {
  event: string;
  command: string;
  /** Seconds before the host kills the hook (same key and unit in Claude Code and Codex). */
  timeout: number;
  matcher?: string;
}

// Host timeouts sit above Leash's own turn deadline (LEASH_DEADLINE_MS, default 60s), so
// Leash normally finishes and logs its misses; the host kill is only the backstop.
/** The hooks Leash always installs: a stale-rubric nudge at session start, a snapshot at
 * turn start, and the check at turn end. */
const TURN_HOOKS: readonly HookSpec[] = [
  { event: 'SessionStart', command: 'leash session', timeout: 30 },
  { event: 'UserPromptSubmit', command: 'leash snapshot', timeout: 30 },
  { event: 'Stop', command: 'leash hook', timeout: 90 },
];

/** The opt-in per-edit hook (`init --edit-phase`). */
const EDIT_HOOK: HookSpec = {
  event: 'PostToolUse',
  command: 'leash edit-hook',
  timeout: 90,
  matcher: 'Edit|Write|MultiEdit',
};

interface HookEntry {
  type: 'command';
  command: string;
  timeout?: number;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
}

export interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export interface InstallOptions {
  /** Also wire the per-edit PostToolUse check (off by default). */
  editPhase?: boolean;
}

/** Add Leash's hook groups, replacing an older install of the same command (idempotent). */
export function addLeashHooks(settings: ClaudeSettings, options: InstallOptions = {}): ClaudeSettings {
  const specs = options.editPhase ? [...TURN_HOOKS, EDIT_HOOK] : TURN_HOOKS;
  return specs.reduce(addHook, settings);
}

function addHook(settings: ClaudeSettings, spec: HookSpec): ClaudeSettings {
  const others = (settings.hooks?.[spec.event] ?? []).filter(
    (group) => !group.hooks?.some((hook) => hook.command === spec.command),
  );
  const group: HookGroup = {
    ...(spec.matcher ? { matcher: spec.matcher } : {}),
    hooks: [{ type: 'command', command: spec.command, timeout: spec.timeout }],
  };
  return { ...settings, hooks: { ...(settings.hooks ?? {}), [spec.event]: [...others, group] } };
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
