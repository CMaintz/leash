import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUBRIC_COMMAND, removeRubricCommand, rubricCommandPath, writeRubricCommand } from '../src/commands.js';

describe('rubric command content', () => {
  it('is a Claude Code command with front matter and the compile step', () => {
    expect(RUBRIC_COMMAND.startsWith('---\n')).toBe(true);
    expect(RUBRIC_COMMAND).toContain('.leash/rubric.json');
    expect(RUBRIC_COMMAND).toContain('leash compile');
  });

  it('uses no em or en dashes', () => {
    expect(new RegExp('[\u2013\u2014]').test(RUBRIC_COMMAND)).toBe(false);
  });
});

describe('rubricCommandPath', () => {
  it('targets .claude/commands for a project install', () => {
    expect(rubricCommandPath(true).replace(/\\/g, '/')).toBe('.claude/commands/leash-rubric.md');
  });
});

describe('write / remove round-trip', () => {
  let cwd: string;
  let dir: string;

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'leash-cmd-'));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the command then removes it, idempotently', () => {
    const written = writeRubricCommand(true);
    expect(readFileSync(written, 'utf8')).toBe(RUBRIC_COMMAND);
    expect(removeRubricCommand(true)).toBe(written);
    expect(removeRubricCommand(true)).toBe(written); // absent is fine
  });
});
