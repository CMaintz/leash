# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **v0.1:** the offline core of a Jev-powered, turn-level output-quality guardrail for coding agents.
- `parseRubric` - validate a committed, readable rubric where each rule is one narrow yes/no question with a `repairAt` / `noteAt` band, optional `scope`, and `source` provenance.
- Pure engine: `questionsForFile` (batches one Noul per in-scope rule), `findingsForFile` (bands the answers), and the **ratchet** (`fingerprint`, `newFindings`, `baselineFrom`) so only newly introduced violations are flagged and the baseline can only shrink.
- `checkTurn` - one batched Jev call per changed file, banded and ratcheted; driven by the shared `JevProvider` port (`providerFromEnv` fails open with no key, honors `TYPESAFE_AI_BASE_URL`).
- `leash` CLI: `report`, `audit`, `check`. Always exits 0 (advisory, never breaks a session).
- Foundry TS gate: prettier, eslint (max-len), knip, tsc strict, vitest.

### Roadmap

- Claude Code / Codex / OpenCode hooks (turn-phase) with the ratchet and repair wiring.
- `compile` rules from CLAUDE.md, `calibrate` against git history, ruleset-guard on the rubric, deterministic-first compile, opt-in edit-phase.
