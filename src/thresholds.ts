// Read a jev-eval thresholds.json (contract version 1) and turn its `yesAt` section into
// repairAt/noteAt bands for the rubric. jev-eval measured, on labeled data, the raw P(yes)
// at which a rule's Noul reaches a precision target; Leash bands on exactly that number
// (`probability >= repairAt`). Pure: no I/O. The CLI writes the result into the rubric.

import type { Question } from './provider.js';
import type { Rubric, Rule } from './schema.js';

/** One measured precision target for a question: flag when raw P(yes) >= threshold. */
export interface YesAtEntry {
  target: number;
  threshold: number;
  precision?: number;
  recall?: number;
  flagged?: number;
  n?: number;
}

/** The parts of a thresholds.json Leash reads. `questions`/`composite` are ignored. */
export interface YesAtThresholds {
  model: string;
  generatedAt?: string;
  yesAt: Record<string, YesAtEntry[]>;
  definitions?: Record<string, unknown>;
}

export interface BandChange {
  ruleId: string;
  before: { repairAt: number; noteAt: number };
  after: { repairAt: number; noteAt: number };
  strict: YesAtEntry;
  /** the loosest entry, absent when jev-eval reached only one target. */
  loose?: YesAtEntry;
}

export interface BandPlan {
  changes: BandChange[];
  /** rules jev-eval has no yesAt entry for; left untouched. */
  unmeasured: string[];
  warnings: string[];
}

export function parseYesAtThresholds(raw: unknown): YesAtThresholds {
  if (!isObject(raw)) throw new Error('thresholds: expected a JSON object');
  if (raw.version !== 1) throw new Error(`thresholds: unsupported version ${String(raw.version)} (Leash reads 1)`);
  if (typeof raw.model !== 'string') throw new Error('thresholds: missing model');
  if (!isObject(raw.yesAt)) {
    throw new Error('thresholds: no yesAt section; re-run `jev-eval thresholds --yes-precision ...`');
  }
  return {
    model: raw.model,
    ...(typeof raw.generatedAt === 'string' ? { generatedAt: raw.generatedAt } : {}),
    yesAt: parseYesAt(raw.yesAt),
    ...(isObject(raw.definitions) ? { definitions: raw.definitions } : {}),
  };
}

function parseYesAt(raw: Record<string, unknown>): Record<string, YesAtEntry[]> {
  const out: Record<string, YesAtEntry[]> = {};
  for (const [id, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) throw new Error(`thresholds: yesAt.${id} must be a list`);
    out[id] = list.map((entry, i) => parseEntry(entry, `yesAt.${id}[${i}]`));
  }
  return out;
}

function parseEntry(raw: unknown, where: string): YesAtEntry {
  if (!isObject(raw) || !isProbability(raw.threshold) || !isProbability(raw.target)) {
    throw new Error(`thresholds: ${where} needs a numeric target and threshold in [0, 1]`);
  }
  const entry: YesAtEntry = { target: raw.target, threshold: raw.threshold };
  for (const key of ['precision', 'recall', 'flagged', 'n'] as const) {
    if (typeof raw[key] === 'number') entry[key] = raw[key];
  }
  return entry;
}

/** The Noul Leash sends for a rule; must stay in lock-step with engine.questionsForFile. */
export function wireQuestion(rule: Pick<Rule, 'question'>): Question {
  return { type: 'noul', instructions: rule.question };
}

export function planBands(rubric: Rubric, thresholds: YesAtThresholds, configuredModel: string): BandPlan {
  const plan: BandPlan = { changes: [], unmeasured: [], warnings: [] };
  if (thresholds.model !== configuredModel) {
    plan.warnings.push(`measured on ${thresholds.model}, but Leash is configured for ${configuredModel}`);
  }
  for (const rule of rubric.rules) planRule(rule, thresholds, plan);
  const known = new Set(rubric.rules.map((r) => r.id));
  for (const id of Object.keys(thresholds.yesAt)) {
    if (!known.has(id)) plan.warnings.push(`${id} is in yesAt but not in the rubric; ignored`);
  }
  return plan;
}

function planRule(rule: Rule, thresholds: YesAtThresholds, plan: BandPlan): void {
  const entries = thresholds.yesAt[rule.id] ?? [];
  if (entries.length === 0) return void plan.unmeasured.push(rule.id);
  if (isReworded(rule, thresholds.definitions)) {
    plan.warnings.push(`${rule.id} was reworded since it was measured; re-measure`);
  }
  const change = bandChange(rule, entries);
  if (change.after.noteAt > change.after.repairAt) {
    return void plan.warnings.push(`${rule.id}: stricter target has the lower threshold; left untouched`);
  }
  plan.changes.push(change);
}

/** Strictest target -> repairAt, loosest -> noteAt. One entry sets repairAt only. */
function bandChange(rule: Rule, entries: YesAtEntry[]): BandChange {
  const sorted = [...entries].sort((a, b) => b.target - a.target);
  const strict = sorted[0]!;
  const before = { repairAt: rule.repairAt, noteAt: rule.noteAt };
  if (sorted.length === 1) {
    const after = { repairAt: strict.threshold, noteAt: Math.min(rule.noteAt, strict.threshold) };
    return { ruleId: rule.id, before, after, strict };
  }
  const loose = sorted[sorted.length - 1]!;
  return { ruleId: rule.id, before, after: { repairAt: strict.threshold, noteAt: loose.threshold }, strict, loose };
}

function isReworded(rule: Rule, definitions: Record<string, unknown> | undefined): boolean {
  if (!definitions || !(rule.id in definitions)) return false;
  return canonical(definitions[rule.id]) !== canonical(wireQuestion(rule));
}

/** Patch repairAt/noteAt into the raw rubric JSON, leaving every other field as written. */
export function applyBands(rawRubric: unknown, changes: BandChange[]): unknown {
  if (!isObject(rawRubric) || !Array.isArray(rawRubric.rules)) return rawRubric;
  const byId = new Map(changes.map((c) => [c.ruleId, c.after]));
  const rules = rawRubric.rules.map((rule: unknown) => {
    const after = isObject(rule) && typeof rule.id === 'string' ? byId.get(rule.id) : undefined;
    return after ? { ...(rule as Record<string, unknown>), ...after } : rule;
  });
  return { ...rawRubric, rules };
}

/** JSON with object keys sorted, so two values compare equal regardless of key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isObject(v) && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}
