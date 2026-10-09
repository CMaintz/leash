// Orchestration: run the turn-check over a diff. One batched Jev call per changed file
// (all in-scope rules as questions; an oversized patch is chunked and the answers
// merged), files judged with bounded concurrency, then band and subtract the ratchet
// baseline. A failing call skips only its own file - the rest of the turn is still judged.

import type { FileDiff } from './diff.js';
import { findingsForFile, isIgnored, newFindings, questionsForFile } from './engine.js';
import { chunkPatch, isBinaryPatch, isLeashPath, MAX_PATCH_CHARS, mergeAnswers } from './patch.js';
import type { Answer, JevProvider, Question } from './provider.js';
import type { Finding, Rubric } from './schema.js';

/** A file the check could not judge (the call failed), with the reason. */
export interface Skipped {
  file: string;
  reason: string;
}

export interface CheckResult {
  /** every current finding at note or repair band. */
  findings: Finding[];
  /** findings not already in the baseline - the ones worth acting on. */
  actionable: Finding[];
  /** files whose Jev call failed; judged as clean (fail open) but reported. */
  skipped: Skipped[];
}

export interface CheckOptions {
  /** Files judged in parallel (default 4). */
  concurrency?: number;
  /** Per-call patch budget in characters before chunking (default MAX_PATCH_CHARS). */
  maxPatchChars?: number;
  /** The turn deadline: once aborted, unjudged files are skipped and in-flight calls end. */
  signal?: AbortSignal;
}

/** Whole-turn budget default (LEASH_DEADLINE_MS): the Stop hook must answer promptly. */
export const DEFAULT_DEADLINE_MS = 60_000;
export const DEADLINE_REASON = 'turn deadline reached';

interface FileResult {
  findings: Finding[];
  skipped?: Skipped;
}

export async function checkTurn(
  provider: JevProvider,
  rubric: Rubric,
  diffs: FileDiff[],
  baseline: readonly string[] = [],
  options: CheckOptions = {},
): Promise<CheckResult> {
  const results = await mapLimit(diffs, options.concurrency ?? 4, (diff) => checkFile(provider, rubric, diff, options));
  const findings = results.flatMap((r) => r.findings);
  const skipped = results.flatMap((r) => (r.skipped ? [r.skipped] : []));
  return { findings, actionable: newFindings(findings, baseline), skipped };
}

async function checkFile(
  provider: JevProvider,
  rubric: Rubric,
  diff: FileDiff,
  options: CheckOptions,
): Promise<FileResult> {
  const { file, patch } = diff;
  if (isLeashPath(file) || isIgnored(file) || isBinaryPatch(patch)) return { findings: [] };
  const questions = questionsForFile(rubric, file);
  if (Object.keys(questions).length === 0) return { findings: [] };
  const { signal } = options;
  try {
    signal?.throwIfAborted();
    const chunks = chunkPatch(patch, options.maxPatchChars ?? MAX_PATCH_CHARS);
    return { findings: findingsForFile(rubric, file, await judgeChunks(provider, file, chunks, questions, signal)) };
  } catch (err) {
    const reason = signal?.aborted ? DEADLINE_REASON : err instanceof Error ? err.message : String(err);
    return { findings: [], skipped: { file, reason } };
  }
}

// Chunks of one file go sequentially (rare, and keeps the concurrency cap honest).
async function judgeChunks(
  provider: JevProvider,
  file: string,
  chunks: string[],
  questions: Record<string, Question>,
  signal?: AbortSignal,
): Promise<Record<string, Answer>> {
  const all: Record<string, Answer>[] = [];
  for (const [i, diff] of chunks.entries()) {
    const state = chunks.length > 1 ? { file, diff, part: `${i + 1}/${chunks.length}` } : { file, diff };
    all.push((await provider.evaluate({ state, questions, ...(signal ? { signal } : {}) })).answers);
  }
  return mergeAnswers(all);
}

/** Map with at most `limit` promises in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
