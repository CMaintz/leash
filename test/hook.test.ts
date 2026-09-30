import { describe, expect, it } from 'vitest';
import { stopDecision } from '../src/hook.js';
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
