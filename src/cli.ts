#!/usr/bin/env node
// The `leash` CLI - a thin wrapper over the library. `check` runs the turn-check on
// the current diff and prints what a turn newly broke; `audit` accepts current debt
// into the baseline; `report` lists the rubric. Always exits 0: Leash is advisory.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { calibrationReport, tallyFires, type RuleCalibration } from './calibrate.js';
import { checkTurn, type CheckResult, type Skipped } from './check.js';
import { summarize, type CompileSummary } from './compile.js';
import { parseDiff, type FileDiff } from './diff.js';
import { baselineFrom, findingsForFile, isIgnored, newFindings, questionsForFile } from './engine.js';
import { rubricDrift } from './guard.js';
import { editHookOutput, readHookInput, repoRelative, stopDecision } from './hook.js';
import { writeRubricCommand, removeRubricCommand } from './commands.js';
import { addLeashHooks, type Host, hostConfigPath, loadSettings, removeLeashHooks, saveSettings } from './install.js';
import { removeOpenCodePlugin, writeOpenCodePlugin } from './opencode.js';
import { isLeashPath } from './patch.js';
import { providerFromEnv } from './provider.js';
import { diffToWorktree, readTurnBase, writeTurnBase } from './snapshot.js';
import { parseRubric, type Finding, type Rubric } from './schema.js';

const RUBRIC_PATH = '.leash/rubric.json';
const BASELINE_PATH = '.leash/baseline.json';

/** An install target: a JSON-hooks host, or OpenCode (which takes a plugin file). */
type Target = Host | 'opencode';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';
  const arg = positional();
  const commands: Record<string, () => Promise<void> | void> = {
    check: () => check(arg),
    audit: () => audit(arg),
    report: () => report(),
    compile: () => compile(),
    guard: () => guard(arg),
    calibrate: () => calibrate(),
    'edit-check': () => editCheck(arg),
    snapshot: () => snapshot(),
    hook: () => hook(),
    'edit-hook': () => editHook(),
    init: () => install(hasFlag('--project'), targetFlag()),
    uninstall: () => uninstallHooks(hasFlag('--project'), targetFlag()),
    version: () => console.log(`leash ${packageVersion()}`),
    help: () =>
      console.log(
        'leash <check|audit|report|compile|guard|calibrate|edit-check|init|uninstall> [arg]\n' +
          '  check flags: --turn (diff since the turn snapshot), --json (machine-readable result)\n' +
          '  init/uninstall flags: --project (this repo, default global); --codex or --opencode (default Claude Code); --edit-phase (also wire the per-edit check)',
      ),
  };
  await (commands[command] ?? commands.help)!();
}

// `--turn` diffs since the turn snapshot (what the hooks judge); `--json` prints a stable
// machine-readable result (the OpenCode plugin and CI consume it).
async function check(baseRef?: string): Promise<void> {
  const base = hasFlag('--turn') ? readTurnBase() : (baseRef ?? 'HEAD');
  const json = hasFlag('--json');
  const rubric = loadRubric();
  const provider = providerFromEnv();
  if (!rubric || !provider) return json ? printCheckJson(base, null, skipReason(rubric)) : skip(rubric, provider);
  const result = await checkTurn(provider, rubric, parseDiff(diffToWorktree(base)), loadBaseline());
  if (json) return printCheckJson(base, result);
  printFindings(result.actionable);
  printSkipped(result.skipped);
}

function printCheckJson(base: string, result: CheckResult | null, reason?: string): void {
  const findings = result?.actionable ?? [];
  const out = { version: 1, base, ran: result !== null, ...(reason ? { reason } : {}) };
  console.log(JSON.stringify({ ...out, findings, skipped: result?.skipped ?? [], decision: stopDecision(findings) }));
}

function skipReason(rubric: Rubric | null): string {
  return rubric ? 'no JEV_API_KEY set' : `no rubric at ${RUBRIC_PATH}`;
}

async function audit(baseRef = 'HEAD'): Promise<void> {
  const rubric = loadRubric();
  const provider = providerFromEnv();
  if (!rubric || !provider) return skip(rubric, provider);
  const { findings, skipped } = await checkTurn(provider, rubric, parseDiff(diffToWorktree(baseRef)), []);
  writeJson(BASELINE_PATH, baselineFrom(findings));
  console.log(`leash: accepted ${findings.length} finding(s) into ${BASELINE_PATH}`);
  printSkipped(skipped);
}

