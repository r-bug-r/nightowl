import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentHarness,
  AgentSession,
  AgentSessionState,
  NativeProcessInfo,
  NativeSnapshot,
  NativeWindowInfo,
} from "./types";

export interface SessionScannerOptions {
  homeDir?: string;
  now?: () => number;
  thinkingWindowMs?: number;
  selfPid?: number;
}

const DEFAULT_THINKING_WINDOW_MS = 6500;
const INFLIGHT_MAX_AGE_MS = 120_000;

interface ClaudeSessionFile {
  pid?: number;
  sessionId?: string;
  cwd?: string;
  startedAt?: number;
  name?: string;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function isClaudeCommandLine(cmd?: string | null): boolean {
  if (!cmd) return false;
  const lower = cmd.toLowerCase();
  if (lower.includes("nightowl")) return false;
  return (
    /(?:^|[\\/\s"'])claude(?:\.exe|\.cmd|\.ps1|\.js)?(?:["'\s]|$)/i.test(cmd) ||
    lower.includes("@anthropic-ai/claude-code") ||
    lower.includes("@anthropic-ai\\claude-code")
  );
}

function isCodexCommandLine(cmd?: string | null): boolean {
  if (!cmd) return false;
  const lower = cmd.toLowerCase();
  if (lower.includes("nightowl")) return false;
  return (
    /(?:^|[\\/\s"'])codex(?:\.exe|\.cmd|\.ps1|\.js)?(?:["'\s]|$)/i.test(cmd) ||
    lower.includes("@openai/codex") ||
    lower.includes("@openai\\codex")
  );
}

function isAgyCommandLine(cmd?: string | null): boolean {
  if (!cmd) return false;
  const lower = cmd.toLowerCase();
  if (lower.includes("nightowl")) return false;
  if (lower.includes("--type=")) return false;
  return /(?:^|[\\/\s"'])(?:agy|antigravity)(?:\.exe|\.cmd|\.ps1|\.js)?(?:["'\s]|$)/i.test(cmd);
}

function isElectronHelperProcess(proc: NativeProcessInfo): boolean {
  const cmd = proc.commandLine || "";
  return /--type=(?:renderer|gpu-process|utility|zygote|ppapi|crashpad)/i.test(cmd);
}

function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[:\\/]/g, "-");
}

function baseNameOrFallback(input: string | undefined | null, fallback: string): string {
  if (!input) return fallback;
  const cleaned = input.replace(/[\\/]+$/, "");
  const base = path.basename(cleaned);
  return base || fallback;
}

function findWindowForPid(
  startPid: number,
  procMap: Map<number, NativeProcessInfo>,
  windowsByPid: Map<number, NativeWindowInfo[]>,
  allWindows: NativeWindowInfo[],
  preferredProject?: string
): NativeWindowInfo | null {
  const visited = new Set<number>();
  let currentPid: number | undefined = startPid;

  for (let hop = 0; hop < 12 && currentPid && !visited.has(currentPid); hop++) {
    visited.add(currentPid);
    const candidates = windowsByPid.get(currentPid);
    if (candidates && candidates.length > 0) {
      if (preferredProject) {
        const lowerProj = preferredProject.toLowerCase();
        const matched = candidates.find((w) => w.title.toLowerCase().includes(lowerProj));
        if (matched) return matched;
      }
      return candidates[0];
    }
    const proc = procMap.get(currentPid);
    currentPid = proc?.parentPid;
  }

  if (preferredProject) {
    const lowerProj = preferredProject.toLowerCase();
    const terminalOrIde = new Set([
      "windowsterminal.exe",
      "pwsh.exe",
      "powershell.exe",
      "cmd.exe",
      "conhost.exe",
      "mintty.exe",
      "code.exe",
    ]);
    const preferredMatch = allWindows.find(
      (w) =>
        terminalOrIde.has(normalizeName(w.processName)) &&
        w.title.toLowerCase().includes(lowerProj)
    );
    if (preferredMatch) return preferredMatch;

    const titleMatch = allWindows.find((w) => w.title.toLowerCase().includes(lowerProj));
    if (titleMatch) return titleMatch;
  }

  return null;
}

async function readTailText(filePath: string, maxBytes = 24 * 1024): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    if (length <= 0) return "";
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, start);
    return buf.toString("utf8");
  } finally {
    await handle.close();
  }
}

function clipPreview(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

function extractClaudePreview(ev: Record<string, unknown>): string | null {
  const msg = ev.message as Record<string, unknown> | undefined;
  const content = msg?.content ?? ev.content;
  if (typeof content === "string") return clipPreview(content);
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string" && p.text.trim()) return clipPreview(p.text);
        if (p.type === "tool_use" && typeof p.name === "string") {
          return clipPreview(`Using ${p.name}...`);
        }
      }
    }
  }
  return null;
}

