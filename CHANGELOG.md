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
- **v0.2:** Claude Code turn hook. `stopDecision` blocks a turn only on a repair-band break (the agent fixes it in the same turn), `leash snapshot` records the pre-turn tree (`git stash create`) so the check sees only this turn, `leash hook` is the Stop handler, and `leash init` / `uninstall` wire both hooks into a Claude Code `settings.json` idempotently.
- **v0.3:** `leash compile` validates the rubric and reports the deterministic-first split; a new optional per-rule `handledBy` defers a rule to a named deterministic tool (the engine skips it, so Jev is spent only where nothing else can decide). `leash guard <baseRef>` is a hard check that fails when the rubric is loosened (a rule removed, a band threshold raised, or a rule newly deferred). The agent authors the rubric from `CLAUDE.md` with no second model; see [docs/COMPILE.md](docs/COMPILE.md).
- **v0.4:** `leash calibrate [--sample N]` scores each active turn-phase rule over the last N commits (default 20) and flags rules that never fire as dead-rule candidates, so the rubric stays honest (`calibrationReport` / `tallyFires` exported). Opt-in edit-phase: `leash edit-check <file>` judges one file's working-tree diff against `phase: "edit"` rules; deliberately **not** wired by `leash init` (per-edit auto-repair is sharp at Jev's edit-level precision), with a documented opt-in `PostToolUse` recipe.
- **v0.5:** Codex turn hook. `leash init --codex` / `uninstall --codex` wire the same `snapshot` + `hook` pair into `.codex/hooks.json` (global or `--project`); Codex shares Claude Code's exact Stop contract, so the pure hook logic is unchanged. The runner now honors Codex's `stop_hook_active` flag (no re-block loop). The install core is generalized behind a `Host` type (`hostConfigPath` exported); `addLeashHooks` / `removeLeashHooks` are host-agnostic.
- **v0.6:** `/leash-rubric` authoring command. On Claude Code, `leash init` also drops a `/leash-rubric` slash command into `.claude/commands/` (and `uninstall` removes it) that walks the agent through the `docs/COMPILE.md` procedure - read the instruction files, keep only the un-lintable rules, write `.leash/rubric.json`, then `leash compile`. Still no second model. The command text and the `writeRubricCommand` / `removeRubricCommand` / `rubricCommandPath` helpers are exported.

### Changed

- Package renamed to `@cmaintz/leash`: the unscoped `leash` name is taken on npm. The `leash` binary is unchanged.

### Roadmap

- OpenCode hook adapter (deferred: OpenCode's plugin hooks return `void`, with no same-turn block primitive; waiting for a clean fit rather than shipping a lesser adapter).
