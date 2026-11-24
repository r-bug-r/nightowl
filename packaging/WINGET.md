# Submitting Nightowl to Winget (`microsoft/winget-pkgs`)

Once the public `v0.2.0` GitHub Release is published on `r-bug-r/nightowl`:

1. `Sheif.Nightowl.installer.yaml` is populated with the `v0.2.0` SHA-256 digest from `SHA256SUMS.txt`. For future versions, copy the new hash from `SHA256SUMS.txt`.
2. Validate the manifests locally:

```powershell
winget validate --manifest packaging\winget
```

3. Submit a PR to `microsoft/winget-pkgs` using `wingetcreate` (or manually under `manifests/s/Sheif/Nightowl/0.2.0/`):

```powershell
winget install Microsoft.WingetCreate
wingetcreate submit --token <github-pat> packaging\winget
```
