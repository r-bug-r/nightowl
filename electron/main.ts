import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { NativeBridge } from "./nativeBridge";
import { SessionJournal } from "./sessionJournal";
import { SessionScanner } from "./sessionScanner";
import { DEFAULT_SETTINGS, sanitizeSettingsPatch } from "./settings";
import type { AgentSession, AwakeState, LidActionBackup, NightowlSettings, PowerStatus } from "./types";
import { checkForUpdates, isAllowedExternalUrl } from "./updateChecker";

const isDev = process.argv.includes("--dev");
const DEV_URL = "http://127.0.0.1:5173";

const nativeBridge = new NativeBridge();
const scanner = new SessionScanner({ selfPid: process.pid });

let capsuleWindow: BrowserWindow | null = null;
let diagnosticsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let journal: SessionJournal;

let settings: NightowlSettings = { ...DEFAULT_SETTINGS };

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
let nativeHealthy = true;
let nativeError: string | null = null;
let shortcutRegistered = false;
let currentLidBackup: LidActionBackup | null = null;
let sessions: AgentSession[] = [];

// Anchor bottom-right corner of capsule window
let anchorRight = 0;
let anchorBottom = 0;
// Fixed-size transparent canvas; never resized at runtime (prevents flicker + upward jumps)
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 420;
let capsuleWidth = CANVAS_WIDTH;
let capsuleHeight = CANVAS_HEIGHT;
let lastAppliedBounds: { x: number; y: number; width: number; height: number } | null = null;
let settingsFilePath = "";
let persistTimer: NodeJS.Timeout | null = null;

interface PersistedConfig {
  settings?: Partial<NightowlSettings>;
  anchorRight?: number;
  anchorBottom?: number;
}

async function loadPersistedConfig(): Promise<void> {
  if (!settingsFilePath) return;
  try {
    const raw = await fs.readFile(settingsFilePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedConfig;
    if (parsed.settings && typeof parsed.settings === "object") {
      settings = { ...settings, ...sanitizeSettingsPatch(parsed.settings) };
    }
    if (
      typeof parsed.anchorRight === "number" &&
      Number.isFinite(parsed.anchorRight) &&
      typeof parsed.anchorBottom === "number" &&
      Number.isFinite(parsed.anchorBottom)
    ) {
      anchorRight = parsed.anchorRight;
      anchorBottom = parsed.anchorBottom;
    }
  } catch {
    // first launch or unreadable config; use defaults
  }
}

async function savePersistedConfigNow(): Promise<void> {
  if (!settingsFilePath) return;
  try {
    const payload: PersistedConfig = {
      settings,
      anchorRight,
      anchorBottom,
    };
    await fs.writeFile(settingsFilePath, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // ignore write failure
  }
}

function schedulePersistConfig(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void savePersistedConfigNow();
  }, 350);
}

function applyLoginItemSetting(openAtLogin: boolean): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin });
  } catch {
    // ignore OS policy restriction on login items
  }
}

