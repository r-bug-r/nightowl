import React from "react";
import type { AgentSession, AwakeState, NightowlSettings, ThemePreset } from "../types";
import { HarnessIcon, harnessDisplayName } from "./HarnessIcons";
import { OwlIcon } from "./OwlIcon";

interface DiagnosticsModalProps {
  awake: AwakeState;
  sessions: AgentSession[];
  settings: NightowlSettings;
  onToggleSetting: (key: keyof NightowlSettings, value: boolean) => void;
  onSelectTheme: (theme: ThemePreset) => void;
  onStartQuick: (hours: number) => void;
  onStop: () => void;
  onFocusSession: (hwnd: string) => void;
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  awake,
  sessions,
  settings,
  onToggleSetting,
  onSelectTheme,
  onStartQuick,
  onStop,
  onFocusSession,
}) => {
  return (
    <div className="diag-shell">
      <header className="diag-header">
        <div className="diag-brand">
          <span className="owl-ring-sm">
            <OwlIcon awake={awake.active} size={20} />
          </span>
          <div>
            <h1>Nightowl for Windows</h1>
            <p className="diag-sub">System tray awake utility &amp; agent monitor</p>
          </div>
        </div>
        <span className={`diag-pill ${awake.active ? "is-awake" : ""}`}>
          {awake.active ? "Keeping PC awake" : "Normal sleep"}
        </span>
      </header>

      <section className="diag-card">
        <div className="diag-card-bar">
          <span>awake-session</span>
          <span>{awake.active && awake.endsAt ? formatRemaining(awake.remainingMs) : awake.active ? "until stopped" : "idle"}</span>
        </div>
        <div className="diag-grid">
          <div className="diag-stat">
            <span className="diag-k">POWER SOURCE</span>
            <span className="diag-v">
              {awake.power.acLineOnline ? "Plugged in" : "On battery"}
              {awake.power.hasBattery ? ` (${awake.power.batteryPercent}%)` : ""}
            </span>
          </div>
          <div className="diag-stat">
            <span className="diag-k">SCREEN</span>
            <span className="diag-v">
              {settings.keepDisplay ? "Stays on" : "Turns off safely"}
            </span>
          </div>
          <div className="diag-stat">
            <span className="diag-k">RECOVERY</span>
            <span className="diag-v">
              {awake.recoveredFromCrash ? "Cleared prior session" : "Clean state"}
            </span>
          </div>
          <div className="diag-stat">
            <span className="diag-k">OPEN AGENTS</span>
            <span className="diag-v">{sessions.length} detected</span>
          </div>
        </div>

        <div className="diag-actions">
          <button type="button" onClick={() => onStartQuick(0.5)}>30 Mins</button>
          <button type="button" onClick={() => onStartQuick(2)}>2 Hours</button>
          <button type="button" onClick={() => onStartQuick(8)}>8 Hours</button>
          {awake.active && (
            <button type="button" className="danger" onClick={onStop}>Stop</button>
          )}
        </div>
      </section>

      <section className="diag-card">
        <div className="diag-card-bar">
          <span>safety &amp; behavior</span>
          <span>preferences</span>
        </div>
        <label className="diag-toggle">
          <input
            type="checkbox"
            checked={settings.batterySafeStop}
            onChange={(e) => onToggleSetting("batterySafeStop", e.target.checked)}
          />
          <span>Stop automatically below 10% battery</span>
        </label>
        <label className="diag-toggle">
          <input
            type="checkbox"
            checked={settings.autoAwakeForAgents}
            onChange={(e) => onToggleSetting("autoAwakeForAgents", e.target.checked)}
          />
          <span>Stay awake automatically while an agent is thinking</span>
        </label>
        <label className="diag-toggle">
          <input
            type="checkbox"
            checked={settings.keepDisplay}
            onChange={(e) => onToggleSetting("keepDisplay", e.target.checked)}
          />
          <span>Keep screen lit during awake sessions</span>
        </label>
        <div className="diag-theme-row">
          <span className="diag-k">THEME PRESET</span>
          <div className="diag-theme-pills">
            {(
              [
                { id: "forest", label: "Nightowl Forest" },
                { id: "minimal-dark", label: "Minimal Dark" },
                { id: "minimal-light", label: "Minimal Light" },
              ] as Array<{ id: ThemePreset; label: string }>
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={settings.theme === preset.id ? "active" : ""}
                onClick={() => onSelectTheme(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="diag-card">
        <div className="diag-card-bar">
          <span>active agents</span>
          <span>Claude Code · Codex · Antigravity</span>
        </div>
        {sessions.length === 0 ? (
          <p className="diag-empty">
            No Claude Code, Codex, or Antigravity sessions detected right now.
          </p>
        ) : (
          <ul className="diag-sessions">
            {sessions.map((s) => (
              <li key={s.id}>
                <div className="diag-sess-left">
                  <span className={`sess-badge sess-${s.harness}`}>
                    <HarnessIcon harness={s.harness} state={s.state} size={16} />
                  </span>
                  <div>
                    <div className="diag-sess-name">{s.projectName}</div>
                    <div className="diag-sess-meta">
                      {harnessDisplayName(s.harness)} · {s.state === "thinking" ? "Thinking..." : "Ready"}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!s.hwnd}
                  onClick={() => s.hwnd && onFocusSession(s.hwnd)}
                >
                  {s.hwnd ? "Focus" : "No window"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
