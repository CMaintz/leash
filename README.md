# Leash

Keep a coding agent's output quality on a short leash. Leash judges every turn
against your project's un-lintable rules using [Jev](https://typesafe.ai) (TypeSafe's
System One decision model), and tells the agent exactly which rule it broke so it
fixes it before moving on. About 300 ms and a fraction of a cent per turn.

> Jev-powered. Early (v0.1): the offline core (rubric, engine, ratchet, CLI). Agent
> hooks land next. Inspired by [Abide](https://www.npmjs.com/package/@coldtea/abide);
> the difference is the ratchet (below).

## Why

Your `CLAUDE.md` / `AGENTS.md` is full of rules no linter can check: "no premature
abstractions", "never let a raw error reach a user", "small single-purpose functions".
Nothing enforces them, so the agent breaks them from the first edit. A frontier LLM
could judge each rule, but at a cent and a few seconds per check it never pays off.
Jev answers one typed question per rule with a calibrated probability in ~300 ms for a
fraction of a cent, which is what makes checking every turn viable.

## What makes it different: the ratchet

Judging every file as if freshly written buries you in findings on a real repo. Leash
borrows Foundry's accepted-debt baseline: existing violations are baselined once, and
Leash only ever flags what a turn **newly** introduces. The baseline is one-way, it can
only shrink. That is what makes it adoptable on an existing codebase from day one.

Turn-check is the default (once per turn, on the whole diff, where the un-lintable
questions actually have an answer). A per-edit mode is planned but off by default: at
Jev's edit-level precision, per-edit auto-repair risks the agent chasing phantoms.

## Install

```
npm install -g leash   # or: npx leash <command>
```

Set a key: `export JEV_API_KEY=...` (or `TYPESAFE_AI_BASE_URL` for a self-host / proxy /
mock). No key means Leash no-ops and lets the edit through, always.

## Use

```
leash report              # list the rules in .leash/rubric.json
leash compile             # validate the rubric, show the active vs deferred split
leash audit               # accept the current diff's findings into the baseline
leash check [baseRef]     # print what this turn newly broke (default base: HEAD)
leash guard [baseRef]     # fail if the rubric was loosened vs baseRef (for CI)
```

You do not hand-write the rubric from scratch: your coding agent compiles it from your
`CLAUDE.md` / `AGENTS.md` (no second model involved - see [docs/COMPILE.md](docs/COMPILE.md)),
then `leash compile` validates it. Rules a linter or the gate already enforce are marked
`handledBy` and skipped (deterministic-first), so Jev is spent only where nothing else
can decide. `leash guard` makes any later weakening of the rubric a red, reviewable check.

A rubric is a committed, readable `.leash/rubric.json`. Each rule is one narrow yes/no
question, phrased so a break reads as `true`, with a `repairAt` / `noteAt` band and an
optional `scope`, `source` (the instruction-file line it came from), and `handledBy`
(a deterministic tool that owns it instead):

```json
{
  "version": 1,
  "rules": [
    {
      "id": "no-premature-abstraction",
      "question": "Does this change add an abstraction (interface, wrapper, base class) used in only one place?",
      "phase": "turn",
      "scope": ["src/**/*.ts"],
      "repairAt": 0.8,
      "noteAt": 0.5,
      "source": "CLAUDE.md:42"
    }
  ]
}
```

## Claude Code (turn hook)

Leash runs as two Claude Code hooks: a `UserPromptSubmit` hook snapshots the working
tree at the start of a turn, and a `Stop` hook checks what that turn changed and, on a
repair-band break, blocks the stop and hands the agent the exact rules to fix so it
repairs them in the same turn. Install both in one command:

```
leash init              # writes the hooks into ~/.claude/settings.json (idempotent)
leash init --project    # or into this repo's .claude/settings.json
leash uninstall         # removes them again
```

`init` merges into whatever is already there and never duplicates. Under the hood it
adds the two hooks to `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "leash snapshot" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "leash hook" }] }]
  }
}
```

`leash snapshot` records the pre-turn state; `leash hook` reads the Stop payload, diffs
against that snapshot, and prints `{"decision":"block","reason":...}` only when a turn
newly breaks a repair-band rule. No key or no rubric means it stays silent and lets the
agent stop (fail open).

## Library

Leash is library-first; the CLI and the coming agent hooks are thin wrappers over the
same exports, so a host can drive the core directly:

```ts
import { checkTurn, parseDiff, parseRubric, providerFromEnv } from 'leash';

const provider = providerFromEnv();
if (provider) {
  const { actionable } = await checkTurn(provider, rubric, parseDiff(diffText), baseline);
}
```

## Works with Foundry

Leash is designed to plug into [Foundry](https://github.com/CMaintz/foundry) with no
friction: a deterministic-first compile skips any rule the six-verb gate or habit-hooks
already enforce, the baseline uses Foundry's ratchet convention, and a boundary guard
keeps Leash out of `mise run gate`. It is a coach on the proposer side, never an oracle.

## Honest limits

Jev is about 68% accurate, so Leash is advisory: it never blocks a commit or fails a
build. It says which rule and how likely, never why or how many; the agent supplies the
fix. Text-only, so it judges per file and chunks large diffs.

## Contributing

Plain npm, no special tooling:

```
npm install
npm run lint        # eslint + prettier
npm run typecheck   # tsc --strict
npm test            # vitest
npm run build
```

The maintainer additionally runs a [Foundry](https://github.com/CMaintz/foundry)
quality gate (mise verbs + habit-hooks structural smells); the committed `mise.toml`
and `.habit-hooks/` support that. Neither is required to build, test, or contribute -
they are an optional overlay, and habit-hooks never needs to be installed to use Leash.

## License

MIT.
