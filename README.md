# Nightowl for Windows

Lightweight Windows system tray utility to keep your PC awake for large downloads, exports, and overnight tasks, with a hover-expanding monitor for active **Claude Code**, **Codex**, and **Antigravity** sessions.

## Features

- **System Tray Capsule**: Anchored in the Windows notification area with a golden-ringed owl icon, live countdown, and clock.
- **Timed Awake Sessions**: Click the owl to enter Days, Hours, and Minutes, or use quick presets (`30 Mins`, `2 Hours`, `8 Hours`). Click the countdown to add 30 minutes, or hold `×` for 0.6s to end early.
- **Native Win32 Power Assertion**: Uses `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` on a persistent `.NET 9` helper thread so your PC stays awake while allowing the screen to turn off safely.
- **Battery Safety & Crash Recovery**: Stops automatically below 10% battery and reconciles `session.json` on startup if the app exits unexpectedly.
- **Agent Session HUD (Hover to Expand)**: Hovering the tray capsule expands to show open **Claude Code**, **Codex** (CLI or Desktop App), and **Antigravity** (`agy` CLI or Antigravity 2.0 App) sessions with live thinking/loading animations. Clicking any agent icon focuses its window.

## Development

```bash
npm install
npm run build
npm start
```

Run tests and typecheck:

```bash
npm run typecheck
npm test
```
