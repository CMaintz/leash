import { type Skipped } from './check.js';
import { RUBRIC_PATH } from './cli-store.js';
import { type Finding, type Rubric } from './schema.js';

export function skipReason(rubric: Rubric | null): string {
  return rubric ? 'no JEV_API_KEY set' : `no rubric at ${RUBRIC_PATH}`;
}

export function skip(rubric: Rubric | null, provider: unknown): void {
  if (!rubric) console.log(`leash: no rubric at ${RUBRIC_PATH} - nothing to check.`);
  if (!provider) console.log('leash: no JEV_API_KEY set - skipping (fail open).');
}

export function printFindings(findings: Finding[]): void {
  if (findings.length === 0) return void console.log('leash: no new rule breaks this turn.');
  const repairs = findings.filter((f) => f.band === 'repair');
  for (const f of findings) console.log(`  [${f.band}] ${f.message}`);
  if (repairs.length) console.log(`\nleash: repair ${repairs.length} rule break(s) above, then continue.`);
}

export function printSkipped(skipped: Skipped[]): void {
  for (const s of skipped) console.log(`  [skipped] ${s.file}: ${s.reason}`);
}
