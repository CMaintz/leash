// Compile: validate a rubric and report its shape. There is no LLM here - the agent
// authors .leash/rubric.json (see docs/COMPILE.md); this validates it and surfaces the
// deterministic-first split, so rules a linter already covers are visibly deferred, not
// spent on a Jev call.

import type { Rubric } from './schema.js';

/** A rule handed to a deterministic tool instead of Jev. */
export interface Deferral {
  id: string;
  handledBy: string;
}

/** A readable summary of a compiled rubric. */
export interface CompileSummary {
  total: number;
  active: number;
  deferred: number;
  byPhase: { turn: number; edit: number };
  deferrals: Deferral[];
}

/** Summarize a rubric: how many rules are active vs deferred to a linter, and by phase. */
export function summarize(rubric: Rubric): CompileSummary {
  const active = rubric.rules.filter((rule) => !rule.handledBy);
  const deferrals = rubric.rules
    .filter((rule) => rule.handledBy)
    .map((rule) => ({ id: rule.id, handledBy: rule.handledBy as string }));
  return {
    total: rubric.rules.length,
    active: active.length,
    deferred: deferrals.length,
    byPhase: {
      turn: active.filter((rule) => rule.phase === 'turn').length,
      edit: active.filter((rule) => rule.phase === 'edit').length,
    },
    deferrals,
  };
}
