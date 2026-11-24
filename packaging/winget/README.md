# Submitting Nightowl to Winget (`microsoft/winget-pkgs`)

Once the public `v0.2.0` GitHub Release is published on `r-bug-r/nightowl`:

1. Copy the exact SHA-256 hash from `SHA256SUMS.txt` into `RyeBugtong.Nightowl.installer.yaml` (replacing `REPLACE_WITH_RELEASE_SHA256`).
2. Validate the manifests locally:

```powershell
winget validate --manifest packaging\winget
```

3. Submit a PR to `microsoft/winget-pkgs` using `wingetcreate` (or manually under `manifests/r/RyeBugtong/Nightowl/0.2.0/`):

```powershell
winget install Microsoft.WingetCreate
wingetcreate submit --token <github-pat> packaging\winget
```