function computeAwakeState(): AwakeState {
  const now = Date.now();
  const remainingMs = endsAt ? Math.max(0, endsAt - now) : 0;
  const active = manualAwake || autoAwakeActive;
  return {
    active,
    manualAwake,
    endsAt,
    remainingMs,
    keepDisplay: settings.keepDisplay,
    keepAwakeWithLidClosed: Boolean(settings.keepAwakeWithLidClosed),
    lidOverrideActive: Boolean(active && currentLidBackup),
    batterySafeStop: settings.batterySafeStop,
    autoAwakeForAgents: settings.autoAwakeForAgents,
    autoAwakeActive,
    recoveredFromCrash,
    recoveryNote,
    nativeHealthy,
    nativeError,
    shortcutRegistered,
    appVersion: app.getVersion(),
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
  const keepLidAwake = Boolean(settings.keepAwakeWithLidClosed);
  try {
    const res = await nativeBridge.setAwake(active, active && settings.keepDisplay, active && keepLidAwake);
    nativeHealthy = true;
    nativeError = null;
    currentLidBackup = active && keepLidAwake ? (res?.lidBackup ?? null) : null;
    if (active) {
      await journal?.writeActive(endsAt, settings.keepDisplay, currentLidBackup);
    }
  } catch (err) {
    nativeHealthy = false;
    nativeError = err instanceof Error ? err.message : "Native power helper did not respond.";
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

function clampAnchorToDisplays(right: number, bottom: number): { right: number; bottom: number } {
  const displays = screen.getAllDisplays();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const d of displays) {
    minX = Math.min(minX, d.workArea.x);
    minY = Math.min(minY, d.workArea.y);
    maxX = Math.max(maxX, d.workArea.x + d.workArea.width);
    maxY = Math.max(maxY, d.workArea.y + d.workArea.height);
  }
  if (!Number.isFinite(minX)) return { right, bottom };
  return {
    right: Math.max(minX + 80, Math.min(maxX + 12, right)),
    bottom: Math.max(minY + 40, Math.min(maxY + 12, bottom)),
  };
}

function applyCapsuleBounds(): void {
  if (!capsuleWindow || capsuleWindow.isDestroyed()) return;
  const width = Math.max(120, Math.round(capsuleWidth));
  const height = Math.max(36, Math.round(capsuleHeight));
  const x = Math.round(anchorRight - width);
  const y = Math.round(anchorBottom - height);
  if (
    lastAppliedBounds &&
    lastAppliedBounds.x === x &&
    lastAppliedBounds.y === y &&
    lastAppliedBounds.width === width &&
    lastAppliedBounds.height === height
  ) {
    return;
  }
  lastAppliedBounds = { x, y, width, height };
  capsuleWindow.setBounds({ x, y, width, height }, false);
}

function createOwlTrayImage(): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="11" fill="#050d0a" stroke="#fbbf24" stroke-width="1.8"/>
    <path d="M4.8 6.0 L8.0 8.2 Q12 7.3 16.0 8.2 L19.2 6.0 C20.3 9.7 19.9 15.2 17.2 18.3 C15.0 19.8 9.0 19.8 6.8 18.3 C4.1 15.2 3.7 9.7 4.8 6.0 Z" fill="#0b1914" stroke="#f0fdf4" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M6.0 8.5 L12 10.6 L18.0 8.5" fill="none" stroke="#fbbf24" stroke-width="0.95" stroke-linecap="round"/>
    <circle cx="8.6" cy="12" r="2.6" fill="#fbbf24"/>
    <circle cx="15.4" cy="12" r="2.6" fill="#fbbf24"/>
    <circle cx="8.6" cy="12" r="1.25" fill="#050d0a"/>
    <circle cx="15.4" cy="12" r="1.25" fill="#050d0a"/>
    <circle cx="7.9" cy="11.2" r="0.55" fill="#ffffff"/>
    <circle cx="14.7" cy="11.2" r="0.55" fill="#ffffff"/>
    <polygon points="12,12.6 13.0,14.0 12,15.8 11.0,14.0" fill="#f59e0b"/>
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
    { label: `Nightowl v${app.getVersion()}: ${statusLabel}`, enabled: false },
    { label: `Open agents: ${sessions.length}`, enabled: false },
    { type: "separator" },
    { label: "Always awake (until stopped)", click: () => void startAwake(null) },
    { label: "Keep awake for 30 mins", click: () => void startAwake(30 * 60_000) },
    { label: "Keep awake for 2 hours", click: () => void startAwake(2 * 3600_000) },
    { label: "Keep awake for 8 hours", click: () => void startAwake(8 * 3600_000) },
    { label: "End awake session", enabled: awake.active, click: () => void stopAwake() },
    { type: "separator" },
    {
      label: "Auto-awake while agents think",
      type: "checkbox",
      checked: settings.autoAwakeForAgents,
      click: (item) => {
        settings = { ...settings, autoAwakeForAgents: item.checked };
        schedulePersistConfig();
        void syncPowerAssertion().then(() => broadcastState());
      },
    },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: Boolean(settings.openAtLogin),
      click: (item) => {
        settings = { ...settings, openAtLogin: item.checked };
        applyLoginItemSetting(item.checked);
        schedulePersistConfig();
        broadcastState();
      },
    },
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
        schedulePersistConfig();
      },
    },
    { label: "Settings & Diagnostics...", click: () => openDiagnosticsWindow() },
    { type: "separator" },
    { label: "Exit Nightowl", click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(`Nightowl for Windows · ${statusLabel}`);
}

let capsuleAllowFocus = false;

function stripCapsuleChrome(): void {
  if (!capsuleWindow || capsuleWindow.isDestroyed()) return;
  try {
    const handleBuf = capsuleWindow.getNativeWindowHandle();
    if (handleBuf.length >= 8) {
      void nativeBridge.stripWindowChrome(handleBuf.readBigInt64LE(0).toString());
    } else if (handleBuf.length >= 4) {
      void nativeBridge.stripWindowChrome(handleBuf.readInt32LE(0).toString());
    }
  } catch {
    // ignore handle read error
  }
}

