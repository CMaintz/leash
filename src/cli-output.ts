import { type Skipped } from './check.js';
import { RUBRIC_PATH } from './cli-store.js';
import { logMiss, recentMisses } from './misses.js';
import { type Finding, type Rubric } from './schema.js';

export function skipReason(rubric: Rubric | null): string {
  return rubric ? 'no JEV_API_KEY (run `leash login`)' : `no rubric at ${RUBRIC_PATH}`;
}

export function skip(rubric: Rubric | null, provider: unknown): void {
  if (!rubric) console.log(`leash: no rubric at ${RUBRIC_PATH} - nothing to check.`);
  if (!provider)
    console.log('leash: no JEV_API_KEY - run `leash login`, or set it in the env or .env. Skipping (fail open).');
}

export function printFindings(findings: Finding[]): void {
  if (findings.length === 0) return void console.log('leash: no new rule breaks this turn.');
  const repairs = findings.filter((f) => f.band === 'repair');
  for (const f of findings) console.log(`  [${f.band}] ${f.message}`);
  if (repairs.length) console.log(`\nleash: repair ${repairs.length} rule break(s) above, then continue.`);
}

/** Findings the baseline hides. The baseline works per rule and file, so a fresh break of
 * an accepted rule in an accepted file lands here; a person can still see it. */
export function printBaselined(findings: Finding[], actionable: Finding[]): void {
  const shown = new Set(actionable);
  for (const f of findings.filter((x) => !shown.has(x))) console.log(`  [baselined ${f.band}] ${f.message}`);
}

export function printSkipped(skipped: Skipped[]): void {
  for (const s of skipped) console.log(`  [skipped] ${s.file}: ${s.reason}`);
}

/** Log each file a hook let through unjudged, plus a keyless run on a repo that has a rubric. */
export function logMisses(command: string, rubric: Rubric | null, skipped: Skipped[] | null): void {
  if (rubric && skipped === null) logMiss(command, 'no JEV_API_KEY');
  for (const s of skipped ?? []) logMiss(command, `${s.file}: ${s.reason}`);
}

export function printMisses(count: number): void {
  const misses = recentMisses(count);
  if (misses.length === 0) return;
  console.log(`
leash: last ${misses.length} unchecked run(s) (from the miss log in the git dir):`);
  for (const m of misses) console.log(`  ${m.at} ${m.command}: ${m.reason}`);
}
