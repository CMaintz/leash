import { type Host } from './install.js';

export type Target = Host | 'opencode';

export function hasFlag(flag: string): boolean {
  return process.argv.slice(3).includes(flag);
}

export function positional(): string | undefined {
  return process.argv.slice(3).find((arg) => !arg.startsWith('--'));
}

export function targetFlag(): Target {
  if (hasFlag('--opencode')) return 'opencode';
  return hasFlag('--codex') ? 'codex' : 'claude';
}

export function sampleSize(): number {
  const args = process.argv.slice(3);
  const flagged = args.indexOf('--sample');
  const raw = flagged >= 0 ? args[flagged + 1] : args[0];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}
