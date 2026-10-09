#!/usr/bin/env node
// The `leash` CLI - a thin wrapper over the library. `check` runs the turn-check on
// the current diff and prints what a turn newly broke; `audit` accepts current debt
// into the baseline; `report` lists the rubric. Always exits 0: Leash is advisory.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { calibrate } from './cli-calibrate.js';
import { hasFlag, positional, targetFlag, type Target } from './cli-args.js';
import { logMisses, printFindings, printMisses, printSkipped, skip, skipReason } from './cli-output.js';
import { logMiss } from './misses.js';
import {
  BASELINE_PATH,
  cliProvider,
  loadBaseline,
  loadRubric,
  loadRubricAt,
  projectRoot,
  RUBRIC_PATH,
  tryLoadRubric,
  turnSignal,
  writeJson,
} from './cli-store.js';
import { checkTurn, type CheckResult } from './check.js';
import { summarize, type CompileSummary } from './compile.js';
import { parseDiff } from './diff.js';
import { baselineFrom, findingsForFile, isIgnored, newFindings, questionsForFile } from './engine.js';
import { rubricDrift } from './guard.js';
import { editHookOutput, readHookInput, repoRelative, stopDecision, stopDecisionOnce } from './hook.js';
import { writeRubricCommand, removeRubricCommand } from './commands.js';
import { addLeashHooks, hostConfigPath, loadSettings, removeLeashHooks, saveSettings } from './install.js';
import { removeOpenCodePlugin, writeOpenCodePlugin } from './opencode.js';
import { isLeashPath } from './patch.js';
import { saveApiKey } from './env.js';
import { readSecret } from './secret.js';
import { diffToWorktree, readBlocked, readTurnBase, recordBlocked, writeTurnBase } from './snapshot.js';
import { parseRubric, type Finding, type Rubric } from './schema.js';
import type { JevProvider } from './provider.js';

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
    login: () => login(),
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

// `--turn` diffs since the turn snapshot (what the hooks judge, so its misses are logged);
// `--json` prints a stable machine-readable result (the OpenCode plugin and CI consume it).
async function check(baseRef?: string): Promise<void> {
  const turn = hasFlag('--turn');
  const base = turn ? readTurnBase() : (baseRef ?? 'HEAD');
  const json = hasFlag('--json');
  const rubric = loadRubric();
  const provider = cliProvider();
  const result = rubric && provider ? await checkDiff(provider, rubric, base) : null;
  if (turn) logMisses('check --turn', rubric, result?.skipped ?? null);
  if (json) return printCheckJson(base, result, result ? undefined : skipReason(rubric));
  if (!result) return skip(rubric, provider);
  printFindings(result.actionable);
  printSkipped(result.skipped);
}

function checkDiff(provider: JevProvider, rubric: Rubric, base: string): Promise<CheckResult> {
  const diffs = parseDiff(diffToWorktree(base));
  return checkTurn(provider, rubric, diffs, loadBaseline(), { signal: turnSignal() });
}

function printCheckJson(base: string, result: CheckResult | null, reason?: string): void {
  const findings = result?.actionable ?? [];
  const out = { version: 1, base, ran: result !== null, ...(reason ? { reason } : {}) };
  console.log(JSON.stringify({ ...out, findings, skipped: result?.skipped ?? [], decision: stopDecision(findings) }));
}

async function audit(baseRef = 'HEAD'): Promise<void> {
  const rubric = loadRubric();
  const provider = cliProvider();
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

// Stop hook: check what changed since the snapshot and block on new repair-band breaks.
// Every Stop is checked, continuations included (that is when a repair gets verified);
// a finding already blocked on this turn never blocks again, so nothing can loop.
async function hook(): Promise<void> {
  await readHookInput(); // drain the payload; the turn state lives in the git dir
  const rubric = loadRubric();
  const provider = cliProvider();
  if (!rubric || !provider) return logMisses('hook', rubric, null); // fail open: allow the stop
  const base = readTurnBase();
  const { actionable, skipped } = await checkDiff(provider, rubric, base);
  logMisses('hook', rubric, skipped);
  const { decision, blocked } = stopDecisionOnce(actionable, readBlocked(base));
  if (!decision.decision) return;
  recordBlocked(base, blocked);
  console.log(JSON.stringify(decision));
}

// Store the API key owner-only in ~/.leash/.env, read by every later run (see env.ts).
async function login(): Promise<void> {
  const apiKey = await readSecret('TypeSafe API key (input hidden): ');
  if (!apiKey) return void console.log('leash: no key entered - nothing saved.');
  console.log(`leash: saved JEV_API_KEY to ${saveApiKey(apiKey)}`);
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

function report(): void {
  const rubric = loadRubric();
  if (!rubric) return void console.log(`leash: no rubric at ${RUBRIC_PATH}`);
  for (const rule of rubric.rules) {
    const scope = rule.scope.length ? rule.scope.join(',') : '*';
    console.log(`- ${rule.id} [${rule.phase}] scope=${scope} repair>=${rule.repairAt} note>=${rule.noteAt}`);
  }
  printMisses(5);
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

// Opt-in edit-phase check for one file's working-tree diff. Advisory, exit 0.
async function editCheck(file?: string): Promise<void> {
  if (!file) return void console.log('usage: leash edit-check <file>');
  const findings = await editFindings(file);
  if (findings === null) return skip(loadRubric(), cliProvider());
  printFindings(findings);
}

// PostToolUse hook (`init --edit-phase`): judge the file Claude just edited and hand any
// repair-band break back as context Claude can see. Silent on everything else.
async function editHook(): Promise<void> {
  const path = (await readHookInput()).tool_input?.file_path;
  const file = path ? repoRelative(path, projectRoot()) : null;
  if (!file) return;
  const out = editHookOutput((await editFindings(file)) ?? []);
  if (out.hookSpecificOutput) console.log(JSON.stringify(out));
}

// New (non-baselined) edit-phase findings for `file`; null when there is no rubric or key.
async function editFindings(file: string): Promise<Finding[] | null> {
  const rubric = loadRubric();
  const provider = cliProvider();
  if (!rubric || !provider) return null;
  const questions = questionsForFile(rubric, file, 'edit');
  if (isLeashPath(file) || isIgnored(file) || Object.keys(questions).length === 0) return [];
  const state = { file, diff: diffToWorktree('HEAD', file) };
  const { answers } = await provider.evaluate({ state, questions, signal: turnSignal() });
  return newFindings(findingsForFile(rubric, file, answers, 'edit'), loadBaseline());
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logMiss(process.argv[2] ?? 'help', message);
  console.error(`leash: ${message}`);
  process.exit(0); // advisory: never break the session
});
