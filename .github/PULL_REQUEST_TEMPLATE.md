## Summary

<!-- What does this PR do + why? Link any issues it closes (e.g. "Closes #123"). -->

## Type

<!-- Check one (or more) -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality
      to not work as expected — call this out below!)
- [ ] Documentation
- [ ] Refactor / chore (no behaviour change)

## Breaking changes

<!-- If this is a breaking change, describe:
     - What breaks for existing installs (config? schema? API?)
     - The migration path (env vars to set, scripts to run, etc.)
     - Whether docs/deployment/updating.md needs an entry
     If not, write "None". -->

## How to test

<!-- Steps a reviewer should follow to verify the change. Include any
seed data, env vars, or URLs. Screenshots are very welcome. -->

1.
2.
3.

## Checklist

- [ ] `bun run lint` finishes clean.
- [ ] TypeScript strict-friendly — no new `any` types.
- [ ] API routes (not server actions) for any new backend logic.
- [ ] shadcn/ui components used (no new custom UI where an existing component
      would do).
- [ ] No new dev-only files committed (worklog.md, PLAN.md, agent-ctx/ stay
      in the private dev repo — see .gitignore).
- [ ] Docs updated if behaviour changed (e.g. docs/deployment/*).
- [ ] No security-relevant change is undocumented (if you touched auth,
      crypto, audit, or rate-limiting, call it out for review).

## Screenshots / recordings

<!-- For UI changes, before + after screenshots save a reviewer a lot of
time. -->
