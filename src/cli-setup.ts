// The commands that set Leash up on a machine: `login`, `init`, `uninstall`. Unlike the
// hook paths these are run on purpose, so a failure exits 1 (see cli.ts).

import { hasFlag, type Target } from './cli-args.js';
import { removeRubricCommand, writeRubricCommand } from './commands.js';
import { saveApiKey } from './env.js';
import {
  addEditHook,
  addLeashHooks,
  hasFoundryAdapter,
  hostConfigPath,
  loadSettings,
  removeLeashHooks,
  saveSettings,
} from './install.js';
import { removeOpenCodePlugin, writeOpenCodePlugin } from './opencode.js';
import { readSecret } from './secret.js';

// Store the API key owner-only in ~/.leash/.env, read by every later run (see env.ts).
export async function login(): Promise<void> {
  const apiKey = await readSecret('TypeSafe API key (input hidden): ');
  if (!apiKey) return void console.log('leash: no key entered - nothing saved.');
  console.log(`leash: saved JEV_API_KEY to ${saveApiKey(apiKey)}`);
}

// Install the turn hooks into the host's config (Claude Code or Codex), plus the
// /leash-rubric authoring command (Claude Code only - its command path is known).
// OpenCode takes a plugin file instead (see opencode.ts). On a Foundry machine (the
// cmaintz-skills leash.sh adapter is registered) Claude Code gets library mode instead.
export function install(project: boolean, host: Target): void {
  if (host === 'opencode') return void console.log(`leash: added OpenCode plugin at ${writeOpenCodePlugin(project)}`);
  const path = hostConfigPath(host, project);
  if (host === 'claude' && foundryDrivesLeash()) libraryMode(path);
  else standaloneMode(path);
  if (host === 'claude') console.log(`leash: added /leash-rubric command at ${writeRubricCommand(project)}`);
}

function standaloneMode(path: string): void {
  saveSettings(path, addLeashHooks(loadSettings(path), { editPhase: hasFlag('--edit-phase') }));
  console.log(`leash: installed snapshot + hook into ${path}`);
}

// Foundry's adapter fires the turn hooks, so installing ours too would check every turn
// twice. Drop any we installed earlier; the per-edit hook has no adapter, so it stays ours.
function libraryMode(path: string): void {
  const before = loadSettings(path);
  const pruned = removeLeashHooks(before);
  const after = hasFlag('--edit-phase') ? addEditHook(pruned) : pruned;
  // Nothing of ours to remove or add: leave the file alone (and don't create one).
  if (JSON.stringify(after.hooks ?? {}) !== JSON.stringify(before.hooks ?? {})) saveSettings(path, after);
  console.log(`leash: Foundry's leash.sh hook drives Leash here, so ${path} gets no turn hooks.`);
  console.log('leash: set LEASH_ENABLED=1 (mise [env]) to turn it on; `init --standalone` installs ours instead.');
}

// The adapter may sit in the global or the project settings; either one drives every turn.
function foundryDrivesLeash(): boolean {
  if (hasFlag('--standalone')) return false;
  return [false, true].some((project) => hasFoundryAdapter(loadSettings(hostConfigPath('claude', project))));
}

export function uninstall(project: boolean, host: Target): void {
  if (host === 'opencode')
    return void console.log(`leash: removed OpenCode plugin at ${removeOpenCodePlugin(project)}`);
  const path = hostConfigPath(host, project);
  saveSettings(path, removeLeashHooks(loadSettings(path)));
  console.log(`leash: removed hooks from ${path}`);
  if (host === 'claude') console.log(`leash: removed /leash-rubric command at ${removeRubricCommand(project)}`);
}
