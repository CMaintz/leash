import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPENCODE_PLUGIN, opencodePluginPath } from '../src/opencode.js';

type Hooks = {
  'chat.message': (input: { sessionID: string }, output: { parts: unknown[] }) => Promise<void>;
  event: (arg: { event: { type: string; properties?: unknown } }) => Promise<void>;
};
type PluginFactory = (ctx: unknown) => Promise<Hooks>;

const BLOCK = JSON.stringify({ decision: { decision: 'block', reason: 'Leash: fix rule x' } });
const CLEAN = JSON.stringify({ decision: {} });

// A fake Bun `$`: records each `leash ...` invocation and replies with `stdout`.
function fakeShell(stdout: () => string) {
  const runs: string[] = [];
  const $ = (_parts: TemplateStringsArray, args: string[]) => {
    runs.push(args.join(' '));
    const done = Promise.resolve({ stdout: Buffer.from(stdout()) });
    const chain = { cwd: () => chain, quiet: () => chain, nothrow: () => done };
    return chain;
  };
  return { $, runs };
}

async function boot(factory: PluginFactory, stdout: () => string) {
  const prompts: { id: string; text: string }[] = [];
  const client = {
    session: {
      prompt: async (req: { path: { id: string }; body: { parts: { text: string }[] } }) => {
        prompts.push({ id: req.path.id, text: req.body.parts[0]!.text });
      },
    },
  };
  const shell = fakeShell(stdout);
  const hooks = await factory({ client, $: shell.$, directory: '/repo' });
  return { hooks, prompts, runs: shell.runs };
}

const idle = (id: string) => ({
  event: { type: 'session.status', properties: { sessionID: id, status: { type: 'idle' } } },
});
const legacyIdle = (id: string) => ({ event: { type: 'session.idle', properties: { sessionID: id } } });
const userMsg = (text: string) => ({ parts: [{ type: 'text', text }] });

describe('generated OpenCode plugin', () => {
  let dir: string;
  let factory: PluginFactory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'leash-oc-'));
    const file = join(dir, 'leash.mjs');
    writeFileSync(file, OPENCODE_PLUGIN);
    factory = ((await import(pathToFileURL(file).href)) as { LeashPlugin: PluginFactory }).LeashPlugin;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('snapshots on a user message, checks on idle, and nudges on a repair break', async () => {
    const { hooks, prompts, runs } = await boot(factory, () => BLOCK);
    await hooks['chat.message']({ sessionID: 's1' }, userMsg('add a feature'));
    await hooks.event(idle('s1'));
    expect(runs).toEqual(['snapshot', 'check --turn --json']);
    expect(prompts).toEqual([{ id: 's1', text: 'Leash: fix rule x' }]);
  });

  it('checks once per turn even when both idle events fire', async () => {
    const { hooks, runs } = await boot(factory, () => CLEAN);
    await hooks['chat.message']({ sessionID: 's1' }, userMsg('go'));
    await hooks.event(idle('s1'));
    await hooks.event(legacyIdle('s1'));
    expect(runs.filter((r) => r.startsWith('check'))).toHaveLength(1);
  });

  it('nudges at most once per user turn; its own nudge never resets the turn', async () => {
    const { hooks, prompts, runs } = await boot(factory, () => BLOCK);
    await hooks['chat.message']({ sessionID: 's1' }, userMsg('go'));
    await hooks.event(idle('s1'));
    await hooks['chat.message']({ sessionID: 's1' }, userMsg('Leash: fix rule x'));
    await hooks.event(idle('s1'));
    expect(prompts).toHaveLength(1);
    expect(runs.filter((r) => r === 'snapshot')).toHaveLength(1);
    await hooks['chat.message']({ sessionID: 's1' }, userMsg('next task'));
    await hooks.event(idle('s1'));
    expect(prompts).toHaveLength(2);
  });

  it('stays silent on a clean turn, unparseable output, or a busy status', async () => {
    for (const out of [CLEAN, 'not json']) {
      const { hooks, prompts } = await boot(factory, () => out);
      await hooks.event(idle('s1'));
      expect(prompts).toHaveLength(0);
    }
    const { hooks, runs } = await boot(factory, () => BLOCK);
    await hooks.event({ event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } } });
    expect(runs).toHaveLength(0);
  });

  it('installs to .opencode/plugins for a project', () => {
    expect(opencodePluginPath(true).replace(/\\/g, '/')).toBe('.opencode/plugins/leash.js');
  });
});