async function inspectClaudeJsonlState(
  jsonlPath: string,
  now: number,
  thinkingWindowMs: number
): Promise<{ state: AgentSessionState; updatedAt: number; preview: string | null }> {
  try {
    const stat = await fs.stat(jsonlPath);
    const age = now - stat.mtimeMs;
    const tail = await readTailText(jsonlPath);
    const lines = tail
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    let preview: string | null = null;
    let inferredState: AgentSessionState | null = null;

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(lines[i]) as Record<string, unknown>;
        if (!preview) preview = extractClaudePreview(ev);
        if (inferredState === null) {
          const type = String(ev.type || "");
          if (type === "user" || type === "progress") {
            inferredState = "thinking";
          } else if (type === "assistant") {
            const msg = ev.message as Record<string, unknown> | undefined;
            const stopReason = msg?.stop_reason;
            inferredState = stopReason === "tool_use" || stopReason == null ? "thinking" : "idle";
          } else if (type === "result" || type === "system") {
            inferredState = "idle";
          }
        }
        if (preview && inferredState !== null) break;
      } catch {
        // ignore partial trailing line
      }
    }

    if (age <= thinkingWindowMs) {
      return { state: "thinking", updatedAt: stat.mtimeMs, preview };
    }
    if (age <= INFLIGHT_MAX_AGE_MS && inferredState) {
      return { state: inferredState, updatedAt: stat.mtimeMs, preview };
    }
    return { state: "idle", updatedAt: stat.mtimeMs, preview };
  } catch {
    return { state: "idle", updatedAt: now, preview: null };
  }
}

async function findRecentFiles(dir: string, ext: string, maxDepth = 3): Promise<Array<{ filePath: string; mtimeMs: number }>> {
  const results: Array<{ filePath: string; mtimeMs: number }> = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
          try {
            const st = await fs.stat(full);
            results.push({ filePath: full, mtimeMs: st.mtimeMs });
          } catch {
            // ignore vanished file
          }
        }
      })
    );
  }

  await walk(dir, 0);
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

function extractCodexPreview(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const ev = JSON.parse(lines[i]) as Record<string, unknown>;
      const type = String(ev.type || "");
      const payload = ev.payload as Record<string, unknown> | undefined;
      const payloadType = String(payload?.type || "");

      if (type === "event_msg" && (payloadType === "user_message" || payloadType === "agent_message")) {
        const msg = payload?.message ?? payload?.text;
        if (typeof msg === "string" && msg.trim()) {
          return clipPreview(msg);
        }
      }
      if (type === "response_item" && payloadType === "function_call") {
        const toolName = String(payload?.name || "");
        if (toolName) return clipPreview(`Running ${toolName}`);
      }
      if (type === "response_item" && payloadType === "message" && Array.isArray(payload?.content)) {
        for (let j = payload.content.length - 1; j >= 0; j--) {
          const part = payload.content[j] as Record<string, unknown>;
          if (typeof part?.text === "string" && part.text.trim()) {
            return clipPreview(part.text);
          }
        }
      }
    } catch {
      // ignore partial line
    }
  }
  return null;
}

