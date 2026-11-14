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

  it("prefers terminal or IDE windows over browser windows in title fallback", async () => {
    const now = 1_700_000_000_000;
    const claudeSessionsDir = path.join(tmpHome, ".claude", "sessions");
    await fs.mkdir(claudeSessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeSessionsDir, "sess-term.json"),
      JSON.stringify({ pid: 2001, sessionId: "sess-term", cwd: "C:\\dev\\nightowl", startedAt: now }),
      "utf8"
    );

    const snapshot: NativeSnapshot = {
      processes: [
        { pid: 2001, parentPid: 999, name: "claude.exe" },
      ],
      windows: [
        { hwnd: "101", pid: 3000, processName: "chrome.exe", title: "nightowl - GitHub", isMinimized: false },
        { hwnd: "102", pid: 3001, processName: "WindowsTerminal.exe", title: "nightowl - claude", isMinimized: false },
      ],
      taskbar: { left: 0, top: 1032, right: 1920, bottom: 1080 },
      workArea: { left: 0, top: 0, right: 1920, bottom: 1032 },
    };

    const scanner = new SessionScanner({ homeDir: tmpHome, now: () => now, selfPid: 99999 });
    const result = await scanner.scan(snapshot);

    expect(result).toHaveLength(1);
    expect(result[0].hwnd).toBe("102");
  });

  it("detects titled Antigravity .db/.db-wal conversations <2h while filtering subagents, stale >2h, and idle one-offs", async () => {
    const now = 1_794_643_700_000;
    const agyBase = path.join(tmpHome, ".gemini", "antigravity");
    const convDir = path.join(agyBase, "conversations");
    const annDir = path.join(agyBase, "annotations");
    const presDir = path.join(agyBase, "presence");
    await fs.mkdir(convDir, { recursive: true });
    await fs.mkdir(annDir, { recursive: true });
    await fs.mkdir(presDir, { recursive: true });

    const makeConv = async (opts: {
      id: string;
      ageMs: number;
      sizeBytes: number;
      title?: string;
      hasLock?: boolean;
      hasWal?: boolean;
      walAgeMs?: number;
    }) => {
      const dbPath = path.join(convDir, `${opts.id}.db`);
      await fs.writeFile(dbPath, Buffer.alloc(opts.sizeBytes, 1));
      await fs.utimes(dbPath, new Date(now - opts.ageMs), new Date(now - opts.ageMs));
      if (opts.hasWal) {
        const walPath = path.join(convDir, `${opts.id}.db-wal`);
        await fs.writeFile(walPath, "wal");
        const wAge = opts.walAgeMs ?? opts.ageMs;
        await fs.utimes(walPath, new Date(now - wAge), new Date(now - wAge));
      }
      if (opts.title !== undefined) {
        const sec = Math.floor((now - opts.ageMs) / 1000);
        await fs.writeFile(
          path.join(annDir, `${opts.id}.pbtxt`),
          `title:"${opts.title}" last_user_view_time:{seconds:${sec} nanos:0}`,
          "utf8"
        );
      }
      if (opts.hasLock) {
        await fs.writeFile(path.join(presDir, `${opts.id}.lock`), "");
      }
    };

    // 1. Active thinking conversation (73cd5bd8) via .db-wal
    await makeConv({
      id: "73cd5bd8-d6c2-4865-87c3-42119f4f701c",
      ageMs: 90_000,
      sizeBytes: 2_000_000,
      title: "Automated Job Application Assistant Setup",
      hasLock: true,
      hasWal: true,
      walAgeMs: 2_000,
    });

    // 2. Active recent conversation (7725e04e)
    await makeConv({
      id: "7725e04e-6a73-4027-be45-4d63c9af43da",
      ageMs: 120_000,
      sizeBytes: 3_500_000,
      title: "Install Nightowl GitHub Repository",
      hasLock: true,
    });

    // 3. Brand new small conversation (< 10m old) -> should be kept
    await makeConv({
      id: "new-small-1",
      ageMs: 180_000,
      sizeBytes: 400_000,
      title: "Quick Setup Question",
      hasLock: true,
    });

    // 4. Subagent (no annotation, no lock) -> excluded
    await makeConv({
      id: "subagent-1",
      ageMs: 10_000,
      sizeBytes: 1_500_000,
    });

    // 5. Old > 2h conversation -> excluded
    await makeConv({
      id: "stale-old-1",
      ageMs: 2.5 * 3600_000,
      sizeBytes: 4_000_000,
      title: "Old Task",
      hasLock: true,
    });

    // 6. Idle one-off (< 1MB, > 10m old) -> excluded
    await makeConv({
      id: "oneoff-1",
      ageMs: 45 * 60_000,
      sizeBytes: 700_000,
      title: "One Off Fix",
      hasLock: true,
    });

    const snapshot: NativeSnapshot = {
      processes: [{ pid: 500, parentPid: 1, name: "Antigravity.exe" }],
      windows: [
        { hwnd: "802", pid: 500, processName: "Antigravity.exe", title: "nightowl - Antigravity", isMinimized: false },
      ],
      taskbar: { left: 0, top: 1032, right: 1920, bottom: 1080 },
      workArea: { left: 0, top: 0, right: 1920, bottom: 1032 },
    };

    const scanner = new SessionScanner({ homeDir: tmpHome, now: () => now, selfPid: 99999 });
    const result = await scanner.scan(snapshot);

    expect(result.map((s) => s.id)).toEqual([
      "antigravity:conv:73cd5bd8-d6c2-4865-87c3-42119f4f701c",
      "antigravity:conv:7725e04e-6a73-4027-be45-4d63c9af43da",
      "antigravity:conv:new-small-1",
    ]);
    expect(result[0].state).toBe("thinking");
    expect(result[1].state).toBe("idle");
    expect(result[0].hwnd).toBe("802");
  });
});
