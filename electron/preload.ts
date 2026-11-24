import { contextBridge, ipcRenderer } from "electron";
import type { AgentSession, AwakeState, NightowlSettings, UpdateCheckResult } from "./types";

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

const api: NightowlApi = {
  getState: () => ipcRenderer.invoke("nightowl:getState"),
  startAwake: (durationMs) => ipcRenderer.invoke("nightowl:startAwake", durationMs),
  addAwakeTime: (deltaMs) => ipcRenderer.invoke("nightowl:addAwakeTime", deltaMs),
  stopAwake: () => ipcRenderer.invoke("nightowl:stopAwake"),
  updateSettings: (patch) => ipcRenderer.invoke("nightowl:updateSettings", patch),
  focusSession: (hwnd, tabTitle, sessionId) =>
    ipcRenderer.invoke("nightowl:focusSession", hwnd, tabTitle, sessionId),
  checkForUpdates: () => ipcRenderer.invoke("nightowl:checkForUpdates"),
  openExternal: (url) => ipcRenderer.invoke("nightowl:openExternal", url),
  resizeCapsule: (width, height) => ipcRenderer.send("nightowl:resizeCapsule", { width, height }),
  setIgnoreMouse: (ignore) => ipcRenderer.send("nightowl:setIgnoreMouse", ignore),
  setCapsuleFocusable: (focusable) => ipcRenderer.send("nightowl:setCapsuleFocusable", focusable),
  moveCapsuleBy: (dx, dy) => ipcRenderer.send("nightowl:moveCapsuleBy", { dx, dy }),
  resetCapsulePosition: () => ipcRenderer.send("nightowl:resetCapsulePosition"),
  openDiagnostics: () => ipcRenderer.send("nightowl:openDiagnostics"),
  quitApp: () => ipcRenderer.send("nightowl:quit"),
  onStateUpdate: (cb) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { awake: AwakeState; sessions: AgentSession[]; settings: NightowlSettings }
    ) => cb(payload);
    ipcRenderer.on("nightowl:state", listener);
    return () => ipcRenderer.removeListener("nightowl:state", listener);
  },
};

contextBridge.exposeInMainWorld("nightowl", api);
