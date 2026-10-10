#!/usr/bin/env node
// The `leash` CLI - a thin dispatcher over the library. The commands live in cli-turn.ts
// (judging a diff, all advisory), cli-rubric.ts (the rubric itself) and cli-setup.ts
// (login/init/uninstall).

import { createRequire } from 'node:module';
import { hasFlag, positional, targetFlag } from './cli-args.js';
import { bench } from './cli-bench.js';
import { calibrate } from './cli-calibrate.js';
import { compile, guard, report, session } from './cli-rubric.js';
import { install, login, uninstall } from './cli-setup.js';
import { projectRoot } from './cli-store.js';
import { audit, check, editCheck, editHook, hook, snapshot } from './cli-turn.js';
import { logMiss } from './misses.js';

type Command = () => Promise<void> | void;

const HELP = `leash <command> [arg]
  setup:   login | init | uninstall | version
  rubric:  compile | report | guard [baseRef] | calibrate [--sample N] | bench [--sample N]
  judge:   check [baseRef] | audit [baseRef] | edit-check <file>
  hooks:   snapshot | hook | session | edit-hook   (run by the host agent)
  check flags: --turn (diff since the turn snapshot), --json (machine-readable result)
  calibrate flags: --sample N; --from <thresholds.json> [--dry-run] (bands from jev-eval, no Jev call)
  init/uninstall flags: --project (this repo, default global); --codex or --opencode
    (default Claude Code); --edit-phase (also wire the per-edit check);
    --standalone (install hooks even where Foundry drives Leash)`;

function commands(arg: string | undefined): Record<string, Command> {
  const project = hasFlag('--project');
  return {
    check: () => check(arg),
    audit: () => audit(arg),
    'edit-check': () => editCheck(arg),
    guard: () => guard(arg),
    init: () => install(project, targetFlag()),
    uninstall: () => uninstall(project, targetFlag()),
    version: () => console.log(`leash ${packageVersion()}`),
    help: () => console.log(HELP),
    ...{ report, compile, calibrate, bench, snapshot, hook, session, login, 'edit-hook': editHook },
  };
}

async function main(): Promise<void> {
  // Every path (.leash/, the git dir, env files) is repo-relative, so a session started
  // in a subdirectory sees the same rubric as one started at the root.
  process.chdir(projectRoot());
  const table = commands(positional());
  await (table[process.argv[2] ?? 'help'] ?? table.help)!();
}

// The version from package.json (always shipped), so the CLI can never drift from it.
function packageVersion(): string {
  const pkg = createRequire(import.meta.url)('../package.json') as { version?: string };
  return pkg.version ?? 'unknown';
}

// Commands a person or CI runs on purpose report failure; everything a hook or a check
// runs stays advisory and never breaks the session.
const STRICT_COMMANDS = new Set(['init', 'uninstall', 'login', 'compile', 'guard']);

main().catch((err: unknown) => {
  const command = process.argv[2] ?? 'help';
  const message = err instanceof Error ? err.message : String(err);
  logMiss(command, message);
  console.error(`leash: ${message}`);
  process.exit(STRICT_COMMANDS.has(command) ? 1 : 0);
});
