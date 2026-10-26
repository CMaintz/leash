import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEADLINE_REASON, type CheckResult } from '../src/check.js';
import { createMcpServer } from '../src/mcp.js';
import type { JevProvider, JevRequest, JevResponse } from '../src/provider.js';

// The MCP contract, through a real client over the in-memory transport, in a throwaway
// git repo: what a Cursor or Claude Desktop agent would actually get back.

const git = (cmd: string): string => execSync(`git ${cmd}`, { encoding: 'utf8' });

const RUBRIC = {
  version: 1,
  rules: [
    {
      id: 'no-premature-abstraction',
      question: 'abstraction used once?',
      scope: ['src/**/*.ts'],
      source: 'CLAUDE.md:3',
    },
    { id: 'docs-tone', question: 'tone off?', scope: ['docs/**/*.md'] },
    { id: 'tiny-edits', question: 'edit too big?', phase: 'edit' },
  ],
};

class FakeProvider implements JevProvider {
  calls: JevRequest[] = [];
  constructor(private readonly answer: (req: JevRequest) => Promise<JevResponse['answers']>) {}
  async evaluate(req: JevRequest): Promise<JevResponse> {
    this.calls.push(req);
    return { model: 'fake', answers: await this.answer(req) };
  }
}

/** Every question asked comes back as a sure break. */
const breaksAll = (): FakeProvider =>
  new FakeProvider(async (req) =>
    Object.fromEntries(Object.keys(req.questions).map((id) => [id, { type: 'noul', noul: 0.95 } as const])),
  );

