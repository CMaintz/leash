import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Leash is a coach, never an oracle: no CI workflow, mise task or npm script in this repo
// may run a Jev-backed command, or a ~68%-accurate model would sit in pass/fail. The
// deterministic ones (guard, compile, report) are fine - leash-guard.yml runs `guard`.
// Foundry's scripts/jev/boundary.test.mjs holds consumer repos to the same rule.
const JEV_COMMAND = /(?:\bleash|@cmaintz\/leash|cli\.js)\s+(?:check|audit|edit-check|edit-hook|hook|calibrate|bench)\b/;

function gateFiles(): string[] {
  const workflows = readdirSync('.github/workflows').map((name) => join('.github/workflows', name));
  return [...workflows, 'mise.toml', 'package.json'];
}

describe('never in the gate', () => {
  it.each(gateFiles())('%s runs no Jev-backed leash command', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(JEV_COMMAND);
  });

  it('the pattern bans Jev-backed commands and allows the deterministic ones', () => {
    for (const cmd of ['leash check --turn', 'npx @cmaintz/leash audit', 'node dist/cli.js bench'])
      expect(cmd).toMatch(JEV_COMMAND);
    for (const cmd of ['node dist/cli.js guard "origin/main"', 'leash compile', 'leash report'])
      expect(cmd).not.toMatch(JEV_COMMAND);
  });
});
