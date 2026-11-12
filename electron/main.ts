import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import path from "node:path";
import { NativeBridge } from "./nativeBridge";
import { SessionJournal } from "./sessionJournal";
import { SessionScanner } from "./sessionScanner";
import type { AgentSession, AwakeState, NightowlSettings, PowerStatus } from "./types";

const isDev = process.argv.includes("--dev");
const DEV_URL = "http://127.0.0.1:5173";

const nativeBridge = new NativeBridge();
const scanner = new SessionScanner({ selfPid: process.pid });

let capsuleWindow: BrowserWindow | null = null;
let diagnosticsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let journal: SessionJournal;

let settings: NightowlSettings = {
  batteryThreshold: 10,
  batterySafeStop: true,
  keepDisplay: false,
  autoAwakeForAgents: false,
};

let powerStatus: PowerStatus = {
  acLineOnline: true,
  hasBattery: false,
  batteryPercent: 100,
  charging: false,
  batterySaver: false,
};

let manualAwake = false;
let endsAt: number | null = null;
let autoAwakeActive = false;
let recoveredFromCrash = false;
let recoveryNote: string | null = null;
let sessions: AgentSession[] = [];

// Anchor bottom-right corner of capsule window
let anchorRight = 0;
let anchorBottom = 0;
let capsuleWidth = 230;
let capsuleHeight = 56;

function computeAwakeState(): AwakeState {
  const now = Date.now();
  const remainingMs = endsAt ? Math.max(0, endsAt - now) : 0;
  const active = manualAwake || autoAwakeActive;
  return {
    active,
    endsAt,
    remainingMs,
    keepDisplay: settings.keepDisplay,
    batterySafeStop: settings.batterySafeStop,
    autoAwakeForAgents: settings.autoAwakeForAgents,
    autoAwakeActive,
    recoveredFromCrash,
    recoveryNote,
    power: powerStatus,
  };
}

function broadcastState(): void {
  const payload = {
    awake: computeAwakeState(),
    sessions,
    settings,
  };
  if (capsuleWindow && !capsuleWindow.isDestroyed()) {
    capsuleWindow.webContents.send("nightowl:state", payload);
  }
  if (diagnosticsWindow && !diagnosticsWindow.isDestroyed()) {
    diagnosticsWindow.webContents.send("nightowl:state", payload);
  }
  refreshTrayMenu();
}

async function syncPowerAssertion(): Promise<void> {
  const active = manualAwake || autoAwakeActive;
  try {
    await nativeBridge.setAwake(active, active && settings.keepDisplay);
  } catch {
    // ignore transient IPC error
  }
}

async function startAwake(durationMs: number | null): Promise<AwakeState> {
  manualAwake = true;
  endsAt = durationMs && durationMs > 0 ? Date.now() + durationMs : null;
  recoveryNote = null;
  await journal.writeActive(endsAt, settings.keepDisplay);
  await syncPowerAssertion();
  broadcastState();
  return computeAwakeState();
}

async function addAwakeTime(deltaMs: number): Promise<AwakeState> {
  if (!manualAwake) {
    return startAwake(deltaMs);
  }
  const base = endsAt ? Math.max(endsAt, Date.now()) : Date.now();
  endsAt = base + deltaMs;
  await journal.writeActive(endsAt, settings.keepDisplay);
  await syncPowerAssertion();
  broadcastState();
  return computeAwakeState();
}

async function stopAwake(reason?: string): Promise<AwakeState> {
  manualAwake = false;
  autoAwakeActive = false;
  endsAt = null;
  if (reason) {
    recoveryNote = reason;
  }
  await journal.clear(true);
  await syncPowerAssertion();
  broadcastState();
  return computeAwakeState();
}

function defaultCapsuleAnchor(): { right: number; bottom: number } {
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  return {
    right: wa.x + wa.width - 14,
    bottom: wa.y + wa.height - 10,
  };
}

function applyCapsuleBounds(): void {
  if (!capsuleWindow || capsuleWindow.isDestroyed()) return;
  const x = Math.round(anchorRight - capsuleWidth);
  const y = Math.round(anchorBottom - capsuleHeight);
  capsuleWindow.setBounds(
    {
      x,
      y,
      width: Math.max(180, Math.round(capsuleWidth)),
      height: Math.max(48, Math.round(capsuleHeight)),
    },
    false
  );
}

