import { describe, expect, it } from 'vitest';
import { addLeashHooks, removeLeashHooks, type ClaudeSettings } from '../src/install.js';

describe('addLeashHooks', () => {
  it('adds both hooks to empty settings', () => {
    const out = addLeashHooks({});
    expect(out.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe('leash snapshot');
    expect(out.hooks?.Stop?.[0]?.hooks?.[0]?.command).toBe('leash hook');
  });

  it('is idempotent and preserves other hooks', () => {
    const existing: ClaudeSettings = {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool run' }] }] },
    };
    const once = addLeashHooks(existing);
    const twice = addLeashHooks(once);
    expect(twice.hooks?.Stop).toHaveLength(2); // other-tool + leash, not duplicated
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it('keeps unrelated top-level settings', () => {
    const out = addLeashHooks({ model: 'sonnet' } as ClaudeSettings);
    expect(out.model).toBe('sonnet');
  });
});

describe('removeLeashHooks', () => {
  it('removes only leash groups, keeping others', () => {
    const settings = addLeashHooks({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool run' }] }] },
    });
    const out = removeLeashHooks(settings);
    expect(out.hooks?.Stop).toHaveLength(1);
    expect(out.hooks?.Stop?.[0]?.hooks?.[0]?.command).toBe('other-tool run');
    expect(out.hooks?.UserPromptSubmit).toBeUndefined();
  });
});
