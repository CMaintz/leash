// Leash public API. Library-first: the CLI and the agent hooks are thin wrappers
// over exactly these exports, so a host (like Foundry) can drive the same core.

export { checkTurn } from './check.js';
export type { CheckResult } from './check.js';
export { summarize } from './compile.js';
export type { CompileSummary, Deferral } from './compile.js';
export { rubricDrift } from './guard.js';
export type { RubricDrift } from './guard.js';
export { parseDiff } from './diff.js';
export type { FileDiff } from './diff.js';
export {
  bandFor,
  baselineFrom,
  fingerprint,
  findingsForFile,
  newFindings,
  questionsForFile,
  rulesForFile,
} from './engine.js';
export { readHookInput, stopDecision } from './hook.js';
export type { StopDecision, StopHookInput } from './hook.js';
export { addLeashHooks, removeLeashHooks } from './install.js';
export type { ClaudeSettings } from './install.js';
export { parseRubric } from './schema.js';
export type { Baseline, Band, Finding, Phase, Rubric, Rule } from './schema.js';
export { postJson, providerFromEnv, TypeSafeProvider } from './provider.js';
export type { Answer, JevProvider, JevRequest, JevResponse, Question } from './provider.js';
