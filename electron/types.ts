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

export interface AwakeState {
  active: boolean;
  endsAt: number | null;
  remainingMs: number;
  keepDisplay: boolean;
  batterySafeStop: boolean;
  autoAwakeForAgents: boolean;
  autoAwakeActive: boolean;
  recoveredFromCrash: boolean;
  recoveryNote: string | null;
  power: PowerStatus;
}

export type ThemePreset = "forest" | "minimal-dark" | "minimal-light";

export interface NightowlSettings {
  batteryThreshold: number;
  batterySafeStop: boolean;
  keepDisplay: boolean;
  autoAwakeForAgents: boolean;
  theme: ThemePreset;
}
