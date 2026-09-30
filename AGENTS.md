# AGENTS.md

Rules for anyone (human or agent) changing this codebase. They override habits and defaults.

## ⛔ 1. ROOT CAUSE ONLY. NO HYPOTHETICAL FIXES. NO "JUST IN CASE" SAFEGUARDS.

- **Reproduce the bug first.** No reproduction = no fix. Say so and keep investigating.
- **Find the first cause**, not a symptom.
- **Fix only that cause, with the minimal change.** Then stop.
- **NEVER add extra guards, retries, fallbacks, try/catch, timeouts or checks "to be safe".** If it was not reproduced as the cause, it does not go in.
- A fix that cannot point to the reproduced cause it removes is not a fix. Delete it.

## ⛔ 2. NO PREMATURE OPTIMIZATION. IT IS THE ROOT OF ALL EVIL.

- **YAGNI first. KISS first. DRY first.**
- Build only what is needed now. No configurability, abstractions, caches or "future-proofing" nobody asked for.
- Optimize only a measured, reproduced problem.

## ⛔ 3. KEEP THE CODEBASE AS SMALL AND CLEAN AS POSSIBLE.

- **Everything unnecessary gets deleted**: dead code, unused files, unused dependencies, commented-out code, workarounds for bugs already fixed upstream.
- Only the minimal code that is needed, well organized and readable.
- When upgrading a dependency, check whether our workarounds for its old bugs can now be removed — and remove them.
