import { readFileSync } from 'node:fs';
import { answerConfidence, choice, noul, score, validateQuestions } from '@cmaintz/jev-core';
import { calibrationReport, type RuleCalibration } from './calibrate.js';
import { commitDiffs } from './cli-calibrate.js';
import { skipReason } from './cli-output.js';
import { loadBaselineAt, loadRubricAt, loadSources, RUBRIC_PATH, tryLoadRubric, turnRubric } from './cli-store.js';
import { checkTurn, type CheckResult } from './check.js';
import { parseDiff, type FileDiff } from './diff.js';
import { inScope, matchGlob } from './engine.js';
import { git } from './git.js';
import { rubricDrift } from './guard.js';
import { recentMisses, type Miss } from './misses.js';
import type { Answer, JevProvider, Question } from './provider.js';
import type { Phase, Rubric, Rule } from './schema.js';
import { diffToWorktree, emptyTree } from './snapshot.js';
import { instructionFiles, NO_STAMP_NUDGE, stampSources, staleNudge, staleSources } from './sources.js';

export type ProviderSource = () => JevProvider | null;

const WHOLE_REQUEST = '*';
const NO_KEY_REASON = 'no JEV_API_KEY (run `leash login`)';

export async function judgeAgainstCommittedRubric(
  provider: ProviderSource,
  readDiff: () => string,
  phase: Phase,
  signal: AbortSignal,
): Promise<CheckResult> {
  try {
    const rubric = turnRubric('HEAD');
    const jev = provider();
    if (!rubric || !jev) return skippedRequest(skipReason(rubric));
    const diffs = parseDiff(readDiff());
    return await checkTurn(jev, rubric, diffs, loadBaselineAt('HEAD'), { phase, signal });
  } catch (err) {
    return skippedRequest(errorMessage(err));
  }
}

export function worktreeDiff(paths: readonly string[] = []): () => string {
  return () => diffToWorktree('HEAD', paths);
}

export function wholeFilesDiff(globs: readonly string[]): () => string {
  return () => diffToWorktree(emptyTree(), filesMatching(globs.map(repoPath)));
}

function filesMatching(globs: readonly string[]): string[] {
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const matched = files.filter((file) => globs.some((glob) => matchGlob(glob, file)));
  if (matched.length === 0) throw new Error(`no file matches ${globs.join(', ')}`);
  return matched;
}

function repoPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function skippedRequest(reason: string): CheckResult {
  return { findings: [], actionable: [], skipped: [{ file: WHOLE_REQUEST, reason }] };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface RuleList {
  rules: Rule[];
  reason?: string;
}

export function listRules(path?: string): RuleList {
  const rubric = tryLoadRubric();
  if (!rubric) return { rules: [], reason: `no rubric at ${RUBRIC_PATH}` };
  if (path === undefined) return { rules: rubric.rules };
  return { rules: rubric.rules.filter((r) => inScope(r.scope, repoPath(path))) };
}

export interface RuleExplanation {
  rule: Rule | null;
  calibration: RuleCalibration | null;
  misses: Miss[];
  reason?: string;
}

export async function explainRule(
  provider: ProviderSource,
  id: string,
  sample: number | undefined,
  signal: AbortSignal,
): Promise<RuleExplanation> {
  const rule = tryLoadRubric()?.rules.find((r) => r.id === id) ?? null;
  const misses = recentMisses(5);
  if (!rule) return { rule, calibration: null, misses, reason: `no rule "${id}" in ${RUBRIC_PATH}` };
  if (!sample) return { rule, calibration: null, misses };
  const jev = provider();
  if (!jev) return { rule, calibration: null, misses, reason: NO_KEY_REASON };
  if (rule.phase !== 'turn' || rule.handledBy)
    return { rule, calibration: null, misses, reason: 'only active turn-phase rules can be calibrated' };
  try {
    return { rule, misses, ...(await calibrateRule(jev, rule, sample, signal)) };
  } catch (err) {
    return { rule, calibration: null, misses, reason: errorMessage(err) };
  }
}

async function calibrateRule(
  jev: JevProvider,
  rule: Rule,
  sample: number,
  signal: AbortSignal,
): Promise<Pick<RuleExplanation, 'calibration' | 'reason'>> {
  const commits = commitDiffs(sample);
  const { fires, skipped } = await tallyOneRule(jev, rule, commits, signal);
  const calibration = calibrationReport({ [rule.id]: fires }, commits.length)[0]!;
  if (skipped === 0) return { calibration };
  const reason = `${skipped} file(s) could not be judged, so fires is a lower bound`;
  return { calibration: { ...calibration, dead: false }, reason };
}

async function tallyOneRule(
  jev: JevProvider,
  rule: Rule,
  commits: FileDiff[][],
  signal: AbortSignal,
): Promise<{ fires: number; skipped: number }> {
  const single = { version: 1, rules: [rule] };
  let fires = 0;
  let skipped = 0;
  for (const files of commits) {
    const result = await checkTurn(jev, single, files, [], { signal });
    if (result.findings.length > 0) fires++;
    skipped += result.skipped.length;
  }
  return { fires, skipped };
}

type JudgeKind = 'noul' | 'score' | 'choice';

export interface JudgeInput {
  question: string;
  state?: unknown;
  kind: JudgeKind;
  options?: string[] | undefined;
  levels?: string[] | undefined;
}

export interface JudgeOutput {
  answer: string | number | boolean | null;
  probability: number | null;
  skipped?: string;
}

export async function jevJudge(provider: ProviderSource, input: JudgeInput, signal: AbortSignal): Promise<JudgeOutput> {
  try {
    const questions = { q: questionFor(input) };
    validateQuestions(questions);
    const jev = provider();
    if (!jev) return { answer: null, probability: null, skipped: NO_KEY_REASON };
    const { answers } = await jev.evaluate({ state: input.state ?? null, questions, signal });
    return judgment(answers.q);
  } catch (err) {
    return { answer: null, probability: null, skipped: errorMessage(err) };
  }
}

function questionFor({ kind, question, options = [], levels = [] }: JudgeInput): Question {
  if (kind === 'choice') return choice(Object.fromEntries(options.map((o) => [o, null])), question);
  if (kind === 'score') return score(levels, question);
  return noul(question);
}

function judgment(answer: Answer | undefined): JudgeOutput {
  if (!answer) return { answer: null, probability: null, skipped: 'Jev returned no answer' };
  if (answer.type === 'noul') return { answer: answer.noul >= 0.5, probability: answer.noul };
  if (answer.type === 'choice')
    return { answer: answer.choice, probability: answer.probabilities[answer.choice] ?? answer.confidence };
  return { answer: answer.score, probability: answerConfidence(answer) ?? null };
}

export function rubricText(): string {
  try {
    return readFileSync(RUBRIC_PATH, 'utf8');
  } catch {
    return JSON.stringify({ rubric: null, reason: `no rubric at ${RUBRIC_PATH}` });
  }
}

export interface Drift {
  loosened: string[];
  staleSources: string[] | null;
  nudge: string | null;
}

export function drift(): Drift {
  const current = tryLoadRubric();
  return { loosened: loosenings(current), ...freshness(current) };
}

function loosenings(current: Rubric | null): string[] {
  const base = loadRubricAt('HEAD');
  if (!base) return [];
  return current ? rubricDrift(base, current).loosened : [`${RUBRIC_PATH}: missing or invalid`];
}

function freshness(current: Rubric | null): Pick<Drift, 'staleSources' | 'nudge'> {
  const recorded = loadSources();
  if (!current) return { staleSources: null, nudge: null };
  if (!recorded) return { staleSources: null, nudge: NO_STAMP_NUDGE };
  const stale = staleSources(recorded, stampSources(instructionFiles(current)));
  return { staleSources: stale, nudge: staleNudge(stale) };
}
