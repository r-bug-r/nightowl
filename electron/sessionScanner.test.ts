import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionScanner } from "./sessionScanner";
import type { NativeSnapshot } from "./types";

describe("SessionScanner", () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "nightowl-scan-"));
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("detects 4 active Claude Code sessions and distinguishes thinking vs idle", async () => {
    const now = 1_700_000_000_000;
    const claudeSessionsDir = path.join(tmpHome, ".claude", "sessions");
    const claudeProjectsDir = path.join(tmpHome, ".claude", "projects");
    await fs.mkdir(claudeSessionsDir, { recursive: true });

    const projects = ["alpha", "beta", "gamma", "delta"];
    for (let i = 0; i < projects.length; i++) {
      const pid = 1000 + i;
      const cwd = `C:\\dev\\${projects[i]}`;
      const sessionId = `sess-${i}`;
      await fs.writeFile(
        path.join(claudeSessionsDir, `${sessionId}.json`),
        JSON.stringify({ pid, sessionId, cwd, startedAt: now - 10_000 }),
        "utf8"
      );

      const encoded = cwd.replace(/[:\\/]/g, "-");
      const projDir = path.join(claudeProjectsDir, encoded);
      await fs.mkdir(projDir, { recursive: true });
      const jsonlPath = path.join(projDir, `${sessionId}.jsonl`);
      if (i < 2) {
        // Thinking: user message without end_turn
        await fs.writeFile(
          jsonlPath,
          JSON.stringify({ type: "user", message: { content: "run tests" } }) + "\n",
          "utf8"
        );
        await fs.utimes(jsonlPath, new Date(now - 2000), new Date(now - 2000));
      } else {
        // Idle: assistant end_turn older than thinkingWindow
        await fs.writeFile(
          jsonlPath,
          JSON.stringify({ type: "assistant", message: { stop_reason: "end_turn" } }) + "\n",
          "utf8"
        );
        await fs.utimes(jsonlPath, new Date(now - 30_000), new Date(now - 30_000));
      }
    }

    const snapshot: NativeSnapshot = {
      processes: [
        { pid: 500, parentPid: 1, name: "WindowsTerminal.exe" },
        { pid: 1000, parentPid: 500, name: "node.exe", commandLine: "node claude.js" },
        { pid: 1001, parentPid: 500, name: "node.exe", commandLine: "node claude.js" },
        { pid: 1002, parentPid: 500, name: "claude.exe" },
        { pid: 1003, parentPid: 500, name: "claude.exe" },
      ],
      windows: [
        { hwnd: "111", pid: 500, processName: "WindowsTerminal.exe", title: "alpha - Claude", isMinimized: false },
        { hwnd: "222", pid: 500, processName: "WindowsTerminal.exe", title: "beta - Claude", isMinimized: false },
      ],
      taskbar: { left: 0, top: 1032, right: 1920, bottom: 1080 },
      workArea: { left: 0, top: 0, right: 1920, bottom: 1032 },
    };

    const scanner = new SessionScanner({ homeDir: tmpHome, now: () => now, selfPid: 99999 });
    const result = await scanner.scan(snapshot);

    expect(result).toHaveLength(4);
    expect(result.every((s) => s.harness === "claude")).toBe(true);
    expect(result.filter((s) => s.state === "thinking")).toHaveLength(2);
    expect(result.filter((s) => s.state === "idle")).toHaveLength(2);
    expect(result.find((s) => s.projectName === "alpha")?.hwnd).toBe("111");
    expect(result.find((s) => s.projectName === "beta")?.hwnd).toBe("222");
  });

  it("detects Codex CLI and Codex Desktop App with unified codex harness", async () => {
    const now = 1_700_000_000_000;
    const snapshot: NativeSnapshot = {
      processes: [
        { pid: 200, parentPid: 1, name: "WindowsTerminal.exe" },
        { pid: 201, parentPid: 200, name: "node.exe", commandLine: "node @openai/codex/bin/codex.js" },
        { pid: 300, parentPid: 1, name: "Codex.exe" },
        { pid: 301, parentPid: 300, name: "Codex.exe", commandLine: "Codex.exe --type=renderer" },
      ],
      windows: [
        { hwnd: "701", pid: 200, processName: "WindowsTerminal.exe", title: "codex cli", isMinimized: false },
        { hwnd: "702", pid: 300, processName: "Codex.exe", title: "Codex", isMinimized: false },
      ],
      taskbar: { left: 0, top: 1032, right: 1920, bottom: 1080 },
      workArea: { left: 0, top: 0, right: 1920, bottom: 1032 },
    };

    const scanner = new SessionScanner({ homeDir: tmpHome, now: () => now, selfPid: 99999 });
    const result = await scanner.scan(snapshot);

    expect(result).toHaveLength(2);
    expect(result.every((s) => s.harness === "codex")).toBe(true);
    expect(result.map((s) => s.hwnd).sort()).toEqual(["701", "702"]);
  });

  it("detects Antigravity CLI and Antigravity 2.0 App while ignoring Electron helpers", async () => {
    const now = 1_700_000_000_000;
    const convDir = path.join(tmpHome, ".gemini", "antigravity", "conversations");
    await fs.mkdir(convDir, { recursive: true });
    const pbFile = path.join(convDir, "abc.pb");
    await fs.writeFile(pbFile, "data", "utf8");
    await fs.utimes(pbFile, new Date(now - 1000), new Date(now - 1000));

    const snapshot: NativeSnapshot = {
      processes: [
        { pid: 400, parentPid: 1, name: "WindowsTerminal.exe" },
        { pid: 401, parentPid: 400, name: "node.exe", commandLine: "node agy.js" },
        { pid: 500, parentPid: 1, name: "Antigravity.exe" },
        { pid: 501, parentPid: 500, name: "Antigravity.exe", commandLine: "Antigravity.exe --type=gpu-process" },
        { pid: 502, parentPid: 500, name: "Antigravity.exe", commandLine: "Antigravity.exe --type=renderer" },
      ],
      windows: [
        { hwnd: "801", pid: 400, processName: "WindowsTerminal.exe", title: "agy cli", isMinimized: false },
        { hwnd: "802", pid: 500, processName: "Antigravity.exe", title: "Antigravity - nightowl", isMinimized: false },
      ],
      taskbar: { left: 0, top: 1032, right: 1920, bottom: 1080 },
      workArea: { left: 0, top: 0, right: 1920, bottom: 1032 },
    };

    const scanner = new SessionScanner({ homeDir: tmpHome, now: () => now, selfPid: 99999 });
    const result = await scanner.scan(snapshot);

    expect(result).toHaveLength(2);
    expect(result.every((s) => s.harness === "antigravity")).toBe(true);
    expect(result.every((s) => s.state === "thinking")).toBe(true);
    expect(result.map((s) => s.hwnd).sort()).toEqual(["801", "802"]);
  });

  it("strictly ignores unsupported harnesses like omp, cursor, opencode, and aider", async () => {
    const snapshot: NativeSnapshot = {
      processes: [
        { pid: 600, parentPid: 1, name: "omp.exe" },
        { pid: 601, parentPid: 1, name: "Cursor.exe" },
        { pid: 602, parentPid: 1, name: "node.exe", commandLine: "node opencode.js" },
        { pid: 603, parentPid: 1, name: "aider.exe" },
      ],
      windows: [
        { hwnd: "901", pid: 601, processName: "Cursor.exe", title: "Cursor", isMinimized: false },
      ],
      taskbar: { left: 0, top: 1032, right: 1920, bottom: 1080 },
      workArea: { left: 0, top: 0, right: 1920, bottom: 1032 },
    };

    const scanner = new SessionScanner({ homeDir: tmpHome, selfPid: 99999 });
    const result = await scanner.scan(snapshot);

    expect(result).toHaveLength(0);
  });
});
