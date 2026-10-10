// The one way Leash runs git: argv arrays through execFileSync, never a shell string, so
// a file name, ref or snapshot id can't inject a command. quotepath=off keeps non-ASCII
// paths readable in diffs (git octal-escapes them by default).

import { execFileSync } from 'node:child_process';

const MAX_BUFFER = 64 * 1024 * 1024;

export interface GitOptions {
  env?: NodeJS.ProcessEnv;
  /** Drop git's stderr (for probes whose failure is an expected answer). */
  quiet?: boolean;
  /** Kill git after this long, so a huge tree can't outlive the host's hook timeout. */
  timeoutMs?: number;
  /** Text for git's stdin (otherwise stdin is closed). */
  input?: string;
}

/** Run `git <args>` and return stdout. Throws on a non-zero exit. */
export function git(args: readonly string[], options: GitOptions = {}): string {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    env: options.env ?? process.env,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', options.quiet ? 'ignore' : 'pipe'],
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.timeoutMs ? { timeout: options.timeoutMs, killSignal: 'SIGKILL' as const } : {}),
  });
}

/** A ref or tree-ish safe to pass as an argument: no option prefix, no whitespace. */
export function assertRef(ref: string): string {
  if (!/^[^-\s][^\s]*$/.test(ref)) throw new Error(`not a git ref: ${JSON.stringify(ref)}`);
  return ref;
}
