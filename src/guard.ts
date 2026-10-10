// Ruleset-guard for the rubric itself. Unlike everything else in Leash this is NOT
// advisory: it guards the rubric's integrity (no Jev involved), so weakening the rules
// to get a green turn is a red check that needs review. Loosening = a rule removed, a
// band threshold raised (higher bar = weaker), a rule newly deferred to a tool, its scope
// narrowed, its phase moved off the default turn check, or its question reworded (a
// rewrite can neuter a rule as surely as deleting it). A grown baseline is accepted debt
// and needs the same review.

import type { Rubric, Rule } from './schema.js';

export interface RubricDrift {
  loosened: string[];
}

/** Report every way `newRubric` is weaker than `oldRubric`. Tightening and additions are fine. */
export function rubricDrift(oldRubric: Rubric, newRubric: Rubric): RubricDrift {
  const next = new Map(newRubric.rules.map((rule) => [rule.id, rule]));
  const loosened: string[] = [];
  for (const before of oldRubric.rules) {
    const after = next.get(before.id);
    if (!after) {
      loosened.push(`${before.id}: removed`);
      continue;
    }
    loosened.push(...weakenings(before, after));
  }
  return { loosened };
}

function weakenings(before: Rule, after: Rule): string[] {
  const out: string[] = [];
  if (after.repairAt > before.repairAt) {
    out.push(`${before.id}: repairAt raised ${before.repairAt} -> ${after.repairAt}`);
  }
  if (after.noteAt > before.noteAt) {
    out.push(`${before.id}: noteAt raised ${before.noteAt} -> ${after.noteAt}`);
  }
  if (after.handledBy && !before.handledBy) {
    out.push(`${before.id}: now deferred to ${after.handledBy} (dodges the Jev check)`);
  }
  return [...out, ...reach(before, after)];
}

// Changes that make a rule fire on less: narrower scope, the opt-in edit phase, new wording.
function reach(before: Rule, after: Rule): string[] {
  const out: string[] = [];
  const dropped = before.scope.length === 0 ? after.scope : before.scope.filter((g) => !after.scope.includes(g));
  if (after.scope.length > 0 && dropped.length > 0) {
    out.push(`${before.id}: scope narrowed [${before.scope.join(', ') || '*'}] -> [${after.scope.join(', ')}]`);
  }
  if (before.phase === 'turn' && after.phase === 'edit') out.push(`${before.id}: moved to the opt-in edit phase`);
  if (after.question !== before.question) out.push(`${before.id}: question reworded`);
  return out;
}

/** Baseline entries in `after` that `before` lacked: newly accepted debt. */
export function baselineGrowth(before: readonly string[], after: readonly string[]): string[] {
  const known = new Set(before);
  return after.filter((entry) => !known.has(entry)).map((entry) => `baseline: accepted ${entry}`);
}
