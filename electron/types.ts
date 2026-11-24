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

export interface NativeProcessInfo {
  pid: number;
  parentPid: number;
  name: string;
  commandLine?: string | null;
}

export interface NativeWindowInfo {
  hwnd: string;
  pid: number;
  processName: string;
  title: string;
  isMinimized: boolean;
}

export interface NativeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  edge?: number;
}

export interface NativeSnapshot {
  processes: NativeProcessInfo[];
  windows: NativeWindowInfo[];
  taskbar: NativeRect;
  workArea: NativeRect;
}

export interface PowerStatus {
  acLineOnline: boolean;
  hasBattery: boolean;
  batteryPercent: number;
  charging: boolean;
  batterySaver: boolean;
}

export interface LidActionBackup {
  schemeGuid: string;
  acValue: number;
  dcValue: number;
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
