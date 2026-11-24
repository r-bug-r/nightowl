# Changelog

All notable changes to Nightowl for Windows are documented in this file.

## [0.2.0] - 2026-11-24

### Added
- Self-contained single-file `.NET 9` native Win32 helper (`Nightowl.Native.exe`) bundled inside the NSIS installer so Windows users need zero `.NET` runtime prerequisites.
- Custom multi-resolution Nightowl Windows icon (`build/icon.ico`) for installer, uninstaller, Start Menu, desktop shortcut, and Settings window.
- **Start with Windows** (`openAtLogin`) setting synced with Windows login items and exposed in both Settings and the tray context menu.
- In-app **Check for updates** against public GitHub Releases plus **Copy diagnostics** and safe external Docs/GitHub links.
- Native helper health monitoring and global hotkey registration status surfaced directly in Settings & Diagnostics.
- GitHub Actions CI (`ci.yml`), automated Windows tagged release workflow with `SHA256SUMS.txt` (`release.yml`), MIT `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, and Winget manifest templates (`packaging/winget/`).
- Accessible custom switches and `minimal-dark` / `minimal-light` theme synchronization in Settings & Diagnostics.

### Changed
- **Safer closed-lid default:** `keepAwakeWithLidClosed` is now opt-in (`false` by default) and overrides only AC (plugged-in) lid action while leaving DC battery lid-close behavior untouched.
- Standardized installer artifact naming to `Nightowl.Setup.<version>.exe` (no spaces) for reliable download URLs, SHA-256 verification, and Winget manifests.
- Added `Always awake (until stopped)`, `Auto-awake while agents think`, and `Start with Windows` to the native system tray context menu.

### Fixed
- Tray context menu now displays the configured `batteryThreshold` percentage instead of hardcoding `<10%`.
- Native helper errors during `setAwake` or polling are surfaced in Diagnostics instead of being silently swallowed.

## [0.1.0] - 2026-11-17

### Added
- Initial Windows system tray capsule with Electron 35, React 19, and `.NET 9` native Win32 helper.
- Timed awake sessions (`30m`, `2h`, `8h`, custom `D:H:M`), `+30m` click extension, `0.6s` hold-to-end ring, Always Awake mode, and `Ctrl+Shift+O` hotkey.
- Live Claude Code, Codex (CLI & Desktop), and Antigravity session HUD with direct window and tab focus.
- Battery safety cutoff, crash-safe disk session journal, and 3 capsule themes (`Forest`, `Minimal Dark`, `Minimal Light`).
