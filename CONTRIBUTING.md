# Contributing to Nightowl

Contributions, bug reports, and hardware Modern Standby (`S0ix`) test reports are welcome.

## Local Setup

Requires Windows 10/11 (x64), Node.js 20+, and `.NET 9 SDK`.

```powershell
npm install
npm run typecheck
npm test
npm run build
```

## Pull Request Checklist

1. Branch from `main` using a descriptive branch name (`feat/...`, `fix/...`).
2. Add or update unit tests in `electron/*.test.ts` for behavior changes.
3. Run `npm run typecheck` and `npm test` before opening a PR.
4. Keep claims about Windows power behavior strictly verified on real hardware.
