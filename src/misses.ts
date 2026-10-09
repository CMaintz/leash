// The miss log: every time a hook let a turn through unchecked (no key, a failed call, the
// turn deadline), one JSON line lands in the git dir so fail-open is never silent. Capped,
// and best-effort - logging a miss must never itself break a session.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitDir } from './snapshot.js';

const MISS_FILE = 'leash-misses.log';
const MAX_LINES = 200;

export interface Miss {
  at: string;
  command: string;
  reason: string;
}

/** Keep only the newest `max` lines of a newline-terminated log. */
export function capLines(text: string, max: number): string {
  const lines = text.split('\n').filter(Boolean);
  return lines.length <= max ? text : `${lines.slice(-max).join('\n')}\n`;
}

/** Record that `command` let something through unchecked. Never throws. */
export function logMiss(command: string, reason: string, now = new Date()): void {
  try {
    const path = join(gitDir(), MISS_FILE);
    appendFileSync(path, `${JSON.stringify({ at: now.toISOString(), command, reason })}\n`);
    writeFileSync(path, capLines(readFileSync(path, 'utf8'), MAX_LINES));
  } catch {
    // outside a git repo, or an unwritable git dir: the miss goes unrecorded, the turn goes on
  }
}

/** The newest `count` misses, oldest first; empty when there is no log. */
export function recentMisses(count: number): Miss[] {
  try {
    const path = join(gitDir(), MISS_FILE);
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-count).map((line) => JSON.parse(line) as Miss);
  } catch {
    return [];
  }
}
