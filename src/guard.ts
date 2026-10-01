// Ruleset-guard for the rubric itself. Unlike everything else in Leash this is NOT
// advisory: it guards the rubric's integrity (no Jev involved), so weakening the rules
// to get a green turn is a red check that needs review. Loosening = a rule removed, a
// band threshold raised (higher bar = weaker), or a rule newly deferred to a tool.

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
  return out;
}
