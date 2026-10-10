import { execFile, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The CLI contract, end to end: build once, spawn the real binary in a throwaway repo
// against a mock Jev server, and assert exit codes and stdout. These are the paths the
// unit tests can't see (argv, cwd, process exit, what a host agent actually reads).

const ROOT = resolve(__dirname, '..');
let build: string;
let repo: string;
let server: Server;
let baseUrl: string;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function leash(args: string[], env: Record<string, string> = {}, input = '', cwd = repo): Promise<Run> {
  return new Promise((done) => {
    const home = join(repo, '.home');
    const vars = { ...process.env, HOME: home, USERPROFILE: home, JEV_API_KEY: '', ...env };
    const child = execFile(
      process.execPath,
      [join(build, 'dist', 'cli.js'), ...args],
      { cwd, env: vars },
      (err, stdout, stderr) => done({ code: err ? Number(err.code ?? 1) : 0, stdout, stderr }),
    );
    child.stdin?.end(input);
  });
}

const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const withJev = (url = baseUrl): Record<string, string> => ({ JEV_API_KEY: 'k', TYPESAFE_AI_BASE_URL: url });

beforeAll(() => {
  // Built under node_modules so the binary resolves its runtime deps (@cmaintz/jev-core).
  mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
  build = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'leash-build-'));
  execFileSync(process.execPath, [
    join(ROOT, 'node_modules/typescript/bin/tsc'),
    '-p',
    join(ROOT, 'tsconfig.build.json'),
    '--outDir',
    join(build, 'dist'),
  ]);
  copyFileSync(join(ROOT, 'package.json'), join(build, 'package.json'));
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const ids = Object.keys((JSON.parse(body) as { questions?: object }).questions ?? {});
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ answers: Object.fromEntries(ids.map((id) => [id, { type: 'noul', noul: 0.95 }])) }));
    });
  });
  return new Promise<void>((ready) =>
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      ready();
    }),
  );
}, 120_000);

afterAll(() => {
  server.close();
  rmSync(build, { recursive: true, force: true });
});

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'leash-cli-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(repo, '.leash'));
  mkdirSync(join(repo, 'src', 'sub'), { recursive: true });
  writeFileSync(
    join(repo, '.leash', 'rubric.json'),
    JSON.stringify({ version: 1, rules: [{ id: 'r1', question: 'Broken?', scope: ['src/**'] }] }),
  );
  writeFileSync(join(repo, 'src', 'a.ts'), 'a\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
});

describe('hook contract', () => {
  it('blocks with one JSON line on a repair-band break, exit 0', async () => {
    await leash(['snapshot'], withJev());
    writeFileSync(join(repo, 'src', 'b.ts'), 'b\n');
    const run = await leash(['hook'], withJev(), '{}');
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ decision: 'block' });
  });

  it('fails open, silently and with exit 0, with no key or a dead server', async () => {
    writeFileSync(join(repo, 'src', 'b.ts'), 'b\n');
    for (const env of [{}, withJev('http://127.0.0.1:9')]) {
      const run = await leash(['hook'], { ...env, LEASH_TIMEOUT_MS: '2000' }, '{}');
      expect(run).toMatchObject({ code: 0, stdout: '' });
    }
    expect(readFileSync(join(git('rev-parse', '--absolute-git-dir').trim(), 'leash-misses.log'), 'utf8')).toMatch(
      /hook/,
    );
  });

  it('checks a session started in a subdirectory', async () => {
    writeFileSync(join(repo, 'src', 'b.ts'), 'b\n');
    const run = await leash(['hook'], withJev(), '{}', join(repo, 'src', 'sub'));
    expect(JSON.parse(run.stdout)).toMatchObject({ decision: 'block' });
  });
});

describe('strict commands', () => {
  it('guard fails when the branch deletes the rubric', async () => {
    rmSync(join(repo, '.leash', 'rubric.json'));
    expect((await leash(['guard', 'HEAD'])).code).toBe(1);
  });

  it('init leaves an unparsable settings file alone and exits 1', async () => {
    mkdirSync(join(repo, '.claude'));
    const path = join(repo, '.claude', 'settings.json');
    writeFileSync(path, '{ "model": "x", }');
    const run = await leash(['init', '--project', '--standalone']);
    expect(run.code).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe('{ "model": "x", }');
  });
});

describe('check --json', () => {
  it('always prints JSON, even with a broken rubric', async () => {
    writeFileSync(join(repo, '.leash', 'rubric.json'), '{');
    const run = await leash(['check', '--json'], withJev());
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ version: 1, ran: false });
  });
});
