// The commands about the rubric itself: `report`, `compile`, `guard` and the SessionStart
// stale-rubric nudge. None of them calls Jev.

import { existsSync, readFileSync } from 'node:fs';
import { printMisses } from './cli-output.js';
import {
  existsAt,
  loadBaseline,
  loadBaselineAt,
  loadRubric,
  loadRubricAt,
  loadSources,
  RUBRIC_PATH,
  tryLoadRubric,
  writeJson,
} from './cli-store.js';
import { deadScopes, summarize, type CompileSummary } from './compile.js';
import { git } from './git.js';
import { baselineGrowth, rubricDrift } from './guard.js';
import { readHookInput } from './hook.js';
import { parseRubric, type Rubric } from './schema.js';
import {
  instructionFiles,
  NO_STAMP_NUDGE,
  sessionStartOutput,
  SOURCES_PATH,
  stampSources,
  staleNudge,
  staleSources,
} from './sources.js';

export function report(): void {
  const rubric = loadRubric();
  if (!rubric) return void console.log(`leash: no rubric at ${RUBRIC_PATH}`);
  for (const rule of rubric.rules) {
    const scope = rule.scope.length ? rule.scope.join(',') : '*';
    console.log(`- ${rule.id} [${rule.phase}] scope=${scope} repair>=${rule.repairAt} note>=${rule.noteAt}`);
  }
  printMisses(5);
}

// Validate .leash/rubric.json, report the deterministic-first split and stamp its sources.
// Exit 1 when the rubric is malformed.
export function compile(): void {
  if (!existsSync(RUBRIC_PATH)) return void console.log(`leash: no rubric at ${RUBRIC_PATH}`);
  const rubric = parseOrReport(readFileSync(RUBRIC_PATH, 'utf8'));
  if (!rubric) return;
  printSummary(summarize(rubric));
  printDeadScopes(rubric);
  stampRubricSources(rubric);
}

// Globs are matched against repo-relative paths, so `*.ts` means root-level files only.
function printDeadScopes(rubric: Rubric): void {
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  for (const { id, glob } of deadScopes(rubric, files)) {
    console.log(`  warning: ${id} scope "${glob}" matches no file in the repo (use **/ for any depth)`);
  }
}

function parseOrReport(text: string): Rubric | null {
  try {
    return parseRubric(JSON.parse(text));
  } catch (err) {
    console.error(`leash: invalid rubric - ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return null;
  }
}

function printSummary(s: CompileSummary): void {
  console.log(
    `leash: ${s.active} active rule(s) (turn ${s.byPhase.turn}, edit ${s.byPhase.edit}), ${s.deferred} deferred of ${s.total}.`,
  );
  for (const d of s.deferrals) console.log(`  deferred to ${d.handledBy}: ${d.id}`);
}

// Record the instruction files this rubric was compiled from (see sources.ts).
function stampRubricSources(rubric: Rubric): void {
  const files = stampSources(instructionFiles(rubric));
  writeJson(SOURCES_PATH, { version: 1, files });
  console.log(`leash: recorded ${Object.keys(files).length} instruction file(s) in ${SOURCES_PATH}.`);
}

// SessionStart hook: if an instruction file changed since the last compile, tell the agent.
export async function session(): Promise<void> {
  await readHookInput();
  const rubric = tryLoadRubric();
  if (!rubric) return;
  const recorded = loadSources();
  const nudge = recorded ? staleNudge(staleSources(recorded, stampSources(instructionFiles(rubric)))) : NO_STAMP_NUDGE;
  if (nudge) console.log(JSON.stringify(sessionStartOutput(nudge)));
}

// Guard the rubric's integrity against a base ref: a loosening exits 1 for review.
export function guard(baseRef = 'HEAD'): void {
  const problems = rubricProblems(baseRef);
  if (problems === null) return void console.log(`leash: no rubric at ${baseRef} - nothing to compare.`);
  problems.push(...baselineGrowth(loadBaselineAt(baseRef), loadBaseline()));
  if (problems.length === 0) return void console.log('leash: rubric not loosened, baseline not grown.');
  console.error('leash: rubric loosened or debt accepted (needs review):');
  for (const line of problems) console.error(`  - ${line}`);
  process.exitCode = 1;
}

// null = no rubric at the base, so nothing to compare. A rubric the branch deleted or
// broke is the strongest loosening of all, so it fails rather than passing as "nothing".
function rubricProblems(baseRef: string): string[] | null {
  if (!existsAt(baseRef, RUBRIC_PATH)) return null;
  const base = loadRubricAt(baseRef);
  const current = tryLoadRubric();
  if (!current) return [`${RUBRIC_PATH}: missing or invalid`];
  return base ? rubricDrift(base, current).loosened : [];
}
