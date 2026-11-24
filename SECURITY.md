# Security Policy

## Supported Versions

Only the latest public release of Nightowl for Windows receives security fixes.

## Privacy & Local Boundaries

- Nightowl runs locally on Windows and collects zero analytics or telemetry.
- Local agent scanning reads process names, window titles, and local session metadata under your user profile (`~/.claude`, `~/.codex`, `~/.gemini/antigravity`) purely in memory to display session state and focus windows.
- Outbound HTTPS requests occur only when you click **Check for updates** (`https://api.github.com/repos/r-bug-r/nightowl/releases/latest`).
- External links opened from the app are restricted to `https://github.com/r-bug-r/nightowl` and `https://nightowl.sheif.org`.

## Reporting a Vulnerability

Please report security issues privately using GitHub Security Advisories on `r-bug-r/nightowl` rather than opening a public issue. Include steps to reproduce and your Windows + Nightowl version.
