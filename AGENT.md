# AGENT.md

This file is binding for every agent working in this repository (`H:\links`).

## Product

Windows desktop receiver: Electron window via `npm run dev`, HTTP core in `server.mjs`, phone uses the browser. No mobile app. Phone picks photos/videos; PC stores originals. Videos use multiple connections on one file; the UI still shows one progress bar. Do not package an installer until this first slice is done.

## Git

After each **sub-feature** lands (one complete, reviewable slice), create a git commit.

- Commit only files for that slice.
- Message: 1–2 sentences on **why**, not a file dump.
- Never `git commit --amend` unless the user asked and the last commit is ours and unpushed.
- Never `--no-verify`, never change git config, never force-push.
- Never commit secrets, `data/config.json`, or files inside `received/`.

## Verify before telling the user

After any functional change, optimization, or new behavior:

1. Add or update a script under `scripts/` (PowerShell).
2. Run it. It must exit `0` only on real success.
3. **Do not tell the user the work is done until the script passed.**
4. If it fails, fix or revert in-repo, re-run, then report.
5. The script may only create/delete files under this repo, and only fixtures it owns (see Delete).

Default command: `powershell -NoProfile -File scripts\verify.ps1`

## Delete (hard)

**Forbidden:** delete anything outside this project directory (`H:\links` and its descendants). No parent folders, other drives, `%USERPROFILE%` (except if the user set an in-repo path), temp dirs we did not create for this task, or system paths.

Before **every** delete:

1. Resolve the path to an absolute path.
2. Confirm it is inside the repo root (`H:\links`).
3. Confirm the target is expected (build artifact, verify fixture, file we just created, or a path the user named in this repo).
4. If any check fails, **do not delete**. Stop and say why.

Safe examples: `H:\links\received\.verify-*` created by `scripts\verify.ps1`.  
Unsafe examples: `H:\`, `C:\Users\...`, `H:\links\..`, anything whose resolved path is not under `H:\links`.

## Scope

Do not install global tools unless required. Prefer stdlib. Do not rewrite the waiting-screen UI unless the task is UI.