function createCapsuleWindow(): void {
  if (anchorRight === 0 && anchorBottom === 0) {
    const def = defaultCapsuleAnchor();
    anchorRight = def.right;
    anchorBottom = def.bottom;
  } else {
    const clamped = clampAnchorToDisplays(anchorRight, anchorBottom);
    anchorRight = clamped.right;
    anchorBottom = clamped.bottom;
  }

  capsuleWindow = new BrowserWindow({
    title: "",
    width: capsuleWidth,
    height: capsuleHeight,
    x: Math.round(anchorRight - capsuleWidth),
    y: Math.round(anchorBottom - capsuleHeight),
    frame: false,
    thickFrame: false,
    roundedCorners: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  capsuleWindow.on("page-title-updated", (e) => {
    e.preventDefault();
    capsuleWindow?.setTitle("");
  });

  capsuleWindow.setAlwaysOnTop(true, "screen-saver");
  capsuleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  capsuleWindow.setIgnoreMouseEvents(true, { forward: true });

  if (isDev) {
    void capsuleWindow.loadURL(DEV_URL);
  } else {
    void capsuleWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  capsuleWindow.once("ready-to-show", () => {
    if (capsuleWindow && !capsuleWindow.isDestroyed()) {
      stripCapsuleChrome();
      capsuleWindow.showInactive();
      broadcastState();
    }
  });

  capsuleWindow.on("show", () => {
    stripCapsuleChrome();
  });

  capsuleWindow.on("focus", () => {
    if (!capsuleAllowFocus && capsuleWindow && !capsuleWindow.isDestroyed()) {
      capsuleWindow.blur();
      capsuleWindow.setFocusable(false);
    }
    stripCapsuleChrome();
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
    width: 620,
    height: 740,
    minWidth: 520,
    minHeight: 560,
    title: "Nightowl Settings & Diagnostics",
    icon: createOwlTrayImage(),
    backgroundColor: "#050d0a",
    autoHideMenuBar: true,
    resizable: true,
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
    if (capsuleWindow && !capsuleWindow.isDestroyed()) {
      capsuleAllowFocus = false;
      capsuleWindow.setFocusable(false);
      if (capsuleWindow.isFocused()) {
        capsuleWindow.blur();
      }
      stripCapsuleChrome();
      capsuleWindow.showInactive();
    }
  });
}

let pollInFlight = false;

async function pollLoop(): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const [nextPower, snapshot] = await Promise.all([
      nativeBridge.getPowerStatus(),
      nativeBridge.snapshot(),
    ]);

    powerStatus = nextPower;
    nativeHealthy = true;
    nativeError = null;
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
  } catch (err) {
    nativeHealthy = false;
    nativeError = err instanceof Error ? err.message : "Native helper poll failed.";
    broadcastState();
  } finally {
    pollInFlight = false;
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
    const nextPatch = sanitizeSettingsPatch(patch ?? {});
    settings = { ...settings, ...nextPatch };
    if (typeof nextPatch.openAtLogin === "boolean") {
      applyLoginItemSetting(nextPatch.openAtLogin);
    }
    schedulePersistConfig();
    await syncPowerAssertion();
    broadcastState();
    return settings;
  });

  ipcMain.handle("nightowl:checkForUpdates", () => checkForUpdates(app.getVersion()));

  ipcMain.handle("nightowl:openExternal", async (_ev, rawUrl: string) => {
    if (typeof rawUrl !== "string" || !isAllowedExternalUrl(rawUrl)) {
      return false;
    }
    await shell.openExternal(rawUrl);
    return true;
  });

  ipcMain.handle(
    "nightowl:focusSession",
    async (_ev, hwnd: string, tabTitle?: string, sessionId?: string) => {
      if (capsuleWindow && !capsuleWindow.isDestroyed() && capsuleWindow.isFocused()) {
        capsuleWindow.blur();
      }
      return nativeBridge.focusWindow(hwnd, tabTitle, sessionId);
    }
  );

  ipcMain.on("nightowl:setCapsuleFocusable", (_ev, focusable: boolean) => {
    if (!capsuleWindow || capsuleWindow.isDestroyed()) return;
    capsuleAllowFocus = Boolean(focusable);
    capsuleWindow.setFocusable(capsuleAllowFocus);
    if (capsuleAllowFocus) {
      capsuleWindow.focus();
    }
    stripCapsuleChrome();
  });

  ipcMain.on("nightowl:resizeCapsule", () => {
    // Intentionally ignored: canvas is fixed-size to avoid resize flicker.
  });

  ipcMain.on("nightowl:setIgnoreMouse", (_ev, ignore: boolean) => {
    if (!capsuleWindow || capsuleWindow.isDestroyed()) return;
    if (ignore) capsuleWindow.setIgnoreMouseEvents(true, { forward: true });
    else capsuleWindow.setIgnoreMouseEvents(false);
  });

  ipcMain.on("nightowl:moveCapsuleBy", (_ev, delta: { dx: number; dy: number }) => {
    const clamped = clampAnchorToDisplays(anchorRight + delta.dx, anchorBottom + delta.dy);
    anchorRight = clamped.right;
    anchorBottom = clamped.bottom;
    applyCapsuleBounds();
    schedulePersistConfig();
  });

  ipcMain.on("nightowl:resetCapsulePosition", () => {
    const def = defaultCapsuleAnchor();
    anchorRight = def.right;
    anchorBottom = def.bottom;
    applyCapsuleBounds();
    schedulePersistConfig();
  });

  ipcMain.on("nightowl:openDiagnostics", () => openDiagnosticsWindow());
  ipcMain.on("nightowl:quit", () => app.quit());
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (capsuleWindow && !capsuleWindow.isDestroyed()) {
    if (!capsuleWindow.isVisible()) {
      capsuleWindow.showInactive();
    }
    capsuleWindow.moveTop();
  }
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  const userDataDir = app.getPath("userData");
  settingsFilePath = path.join(userDataDir, "settings.json");
  journal = new SessionJournal(path.join(userDataDir, "session.json"));

  await loadPersistedConfig();
  if (app.isPackaged) {
    const loginState = app.getLoginItemSettings();
    if (typeof settings.openAtLogin === "boolean") {
      applyLoginItemSetting(settings.openAtLogin);
    } else {
      settings.openAtLogin = Boolean(loginState.openAtLogin);
    }
  }

  nativeBridge.start();
  const recovery = await journal.reconcileOnStartup();
  recoveredFromCrash = recovery.recoveredFromCrash;
  if (recovery.previousRecord?.lidActionBackup) {
    try {
      await nativeBridge.restoreLidAction(recovery.previousRecord.lidActionBackup);
    } catch {
      // ignore restore failure
    }
  }
  if (recoveredFromCrash) {
    recoveryNote = "Cleared an unclosed session from a previous exit.";
  }
  try {
    await nativeBridge.setAwake(false, false, false);
    nativeHealthy = true;
    nativeError = null;
  } catch (err) {
    nativeHealthy = false;
    nativeError = err instanceof Error ? err.message : "Native power helper failed to initialize.";
  }
  if (settings.keepAwakeOnLaunch) {
    await startAwake(null);
  }

  registerIpc();
  shortcutRegistered = globalShortcut.register("CommandOrControl+Shift+O", () => {
    if (manualAwake || autoAwakeActive) {
      void stopAwake();
    } else {
      void startAwake(null);
    }
  });
  tray = new Tray(createOwlTrayImage());
  tray.setToolTip("Nightowl (Ctrl+Shift+O to toggle awake)");
  tray.on("click", () => {
    if (!capsuleWindow || capsuleWindow.isDestroyed()) return;
    if (capsuleWindow.isVisible()) {
      capsuleWindow.moveTop();
    } else {
      capsuleWindow.showInactive();
    }
  });

  const keepCapsuleOnScreen = () => {
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const wa = d.workArea;
      return (
        anchorRight > wa.x + 60 &&
        anchorRight <= wa.x + wa.width + 40 &&
        anchorBottom > wa.y + 40 &&
        anchorBottom <= wa.y + wa.height + 40
      );
    });
    if (!visible) {
      const def = defaultCapsuleAnchor();
      anchorRight = def.right;
      anchorBottom = def.bottom;
      applyCapsuleBounds();
    }
  };
  keepCapsuleOnScreen();
  screen.on("display-metrics-changed", keepCapsuleOnScreen);
  screen.on("display-removed", keepCapsuleOnScreen);

  createCapsuleWindow();
  await pollLoop();
  pollTimer = setInterval(() => void pollLoop(), 1500);
});

let isQuitting = false;

app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (pollTimer) clearInterval(pollTimer);
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  void Promise.allSettled([
    savePersistedConfigNow(),
    journal?.clear(true),
    nativeBridge.stop(),
  ]).finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  // Keep running in system tray
});