async function inspectCodexJsonlState(
  jsonlPath: string,
  now: number,
  thinkingWindowMs: number
): Promise<{ state: AgentSessionState; updatedAt: number; preview: string | null }> {
  try {
    const stat = await fs.stat(jsonlPath);
    const age = now - stat.mtimeMs;
    const tail = await readTailText(jsonlPath);
    const lines = tail
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const preview = extractCodexPreview(lines);

    if (age <= thinkingWindowMs) {
      return { state: "thinking", updatedAt: stat.mtimeMs, preview };
    }

    if (age <= INFLIGHT_MAX_AGE_MS) {
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const ev = JSON.parse(lines[i]) as Record<string, unknown>;
          const type = String(ev.type || "");
          const payload = ev.payload as Record<string, unknown> | undefined;
          const payloadType = String(payload?.type || "");

          if (
            type === "response_item" &&
            (payloadType === "function_call" || payloadType === "reasoning")
          ) {
            return { state: "thinking", updatedAt: stat.mtimeMs, preview };
          }
          if (type === "event_msg" && payloadType === "user_message") {
            return { state: "thinking", updatedAt: stat.mtimeMs, preview };
          }
          if (
            type === "event_msg" &&
            (payloadType === "task_complete" || payloadType === "agent_message" || payloadType === "turn_aborted")
          ) {
            return { state: "idle", updatedAt: stat.mtimeMs, preview };
          }
        } catch {
          // ignore partial line
        }
      }
    }

    return { state: "idle", updatedAt: stat.mtimeMs, preview };
  } catch {
    return { state: "idle", updatedAt: now, preview: null };
  }
}

export class SessionScanner {
  private readonly homeDir: string;
  private readonly now: () => number;
  private readonly thinkingWindowMs: number;
  private readonly selfPid: number;

  constructor(options: SessionScannerOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir();
    this.now = options.now ?? (() => Date.now());
    this.thinkingWindowMs = options.thinkingWindowMs ?? DEFAULT_THINKING_WINDOW_MS;
    this.selfPid = options.selfPid ?? process.pid;
  }

  async scan(snapshot: NativeSnapshot): Promise<AgentSession[]> {
    const now = this.now();
    const procMap = new Map<number, NativeProcessInfo>();
    for (const p of snapshot.processes) {
      procMap.set(p.pid, p);
    }

    const windowsByPid = new Map<number, NativeWindowInfo[]>();
    for (const w of snapshot.windows) {
      if (w.pid === this.selfPid) continue;
      const list = windowsByPid.get(w.pid) ?? [];
      list.push(w);
      windowsByPid.set(w.pid, list);
    }

    const [claudeSessions, codexSessions, agySessions] = await Promise.all([
      this.scanClaude(snapshot, procMap, windowsByPid, now),
      this.scanCodex(snapshot, procMap, windowsByPid, now),
      this.scanAntigravity(snapshot, procMap, windowsByPid, now),
    ]);

    return [...claudeSessions, ...codexSessions, ...agySessions].sort((a, b) => {
      if (a.state !== b.state) return a.state === "thinking" ? -1 : 1;
      if (a.harness !== b.harness) return a.harness.localeCompare(b.harness);
      return a.pid - b.pid;
    });
  }

