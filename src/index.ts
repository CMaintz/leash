// Leash public API. Library-first: the CLI and the agent hooks are thin wrappers
// over exactly these exports, so a host (like Foundry) can drive the same core.

export { checkTurn } from './check.js';
export type { CheckResult } from './check.js';
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
export { parseRubric } from './schema.js';
export type { Baseline, Band, Finding, Phase, Rubric, Rule } from './schema.js';
export { postJson, providerFromEnv, TypeSafeProvider } from './provider.js';
export type { Answer, JevProvider, JevRequest, JevResponse, Question } from './provider.js';
