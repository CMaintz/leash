import { describe, expect, it } from 'vitest';
import { parseDiff, unquotePath } from '../src/diff.js';

const modified = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

const added = [
  'diff --git a/src/new.ts b/src/new.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/new.ts',
  '@@ -0,0 +1 @@',
  '+hello',
].join('\n');

const deleted = [
  'diff --git a/src/gone.ts b/src/gone.ts',
  'deleted file mode 100644',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
].join('\n');

describe('parseDiff', () => {
  it('splits a multi-file diff into one patch per file', () => {
    const diffs = parseDiff(`${modified}\n${added}`);
    expect(diffs.map((d) => d.file)).toEqual(['src/a.ts', 'src/new.ts']);
    expect(diffs[0]!.patch).toContain('+new');
    expect(diffs[0]!.patch).not.toContain('+hello');
  });

  it('keeps new files and drops deletions (nothing left to judge)', () => {
    expect(parseDiff(`${added}\n${deleted}`).map((d) => d.file)).toEqual(['src/new.ts']);
  });

  it('uses the post-image path for a rename', () => {
    const rename = 'diff --git a/old.ts b/renamed.ts\nsimilarity index 90%\n--- a/old.ts\n+++ b/renamed.ts';
    expect(parseDiff(rename)[0]!.file).toBe('renamed.ts');
  });

  it('returns nothing for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});

describe('parseDiff hardening', () => {
  const header = (path: string): string =>
    [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`].join('\n');

  it('treats an added "++ " content line as content, never as the file path', () => {
    const diff = `${header('src/evade.ts')}\n@@ -0,0 +1,2 @@\n+++ .leash/hidden\n+export const x = 1;`;
    const [d] = parseDiff(diff);
    expect(d!.file).toBe('src/evade.ts');
    expect(d!.patch).toContain('+++ .leash/hidden');
  });

  it('decodes git-quoted paths (octal UTF-8 and escapes)', () => {
    const q = String.raw`"b/src/caf\303\251 \"x\".ts"`;
    const a = String.raw`"a/src/caf\303\251 \"x\".ts"`;
    const diff = `diff --git ${a} ${q}\n--- /dev/null\n+++ ${q}\n@@ -0,0 +1 @@\n+a`;
    expect(parseDiff(diff)[0]!.file).toBe('src/café "x".ts');
    expect(unquotePath(String.raw`"\t\\"`)).toBe('\t\\');
    expect(unquotePath('plain/path.ts')).toBe('plain/path.ts');
  });
});
