// Bench: what Leash costs on your machine and repo. Replays recent commits as turns through
// a timing wrapper around the provider and reports request and turn latency, characters
// sent, and the token usage the API reports. No price table: multiply by your own rate.

import type { JevProvider, JevRequest, JevResponse } from './provider.js';

/** One Jev request as the bench saw it. */
export interface RequestSample {
  ms: number;
  chars: number;
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

export interface BenchReport {
  turns: number;
  requests: number;
  failed: number;
  requestMs: Percentiles;
  turnMs: Percentiles;
  chars: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface Percentiles {
  p50: number;
  p95: number;
  max: number;
}

/** Wrap a provider so every request it makes is timed and sized into `samples`. */
export function timedProvider(
  inner: JevProvider,
  samples: RequestSample[],
  now = () => performance.now(),
): JevProvider {
  return {
    async evaluate(req: JevRequest): Promise<JevResponse> {
      const start = now();
      const chars = JSON.stringify({ state: req.state, questions: req.questions }).length;
      try {
        const res = await inner.evaluate(req);
        samples.push({ ms: now() - start, chars, ok: true, ...usageOf(res) });
        return res;
      } catch (err) {
        samples.push({ ms: now() - start, chars, ok: false });
        throw err;
      }
    },
  };
}

function usageOf(res: JevResponse): Pick<RequestSample, 'inputTokens' | 'outputTokens'> {
  if (!res.usage) return {};
  return { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
}

/** Nearest-rank percentiles (0 for an empty list). */
export function percentiles(values: readonly number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
  return { p50: rank(0.5), p95: rank(0.95), max: sorted.at(-1) ?? 0 };
}

/** Summarize the request samples and per-turn wall times. */
export function benchReport(samples: readonly RequestSample[], turnMs: readonly number[]): BenchReport {
  return {
    turns: turnMs.length,
    requests: samples.length,
    failed: samples.filter((s) => !s.ok).length,
    requestMs: percentiles(samples.map((s) => s.ms)),
    turnMs: percentiles(turnMs),
    chars: samples.reduce((sum, s) => sum + s.chars, 0),
    inputTokens: tokenSum(samples, 'inputTokens'),
    outputTokens: tokenSum(samples, 'outputTokens'),
  };
}

/** Sum of a token count, or null when the API reported none at all. */
function tokenSum(samples: readonly RequestSample[], key: 'inputTokens' | 'outputTokens'): number | null {
  const reported = samples.flatMap((s) => (s[key] === undefined ? [] : [s[key]]));
  return reported.length ? reported.reduce((a, b) => a + b, 0) : null;
}
