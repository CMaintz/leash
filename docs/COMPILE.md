# Compiling a rubric

Leash does not call a second model to read your rules. The coding agent writes
`.leash/rubric.json` from your instruction files, and `leash compile` validates it and
shows the deterministic-first split. This is the whole compile step: agent authors,
CLI checks.

## The procedure (for the agent)

1. Read the project's instruction files (`CLAUDE.md`, `AGENTS.md`, and any linked
   coding-standard docs).
2. Pull out the rules that are **un-lintable** - the ones no formatter, linter, type
   checker, or test can decide. Good candidates: "no premature abstractions", "never
   let a raw error reach a user", "functions do one thing".
3. **Do not create a rule for anything a linter or the gate already enforces.** Line
   length, import order, formatting, unused vars, type errors: those belong to the
   deterministic tools. If a rule is a useful near-miss of something a tool covers,
   keep it but set `handledBy` to that tool so Leash defers it instead of spending a
   Jev call.
4. Phrase each `question` as a narrow yes/no where a break reads as `true` (Leash asks
   it as a Noul). "Does this change add an abstraction used in only one place?" is
   good; "Is the code clean?" is not.
5. Write `.leash/rubric.json`, then run `leash compile` and fix anything it reports.

## Rubric schema

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
      "noteAt": 0.55,
      "source": "CLAUDE.md:42"
    },
    {
      "id": "import-order",
      "question": "Are imports out of the project's required order?",
      "handledBy": "eslint"
    }
  ]
}
```

- `id` and `question` are required; everything else has a default.
- `phase`: `turn` (default, judged once per turn on the whole diff) or `edit`.
- `scope`: globs the rule applies to; empty means every file.
- `repairAt` / `noteAt`: probability bands (defaults 0.8 / 0.5). At or above `repairAt`
  the agent is told to repair; between `noteAt` and `repairAt` is a note.
- `source`: provenance, the instruction-file line the rule came from.
- `handledBy`: a deterministic tool that already enforces this. Set it and Leash skips
  the rule (hands it to that tool); `leash compile` lists it as deferred.

## Commands

```
leash compile          # validate the rubric, show the active vs deferred split
leash guard <baseRef>  # fail if the rubric was loosened versus baseRef (for CI)
```

`compile` exits non-zero only when the rubric is malformed. `guard` exits non-zero
when a rule was removed, a band threshold raised, or a rule newly deferred - so
weakening the rubric to get a green turn is a visible, reviewable change.
