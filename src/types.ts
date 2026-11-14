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

export type CapsuleSection = "agents" | "owl" | "time";

export type HoverAnimationSpeed = "slow" | "normal" | "fast";

export interface NightowlSettings {
  batteryThreshold: number;
  batterySafeStop: boolean;
  keepDisplay: boolean;
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
  focusSession: (hwnd: string) => Promise<{ focused: boolean; reason?: string }>;
  resizeCapsule: (width: number, height: number) => void;
  setIgnoreMouse: (ignore: boolean) => void;
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