async function connect(provider: JevProvider | null): Promise<Client> {
  const server = createMcpServer({ provider: () => provider, version: 'test' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError ?? false).toBe(false);
  return result.structuredContent as T;
}

function commitAll(): void {
  git('add -A');
  git('commit -qm work');
}

describe('leash mcp server', () => {
  let cwd: string;
  let dir: string;

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'leash-mcp-'));
    process.chdir(dir);
    git('init -q');
    git('config user.email t@example.com');
    git('config user.name t');
    git('config core.autocrlf false');
    mkdirSync('.leash');
    mkdirSync('src');
    writeFileSync('.leash/rubric.json', JSON.stringify(RUBRIC));
    writeFileSync('src/old.ts', 'export const old = 1;\n');
    commitAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  describe('check', () => {
    it('subtracts the baseline from actionable but keeps it in findings', async () => {
      writeFileSync('.leash/baseline.json', JSON.stringify(['no-premature-abstraction::src/old.ts']));
      commitAll();
      writeFileSync('src/old.ts', 'export const old = 2;\n');
      writeFileSync('src/new.ts', 'export const fresh = 1;\n');
      const result = await call<CheckResult>(await connect(breaksAll()), 'check');
      expect(result.findings.map((f) => f.file).sort()).toEqual(['src/new.ts', 'src/old.ts']);
      expect(result.actionable.map((f) => f.file)).toEqual(['src/new.ts']);
    });

    it('judges a pasted diff instead of the working tree', async () => {
      const diff = 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-a\n+b\n';
      const result = await call<CheckResult>(await connect(breaksAll()), 'check', { diff });
      expect(result.actionable.map((f) => f.file)).toEqual(['src/x.ts']);
    });

    it('asks only edit-phase rules when phase is edit', async () => {
      writeFileSync('src/old.ts', 'export const old = 2;\n');
      const result = await call<CheckResult>(await connect(breaksAll()), 'check', { phase: 'edit' });
      expect(result.actionable.map((f) => f.ruleId)).toEqual(['tiny-edits']);
    });

    it('judges against the committed rubric, so an uncommitted loosening cannot pass its own check', async () => {
      writeFileSync('.leash/rubric.json', JSON.stringify({ version: 1, rules: [] }));
      writeFileSync('src/old.ts', 'export const old = 2;\n');
      const result = await call<CheckResult>(await connect(breaksAll()), 'check');
      expect(result.actionable.map((f) => f.ruleId)).toEqual(['no-premature-abstraction']);
    });

    it('fails open on a throwing provider: a normal result with the file skipped', async () => {
      writeFileSync('src/old.ts', 'export const old = 2;\n');
      const boom = new FakeProvider(() => Promise.reject(new Error('jev down')));
      const result = await call<CheckResult>(await connect(boom), 'check');
      expect(result.actionable).toEqual([]);
      expect(result.skipped).toEqual([{ file: 'src/old.ts', reason: 'jev down' }]);
    });

    it('fails open with no key: skipped names the missing key', async () => {
      writeFileSync('src/old.ts', 'export const old = 2;\n');
      const result = await call<CheckResult>(await connect(null), 'check');
      expect(result.skipped[0]!.reason).toMatch(/JEV_API_KEY/);
    });

    it('fails open with no rubric: skipped names the missing rubric', async () => {
      git('rm -q .leash/rubric.json');
      commitAll();
      const result = await call<CheckResult>(await connect(breaksAll()), 'check');
      expect(result.skipped[0]!.reason).toMatch(/no rubric/);
    });

    it('fails open outside a git repo', async () => {
      rmSync('.git', { recursive: true, force: true });
      const result = await call<CheckResult>(await connect(breaksAll()), 'check');
      expect(result.skipped).toHaveLength(1);
    });

    it('times each request from its own start, not from server start', async () => {
      vi.spyOn(performance, 'now').mockReturnValue(10 * 60_000);
      writeFileSync('src/old.ts', 'export const old = 2;\n');
      // Like a real call, this one takes a moment and honours the abort.
      const slow = new FakeProvider(async (req) => {
        await new Promise((done) => setTimeout(done, 20));
        req.signal?.throwIfAborted();
        return { 'no-premature-abstraction': { type: 'noul', noul: 0.95 } };
      });
      const result = await call<CheckResult>(await connect(slow), 'check');
      expect(result.skipped).toEqual([]);
      expect(result.actionable).toHaveLength(1);
    });

    it('ends a hung Jev call at the deadline and reports it as skipped', async () => {
      vi.stubEnv('LEASH_DEADLINE_MS', '50');
      writeFileSync('src/old.ts', 'export const old = 2;\n');
      const hang = new FakeProvider(
        (req) => new Promise((_, reject) => req.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
      );
      const result = await call<CheckResult>(await connect(hang), 'check');
      expect(result.skipped).toEqual([{ file: 'src/old.ts', reason: DEADLINE_REASON }]);
    });
  });

  describe('judge_files', () => {
    it('judges unchanged committed files whole, without touching the baseline', async () => {
      writeFileSync('.leash/baseline.json', '[]\n');
      commitAll();
      const result = await call<CheckResult>(await connect(breaksAll()), 'judge_files', { paths: ['src/**/*.ts'] });
      expect(result.actionable.map((f) => f.file)).toEqual(['src/old.ts']);
      expect(readFileSync('.leash/baseline.json', 'utf8')).toBe('[]\n');
    });

    it('matches globs the way rubric scopes do (src/**/*.ts includes src/a.ts)', async () => {
      mkdirSync('src/deep');
      writeFileSync('src/deep/b.ts', 'export const b = 1;\n');
      writeFileSync('other.ts', 'export const o = 1;\n');
      const result = await call<CheckResult>(await connect(breaksAll()), 'judge_files', { paths: ['src/**/*.ts'] });
      expect(result.findings.map((f) => f.file).sort()).toEqual(['src/deep/b.ts', 'src/old.ts']);
    });

    it('takes brace globs the way rubric scopes do', async () => {
      mkdirSync('docs');
      writeFileSync('docs/a.md', 'a\n');
      const result = await call<CheckResult>(await connect(breaksAll()), 'judge_files', {
        paths: ['{src,docs}/**/*.{ts,md}'],
      });
      expect(result.findings.map((f) => f.file).sort()).toEqual(['docs/a.md', 'src/old.ts']);
    });

    it('reports a glob that matches no file as skipped, not as clean', async () => {
      const result = await call<CheckResult>(await connect(breaksAll()), 'judge_files', { paths: ['lib/**/*.ts'] });
      expect(result.skipped).toEqual([{ file: '*', reason: 'no file matches lib/**/*.ts' }]);
    });
  });

  describe('list_rules', () => {
    it('lists every rule with its fields, and only in-scope rules for a path', async () => {
      const client = await connect(null);
      const all = await call<{ rules: { id: string }[] }>(client, 'list_rules');
      expect(all.rules.map((r) => r.id)).toEqual(['no-premature-abstraction', 'docs-tone', 'tiny-edits']);
      const scoped = await call<{ rules: { id: string; source?: string }[] }>(client, 'list_rules', {
        path: 'src/a.ts',
      });
      expect(scoped.rules.map((r) => r.id)).toEqual(['no-premature-abstraction', 'tiny-edits']);
      expect(scoped.rules[0]!.source).toBe('CLAUDE.md:3');
      const windowsStyle = await call<{ rules: { id: string }[] }>(client, 'list_rules', { path: '.\\src\\a.ts' });
      expect(windowsStyle.rules.map((r) => r.id)).toEqual(['no-premature-abstraction', 'tiny-edits']);
    });
  });

  describe('explain_rule', () => {
    it('calibrates only the asked rule over sampled commits when sample is given', async () => {
      mkdirSync('docs');
      writeFileSync('docs/a.md', 'x\n');
      commitAll();
      const provider = breaksAll();
      const out = await call<{ calibration: { fires: number } | null }>(await connect(provider), 'explain_rule', {
        id: 'no-premature-abstraction',
        sample: 2,
      });
      expect(out.calibration?.fires).toBe(1);
      expect(provider.calls.every((c) => Object.keys(c.questions).join() === 'no-premature-abstraction')).toBe(true);
    });

    it('does not call a rule dead when the deadline cut the sample short', async () => {
      vi.stubEnv('LEASH_DEADLINE_MS', '50');
      const hang = new FakeProvider(
        (req) => new Promise((_, reject) => req.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
      );
      const out = await call<{ calibration: { dead: boolean } | null; reason?: string }>(
        await connect(hang),
        'explain_rule',
        { id: 'no-premature-abstraction', sample: 1 },
      );
      expect(out.calibration?.dead).toBe(false);
      expect(out.reason).toMatch(/1 file/);
    });

    it('says why an edit-phase rule has no calibration', async () => {
      const out = await call<{ reason?: string }>(await connect(breaksAll()), 'explain_rule', {
        id: 'tiny-edits',
        sample: 1,
      });
      expect(out.reason).toMatch(/turn-phase/);
    });

    it('returns a reason, not an error, for an unknown rule', async () => {
      const out = await call<{ rule: unknown; reason?: string }>(await connect(null), 'explain_rule', { id: 'nope' });
      expect(out.rule).toBeNull();
      expect(out.reason).toMatch(/nope/);
    });
  });

  describe('jev_judge', () => {
    it('maps a choice answer to its label and that label probability', async () => {
      const provider = new FakeProvider(async () => ({
        q: { type: 'choice', choice: 'feat', confidence: 0.7, probabilities: { feat: 0.8, fix: 0.2 } },
      }));
      const out = await call<{ answer: unknown; probability: number }>(await connect(provider), 'jev_judge', {
        question: 'Which kind of commit is this?',
        state: { message: 'add a thing' },
        kind: 'choice',
        options: ['feat', 'fix'],
      });
      expect(out).toMatchObject({ answer: 'feat', probability: 0.8 });
    });

    it('rejects a choice with no options as skipped, before calling Jev', async () => {
      const provider = breaksAll();
      const out = await call<{ skipped?: string }>(await connect(provider), 'jev_judge', {
        question: 'Which?',
        state: 'x',
        kind: 'choice',
      });
      expect(out.skipped).toMatch(/options/);
      expect(provider.calls).toHaveLength(0);
    });

    it('fails open with no key', async () => {
      const out = await call<{ answer: unknown; skipped?: string }>(await connect(null), 'jev_judge', {
        question: 'Is it?',
        state: 'x',
        kind: 'noul',
      });
      expect(out.answer).toBeNull();
      expect(out.skipped).toMatch(/JEV_API_KEY/);
    });
  });

  describe('resources', () => {
    it('drift reports a working-tree loosening of the committed rubric', async () => {
      const loosened = { ...RUBRIC, rules: RUBRIC.rules.slice(1) };
      writeFileSync('.leash/rubric.json', JSON.stringify(loosened));
      const client = await connect(null);
      const read = await client.readResource({ uri: 'leash://drift' });
      const drift = JSON.parse((read.contents[0] as { text: string }).text) as { loosened: string[] };
      expect(drift.loosened).toEqual(['no-premature-abstraction: removed']);
    });
  });
});
