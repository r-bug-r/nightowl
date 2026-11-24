# Nightowl for Windows

Lightweight Windows 10/11 system tray utility that keeps your PC awake for overnight AI coding runs, builds, and large downloads while monitoring live **Claude Code**, **OpenAI Codex**, and **Antigravity** sessions.

- **Website & Docs:** https://nightowl.sheif.org
- **Releases & Checksums:** https://github.com/r-bug-r/nightowl/releases
- **License:** MIT

## Features

- **Live AI Agent HUD:** Hover the tray capsule to see active Claude Code, Codex (CLI or Desktop), and Antigravity sessions with live thinking/ready state, preview card, and 1-click jump to the exact window or Antigravity conversation tab.
- **Auto-Awake for Agents:** Optionally keep Windows awake automatically whenever any detected agent is actively thinking.
- **One-Click & Timed Awake Sessions:** Click the owl or press `Ctrl+Shift+O` to toggle Always Awake, or pick presets (`30m`, `2h`, `8h`, or custom `D:H:M`). Click the countdown to add `+30m`, or hold `×` for `0.6s` to stop safely.
- **Display Sleeps Safely:** Uses Win32 `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` in a dedicated native helper thread so CPU and network stay awake while your monitor turns off normally (optional toggle to keep screen lit).
- **Battery & Crash Safety:** Stops automatically below your chosen battery threshold (default `10%`, configurable `5%` to `20%`), writes an atomic `session.json` recovery journal so crashes never leave stale sleep locks, and keeps closed-lid awake strictly opt-in (AC power only).
- **Zero Runtime Prerequisites:** Ships with a self-contained `.NET 9` Win32 helper (`Nightowl.Native.exe`). No separate `.NET` runtime installation required.
- **Customizable Tray Capsule:** `Start with Windows`, 3 theme presets (`Forest`, `Minimal Dark`, `Minimal Light`), drag-to-reposition, drag-to-scale, and reorderable capsule sections.

## Install

### Option 1: Windows Installer (x64)

1. Download `Nightowl.Setup.0.2.0.exe` from [GitHub Releases](https://github.com/r-bug-r/nightowl/releases/latest).
2. Optional: verify the file hash against `SHA256SUMS.txt` in PowerShell:

```powershell
Get-FileHash .\Nightowl.Setup.0.2.0.exe -Algorithm SHA256
```

3. Run the installer. Because this is an unsigned open-source release, Windows Defender SmartScreen may show an "Unknown publisher" prompt. Click **More info**, confirm the filename matches your verified download, and click **Run anyway**.

### Option 2: Winget (after manifest approval)

```powershell
winget install Sheif.Nightowl
```

## Honest Limitations

- **No thermal sensor cutoff yet:** Nightowl stops on low battery, not internal CPU/battery temperature. Always run heavy overnight tasks on a hard, well-ventilated surface, never inside a closed bag.
- **Closed-lid Modern Standby variance:** Opt-in closed-lid awake temporarily overrides the active AC lid-close power setting and restores it on stop or crash recovery. Some Windows OEM laptops still force Modern Standby (`S0ix`) in firmware when the lid closes.
- **100% local, zero telemetry:** Nightowl reads local process trees and local agent session logs on your machine only. Network access happens only when you click **Check for updates** (queries the public GitHub Releases API).

## Development

Prerequisites: Node.js 20+ and `.NET 9 SDK` (Windows 10/11 x64).

```powershell
npm install
npm run typecheck
npm test
npm run build
npm start
```

Build the zero-prerequisite NSIS Windows installer locally:

```powershell
npm run package:win
```

Output lands in `release/Nightowl.Setup.<version>.exe`.

## Attribution

Inspired by Krish Gupta's macOS utility [krishhgg/Insomnia](https://github.com/krishhgg/Insomnia) (MIT). Nightowl is an independent Windows codebase and has no affiliation with Kong's Insomnia REST API client.
