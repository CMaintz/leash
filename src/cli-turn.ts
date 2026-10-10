// The commands that judge a diff: `check`, `audit`, the turn hooks (snapshot + Stop) and
// the opt-in per-edit check. All advisory: they fail open and never break a session.

import { resolve } from 'node:path';
import { hasFlag, positionals } from './cli-args.js';
import { logMisses, printBaselined, printFindings, printSkipped, skip, skipReason } from './cli-output.js';
import {
  BASELINE_PATH,
  cliProvider,
  loadBaseline,
  loadBaselineAt,
  projectRoot,
  tryLoadRubric,
  turnRubric,
  turnSignal,
  writeJson,
} from './cli-store.js';
import { checkTurn, type CheckResult } from './check.js';
import { parseDiff } from './diff.js';
import { rebaseline } from './engine.js';
import {
  editedFiles,
  editHookOutput,
  isRepairPrompt,
  readHookInput,
  repoRelative,
  stopDecision,
  stopDecisionOnce,
  type StopHookInput,
} from './hook.js';
import type { JevProvider } from './provider.js';
import type { Finding, Rubric } from './schema.js';
import { diffToWorktree, emptyTree, readBlocked, readTurnBase, recordBlocked, writeTurnBase } from './snapshot.js';

// `--turn` diffs since the turn snapshot (what the hooks judge, so its misses are logged);
// `--json` prints a stable machine-readable result (the OpenCode plugin and CI consume it).
export async function check(baseRef?: string): Promise<void> {
  const turn = hasFlag('--turn');
  const base = turn ? readTurnBase() : (baseRef ?? 'HEAD');
  const rubric = turn ? turnRubric(base) : tryLoadRubric();
  const provider = cliProvider();
  const baseline = turn ? loadBaselineAt(base) : loadBaseline();
  const result = rubric && provider ? await judge(provider, rubric, base, baseline) : null;
  if (turn) logMisses('check --turn', rubric, result?.skipped ?? null);
  if (hasFlag('--json')) return printCheckJson(base, result, result ? undefined : skipReason(rubric));
  if (!result) return skip(rubric, provider);
  printFindings(result.actionable);
  printBaselined(result.findings, result.actionable);
  printSkipped(result.skipped);
}

/** Judge the diff from `base` to the working tree within the turn deadline. */
function judge(provider: JevProvider, rubric: Rubric, base: string, baseline: string[]): Promise<CheckResult> {
  const diffs = parseDiff(diffToWorktree(base));
  return checkTurn(provider, rubric, diffs, baseline, { signal: turnSignal() });
}

function printCheckJson(base: string, result: CheckResult | null, reason?: string): void {
  const findings = result?.actionable ?? [];
  const out = { version: 1, base, ran: result !== null, ...(reason ? { reason } : {}) };
  console.log(JSON.stringify({ ...out, findings, skipped: result?.skipped ?? [], decision: stopDecision(findings) }));
}

// Accept findings as debt; only the files it judged are rewritten. `audit [baseRef]`
// judges the diff since a ref; `audit --all [paths...]` judges whole files as if just
// written, which is how existing debt in untouched files gets baselined.
export async function audit(baseRef = 'HEAD'): Promise<void> {
  const rubric = tryLoadRubric();
  const provider = cliProvider();
  if (!rubric || !provider) return skip(rubric, provider);
  const all = hasFlag('--all');
  const diffs = parseDiff(all ? diffToWorktree(emptyTree(), positionals()) : diffToWorktree(baseRef));
  const { findings, skipped } = await checkTurn(provider, rubric, diffs, []);
  const judged = new Set(diffs.map((d) => d.file).filter((f) => !skipped.some((s) => s.file === f)));
  writeJson(BASELINE_PATH, rebaseline(loadBaseline(), judged, findings));
  console.log(`leash: accepted ${findings.length} finding(s) from ${judged.size} file(s) into ${BASELINE_PATH}`);
  printSkipped(skipped);
}

// UserPromptSubmit hook: snapshot the whole working tree (untracked files included) so
// the Stop hook can diff exactly this turn's changes. See snapshot.ts. A prompt that is
// Leash's own repair request (Codex re-submits it) continues the turn: keep its snapshot.
export async function snapshot(): Promise<void> {
  const input = await enterSession();
  if (!isRepairPrompt(input)) writeTurnBase(input.session_id);
}

// Stop hook: check what changed since the snapshot and block on new repair-band breaks.
// Every Stop is checked, continuations included (that is when a repair gets verified);
// a finding already blocked on this turn never blocks again, so nothing can loop.
export async function hook(): Promise<void> {
  const { session_id: session } = await enterSession();
  const provider = cliProvider();
  if (!provider) return logMisses('hook', tryLoadRubric(), null); // fail open: allow the stop
  const base = readTurnBase(session);
  const rubric = turnRubric(base);
  if (!rubric) return;
  const { actionable, skipped } = await judge(provider, rubric, base, loadBaselineAt(base));
  logMisses('hook', rubric, skipped);
  const { decision, blocked } = stopDecisionOnce(actionable, readBlocked(base, session));
  if (!decision.decision) return;
  recordBlocked(base, blocked, session);
  console.log(JSON.stringify(decision));
}

/** Read the hook payload and move to the repo of the session's own cwd (the host may
 * start the hook elsewhere). */
async function enterSession(): Promise<StopHookInput> {
  const input = await readHookInput();
  if (input.cwd) {
    process.chdir(input.cwd);
    process.chdir(projectRoot());
  }
  return input;
}

// Opt-in edit-phase check for one file's working-tree diff. Advisory, exit 0.
export async function editCheck(file?: string): Promise<void> {
  if (!file) return void console.log('usage: leash edit-check <file>');
  const findings = await editFindings([file]);
  if (findings === null) return skip(tryLoadRubric(), cliProvider());
  printFindings(findings);
}

// PostToolUse hook (`init --edit-phase`): judge the files the agent just edited (Claude's
// file_path, or every file in a Codex apply_patch) and hand any repair-band break back as
// context the agent can see. Silent on everything else.
export async function editHook(): Promise<void> {
  const input = await enterSession();
  const root = projectRoot();
  // Codex's patch paths are relative to the session cwd, which may be a subdirectory.
  const base = input.cwd ?? root;
  const files = editedFiles(input).flatMap((path) => repoRelative(resolve(base, path), root) ?? []);
  if (files.length === 0) return;
  const out = editHookOutput((await editFindings(files)) ?? []);
  if (out.hookSpecificOutput) console.log(JSON.stringify(out));
}

// New (non-baselined) edit-phase findings for `files`; null when there is no rubric or key.
// Same pipeline as the turn check: ignore lists, binary skip, chunking and the deadline.
async function editFindings(files: string[]): Promise<Finding[] | null> {
  const rubric = tryLoadRubric();
  const provider = cliProvider();
  if (!rubric || !provider) return null;
  const diffs = parseDiff(diffToWorktree('HEAD', files));
  const options = { phase: 'edit' as const, signal: turnSignal() };
  return (await checkTurn(provider, rubric, diffs, loadBaseline(), options)).actionable;
}
