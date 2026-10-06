// Read the CLI's command line: the flags, the positional argument, the install target,
// and the calibrate sample size. Flags may appear in any order after the subcommand.

import { type Host } from './install.js';

/** An install target: a JSON-hooks host, or OpenCode (which takes a plugin file). */
export type Target = Host | 'opencode';

export function hasFlag(flag: string): boolean {
  return process.argv.slice(3).includes(flag);
}

// The first non-flag argument after the subcommand (a base ref, a file, a sample size).
export function positional(): string | undefined {
  return process.argv.slice(3).find((arg) => !arg.startsWith('--'));
}

export function targetFlag(): Target {
  if (hasFlag('--opencode')) return 'opencode';
  return hasFlag('--codex') ? 'codex' : 'claude';
}

// `--sample N` or a bare N after the command; defaults to 20.
export function sampleSize(): number {
  const args = process.argv.slice(3);
  const flagged = args.indexOf('--sample');
  const raw = flagged >= 0 ? args[flagged + 1] : args[0];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}
