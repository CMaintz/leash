import { PassThrough } from 'node:stream';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  editedFiles,
  editHookOutput,
  isRepairPrompt,
  readHookInput,
  repoRelative,
  stopDecision,
  stopDecisionOnce,
} from '../src/hook.js';
import type { Finding } from '../src/schema.js';

const finding = (band: Finding['band'], id = 'r'): Finding => ({
  ruleId: id,
  file: 'src/a.ts',
  probability: band === 'repair' ? 0.9 : 0.6,
  band,
  message: `Rule "${id}" looks broken in src/a.ts`,
});

describe('stopDecision', () => {
  it('allows the stop when there are no repair-band findings', () => {
    expect(stopDecision([])).toEqual({});
    expect(stopDecision([finding('note')])).toEqual({});
  });

  it('blocks with a repair reason listing the broken rules', () => {
    const decision = stopDecision([finding('repair', 'no-premature-abstraction'), finding('note', 'x')]);
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('1 project rule');
    expect(decision.reason).toContain('no-premature-abstraction');
    expect(decision.reason).toContain('Repair them, then continue.');
  });
});

describe('stopDecisionOnce', () => {
  it('blocks a first-time repair and records its fingerprint', () => {
    const { decision, blocked } = stopDecisionOnce([finding('repair', 'a')], []);
    expect(decision.decision).toBe('block');
    expect(blocked).toEqual(['a::src/a.ts']);
  });

  it('never blocks twice on the same finding in a turn (no loop on a phantom)', () => {
    const { decision, blocked } = stopDecisionOnce([finding('repair', 'a')], ['a::src/a.ts']);
    expect(decision).toEqual({});
    expect(blocked).toEqual(['a::src/a.ts']);
  });

  it('still blocks a NEW break introduced while repairing, naming only that one', () => {
    const { decision, blocked } = stopDecisionOnce([finding('repair', 'a'), finding('repair', 'b')], ['a::src/a.ts']);
    expect(decision.reason).toContain('"b"');
    expect(decision.reason).not.toContain('"a"');
    expect(blocked).toEqual(['a::src/a.ts', 'b::src/a.ts']);
  });
});

describe('editHookOutput', () => {
  it('says nothing without a repair-band finding', () => {
    expect(editHookOutput([])).toEqual({});
    expect(editHookOutput([finding('note')])).toEqual({});
  });

  it('hands repairs to Claude as PostToolUse additionalContext, never a block', () => {
    const out = editHookOutput([finding('repair', 'small-functions')]);
    expect(out.hookSpecificOutput?.hookEventName).toBe('PostToolUse');
    expect(out.hookSpecificOutput?.additionalContext).toContain('small-functions');
    expect(out).not.toHaveProperty('decision');
  });
});

describe('repoRelative', () => {
  it('maps an absolute path inside the repo to a forward-slash relative one', () => {
    expect(repoRelative(join(sep, 'repo', 'src', 'a.ts'), join(sep, 'repo'))).toBe('src/a.ts');
  });

  it('rejects paths outside the repo, and the root itself', () => {
    expect(repoRelative(join(sep, 'elsewhere', 'a.ts'), join(sep, 'repo'))).toBeNull();
    expect(repoRelative(join(sep, 'repo'), join(sep, 'repo'))).toBeNull();
  });
});

describe('readHookInput', () => {
  it('parses the cwd and session id the runners use', async () => {
    const input = await readHookInput(Readable.from(['{"cwd":"/x","session_id":"s1","stop_hook_active":true}']));
    expect(input).toMatchObject({ cwd: '/x', session_id: 's1' });
  });

  it('reads nothing from a terminal, so running a hook by hand never waits', async () => {
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    expect(await readHookInput(tty, 60_000)).toEqual({});
  });
});

describe('editedFiles', () => {
  it("takes Claude's file_path", () => {
    expect(editedFiles({ tool_input: { file_path: '/r/src/a.ts' } })).toEqual(['/r/src/a.ts']);
  });

  it('takes every added, updated or moved file from a Codex apply_patch', () => {
    const command = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-x',
      '+y',
      '*** Add File: src/new.ts',
      '+z',
      '*** Delete File: src/gone.ts',
      '*** Update File: src/old.ts',
      '*** Move to: src/moved.ts',
      '*** End Patch',
    ].join('\n');
    expect(editedFiles({ tool_input: { command } })).toEqual(['src/a.ts', 'src/new.ts', 'src/old.ts', 'src/moved.ts']);
  });
});

describe('isRepairPrompt', () => {
  it("recognises Leash's own block reason coming back as a prompt", () => {
    const reason = stopDecision([{ ruleId: 'r', file: 'a.ts', band: 'repair', probability: 0.9 } as Finding]).reason;
    expect(isRepairPrompt({ prompt: reason! })).toBe(true);
    expect(isRepairPrompt({ prompt: 'Leash is great, add a feature' })).toBe(false);
    expect(isRepairPrompt({})).toBe(false);
  });
});

describe('readHookInput edge cases', () => {
  it('tolerates an empty pipe', async () => {
    expect(await readHookInput(Readable.from(['']))).toEqual({});
  });
});

describe('readHookInput deadline', () => {
  it('gives up on a stdin that never closes and keeps what arrived', async () => {
    const stream = new PassThrough();
    stream.write('{"cwd":"/x"');
    const started = Date.now();
    expect(await readHookInput(stream, 50)).toEqual({}); // partial JSON parses as nothing
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
