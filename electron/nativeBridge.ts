import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { app } from "electron";
import path from "node:path";
import readline from "node:readline";
import type { NativeSnapshot, PowerStatus } from "./types";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export class NativeBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();

  private resolveExePath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "native", "Nightowl.Native.exe");
    }
    return path.join(app.getAppPath(), "native", "bin", "Nightowl.Native.exe");
  }

  start(): void {
    if (this.proc) return;
    const exePath = this.resolveExePath();
    this.proc = spawn(exePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc.stderr?.resume();

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as {
          id?: number;
          ok?: boolean;
          result?: unknown;
          error?: string;
        };
        if (typeof msg.id === "number") {
          const entry = this.pending.get(msg.id);
          if (entry) {
            this.pending.delete(msg.id);
            if (msg.ok) entry.resolve(msg.result);
            else entry.reject(new Error(msg.error || "Native helper error"));
          }
        }
      } catch {
        // ignore malformed stdout line
      }
    });

    const rejectAll = (reason: string) => {
      for (const [, entry] of this.pending) {
        entry.reject(new Error(reason));
      }
      this.pending.clear();
      this.proc = null;
    };

    this.proc.on("error", (err) => rejectAll(`Native helper error: ${err.message}`));
    this.proc.on("exit", () => rejectAll("Native helper exited"));
  }

  private call<T>(cmd: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!this.proc) {
      this.start();
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      if (!this.proc || !this.proc.stdin.writable) {
        reject(new Error("Native helper stdin not writable"));
        return;
      }
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Native helper call timed out: ${cmd}`));
        }
      }, 10_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      try {
        const line = JSON.stringify({ id, cmd, ...payload });
        this.proc.stdin.write(`${line}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async setAwake(keepAwake: boolean, keepDisplay: boolean): Promise<void> {
    await this.call("setAwake", { keepAwake, keepDisplay });
  }

  async getPowerStatus(): Promise<PowerStatus> {
    return this.call<PowerStatus>("getPowerStatus");
  }

  async snapshot(): Promise<NativeSnapshot> {
    return this.call<NativeSnapshot>("snapshot");
  }

  async focusWindow(
    hwnd: string,
    tabTitle?: string,
    sessionId?: string
  ): Promise<{ focused: boolean; tabSelected?: boolean; reason?: string }> {
    return this.call<{ focused: boolean; tabSelected?: boolean; reason?: string }>("focusWindow", {
      hwnd,
      tabTitle,
      sessionId,
    });
  }

  async stripWindowChrome(hwnd: string): Promise<{ stripped: boolean }> {
    return this.call<{ stripped: boolean }>("stripWindowChrome", { hwnd });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.setAwake(false, false);
    } catch {
      // ignore
    }
    try {
      this.proc.stdin.end();
      this.proc.kill();
    } catch {
      // ignore
    }
    this.proc = null;
  }
}
