import { describe, expect, it } from 'vitest';
import { chunkPatch, isBinaryPatch, isLeashPath, mergeAnswers } from '../src/patch.js';

const header = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts';
const hunk = (n: number, size: number): string => `@@ -${n},1 +${n},1 @@\n+${'x'.repeat(size)}`;

describe('chunkPatch', () => {
  it('leaves a small patch whole', () => {
    const patch = `${header}\n${hunk(1, 10)}`;
    expect(chunkPatch(patch, 1_000)).toEqual([patch]);
  });

  it('splits on hunk boundaries, repeating the header, within budget', () => {
    const patch = [header, hunk(1, 1_500), hunk(2, 1_500), hunk(3, 1_500)].join('\n');
    const chunks = chunkPatch(patch, 2_000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith(header)).toBe(true);
      expect(chunk.length).toBeLessThanOrEqual(2_000);
    }
    expect(chunks.join('\n')).toContain('@@ -3,1 +3,1 @@');
  });

  it('cuts a single oversized hunk on line boundaries', () => {
    const big = `@@ -1,9 +1,9 @@\n${Array.from({ length: 50 }, () => `+${'y'.repeat(99)}`).join('\n')}`;
    const chunks = chunkPatch(`${header}\n${big}`, 1_500);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1_500);
  });
});

describe('skips', () => {
  it('detects binary patches', () => {
    expect(isBinaryPatch('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ')).toBe(true);
    expect(isBinaryPatch(`${header}\n${hunk(1, 5)}`)).toBe(false);
  });

  it('treats only .leash/ as leash state', () => {
    expect(isLeashPath('.leash/rubric.json')).toBe(true);
    expect(isLeashPath('src/.leashy.ts')).toBe(false);
  });
});

describe('mergeAnswers', () => {
  it('keeps the strongest Noul per rule across chunks', () => {
    const merged = mergeAnswers([
      { a: { type: 'noul', noul: 0.2 }, b: { type: 'noul', noul: 0.9 } },
      { a: { type: 'noul', noul: 0.85 }, b: { type: 'noul', noul: 0.1 } },
    ]);
    expect(merged.a).toEqual({ type: 'noul', noul: 0.85 });
    expect(merged.b).toEqual({ type: 'noul', noul: 0.9 });
  });
});