function createOwlTrayImage(): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="11" fill="#050d0a" stroke="#fbbf24" stroke-width="1.8"/>
    <path d="M5.5 7.5 L8 9.2 L12 10.2 L16 9.2 L18.5 7.5 C19.3 10.5 18.8 14.8 16.5 17.5 C14.5 18.8 9.5 18.8 7.5 17.5 C5.2 14.8 4.7 10.5 5.5 7.5 Z" fill="#0a1612" stroke="#eefbf4" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="9" cy="11.5" r="2.2" fill="#fbbf24"/>
    <circle cx="15" cy="11.5" r="2.2" fill="#fbbf24"/>
    <circle cx="9" cy="11.5" r="1.1" fill="#050d0a"/>
    <circle cx="15" cy="11.5" r="1.1" fill="#050d0a"/>
    <polygon points="11.2,12.8 12,14.8 12.8,12.8" fill="#f59e0b"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  );
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const awake = computeAwakeState();
  const statusLabel = awake.active
    ? awake.endsAt
      ? `Keeping PC awake (${Math.ceil(awake.remainingMs / 60000)}m left)`
      : "Keeping PC awake"
    : "Normal sleep active";

  const menu = Menu.buildFromTemplate([
    { label: `Nightowl: ${statusLabel}`, enabled: false },
    { label: `Open agents: ${sessions.length}`, enabled: false },
    { type: "separator" },
    { label: "Keep awake for 30 mins", click: () => void startAwake(30 * 60_000) },
    { label: "Keep awake for 2 hours", click: () => void startAwake(2 * 3600_000) },
    { label: "Keep awake for 8 hours", click: () => void startAwake(8 * 3600_000) },
    { label: "End awake session", enabled: awake.active, click: () => void stopAwake() },
    { type: "separator" },
    {
      label: "Show / Hide Tray Capsule",
      click: () => {
        if (!capsuleWindow) return;
        if (capsuleWindow.isVisible()) capsuleWindow.hide();
        else capsuleWindow.showInactive();
      },
    },
    {
      label: "Reset Capsule Position",
      click: () => {
        const def = defaultCapsuleAnchor();
        anchorRight = def.right;
        anchorBottom = def.bottom;
        applyCapsuleBounds();
      },
    },
    { label: "Settings & Diagnostics...", click: () => openDiagnosticsWindow() },
    { type: "separator" },
    { label: "Exit Nightowl", click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(`Nightowl for Windows · ${statusLabel}`);
}

function createCapsuleWindow(): void {
  const def = defaultCapsuleAnchor();
  anchorRight = def.right;
  anchorBottom = def.bottom;

  capsuleWindow = new BrowserWindow({
    width: capsuleWidth,
    height: capsuleHeight,
    x: Math.round(anchorRight - capsuleWidth),
    y: Math.round(anchorBottom - capsuleHeight),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  capsuleWindow.setAlwaysOnTop(true, "screen-saver");
  capsuleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    void capsuleWindow.loadURL(DEV_URL);
  } else {
    void capsuleWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  capsuleWindow.once("ready-to-show", () => {
    capsuleWindow?.showInactive();
    broadcastState();
  });

  capsuleWindow.on("closed", () => {
    capsuleWindow = null;
  });
}

function openDiagnosticsWindow(): void {
  if (diagnosticsWindow && !diagnosticsWindow.isDestroyed()) {
    diagnosticsWindow.show();
    diagnosticsWindow.focus();
    return;
  }

  diagnosticsWindow = new BrowserWindow({
    width: 520,
    height: 540,
    title: "Nightowl Settings & Diagnostics",
    backgroundColor: "#050d0a",
    autoHideMenuBar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    void diagnosticsWindow.loadURL(`${DEV_URL}/?view=diagnostics`);
  } else {
    void diagnosticsWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"), {
      query: { view: "diagnostics" },
    });
  }

  diagnosticsWindow.on("closed", () => {
    diagnosticsWindow = null;
  });
}

async function pollLoop(): Promise<void> {
  try {
    const [nextPower, snapshot] = await Promise.all([
      nativeBridge.getPowerStatus(),
      nativeBridge.snapshot(),
    ]);

    powerStatus = nextPower;
    sessions = await scanner.scan(snapshot);

    const now = Date.now();
    if (manualAwake && endsAt && now >= endsAt) {
      await stopAwake("Timer finished. Normal sleep restored.");
      return;
    }

    if (
      settings.batterySafeStop &&
      !powerStatus.acLineOnline &&
      powerStatus.hasBattery &&
      powerStatus.batteryPercent < settings.batteryThreshold &&
      (manualAwake || autoAwakeActive)
    ) {
      await stopAwake(`Stopped automatically below ${settings.batteryThreshold}% battery.`);
      return;
    }

    if (settings.autoAwakeForAgents && !manualAwake) {
      const anyThinking = sessions.some((s) => s.state === "thinking");
      if (anyThinking !== autoAwakeActive) {
        autoAwakeActive = anyThinking;
        await syncPowerAssertion();
      }
    } else if (!settings.autoAwakeForAgents && autoAwakeActive) {
      autoAwakeActive = false;
      await syncPowerAssertion();
    }

    broadcastState();
  } catch {
    // keep polling resilient
  }
}

function registerIpc(): void {
  ipcMain.handle("nightowl:getState", () => ({
    awake: computeAwakeState(),
    sessions,
    settings,
  }));

  ipcMain.handle("nightowl:startAwake", (_ev, durationMs: number | null) =>
    startAwake(durationMs)
  );

  ipcMain.handle("nightowl:addAwakeTime", (_ev, deltaMs: number) => addAwakeTime(deltaMs));

  ipcMain.handle("nightowl:stopAwake", () => stopAwake());

  ipcMain.handle("nightowl:updateSettings", async (_ev, patch: Partial<NightowlSettings>) => {
    settings = { ...settings, ...patch };
    await syncPowerAssertion();
    broadcastState();
    return settings;
  });

  ipcMain.handle("nightowl:focusSession", async (_ev, hwnd: string) => {
    return nativeBridge.focusWindow(hwnd);
  });

  ipcMain.on(
    "nightowl:resizeCapsule",
    (_ev, size: { width: number; height: number }) => {
      capsuleWidth = Math.max(180, Math.min(920, Math.ceil(size.width)));
      capsuleHeight = Math.max(48, Math.min(460, Math.ceil(size.height)));
      applyCapsuleBounds();
    }
  );

  ipcMain.on("nightowl:moveCapsuleBy", (_ev, delta: { dx: number; dy: number }) => {
    anchorRight += delta.dx;
    anchorBottom += delta.dy;
    applyCapsuleBounds();
  });

  ipcMain.on("nightowl:resetCapsulePosition", () => {
    const def = defaultCapsuleAnchor();
    anchorRight = def.right;
    anchorBottom = def.bottom;
    applyCapsuleBounds();
  });

  ipcMain.on("nightowl:openDiagnostics", () => openDiagnosticsWindow());
  ipcMain.on("nightowl:quit", () => app.quit());
}

app.whenReady().then(async () => {
  const userDataDir = app.getPath("userData");
  journal = new SessionJournal(path.join(userDataDir, "session.json"));

  nativeBridge.start();
  const recovery = await journal.reconcileOnStartup();
  recoveredFromCrash = recovery.recoveredFromCrash;
  if (recoveredFromCrash) {
    recoveryNote = "Cleared an unclosed session from a previous exit.";
  }
  await nativeBridge.setAwake(false, false);

  registerIpc();
  tray = new Tray(createOwlTrayImage());
  tray.on("click", () => {
    if (!capsuleWindow) return;
    if (capsuleWindow.isVisible()) capsuleWindow.showInactive();
    else capsuleWindow.showInactive();
  });

  createCapsuleWindow();
  await pollLoop();
  pollTimer = setInterval(() => void pollLoop(), 1500);
});

app.on("before-quit", () => {
  if (pollTimer) clearInterval(pollTimer);
  void journal?.clear(true);
  void nativeBridge.stop();
});

app.on("window-all-closed", () => {
  // Keep running in system tray
});
