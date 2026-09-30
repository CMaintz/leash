// The rubric, verdicts, and ratchet baseline. A rubric is a committed, readable file;
// every finding cites the rule id it came from. Hand-validated (zero deps).

/** When a rule is judged: once per turn on the whole diff, or after each edit. */
export type Phase = 'turn' | 'edit';

/** What a finding's probability earns it. */
export type Band = 'repair' | 'note' | 'off';

/** One un-lintable rule, compiled from an instruction file. */
export interface Rule {
  id: string;
  /** the narrow yes/no judgment Jev is asked, phrased so a break is `true`. */
  question: string;
  phase: Phase;
  /** globs the rule applies to; empty means every file. */
  scope: string[];
  /** probability at or above which the agent is told to repair. */
  repairAt: number;
  /** probability at or above which a note is shown (below repairAt). */
  noteAt: number;
  /** provenance: the instruction file + line this was compiled from. */
  source?: string;
}

export interface Rubric {
  version: number;
  rules: Rule[];
}

/** One judged (rule, file) pair. */
export interface Finding {
  ruleId: string;
  file: string;
  probability: number;
  band: Band;
  message: string;
  source?: string;
}

/** Sorted list of accepted-debt fingerprints - the one-way ratchet. */
export type Baseline = string[];

const DEFAULTS = { phase: 'turn' as Phase, scope: [] as string[], repairAt: 0.8, noteAt: 0.5 };

/** Validate and normalize a parsed rubric, applying defaults. Throws on malformed input. */
export function parseRubric(raw: unknown): Rubric {
  if (!isObject(raw) || !Array.isArray(raw.rules)) {
    throw new Error('rubric: expected { version, rules: [] }');
  }
  return { version: typeof raw.version === 'number' ? raw.version : 1, rules: raw.rules.map(normalizeRule) };
}

function normalizeRule(raw: unknown, index: number): Rule {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.question !== 'string') {
    throw new Error(`rubric.rules[${index}]: each rule needs a string id and question`);
  }
  return {
    id: raw.id,
    question: raw.question,
    phase: raw.phase === 'edit' ? 'edit' : DEFAULTS.phase,
    scope: Array.isArray(raw.scope) ? raw.scope.filter((s): s is string => typeof s === 'string') : DEFAULTS.scope,
    repairAt: numberOr(raw.repairAt, DEFAULTS.repairAt),
    noteAt: numberOr(raw.noteAt, DEFAULTS.noteAt),
    ...(typeof raw.source === 'string' ? { source: raw.source } : {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback;
}
