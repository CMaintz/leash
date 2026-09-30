#!/usr/bin/env node
// The `leash` CLI - a thin wrapper over the library. `check` runs the turn-check on
// the current diff and prints what a turn newly broke; `audit` accepts current debt
// into the baseline; `report` lists the rubric. Always exits 0: Leash is advisory.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { checkTurn } from './check.js';
import { parseDiff } from './diff.js';
import { baselineFrom } from './engine.js';
import { providerFromEnv } from './provider.js';
import { parseRubric, type Finding, type Rubric } from './schema.js';

const RUBRIC_PATH = '.leash/rubric.json';
const BASELINE_PATH = '.leash/baseline.json';

async function main(): Promise<void> {
  const [command = 'help', arg] = process.argv.slice(2);
  const commands: Record<string, () => Promise<void> | void> = {
    check: () => check(arg),
    audit: () => audit(arg),
    report: () => report(),
    version: () => console.log('leash 0.1.0'),
    help: () => console.log('leash <check|audit|report> [baseRef]'),
  };
  await (commands[command] ?? commands.help)!();
}

async function check(baseRef = 'HEAD'): Promise<void> {
  const rubric = loadRubric();
  const provider = providerFromEnv();
  if (!rubric || !provider) return skip(rubric, provider);
  const diffs = parseDiff(gitDiff(baseRef));
  const { actionable } = await checkTurn(provider, rubric, diffs, loadBaseline());
  printFindings(actionable);
}

async function audit(baseRef = 'HEAD'): Promise<void> {
  const rubric = loadRubric();
  const provider = providerFromEnv();
  if (!rubric || !provider) return skip(rubric, provider);
  const { findings } = await checkTurn(provider, rubric, parseDiff(gitDiff(baseRef)), []);
  writeJson(BASELINE_PATH, baselineFrom(findings));
  console.log(`leash: accepted ${findings.length} finding(s) into ${BASELINE_PATH}`);
}

function report(): void {
  const rubric = loadRubric();
  if (!rubric) return void console.log(`leash: no rubric at ${RUBRIC_PATH}`);
  for (const rule of rubric.rules) {
    const scope = rule.scope.length ? rule.scope.join(',') : '*';
    console.log(`- ${rule.id} [${rule.phase}] scope=${scope} repair>=${rule.repairAt} note>=${rule.noteAt}`);
  }
}

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) return void console.log('leash: no new rule breaks this turn.');
  const repairs = findings.filter((f) => f.band === 'repair');
  for (const f of findings) console.log(`  [${f.band}] ${f.message}`);
  if (repairs.length) console.log(`\nleash: repair ${repairs.length} rule break(s) above, then continue.`);
}

function skip(rubric: Rubric | null, provider: unknown): void {
  if (!rubric) console.log(`leash: no rubric at ${RUBRIC_PATH} - nothing to check.`);
  if (!provider) console.log('leash: no JEV_API_KEY set - skipping (fail open).');
}

function gitDiff(baseRef: string): string {
  return execSync(`git diff ${baseRef}`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function loadRubric(): Rubric | null {
  if (!existsSync(RUBRIC_PATH)) return null;
  return parseRubric(JSON.parse(readFileSync(RUBRIC_PATH, 'utf8')));
}

function loadBaseline(): string[] {
  if (!existsSync(BASELINE_PATH)) return [];
  const parsed: unknown = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
}

function writeJson(path: string, value: unknown): void {
  mkdirSync('.leash', { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

main().catch((err: unknown) => {
  console.error(`leash: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(0); // advisory: never break the session
});
