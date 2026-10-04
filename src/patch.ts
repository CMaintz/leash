// Pure patch handling for the turn-check: which patches to skip, how to split an
// oversized patch so it fits Jev's context, and how to merge the per-chunk answers.
// No I/O.

import type { Answer } from './provider.js';

/** Default per-call patch budget, in characters (well under Jev's ~32k-token context). */
export const MAX_PATCH_CHARS = 40_000;

/** True for a `git diff` patch that carries no reviewable text. */
export function isBinaryPatch(patch: string): boolean {
  return /^Binary files .* differ$/m.test(patch) || patch.includes('GIT binary patch');
}

/** Leash's own state never gets judged against the rubric. */
export function isLeashPath(file: string): boolean {
  return file === '.leash' || file.startsWith('.leash/');
}

/**
 * Split a patch into chunks of at most `maxChars`, on hunk boundaries where possible.
 * Every chunk repeats the file header so each one reads as a valid patch on its own.
 */
export function chunkPatch(patch: string, maxChars: number = MAX_PATCH_CHARS): string[] {
  if (patch.length <= maxChars) return [patch];
  const { header, hunks } = splitHunks(patch);
  const budget = Math.max(1_000, maxChars - header.length - 1);
  const pieces = hunks.flatMap((hunk) => splitOversize(hunk, budget));
  return packPieces(pieces, header, budget);
}

/** Merge per-chunk answers: a rule counts as broken if ANY chunk says so (max Noul). */
export function mergeAnswers(list: Record<string, Answer>[]): Record<string, Answer> {
  const merged: Record<string, Answer> = {};
  for (const answers of list) {
    for (const [id, answer] of Object.entries(answers)) {
      if (strongerThan(answer, merged[id])) merged[id] = answer;
    }
  }
  return merged;
}

function strongerThan(candidate: Answer, current: Answer | undefined): boolean {
  if (!current) return true;
  return candidate.type === 'noul' && current.type === 'noul' && candidate.noul > current.noul;
}

function splitHunks(patch: string): { header: string; hunks: string[] } {
  const lines = patch.split('\n');
  const first = lines.findIndex((line) => line.startsWith('@@'));
  if (first === -1) return { header: '', hunks: [patch] };
  const hunks: string[][] = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith('@@') || hunks.length === 0) hunks.push([]);
    hunks[hunks.length - 1]!.push(line);
  }
  return { header: lines.slice(0, first).join('\n'), hunks: hunks.map((h) => h.join('\n')) };
}

// A hunk larger than the budget is cut on line boundaries (a single giant line is sliced).
function splitOversize(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const out: string[] = [];
  let current = '';
  for (const line of text.split('\n').flatMap((l) => sliceLine(l, budget))) {
    if (current && current.length + line.length + 1 > budget) {
      out.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line;
  }
  return current ? [...out, current] : out;
}

function sliceLine(line: string, budget: number): string[] {
  if (line.length <= budget) return [line];
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += budget) parts.push(line.slice(i, i + budget));
  return parts;
}

function packPieces(pieces: string[], header: string, budget: number): string[] {
  const chunks: string[] = [];
  let body = '';
  for (const piece of pieces) {
    if (body && body.length + piece.length + 1 > budget) {
      chunks.push(withHeader(header, body));
      body = '';
    }
    body = body ? `${body}\n${piece}` : piece;
  }
  if (body) chunks.push(withHeader(header, body));
  return chunks;
}

function withHeader(header: string, body: string): string {
  return header ? `${header}\n${body}` : body;
}
