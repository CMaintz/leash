// Rubric freshness. `leash compile` stamps a hash of every instruction file the rubric came
// from (CLAUDE.md, AGENTS.md, and any Markdown file a rule cites as its `source`); the
// SessionStart hook compares those stamps with the files on disk and, when one changed,
// tells the agent to bring the rubric up to date. Hashes are of LF-normalized text, so a
// CRLF checkout does not read as a change.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Rubric } from './schema.js';

export const SOURCES_PATH = '.leash/sources.json';
const DEFAULT_SOURCES = ['CLAUDE.md', 'AGENTS.md'];
const CITED_MARKDOWN = /^([\w./-]+\.md)\b/i;

/** File -> hash of its LF-normalized text. */
export type SourceStamp = Record<string, string>;

/** The instruction files behind a rubric: the defaults plus every cited Markdown file. */
export function instructionFiles(rubric: Rubric): string[] {
  const cited = rubric.rules.flatMap((rule) => CITED_MARKDOWN.exec(rule.source ?? '')?.[1] ?? []);
  return [...new Set([...DEFAULT_SOURCES, ...cited])].sort();
}

export function hashText(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

/** Stamp each of `files` that exists (a missing file is simply not a source). */
export function stampSources(files: readonly string[], read = readIfExists): SourceStamp {
  const stamp: SourceStamp = {};
  for (const file of files) {
    const text = read(file);
    if (text !== null) stamp[file] = hashText(text);
  }
  return stamp;
}

/** Files added, removed or edited between the recorded stamp and the current one. */
export function staleSources(recorded: SourceStamp, current: SourceStamp): string[] {
  const files = new Set([...Object.keys(recorded), ...Object.keys(current)]);
  return [...files].filter((file) => recorded[file] !== current[file]).sort();
}

/** The SessionStart nudge for stale sources, or null when the rubric is current. */
export function staleNudge(stale: readonly string[]): string | null {
  if (stale.length === 0) return null;
  return (
    `Leash: ${stale.join(', ')} changed since .leash/rubric.json was compiled. ` +
    'Bring the rubric in line with the current instruction files (the /leash-rubric command does this, ' +
    'where installed), then run `leash compile`. Do not loosen rules the files still state.'
  );
}

export const NO_STAMP_NUDGE =
  'Leash: .leash/rubric.json has no record of the instruction files it came from. Run `leash compile` ' +
  'to validate it and record them, so Leash can tell you when they change.';

/** SessionStart hook output carrying `text` into the agent's context (Claude Code and Codex). */
export function sessionStartOutput(text: string): {
  hookSpecificOutput: { hookEventName: 'SessionStart'; additionalContext: string };
} {
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}

function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}
