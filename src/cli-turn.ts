// The commands that judge a diff: `check`, `audit`, the turn hooks (snapshot + Stop) and
// the opt-in per-edit check. All advisory: they fail open and never break a session.

import { hasFlag } from './cli-args.js';
import { logMisses, printFindings, printSkipped, skip, skipReason } from './cli-output.js';
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
import { editHookOutput, readHookInput, repoRelative, stopDecision, stopDecisionOnce } from './hook.js';
import type { JevProvider } from './provider.js';
import type { Finding, Rubric } from './schema.js';
import { diffToWorktree, readBlocked, readTurnBase, recordBlocked, writeTurnBase } from './snapshot.js';

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

// Accept the current diff's findings as debt. Only the files it judged are rewritten.
export async function audit(baseRef = 'HEAD'): Promise<void> {
  const rubric = tryLoadRubric();
  const provider = cliProvider();
  if (!rubric || !provider) return skip(rubric, provider);
  const diffs = parseDiff(diffToWorktree(baseRef));
  const { findings, skipped } = await checkTurn(provider, rubric, diffs, []);
  const judged = new Set(diffs.map((d) => d.file).filter((f) => !skipped.some((s) => s.file === f)));
  writeJson(BASELINE_PATH, rebaseline(loadBaseline(), judged, findings));
  console.log(`leash: accepted ${findings.length} finding(s) from ${judged.size} file(s) into ${BASELINE_PATH}`);
  printSkipped(skipped);
}

// UserPromptSubmit hook: snapshot the whole working tree (untracked files included) so
// the Stop hook can diff exactly this turn's changes. See snapshot.ts.
export function snapshot(): void {
  writeTurnBase();
}

// Stop hook: check what changed since the snapshot and block on new repair-band breaks.
// Every Stop is checked, continuations included (that is when a repair gets verified);
// a finding already blocked on this turn never blocks again, so nothing can loop.
export async function hook(): Promise<void> {
  await readHookInput(); // drain the payload; the turn state lives in the git dir
  const provider = cliProvider();
  if (!provider) return logMisses('hook', tryLoadRubric(), null); // fail open: allow the stop
  const base = readTurnBase();
  const rubric = turnRubric(base);
  if (!rubric) return;
  const { actionable, skipped } = await judge(provider, rubric, base, loadBaselineAt(base));
  logMisses('hook', rubric, skipped);
  const { decision, blocked } = stopDecisionOnce(actionable, readBlocked(base));
  if (!decision.decision) return;
  recordBlocked(base, blocked);
  console.log(JSON.stringify(decision));
}

// Opt-in edit-phase check for one file's working-tree diff. Advisory, exit 0.
export async function editCheck(file?: string): Promise<void> {
  if (!file) return void console.log('usage: leash edit-check <file>');
  const findings = await editFindings(file);
  if (findings === null) return skip(tryLoadRubric(), cliProvider());
  printFindings(findings);
}

// PostToolUse hook (`init --edit-phase`): judge the file Claude just edited and hand any
// repair-band break back as context Claude can see. Silent on everything else.
export async function editHook(): Promise<void> {
  const path = (await readHookInput()).tool_input?.file_path;
  const file = path ? repoRelative(path, projectRoot()) : null;
  if (!file) return;
  const out = editHookOutput((await editFindings(file)) ?? []);
  if (out.hookSpecificOutput) console.log(JSON.stringify(out));
}

// New (non-baselined) edit-phase findings for `file`; null when there is no rubric or key.
// Same pipeline as the turn check: ignore lists, binary skip, chunking and the deadline.
async function editFindings(file: string): Promise<Finding[] | null> {
  const rubric = tryLoadRubric();
  const provider = cliProvider();
  if (!rubric || !provider) return null;
  const diffs = parseDiff(diffToWorktree('HEAD', file));
  const { actionable } = await checkTurn(provider, rubric, diffs, loadBaseline(), {
    phase: 'edit',
    signal: turnSignal(),
  });
  return actionable;
}
