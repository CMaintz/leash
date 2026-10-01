// Pure engine: rubric + Jev answers -> banded findings, minus the ratchet baseline.
// No I/O. The ratchet is the point: only findings whose (rule, file) fingerprint is
// NOT already accepted count as new. Existing debt is silent; the baseline only shrinks.

import type { Answer, Question } from './provider.js';
import type { Band, Finding, Phase, Rubric, Rule } from './schema.js';

/** Turn-phase rules that apply to `file`. Rules deferred to a deterministic tool
 * (`handledBy`) are skipped: that is the deterministic-first split. */
export function rulesForFile(rubric: Rubric, file: string, phase: 'turn' | 'edit' = 'turn'): Rule[] {
  return rubric.rules.filter((rule) => rule.phase === phase && !rule.handledBy && inScope(rule.scope, file));
}

/** One Noul question per applicable rule, keyed by rule id (batched in a single call). */
export function questionsForFile(
  rubric: Rubric,
  file: string,
  phase: 'turn' | 'edit' = 'turn',
): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (const rule of rulesForFile(rubric, file, phase)) {
    questions[rule.id] = { type: 'noul', instructions: rule.question };
  }
  return questions;
}

/** Band a probability against a rule's thresholds. */
export function bandFor(rule: Rule, probability: number): Band {
  if (probability >= rule.repairAt) return 'repair';
  if (probability >= rule.noteAt) return 'note';
  return 'off';
}

/** Turn Jev's answers for one file into findings (drops `off` band). */
export function findingsForFile(
  rubric: Rubric,
  file: string,
  answers: Record<string, Answer>,
  phase: Phase = 'turn',
): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rulesForFile(rubric, file, phase)) {
    const probability = noulOf(answers[rule.id]);
    if (probability === null) continue;
    const band = bandFor(rule, probability);
    if (band === 'off') continue;
    findings.push({
      ruleId: rule.id,
      file,
      probability,
      band,
      message: describe(rule, file, probability),
      ...(rule.source ? { source: rule.source } : {}),
    });
  }
  return findings;
}

/** Stable per (rule, file) fingerprint - the ratchet key. */
export function fingerprint(finding: Pick<Finding, 'ruleId' | 'file'>): string {
  return `${finding.ruleId}::${finding.file}`;
}

/** Findings whose fingerprint is not already in the baseline. */
export function newFindings(findings: Finding[], baseline: readonly string[]): Finding[] {
  const accepted = new Set(baseline);
  return findings.filter((f) => !accepted.has(fingerprint(f)));
}

/** The sorted, de-duplicated fingerprints of all current findings - a fresh baseline. */
export function baselineFrom(findings: Finding[]): string[] {
  return [...new Set(findings.map(fingerprint))].sort();
}

function inScope(scope: string[], file: string): boolean {
  return scope.length === 0 || scope.some((glob) => matchGlob(glob, file));
}

function matchGlob(glob: string, file: string): boolean {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '@@DIRS@@')
    .replace(/\*\*/g, '@@ANY@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@DIRS@@/g, '(?:.*/)?')
    .replace(/@@ANY@@/g, '.*');
  return new RegExp(`^${pattern}$`).test(file);
}

function noulOf(answer: Answer | undefined): number | null {
  return answer && answer.type === 'noul' && typeof answer.noul === 'number' ? answer.noul : null;
}

function describe(rule: Rule, file: string, probability: number): string {
  const cite = rule.source ? ` [${rule.source}]` : '';
  return `Rule "${rule.id}" looks broken in ${file} (p=${probability.toFixed(2)})${cite}`;
}
