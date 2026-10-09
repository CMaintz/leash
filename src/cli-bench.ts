import { benchReport, timedProvider, type BenchReport, type RequestSample } from './bench.js';
import { checkTurn } from './check.js';
import { sampleSize } from './cli-args.js';
import { commitDiffs } from './cli-calibrate.js';
import { skip } from './cli-output.js';
import { cliProvider, loadRubric } from './cli-store.js';

// Replay the last N commits as turns, exactly as the Stop hook would judge them.
export async function bench(): Promise<void> {
  const rubric = loadRubric();
  const provider = cliProvider();
  if (!rubric || !provider) return skip(rubric, provider);
  const samples: RequestSample[] = [];
  const timed = timedProvider(provider, samples);
  const turnMs: number[] = [];
  for (const diffs of commitDiffs(sampleSize())) {
    const start = performance.now();
    await checkTurn(timed, rubric, diffs, []);
    turnMs.push(performance.now() - start);
  }
  printBench(benchReport(samples, turnMs));
}

function printBench(r: BenchReport): void {
  const ms = (p: BenchReport['turnMs']): string =>
    `p50 ${Math.round(p.p50)}ms  p95 ${Math.round(p.p95)}ms  max ${Math.round(p.max)}ms`;
  console.log(`leash: bench over ${r.turns} commit(s) as turns, ${r.requests} Jev request(s), ${r.failed} failed.`);
  console.log(`  per request  ${ms(r.requestMs)}`);
  console.log(`  per turn     ${ms(r.turnMs)}   (what the Stop hook waits for)`);
  console.log(`  sent         ${r.chars} chars, ~${Math.round(r.chars / Math.max(1, r.turns))} per turn`);
  const tokens = r.inputTokens === null ? 'not reported by the API' : `${r.inputTokens} in, ${r.outputTokens ?? 0} out`;
  console.log(`  tokens       ${tokens}`);
  console.log('\nleash: multiply the token counts by your plan rate for spend; Leash does not guess prices.');
}
