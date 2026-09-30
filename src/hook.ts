// Claude Code Stop-hook glue. The pure part (stopDecision) turns actionable findings
// into the exact JSON Claude Code expects; the runner reads the hook stdin and drives
// the turn-check. Verified against the Claude Code hooks reference:
//   Stop input on stdin includes cwd; a { decision: "block", reason } on stdout (exit 0)
//   makes the agent keep working in the same turn. Claude caps consecutive blocks at 8,
//   so no loop guard is needed here. Advisory: on any doubt we allow the stop.

import type { Finding } from './schema.js';

/** What the Stop hook reads on stdin (only the fields we use). */
export interface StopHookInput {
  cwd?: string;
  hook_event_name?: string;
}

/** The Stop-hook decision. An empty object means "allow the agent to stop". */
export interface StopDecision {
  decision?: 'block';
  reason?: string;
}

/**
 * Turn actionable findings into a Stop decision. Only `repair`-band findings block;
 * `note`-band findings never interrupt the agent. No new repairs means allow.
 */
export function stopDecision(actionable: Finding[]): StopDecision {
  const repairs = actionable.filter((finding) => finding.band === 'repair');
  if (repairs.length === 0) return {};
  const lines = repairs.map((finding) => `  - ${finding.message}`).join('\n');
  return {
    decision: 'block',
    reason: `Leash: this turn broke ${repairs.length} project rule(s):\n${lines}\n\nRepair them, then continue.`,
  };
}

/** Read all of stdin (the hook payload) and parse it, tolerating an empty pipe. */
export async function readHookInput(stream: NodeJS.ReadableStream = process.stdin): Promise<StopHookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as StopHookInput;
  } catch {
    return {};
  }
}