  private async scanClaude(
    snapshot: NativeSnapshot,
    procMap: Map<number, NativeProcessInfo>,
    windowsByPid: Map<number, NativeWindowInfo[]>,
    now: number
  ): Promise<AgentSession[]> {
    const sessions: AgentSession[] = [];
    const seenPids = new Set<number>();

    const claudeSessionsDir = path.join(this.homeDir, ".claude", "sessions");
    const claudeProjectsDir = path.join(this.homeDir, ".claude", "projects");

    try {
      const files = await fs.readdir(claudeSessionsDir, { withFileTypes: true });
      await Promise.all(
        files
          .filter((f) => f.isFile() && f.name.endsWith(".json"))
          .map(async (f) => {
            try {
              const raw = await fs.readFile(path.join(claudeSessionsDir, f.name), "utf8");
              const data = JSON.parse(raw) as ClaudeSessionFile;
              if (!data.pid || !procMap.has(data.pid)) return;

              seenPids.add(data.pid);
              const projectName = baseNameOrFallback(data.cwd, "Claude Code");
              const win = findWindowForPid(
                data.pid,
                procMap,
                windowsByPid,
                snapshot.windows,
                projectName
              );

              let state: AgentSessionState = "idle";
              let updatedAt = data.startedAt ?? now;

              let preview: string | null = win?.title ? clipPreview(win.title) : null;

              if (data.sessionId && data.cwd) {
                const encoded = encodeClaudeProjectDir(data.cwd);
                const jsonlPath = path.join(claudeProjectsDir, encoded, `${data.sessionId}.jsonl`);
                const inspected = await inspectClaudeJsonlState(
                  jsonlPath,
                  now,
                  this.thinkingWindowMs
                );
                state = inspected.state;
                updatedAt = inspected.updatedAt;
                if (inspected.preview) {
                  preview = inspected.preview;
                }
              }

              sessions.push({
                id: `claude:${data.sessionId || data.pid}`,
                harness: "claude",
                label: data.name || projectName,
                projectName,
                state,
                hwnd: win?.hwnd ?? null,
                pid: data.pid,
                windowTitle: win?.title ?? null,
                preview,
                source: "cli",
                updatedAt,
              });
            } catch {
              // ignore malformed session file
            }
          })
      );
    } catch {
      // ~/.claude/sessions may not exist
    }

    for (const proc of snapshot.processes) {
      if (proc.pid === this.selfPid || seenPids.has(proc.pid)) continue;
      const exe = normalizeName(proc.name);
      const isClaudeExe = exe === "claude.exe";
      const isClaudeNode = exe === "node.exe" && isClaudeCommandLine(proc.commandLine);
      if (!isClaudeExe && !isClaudeNode) continue;

      seenPids.add(proc.pid);
      const win = findWindowForPid(proc.pid, procMap, windowsByPid, snapshot.windows);
      const label = win?.title ? baseNameOrFallback(win.title, "Claude Code") : "Claude Code";

      sessions.push({
        id: `claude:pid:${proc.pid}`,
        harness: "claude",
        label,
        projectName: label,
        state: "idle",
        hwnd: win?.hwnd ?? null,
        pid: proc.pid,
        windowTitle: win?.title ?? null,
        preview: win?.title ? clipPreview(win.title) : null,
        source: "cli",
        updatedAt: now,
      });
    }

    return sessions;
  }

  private async scanCodex(
    snapshot: NativeSnapshot,
    procMap: Map<number, NativeProcessInfo>,
    windowsByPid: Map<number, NativeWindowInfo[]>,
    now: number
  ): Promise<AgentSession[]> {
    const sessions: AgentSession[] = [];
    const seenHwnds = new Set<string>();
    const seenPids = new Set<number>();

    const codexSessionsDir = path.join(this.homeDir, ".codex", "sessions");
    const recentLogs = await findRecentFiles(codexSessionsDir, ".jsonl", 4);
    let latestCodexState: { state: AgentSessionState; updatedAt: number; preview: string | null } = {
      state: "idle",
      updatedAt: now,
      preview: null,
    };
    if (recentLogs.length > 0 && now - recentLogs[0].mtimeMs <= INFLIGHT_MAX_AGE_MS) {
      latestCodexState = await inspectCodexJsonlState(
        recentLogs[0].filePath,
        now,
        this.thinkingWindowMs
      );
    }

    // 1. Codex Desktop App windows
    for (const win of snapshot.windows) {
      if (win.pid === this.selfPid) continue;
      const exe = normalizeName(win.processName);
      if (exe !== "codex.exe") continue;

      seenHwnds.add(win.hwnd);
      seenPids.add(win.pid);
      sessions.push({
        id: `codex:win:${win.hwnd}`,
        harness: "codex",
        label: win.title || "Codex",
        projectName: win.title || "Codex",
        state: latestCodexState.state,
        hwnd: win.hwnd,
        pid: win.pid,
        windowTitle: win.title,
        preview: latestCodexState.preview ?? (win.title ? clipPreview(win.title) : null),
        source: "desktop",
        updatedAt: latestCodexState.updatedAt,
      });
    }

    // 2. Codex CLI processes
    for (const proc of snapshot.processes) {
      if (proc.pid === this.selfPid || seenPids.has(proc.pid)) continue;
      if (isElectronHelperProcess(proc)) continue;

      const exe = normalizeName(proc.name);
      const isCodexExe = exe === "codex.exe";
      const isCodexNode = exe === "node.exe" && isCodexCommandLine(proc.commandLine);
      if (!isCodexExe && !isCodexNode) continue;

      // Avoid duplicate entry for Codex desktop child processes
      const parent = procMap.get(proc.parentPid);
      if (parent && normalizeName(parent.name) === "codex.exe") continue;

      seenPids.add(proc.pid);
      const win = findWindowForPid(proc.pid, procMap, windowsByPid, snapshot.windows);
      if (win && seenHwnds.has(win.hwnd)) continue;

      sessions.push({
        id: `codex:pid:${proc.pid}`,
        harness: "codex",
        label: win?.title || "Codex",
        projectName: win?.title || "Codex",
        state: latestCodexState.state,
        hwnd: win?.hwnd ?? null,
        pid: proc.pid,
        windowTitle: win?.title ?? null,
        preview: latestCodexState.preview ?? (win?.title ? clipPreview(win.title) : null),
        source: isCodexExe && win?.processName.toLowerCase() === "codex.exe" ? "desktop" : "cli",
        updatedAt: latestCodexState.updatedAt,
      });
    }

    return sessions;
  }

