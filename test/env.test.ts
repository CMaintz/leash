import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envFiles, parseEnvFile, resolveEnv, saveApiKey, upsertEnvLine, userEnvPath } from '../src/env.js';

describe('parseEnvFile', () => {
  it("keeps only Leash's keys, so an app's other secrets are never read", () => {
    const text = 'DATABASE_URL=postgres://x\nJEV_API_KEY=k1\nLEASH_TIMEOUT_MS=5000\nTYPESAFE_AI_BASE_URL=http://m\n';
    expect(parseEnvFile(text)).toEqual({
      JEV_API_KEY: 'k1',
      LEASH_TIMEOUT_MS: '5000',
      TYPESAFE_AI_BASE_URL: 'http://m',
    });
  });

  it('handles export, quotes, comments and CRLF', () => {
    const text = '# comment\r\nexport JEV_API_KEY="a b"\r\nJEV_MODEL=jev-1 # pinned\r\nLEASH_X=\'#kept\'\r\n';
    expect(parseEnvFile(text)).toEqual({ JEV_API_KEY: 'a b', JEV_MODEL: 'jev-1', LEASH_X: '#kept' });
  });
});

describe('resolveEnv', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leash-env-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('prefers the process env, then the earliest file that sets a key', () => {
    const [local, dotenv, user] = envFiles(dir, dir);
    writeFileSync(local!, 'JEV_MODEL=local\n');
    writeFileSync(dotenv!, 'JEV_MODEL=dotenv\nJEV_API_KEY=from-dotenv\n');
    const env = resolveEnv({ LEASH_TIMEOUT_MS: '1' }, [local!, dotenv!, user!]);
    expect(env).toMatchObject({ JEV_MODEL: 'local', JEV_API_KEY: 'from-dotenv', LEASH_TIMEOUT_MS: '1' });
    expect(resolveEnv({ JEV_API_KEY: 'from-env' }, [dotenv!]).JEV_API_KEY).toBe('from-env');
  });

  it('skips missing files', () => {
    expect(resolveEnv({}, [join(dir, 'nope')])).toEqual({});
  });

  it('saveApiKey writes ~/.leash/.env, replacing an old key and keeping other lines', () => {
    const path = userEnvPath(dir);
    saveApiKey('first', path);
    writeFileSync(path, `${readFileSync(path, 'utf8')}JEV_MODEL=jev-1\n`);
    saveApiKey('second', path);
    expect(readFileSync(path, 'utf8')).toBe('JEV_API_KEY=second\nJEV_MODEL=jev-1\n');
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('upsertEnvLine', () => {
  it('appends to empty text and replaces in place', () => {
    expect(upsertEnvLine('', 'JEV_API_KEY', 'a')).toBe('JEV_API_KEY=a\n');
    expect(upsertEnvLine('X=1\nexport JEV_API_KEY=old\n', 'JEV_API_KEY', 'b')).toBe('X=1\nJEV_API_KEY=b\n');
  });
});