// UserPromptSubmit hook: snapshot the whole working tree (untracked files included) so
// the Stop hook can diff exactly this turn's changes. See snapshot.ts.
function snapshot(): void {
  writeTurnBase();
}

// Stop hook: check what changed since the snapshot; block only on repair-band breaks.
async function hook(): Promise<void> {
  const input = await readHookInput(); // the hook already runs in cwd; we only read flags
  if (input.stop_hook_active) return; // Codex already forced one continuation; don't re-block
  const rubric = loadRubric();
  const provider = providerFromEnv();
  if (!rubric || !provider) return; // fail open, silent: allow the stop
  const { actionable } = await checkTurn(provider, rubric, parseDiff(diffToWorktree(readTurnBase())), loadBaseline());
  const decision = stopDecision(actionable);
  if (decision.decision) console.log(JSON.stringify(decision));
}

// Install the Stop + UserPromptSubmit hooks into the host's config (Claude Code or Codex),
// plus the /leash-rubric authoring command (Claude Code only - its command path is known).
// OpenCode takes a plugin file instead (see opencode.ts).
function install(project: boolean, host: Target): void {
  if (host === 'opencode') return void console.log(`leash: added OpenCode plugin at ${writeOpenCodePlugin(project)}`);
  const path = hostConfigPath(host, project);
  saveSettings(path, addLeashHooks(loadSettings(path), { editPhase: hasFlag('--edit-phase') }));
  console.log(`leash: installed snapshot + hook into ${path}`);
  if (host === 'claude') console.log(`leash: added /leash-rubric command at ${writeRubricCommand(project)}`);
}

function uninstallHooks(project: boolean, host: Target): void {
  if (host === 'opencode')
    return void console.log(`leash: removed OpenCode plugin at ${removeOpenCodePlugin(project)}`);
  const path = hostConfigPath(host, project);
  saveSettings(path, removeLeashHooks(loadSettings(path)));
  console.log(`leash: removed hooks from ${path}`);
  if (host === 'claude') console.log(`leash: removed /leash-rubric command at ${removeRubricCommand(project)}`);
}

// The version from package.json (always shipped), so the CLI can never drift from it.
function packageVersion(): string {
  const pkg = createRequire(import.meta.url)('../package.json') as { version?: string };
  return pkg.version ?? 'unknown';
}

// Flags may appear in any order after the subcommand.
function hasFlag(flag: string): boolean {
  return process.argv.slice(3).includes(flag);
}

function targetFlag(): Target {
  if (hasFlag('--opencode')) return 'opencode';
  return hasFlag('--codex') ? 'codex' : 'claude';
}

// The first non-flag argument after the subcommand (a base ref, a file, a sample size).
function positional(): string | undefined {
  return process.argv.slice(3).find((arg) => !arg.startsWith('--'));
}

function report(): void {
  const rubric = loadRubric();
  if (!rubric) return void console.log(`leash: no rubric at ${RUBRIC_PATH}`);
  for (const rule of rubric.rules) {
    const scope = rule.scope.length ? rule.scope.join(',') : '*';
    console.log(`- ${rule.id} [${rule.phase}] scope=${scope} repair>=${rule.repairAt} note>=${rule.noteAt}`);
  }
}

