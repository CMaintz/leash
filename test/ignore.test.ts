import { describe, expect, it } from 'vitest';
import { isIgnored } from '../src/engine.js';

describe('isIgnored', () => {
  it('never sends likely secret files, at the root or nested', () => {
    for (const file of ['.env', '.env.local', 'apps/web/.env.production', 'certs/server.pem', 'deploy/id_rsa', '.npmrc'])
      expect(isIgnored(file), file).toBe(true);
  });

  it('still judges ordinary source', () => {
    for (const file of ['src/env.ts', 'src/environment.ts', 'docs/keys.md']) expect(isIgnored(file), file).toBe(false);
  });
});
