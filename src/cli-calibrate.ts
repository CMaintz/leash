import { existsSync, readFileSync } from 'node:fs';
import { calibrationReport, tallyFires, type RuleCalibration } from './calibrate.js';
import { flagValue, hasFlag, sampleSize } from './cli-args.js';
import { skip } from './cli-output.js';
import { cliProvider, loadRubric, projectRoot, RUBRIC_PATH, writeJson } from './cli-store.js';
import { parseDiff, type FileDiff } from './diff.js';
import { git } from './git.js';
import { envFiles, resolveEnv } from './env.js';
import { parseRubric } from './schema.js';
import {
  applyBands,
  parseYesAtThresholds,
  planBands,
  type BandChange,
  type BandPlan,
  type YesAtEntry,
  type YesAtThresholds,
} from './thresholds.js';

export async function calibrate(): Promise<void> {
  if (hasFlag('--from')) return calibrateFrom(flagValue('--from'), hasFlag('--dry-run'));
  const rubric = loadRubric();
  const provider = cliProvider();
  if (!rubric || !provider) return skip(rubric, provider);
  const commits = commitDiffs(sampleSize());
  const report = calibrationReport(await tallyFires(provider, rubric, commits), commits.length);
  printCalibration(report, commits.length);
}

export function commitDiffs(sample: number): FileDiff[][] {
  const log = git(['log', '-n', String(sample), '--format=%H']);
  const shas = log.trim().split('\n').filter(Boolean);
  return shas.map((sha) => parseDiff(git(['show', sha, '--format='])));
}

function printCalibration(report: RuleCalibration[], sample: number): void {
  if (report.length === 0) return void console.log('leash: no active turn-phase rules to calibrate.');
  console.log(`leash: calibrated ${report.length} rule(s) over ${sample} commit(s).`);
  for (const r of [...report].sort((a, b) => a.rate - b.rate)) {
    console.log(`  ${r.dead ? 'DEAD' : '    '} ${r.rule}: ${r.fires}/${sample} (${Math.round(r.rate * 100)}%)`);
  }
  const dead = report.filter((r) => r.dead).map((r) => r.rule);
  if (dead.length) console.log(`\nleash: ${dead.length} rule(s) never fired - reword or remove: ${dead.join(', ')}`);
}

// `calibrate --from thresholds.json`: write jev-eval's measured yesAt bands into the rubric
// as plain numbers, so the change is a reviewable diff that `leash guard` sees. No Jev call.
// A refused file exits 1, like `compile` on a malformed rubric (a manual command, not a hook).
function calibrateFrom(path: string | undefined, dryRun: boolean): void {
  if (!path) return void console.log('usage: leash calibrate --from <thresholds.json> [--dry-run]');
  if (!existsSync(RUBRIC_PATH)) return void console.log(`leash: no rubric at ${RUBRIC_PATH}`);
  try {
    const raw: unknown = JSON.parse(readFileSync(RUBRIC_PATH, 'utf8'));
    const thresholds = parseYesAtThresholds(JSON.parse(readFileSync(path, 'utf8')));
    const plan = planBands(parseRubric(raw), thresholds, configuredModel());
    printPlan(path, thresholds, plan);
    if (!dryRun && plan.changes.length) writeJson(RUBRIC_PATH, applyBands(raw, plan.changes));
    if (plan.changes.length)
      console.log(dryRun ? 'leash: dry run, rubric not written.' : `leash: wrote ${RUBRIC_PATH}.`);
  } catch (err) {
    console.error(`leash: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// The model Leash calls: JEV_MODEL from the env or Leash's env files, else the provider default.
function configuredModel(): string {
  return resolveEnv(process.env, envFiles(projectRoot())).JEV_MODEL || 'jev-latest';
}

function printPlan(path: string, thresholds: YesAtThresholds, plan: BandPlan): void {
  const when = thresholds.generatedAt ? ` at ${thresholds.generatedAt}` : '';
  console.log(`leash: bands from ${path} (${thresholds.model}${when})`);
  for (const w of plan.warnings) console.log(`  warning: ${w}`);
  for (const c of plan.changes) printChange(c);
  if (plan.unmeasured.length) console.log(`  not measured (left as is): ${plan.unmeasured.join(', ')}`);
}

function printChange(c: BandChange): void {
  console.log(`  ${c.ruleId}`);
  console.log(`    repairAt ${c.before.repairAt} -> ${c.after.repairAt} ${provenance(c.strict)}`);
  const note = c.loose ? provenance(c.loose) : '(one target measured; capped at repairAt)';
  if (c.loose || c.after.noteAt !== c.before.noteAt)
    console.log(`    noteAt   ${c.before.noteAt} -> ${c.after.noteAt} ${note}`);
}

function provenance(e: YesAtEntry): string {
  const stats = (['precision', 'recall', 'flagged', 'n'] as const)
    .filter((k) => e[k] !== undefined)
    .map((k) => `${k} ${e[k]}`);
  return `(target ${e.target}${stats.length ? `, ${stats.join(', ')}` : ''})`;
}
