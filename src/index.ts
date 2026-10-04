// Leash public API. Library-first: the CLI and the agent hooks are thin wrappers
// over exactly these exports, so a host (like Foundry) can drive the same core.

export { calibrationReport, tallyFires } from './calibrate.js';
export type { RuleCalibration } from './calibrate.js';
export { checkTurn, mapLimit } from './check.js';
export type { CheckOptions, CheckResult, Skipped } from './check.js';
export { summarize } from './compile.js';
export type { CompileSummary, Deferral } from './compile.js';
export { rubricDrift } from './guard.js';
export type { RubricDrift } from './guard.js';
export { parseDiff } from './diff.js';
export type { FileDiff } from './diff.js';
export {
  bandFor,
  baselineFrom,
  DEFAULT_IGNORE,
  fingerprint,
  findingsForFile,
  isIgnored,
  newFindings,
  questionsForFile,
  rulesForFile,
} from './engine.js';
export { readHookInput, stopDecision } from './hook.js';
export type { StopDecision, StopHookInput } from './hook.js';
export { RUBRIC_COMMAND, removeRubricCommand, rubricCommandPath, writeRubricCommand } from './commands.js';
export { addLeashHooks, hostConfigPath, removeLeashHooks } from './install.js';
export type { ClaudeSettings, Host } from './install.js';
export { chunkPatch, isBinaryPatch, isLeashPath, MAX_PATCH_CHARS, mergeAnswers } from './patch.js';
export { parseRubric } from './schema.js';
export type { Baseline, Band, Finding, Phase, Rubric, Rule } from './schema.js';
export { DEFAULT_TIMEOUT_MS, postJson, providerFromEnv, TypeSafeProvider } from './provider.js';
export { diffToWorktree, readTurnBase, worktreeTree, writeTurnBase } from './snapshot.js';
export type { Answer, JevProvider, JevRequest, JevResponse, Question } from './provider.js';
