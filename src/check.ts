// Orchestration: run the turn-check over a diff. One batched Jev call per changed
// file (all in-scope rules as questions), then band and subtract the ratchet baseline.

import type { FileDiff } from './diff.js';
import { findingsForFile, newFindings, questionsForFile } from './engine.js';
import type { JevProvider } from './provider.js';
import type { Finding, Rubric } from './schema.js';

export interface CheckResult {
  /** every current finding at note or repair band. */
  findings: Finding[];
  /** findings not already in the baseline - the ones worth acting on. */
  actionable: Finding[];
}

export async function checkTurn(
  provider: JevProvider,
  rubric: Rubric,
  diffs: FileDiff[],
  baseline: readonly string[] = [],
): Promise<CheckResult> {
  const findings: Finding[] = [];
  for (const { file, patch } of diffs) {
    const questions = questionsForFile(rubric, file);
    if (Object.keys(questions).length === 0) continue;
    const { answers } = await provider.evaluate({ state: { file, diff: patch }, questions });
    findings.push(...findingsForFile(rubric, file, answers));
  }
  return { findings, actionable: newFindings(findings, baseline) };
}