// Validate .leash/rubric.json and report the deterministic-first split. Exit 1 only
// when the rubric is malformed (never throws to the advisory catch below).
function compile(): void {
  if (!existsSync(RUBRIC_PATH)) return void console.log(`leash: no rubric at ${RUBRIC_PATH}`);
  let rubric: Rubric;
  try {
    rubric = parseRubric(JSON.parse(readFileSync(RUBRIC_PATH, 'utf8')));
  } catch (err) {
    console.error(`leash: invalid rubric - ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }
  printSummary(summarize(rubric));
}

function printSummary(s: CompileSummary): void {
  console.log(
    `leash: ${s.active} active rule(s) (turn ${s.byPhase.turn}, edit ${s.byPhase.edit}), ${s.deferred} deferred of ${s.total}.`,
  );
  for (const d of s.deferrals) console.log(`  deferred to ${d.handledBy}: ${d.id}`);
}

// Guard the rubric's integrity against a base ref: a loosening exits 1 for review.
function guard(baseRef = 'HEAD'): void {
  const current = tryLoadRubric();
  if (!current) return void console.log(`leash: no usable rubric at ${RUBRIC_PATH} - nothing to guard.`);
  const base = loadRubricAt(baseRef);
  if (!base) return void console.log(`leash: no rubric at ${baseRef} - nothing to compare.`);
  const { loosened } = rubricDrift(base, current);
  if (loosened.length === 0) return void console.log('leash: rubric not loosened.');
  console.error('leash: rubric loosened (needs review):');
  for (const line of loosened) console.error(`  - ${line}`);
  process.exitCode = 1;
}

// Score each turn-phase rule against the last N commits (default 20) and flag the
// ones that never fire. Advisory, exit 0; no key => fail-open skip.
async function calibrate(): Promise<void> {
  const rubric = loadRubric();
  const provider = providerFromEnv();
  if (!rubric || !provider) return skip(rubric, provider);
  const commits = commitDiffs(sampleSize());
  const report = calibrationReport(await tallyFires(provider, rubric, commits), commits.length);
  printCalibration(report, commits.length);
}

// Opt-in edit-phase check for one file's working-tree diff. Advisory, exit 0.
// Opt-in edit-phase check for one file's working-tree diff. Advisory, exit 0.
async function editCheck(file?: string): Promise<void> {
  if (!file) return void console.log('usage: leash edit-check <file>');
  const findings = await editFindings(file);
  if (findings === null) return skip(loadRubric(), providerFromEnv());
  printFindings(findings);
}

// PostToolUse hook (`init --edit-phase`): judge the file Claude just edited and hand any
// repair-band break back as context Claude can see. Silent on everything else.
async function editHook(): Promise<void> {
  const path = (await readHookInput()).tool_input?.file_path;
  const file = path ? repoRelative(path, repoRoot()) : null;
  if (!file) return;
  const out = editHookOutput((await editFindings(file)) ?? []);
  if (out.hookSpecificOutput) console.log(JSON.stringify(out));
}

// New (non-baselined) edit-phase findings for `file`; null when there is no rubric or key.
async function editFindings(file: string): Promise<Finding[] | null> {
  const rubric = loadRubric();
  const provider = providerFromEnv();
  if (!rubric || !provider) return null;
  const questions = questionsForFile(rubric, file, 'edit');
  if (isLeashPath(file) || isIgnored(file) || Object.keys(questions).length === 0) return [];
  const { answers } = await provider.evaluate({ state: { file, diff: diffToWorktree('HEAD', file) }, questions });
  return newFindings(findingsForFile(rubric, file, answers, 'edit'), loadBaseline());
}

function repoRoot(): string {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
}

// Diff of each of the last `sample` commits, parsed into per-file patches.
function commitDiffs(sample: number): FileDiff[][] {
  const log = execSync(`git log -n ${sample} --format=%H`, { encoding: 'utf8' });
  const shas = log.trim().split('\n').filter(Boolean);
  return shas.map((sha) =>
    parseDiff(execSync(`git show ${sha} --format=`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })),
  );
}

// `--sample N` or a bare N after the command; defaults to 20.
function sampleSize(): number {
  const args = process.argv.slice(3);
  const flagged = args.indexOf('--sample');
  const raw = flagged >= 0 ? args[flagged + 1] : args[0];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
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

// Files whose Jev call failed are judged clean (fail open) but never silently.
function printSkipped(skipped: Skipped[]): void {
  for (const s of skipped) console.log(`  [skipped] ${s.file}: ${s.reason}`);
}

function loadRubric(): Rubric | null {
  if (!existsSync(RUBRIC_PATH)) return null;
  return parseRubric(JSON.parse(readFileSync(RUBRIC_PATH, 'utf8')));
}

function tryLoadRubric(): Rubric | null {
  try {
    return loadRubric();
  } catch {
    return null;
  }
}

// The rubric as of a git ref, or null if absent/unreadable there (guard then no-ops).
function loadRubricAt(ref: string): Rubric | null {
  try {
    const text = execSync(`git show ${ref}:${RUBRIC_PATH}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return parseRubric(JSON.parse(text));
  } catch {
    return null;
  }
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
