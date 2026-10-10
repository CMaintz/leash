// Hook glue, shared by Claude Code and Codex. The pure parts turn actionable findings
// into the exact JSON each event expects; the runners in cli.ts read the hook stdin and
// drive the check. Checked against the Claude Code hooks reference and Codex's own
// generated schemas (codex-rs/hooks/schema/generated/stop.command.{input,output}):
//   Stop: input on stdin includes cwd and stop_hook_active; a { decision: "block", reason }
//   on stdout (exit 0) makes the agent keep working in the same turn (Codex injects
//   `reason` as the next user message; Claude Code the same - Codex's schema even notes it
//   mirrors Claude's "reason required when decision is block" rule). BOTH hosts set
//   `stop_hook_active` once any Stop hook has forced a continuation (Claude also caps at 8
//   continuations). Leash does not use that flag to skip: a continuation is exactly when a
//   repair needs verifying. Instead it blocks at most once per finding per turn
//   (stopDecisionOnce), so repairs are re-checked but a phantom finding cannot loop.
//   PostToolUse: Claude Code puts the edited file in `tool_input.file_path` (there is no
//   CLAUDE_FILE_PATH env var). Codex edits through apply_patch: its matcher accepts Edit and
//   Write as aliases, but `tool_input` is `{ command: <patch text> }`, so the files come from
//   the patch's `*** Add/Update File:` lines. Plain exit-0 stdout only reaches the debug
//   log - feedback the agent can see goes out as `hookSpecificOutput.additionalContext`
//   (same field in Codex's post-tool-use output schema).
//   Every event carries `session_id`, which keys the turn state so two sessions in one
//   checkout don't share a snapshot.
// Advisory throughout: on any doubt we allow the stop and stay silent.

import { isAbsolute, relative } from 'node:path';
import { fingerprint, newFindings } from './engine.js';
import type { Finding } from './schema.js';

/** What the hooks read on stdin (only the fields we use). */
export interface StopHookInput {
  cwd?: string;
  hook_event_name?: string;
  session_id?: string;
  /** UserPromptSubmit: the prompt text. */
  prompt?: string;
  /** PostToolUse: Claude's edited file (absolute), or Codex's apply_patch text. */
  tool_input?: { file_path?: string; command?: string };
}

/** The files a PostToolUse event edited: Claude's `file_path`, or every file named in a
 * Codex apply_patch (`*** Add File:`, `*** Update File:`, `*** Move to:`). */
export function editedFiles(input: StopHookInput): string[] {
  const { file_path, command } = input.tool_input ?? {};
  if (file_path) return [file_path];
  if (!command) return [];
  return [...command.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+?)\s*$/gm)].map((m) => m[1]!);
}

const REPAIR_PREFIX = 'Leash: this turn broke ';

/** True when a prompt is Leash's own repair request coming back as a new prompt (Codex
 * injects the block reason as a user message); it continues the turn, not a new one. */
export function isRepairPrompt(input: StopHookInput): boolean {
  return input.prompt?.startsWith(REPAIR_PREFIX) ?? false;
}

/** The Stop-hook decision. An empty object means "allow the agent to stop". */
export interface StopDecision {
  decision?: 'block';
  reason?: string;
}

/** PostToolUse feedback Claude can see. An empty object means "say nothing". */
export interface EditHookOutput {
  hookSpecificOutput?: { hookEventName: 'PostToolUse'; additionalContext: string };
}

/**
 * Turn actionable findings into a Stop decision. Only `repair`-band findings block;
 * `note`-band findings never interrupt the agent. No new repairs means allow.
 */
export function stopDecision(actionable: Finding[]): StopDecision {
  const repairs = repairsOf(actionable);
  if (repairs.length === 0) return {};
  const reason = `${REPAIR_PREFIX}${repairs.length} project rule(s):\n${bullets(repairs)}\n\nRepair them, then continue.`;
  return { decision: 'block', reason };
}

/**
 * The Stop decision for a turn that may already have been blocked: only findings not
 * blocked before this turn can block again. Returns the updated per-turn block record.
 */
export function stopDecisionOnce(
  actionable: Finding[],
  alreadyBlocked: readonly string[],
): { decision: StopDecision; blocked: string[] } {
  const fresh = newFindings(actionable, alreadyBlocked);
  const decision = stopDecision(fresh);
  if (!decision.decision) return { decision, blocked: [...alreadyBlocked] };
  const blocked = [...new Set([...alreadyBlocked, ...repairsOf(fresh).map(fingerprint)])].sort();
  return { decision, blocked };
}

/**
 * Turn an edit's findings into PostToolUse context. Advisory, never a block: per-edit
 * precision is lower than per-turn, so Claude is told and decides; it is not stopped.
 */
export function editHookOutput(findings: Finding[]): EditHookOutput {
  const repairs = repairsOf(findings);
  if (repairs.length === 0) return {};
  const additionalContext = `Leash: this edit looks like it breaks ${repairs.length} project rule(s):\n${bullets(repairs)}\n\nFix it now if it really does; ignore it if not.`;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } };
}

/** `filePath` relative to the repo `root`, with forward slashes, or null if outside it. */
export function repoRelative(filePath: string, root: string): string | null {
  const rel = relative(root, filePath).split('\\').join('/');
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null;
  return rel;
}

/** Read all of stdin (the hook payload) and parse it, tolerating an empty pipe. */
export async function readHookInput(
  stream: NodeJS.ReadableStream = process.stdin,
  timeoutMs = STDIN_TIMEOUT_MS,
): Promise<StopHookInput> {
  if ((stream as { isTTY?: boolean }).isTTY) return {}; // run by hand: no payload coming
  const text = await readWithin(stream, timeoutMs);
  if (!text) return {};
  try {
    return JSON.parse(text) as StopHookInput;
  } catch {
    return {};
  }
}

/** Hosts write the payload and close stdin at once; a stream left open must not eat the
 * turn's deadline, so reading gives up after this and carries on with what arrived. */
const STDIN_TIMEOUT_MS = 5_000;

async function readWithin(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<string> {
  const chunks: Buffer[] = [];
  const read = (async (): Promise<void> => {
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  })();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)));
  await Promise.race([read, timeout]);
  clearTimeout(timer);
  (stream as { destroy?: () => void }).destroy?.(); // an open stdin would keep the process alive
  return Buffer.concat(chunks).toString('utf8').trim();
}

function repairsOf(findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.band === 'repair');
}

function bullets(findings: Finding[]): string {
  return findings.map((finding) => `  - ${finding.message}`).join('\n');
}
