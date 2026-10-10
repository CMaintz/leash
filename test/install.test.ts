import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addEditHook,
  addLeashHooks,
  hasFoundryAdapter,
  hostConfigPath,
  loadSettings,
  removeLeashHooks,
  type ClaudeSettings,
} from '../src/install.js';

describe('addLeashHooks', () => {
  it('adds both hooks to empty settings', () => {
    const out = addLeashHooks({});
    expect(out.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe('leash snapshot');
    expect(out.hooks?.Stop?.[0]?.hooks?.[0]?.command).toBe('leash hook');
    expect(out.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toBe('leash session');
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

describe('hook timeouts', () => {
  it('sets a host timeout on every Leash hook', () => {
    const out = addLeashHooks({}, { editPhase: true });
    expect(out.hooks?.Stop?.[0]?.hooks?.[0]?.timeout).toBe(90);
    expect(out.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.timeout).toBe(30);
    expect(out.hooks?.PostToolUse?.[0]?.hooks?.[0]?.timeout).toBe(90);
  });

  it('re-running init upgrades an older install in place', () => {
    const old: ClaudeSettings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'leash hook' }] }] } };
    const stop = addLeashHooks(old).hooks?.Stop;
    expect(stop).toHaveLength(1);
    expect(stop?.[0]?.hooks?.[0]?.timeout).toBe(90);
  });
});

describe('edit phase (opt-in)', () => {
  it('is not wired by default', () => {
    expect(addLeashHooks({}).hooks?.PostToolUse).toBeUndefined();
  });

  it('adds a matched PostToolUse group, idempotently, and uninstall removes it', () => {
    const once = addLeashHooks({}, { editPhase: true });
    const group = once.hooks?.PostToolUse?.[0];
    expect(group?.matcher).toBe('Edit|Write|MultiEdit');
    expect(group?.hooks?.[0]?.command).toBe('leash edit-hook');
    expect(addLeashHooks(once, { editPhase: true }).hooks?.PostToolUse).toHaveLength(1);
    expect(removeLeashHooks(once).hooks?.PostToolUse).toBeUndefined();
  });
});

describe('hostConfigPath', () => {
  it('maps each host to its project config file', () => {
    expect(hostConfigPath('claude', true).replace(/\\/g, '/')).toBe('.claude/settings.json');
    expect(hostConfigPath('codex', true).replace(/\\/g, '/')).toBe('.codex/hooks.json');
  });

  it('puts the global config under the home directory', () => {
    const p = hostConfigPath('codex', false).replace(/\\/g, '/');
    expect(p.endsWith('.codex/hooks.json')).toBe(true);
    expect(p).not.toBe('.codex/hooks.json'); // absolute, under home
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

describe('Foundry library mode', () => {
  const adapter = (args: string[]): ClaudeSettings => ({
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'C:\\Program Files\\Git\\bin\\bash.exe', args } as never] }],
    },
  });

  it('spots the leash.sh adapter in a command or in args, Windows paths included', () => {
    expect(hasFoundryAdapter(adapter(['C:/Users/me/.claude/hooks/leash.sh', 'hook']))).toBe(true);
    expect(hasFoundryAdapter(adapter(['C:\\Users\\me\\.claude\\hooks\\leash.sh', 'hook']))).toBe(true);
    expect(hasFoundryAdapter({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'leash.sh hook' }] }] } })).toBe(
      true,
    );
  });

  it('ignores Leash own hooks and look-alike scripts', () => {
    expect(hasFoundryAdapter(addLeashHooks({}, { editPhase: true }))).toBe(false);
    expect(hasFoundryAdapter(adapter(['/hooks/my-leash.sh']))).toBe(false);
    expect(hasFoundryAdapter({})).toBe(false);
  });

  it('adds only the per-edit hook', () => {
    const out = addEditHook({});
    expect(Object.keys(out.hooks ?? {})).toEqual(['PostToolUse']);
    expect(out.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toBe('leash edit-hook');
  });
});

describe('removeLeashHooks safety', () => {
  it("keeps another tool's hook that shares a group, and survives prompt hooks", () => {
    const settings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'leash hook' }, { type: 'command', command: 'my-notify.sh' }] },
          { hooks: [{ type: 'prompt', prompt: 'Is the work done?' } as never] },
        ],
      },
    } as ClaudeSettings;
    const stop = removeLeashHooks(settings).hooks?.Stop;
    expect(stop).toHaveLength(2);
    expect(stop?.[0]?.hooks).toEqual([{ type: 'command', command: 'my-notify.sh' }]);
  });
});

describe('loadSettings', () => {
  it('refuses a file it cannot parse instead of treating it as empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leash-settings-'));
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{ "model": "x", }');
    expect(() => loadSettings(path)).toThrow(/not valid JSON/);
    expect(loadSettings(join(dir, 'missing.json'))).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });
});
