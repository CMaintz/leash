import { execSync } from 'node:child_process';
import { calibrationReport, tallyFires, type RuleCalibration } from './calibrate.js';
import { sampleSize } from './cli-args.js';
import { skip } from './cli-output.js';
import { cliProvider, loadRubric } from './cli-store.js';
import { parseDiff, type FileDiff } from './diff.js';

export async function calibrate(): Promise<void> {
  const rubric = loadRubric();
  const provider = cliProvider();
  if (!rubric || !provider) return skip(rubric, provider);
  const commits = commitDiffs(sampleSize());
  const report = calibrationReport(await tallyFires(provider, rubric, commits), commits.length);
  printCalibration(report, commits.length);
}

export function commitDiffs(sample: number): FileDiff[][] {
  const log = execSync(`git log -n ${sample} --format=%H`, { encoding: 'utf8' });
  const shas = log.trim().split('\n').filter(Boolean);
  return shas.map((sha) =>
    parseDiff(execSync(`git show ${sha} --format=`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })),
  );
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
