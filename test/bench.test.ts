import { describe, expect, it } from 'vitest';
import { benchReport, percentiles, timedProvider, type RequestSample } from '../src/bench.js';
import type { JevProvider } from '../src/provider.js';

describe('percentiles', () => {
  it('uses nearest rank and handles an empty list', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentiles(values)).toEqual({ p50: 50, p95: 95, max: 100 });
    expect(percentiles([])).toEqual({ p50: 0, p95: 0, max: 0 });
  });
});

describe('timedProvider', () => {
  it('times and sizes each request, keeping reported usage', async () => {
    const samples: RequestSample[] = [];
    let t = 0;
    const inner: JevProvider = {
      evaluate: async () => {
        t += 120;
        return { model: 'm', answers: {}, usage: { input_tokens: 50, output_tokens: 2 } };
      },
    };
    await timedProvider(inner, samples, () => t).evaluate({ state: { file: 'a' }, questions: {} });
    const chars = JSON.stringify({ state: { file: 'a' }, questions: {} }).length;
    expect(samples).toEqual([{ ms: 120, chars, ok: true, inputTokens: 50, outputTokens: 2 }]);
  });

  it('records a failed request and still throws', async () => {
    const samples: RequestSample[] = [];
    const inner: JevProvider = { evaluate: async () => Promise.reject(new Error('down')) };
    await expect(timedProvider(inner, samples).evaluate({ state: {}, questions: {} })).rejects.toThrow('down');
    expect(samples[0]?.ok).toBe(false);
  });
});

describe('benchReport', () => {
  it('sums sizes and tokens, and says when the API reported no tokens', () => {
    const samples: RequestSample[] = [
      { ms: 10, chars: 100, ok: true, inputTokens: 40, outputTokens: 1 },
      { ms: 30, chars: 300, ok: false },
    ];
    const report = benchReport(samples, [25, 45]);
    expect(report).toMatchObject({ turns: 2, requests: 2, failed: 1, chars: 400, inputTokens: 40, outputTokens: 1 });
    expect(benchReport([{ ms: 1, chars: 1, ok: true }], [1]).inputTokens).toBeNull();
  });
});
