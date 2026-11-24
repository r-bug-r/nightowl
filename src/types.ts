export type AgentHarness = "claude" | "codex" | "antigravity";

export type AgentSessionState = "thinking" | "idle";

export interface AgentSession {
  id: string;
  harness: AgentHarness;
  label: string;
  projectName: string;
  state: AgentSessionState;
  hwnd: string | null;
  pid: number;
  windowTitle: string | null;
  preview?: string | null;
  source: "cli" | "desktop";
  updatedAt: number;
}

export interface PowerStatus {
  acLineOnline: boolean;
  hasBattery: boolean;
  batteryPercent: number;
  charging: boolean;
  batterySaver: boolean;
}

export interface AwakeState {
  active: boolean;
  manualAwake?: boolean;
  endsAt: number | null;
  remainingMs: number;
  keepDisplay: boolean;
  keepAwakeWithLidClosed?: boolean;
  lidOverrideActive?: boolean;
  batterySafeStop: boolean;
  autoAwakeForAgents: boolean;
  autoAwakeActive: boolean;
  recoveredFromCrash: boolean;
  recoveryNote: string | null;
  nativeHealthy?: boolean;
  nativeError?: string | null;
  shortcutRegistered?: boolean;
  appVersion?: string;
  power: PowerStatus;
}

export interface UpdateCheckResult {
  status: "update-available" | "up-to-date" | "error";
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  checkedAt: number;
  error?: string;
}

export type ThemePreset = "forest" | "minimal-dark" | "minimal-light";

export type CapsuleSection = "agents" | "owl" | "time";

export type HoverAnimationSpeed = "slow" | "normal" | "fast";

export interface NightowlSettings {
  batteryThreshold: number;
  batterySafeStop: boolean;
  keepDisplay: boolean;
  keepAwakeWithLidClosed?: boolean;
  keepAwakeOnLaunch?: boolean;
  openAtLogin?: boolean;
  autoAwakeForAgents: boolean;
  theme: ThemePreset;
  capsuleScale?: number;
  capsuleOrder?: CapsuleSection[];
  hoverAnimation?: HoverAnimationSpeed;
  clockFormat24h?: boolean;
  showClock?: boolean;
}

export interface NightowlApi {
  getState: () => Promise<{ awake: AwakeState; sessions: AgentSession[]; settings: NightowlSettings }>;
  startAwake: (durationMs: number | null) => Promise<AwakeState>;
  addAwakeTime: (deltaMs: number) => Promise<AwakeState>;
  stopAwake: () => Promise<AwakeState>;
  updateSettings: (patch: Partial<NightowlSettings>) => Promise<NightowlSettings>;
  focusSession: (
    hwnd: string,
    tabTitle?: string,
    sessionId?: string
  ) => Promise<{ focused: boolean; tabSelected?: boolean; reason?: string }>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  openExternal: (url: string) => Promise<boolean>;
  resizeCapsule: (width: number, height: number) => void;
  setIgnoreMouse: (ignore: boolean) => void;
  setCapsuleFocusable: (focusable: boolean) => void;
  moveCapsuleBy: (dx: number, dy: number) => void;
  resetCapsulePosition: () => void;
  openDiagnostics: () => void;
  quitApp: () => void;
  onStateUpdate: (
    cb: (payload: { awake: AwakeState; sessions: AgentSession[]; settings: NightowlSettings }) => void
  ) => () => void;
}

declare global {
  interface Window {
    nightowl?: NightowlApi;
  }
}
