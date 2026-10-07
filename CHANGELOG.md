# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.1] - 2026-10-04

### Fixed

- **Stop hook: repairs are verified again, and nothing can loop.** Since 0.5 the Stop hook returned early whenever `stop_hook_active` was set, on the belief that only Codex sends it. Claude Code sends it too (true once any Stop hook has forced a continuation), so after a single block the agent's repair was never re-checked, and a continuation forced by a *different* Stop hook skipped Leash entirely. Now every Stop is checked, but each finding blocks at most once per turn: a per-turn block record (fingerprints, in the git dir, reset by the next snapshot) is subtracted before deciding. A finding Jev keeps reporting cannot loop; a new break introduced while repairing is still caught. New export `stopDecisionOnce`, plus `readBlocked` / `recordBlocked`.
- README: documents that building a snapshot hashes untracked, non-ignored files into `.git/objects` (as `git add` would; nothing is committed and `git gc` prunes them).

### Changed

- Leash dogfoods itself: a committed `.leash/rubric.json` (fail-open, single-purpose functions, no premature abstraction, no silent error swallowing; line length deferred to eslint) guarded on every PR by a new `leash-guard` workflow.
- README: the "Works with Foundry" section no longer claims a boundary guard that does not exist (Foundry's boundary test covers `scripts/jev`, not Leash); it now states what is true. New "Use in CI" section for `leash guard`.

## [0.9.0] - 2026-10-04

### Fixed

- **The per-edit check never actually worked.** The documented 0.4 recipe ran `leash edit-check "$CLAUDE_FILE_PATH"`, but Claude Code sets no such variable - the edited path arrives on stdin as `tool_input.file_path` - so the check always got an empty argument. And even with a path, its plain exit-0 output only reached Claude Code's debug log, never Claude.

### Added

- **`leash edit-hook`**: a real PostToolUse handler. It reads `tool_input.file_path` from the hook payload (absolute; mapped to a repo-relative path, silent for files outside the repo), checks that file's diff against edit-phase rules, subtracts the ratchet baseline, and returns repair-band breaks as `hookSpecificOutput.additionalContext` - advisory text Claude sees, never a block.
- **`leash init --edit-phase`** wires it (PostToolUse, matcher `Edit|Write|MultiEdit`); `uninstall` removes it with the rest. Still off by default.
- New exports: `editHookOutput`, `repoRelative`, `EditHookOutput`, `InstallOptions` (`addLeashHooks(settings, { editPhase })`).

### Changed

- `leash edit-check <file>` now subtracts the ratchet baseline and skips ignored files and `.leash/`, the same as the turn check.

## [0.8.0] - 2026-10-04

### Added

- **OpenCode adapter.** `leash init --opencode` / `uninstall --opencode` write or remove a generated plugin (`.opencode/plugins/leash.js`, or `~/.config/opencode/plugins/leash.js` globally). OpenCode hooks return `void` - there is no "block the stop" - so the plugin snapshots on each user message (`chat.message`), checks once when the session goes idle (`session.status` idle, or the deprecated `session.idle`), and on a repair-band break sends the reason back as one follow-up prompt via `client.session.prompt`. Loop guard: at most one check and one nudge per user turn, and Leash's own nudge never resets the turn. Verified against the anomalyco/opencode plugin and event schemas; Bun shell semantics (array args, `.cwd().quiet().nothrow()`) checked with a real Bun.
- **`leash check --json`**: one stable, versioned JSON object (`version`, `base`, `ran`, `reason`, `findings` = new findings only, `skipped`, `decision`) for the OpenCode plugin and CI. It is valid JSON even with no key or rubric (`ran: false`).
- **`leash check --turn`**: diff against the turn snapshot (what the hooks judge) instead of a base ref.

### Changed

- CLI arguments: flags may now sit anywhere; the first non-flag argument is the base ref / file / sample size.
- Shared `writeFileEnsuringDir` / `removeIfExists` helpers behind the command and plugin installers.

## [0.7.0] - 2026-10-04

Turn-check correctness. Every fix here is something 0.6 silently got wrong.

### Fixed

- **Files created during a turn are now judged.** The turn snapshot was `git stash create` plus `git diff`, which ignore untracked files - so a brand-new file (the most common thing an agent writes) was never checked. Snapshots are now a git tree of the whole working tree (tracked + untracked, `.gitignore` respected), built in a scratch index so the real index is never touched. `leash check`, `audit` and `edit-check` use the same working-tree diff.
- **Large patches are actually chunked.** The README already promised this; nothing did it. An oversized patch is split on hunk boundaries (header repeated per chunk) and a rule counts as broken if any chunk breaks it.
- **One failed call no longer fails the whole turn.** Each file is isolated: a failing or timed-out call skips only that file, reported as `[skipped]` by `check` / `audit`.
- **Requests time out** (20 s default, `LEASH_TIMEOUT_MS`), so a hung connection cannot stall an agent's turn.
- The turn marker moved from `.leash/turn-base` (which showed up in `git status`) into the git dir; the old marker is still read once and then removed.

### Changed

- Files are judged with bounded concurrency (4 at a time) instead of one after another; findings keep diff order.
- Lockfiles, minified bundles, source maps (`DEFAULT_IGNORE`), binary patches and `.leash/` are never sent to Jev.
- New exports: `mapLimit`, `Skipped`, `CheckOptions`, `chunkPatch`, `mergeAnswers`, `isBinaryPatch`, `isLeashPath`, `MAX_PATCH_CHARS`, `DEFAULT_IGNORE`, `isIgnored`, `DEFAULT_TIMEOUT_MS`, `worktreeTree`, `writeTurnBase`, `readTurnBase`, `diffToWorktree`.
- The diff parser now has tests (it had none).

## [0.6.0] - 2026-10-04

First versioned release. Everything below shipped as internal milestones v0.1 to v0.6 while the package sat at 0.1.0; this release stamps them.

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
- `leash version` now reads the version from `package.json` instead of a hardcoded string, so it cannot drift.

[Unreleased]: https://github.com/CMaintz/leash/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/CMaintz/leash/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/CMaintz/leash/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/CMaintz/leash/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/CMaintz/leash/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/CMaintz/leash/releases/tag/v0.6.0