  private async scanAntigravity(
    snapshot: NativeSnapshot,
    procMap: Map<number, NativeProcessInfo>,
    windowsByPid: Map<number, NativeWindowInfo[]>,
    now: number
  ): Promise<AgentSession[]> {
    const sessions: AgentSession[] = [];
    const seenHwnds = new Set<string>();
    const seenPids = new Set<number>();

    const agyConvDir = path.join(this.homeDir, ".gemini", "antigravity", "conversations");
    const recentConvs = await findRecentFiles(agyConvDir, ".pb", 1);
    const agyThinking =
      recentConvs.length > 0 && now - recentConvs[0].mtimeMs <= this.thinkingWindowMs;
    const agyUpdatedAt = recentConvs[0]?.mtimeMs ?? now;

    // 1. Antigravity 2.0 Desktop App windows
    for (const win of snapshot.windows) {
      if (win.pid === this.selfPid) continue;
      const exe = normalizeName(win.processName);
      if (exe !== "antigravity.exe" && exe !== "agy.exe") continue;

      seenHwnds.add(win.hwnd);
      seenPids.add(win.pid);
      sessions.push({
        id: `antigravity:win:${win.hwnd}`,
        harness: "antigravity",
        label: win.title || "Antigravity",
        projectName: win.title || "Antigravity",
        state: agyThinking ? "thinking" : "idle",
        hwnd: win.hwnd,
        pid: win.pid,
        windowTitle: win.title,
        preview: win.title ? clipPreview(win.title) : null,
        source: "desktop",
        updatedAt: agyUpdatedAt,
      });
    }

    // 2. Antigravity CLI (`agy` / `antigravity`)
    for (const proc of snapshot.processes) {
      if (proc.pid === this.selfPid || seenPids.has(proc.pid)) continue;
      if (isElectronHelperProcess(proc)) continue;

      const exe = normalizeName(proc.name);
      const isAgyExe = exe === "agy.exe" || exe === "antigravity.exe";
      const isAgyNode = exe === "node.exe" && isAgyCommandLine(proc.commandLine);
      if (!isAgyExe && !isAgyNode) continue;

      // Skip Electron background/child processes of Antigravity.exe
      const parent = procMap.get(proc.parentPid);
      if (
        parent &&
        (normalizeName(parent.name) === "antigravity.exe" ||
          normalizeName(parent.name) === "agy.exe")
      ) {
        continue;
      }
      if (isAgyExe && !windowsByPid.has(proc.pid) && exe === "antigravity.exe") {
        continue;
      }

      seenPids.add(proc.pid);
      const win = findWindowForPid(proc.pid, procMap, windowsByPid, snapshot.windows);
      if (win && seenHwnds.has(win.hwnd)) continue;

      sessions.push({
        id: `antigravity:pid:${proc.pid}`,
        harness: "antigravity",
        label: win?.title || "Antigravity",
        projectName: win?.title || "Antigravity",
        state: agyThinking ? "thinking" : "idle",
        hwnd: win?.hwnd ?? null,
        pid: proc.pid,
        windowTitle: win?.title ?? null,
        preview: win?.title ? clipPreview(win.title) : null,
        source: "cli",
        updatedAt: agyUpdatedAt,
      });
    }

    return sessions;
  }
}

export function getSupportedHarnesses(): AgentHarness[] {
  return ["claude", "codex", "antigravity"];
}
