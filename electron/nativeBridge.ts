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

    this.proc.on("exit", () => {
      for (const [, entry] of this.pending) {
        entry.reject(new Error("Native helper exited"));
      }
      this.pending.clear();
      this.proc = null;
    });
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
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      const line = JSON.stringify({ id, cmd, ...payload });
      this.proc.stdin.write(`${line}\n`);
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

  async focusWindow(hwnd: string): Promise<{ focused: boolean; reason?: string }> {
    return this.call<{ focused: boolean; reason?: string }>("focusWindow", { hwnd });
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
