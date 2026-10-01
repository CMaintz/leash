// Calibrate the rubric against real git history: how often does each turn-phase rule
// actually fire? A rule that never fires across the sample is a dead-rule candidate
// (reword or remove). Pure reporting plus a thin Jev orchestration over commit diffs.

import type { FileDiff } from './diff.js';
import { findingsForFile, questionsForFile } from './engine.js';
import type { JevProvider } from './provider.js';
import type { Rubric } from './schema.js';

/** One rule's fire-rate across the sampled commits. */
export interface RuleCalibration {
  rule: string;
  fires: number;
  rate: number;
  dead: boolean;
}

/** Per-rule fire counts into calibration rows. A rule with zero fires is flagged dead. */
export function calibrationReport(perRuleHits: Record<string, number>, sampleSize: number): RuleCalibration[] {
  return Object.entries(perRuleHits).map(([rule, fires]) => ({
    rule,
    fires,
    rate: sampleSize > 0 ? fires / sampleSize : 0,
    dead: fires === 0,
  }));
}

/** Count, per active turn-phase rule, how many sampled commits it fired in (>= noteAt). */
export async function tallyFires(
  provider: JevProvider,
  rubric: Rubric,
  commits: FileDiff[][],
): Promise<Record<string, number>> {
  const hits = zeroedHits(rubric);
  for (const files of commits) {
    for (const ruleId of await firedRules(provider, rubric, files)) {
      hits[ruleId] = (hits[ruleId] ?? 0) + 1;
    }
  }
  return hits;
}

/** Start every active turn-phase rule at zero so a never-firing rule still shows as dead. */
function zeroedHits(rubric: Rubric): Record<string, number> {
  const hits: Record<string, number> = {};
  for (const rule of rubric.rules) {
    if (!rule.handledBy && rule.phase === 'turn') hits[rule.id] = 0;
  }
  return hits;
}

/** The set of rules that fired in at least one file of this commit. */
async function firedRules(provider: JevProvider, rubric: Rubric, files: FileDiff[]): Promise<Set<string>> {
  const fired = new Set<string>();
  for (const { file, patch } of files) {
    const questions = questionsForFile(rubric, file);
    if (Object.keys(questions).length === 0) continue;
    const { answers } = await provider.evaluate({ state: { file, diff: patch }, questions });
    for (const finding of findingsForFile(rubric, file, answers)) fired.add(finding.ruleId);
  }
  return fired;
}
