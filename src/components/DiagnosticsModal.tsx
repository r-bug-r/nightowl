import React, { useEffect } from "react";
import type {
  AgentSession,
  AwakeState,
  CapsuleSection,
  HoverAnimationSpeed,
  NightowlSettings,
  ThemePreset,
} from "../types";
import { HarnessIcon, harnessDisplayName } from "./HarnessIcons";
import { OwlIcon } from "./OwlIcon";

interface DiagnosticsModalProps {
  awake: AwakeState;
  sessions: AgentSession[];
  settings: NightowlSettings;
  onUpdateSettings: (patch: Partial<NightowlSettings>) => void;
  onSelectTheme: (theme: ThemePreset) => void;
  onStartQuick: (hours: number) => void;
  onStop: () => void;
  onFocusSession: (hwnd: string) => void;
  onResetPosition: () => void;
}

const SECTION_LABELS: Record<CapsuleSection, string> = {
  agents: "Agents",
  owl: "Owl",
  time: "Time",
};

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
  onUpdateSettings,
  onSelectTheme,
  onStartQuick,
  onStop,
  onFocusSession,
  onResetPosition,
}) => {
  useEffect(() => {
    document.title = "Nightowl Settings & Diagnostics";
  }, []);

  const order: CapsuleSection[] =
    settings.capsuleOrder && settings.capsuleOrder.length === 3
      ? settings.capsuleOrder
      : ["agents", "owl", "time"];

  const moveSection = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onUpdateSettings({ capsuleOrder: next });
  };

  const animSpeed: HoverAnimationSpeed = settings.hoverAnimation ?? "slow";
  const scale = settings.capsuleScale ?? 1;
  const showClock = settings.showClock !== false;
  const clock24 = Boolean(settings.clockFormat24h);
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
            onChange={(e) => onUpdateSettings({ batterySafeStop: e.target.checked })}
          />
          <span>Stop automatically below {settings.batteryThreshold}% battery</span>
        </label>
        <div className="diag-theme-row">
          <span className="diag-k">BATTERY THRESHOLD</span>
          <div className="diag-theme-pills">
            {[5, 10, 15, 20].map((pct) => (
              <button
                key={pct}
                type="button"
                className={settings.batteryThreshold === pct ? "active" : ""}
                onClick={() => onUpdateSettings({ batteryThreshold: pct })}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
        <label className="diag-toggle">
          <input
            type="checkbox"
            checked={settings.autoAwakeForAgents}
            onChange={(e) => onUpdateSettings({ autoAwakeForAgents: e.target.checked })}
          />
          <span>Stay awake automatically while an agent is thinking</span>
        </label>
        <label className="diag-toggle">
          <input
            type="checkbox"
            checked={settings.keepDisplay}
            onChange={(e) => onUpdateSettings({ keepDisplay: e.target.checked })}
          />
          <span>Keep screen lit during awake sessions</span>
        </label>
      </section>

      <section className="diag-card">
        <div className="diag-card-bar">
          <span>capsule customization</span>
          <span>layout &amp; motion</span>
        </div>

        <div className="diag-theme-row">
          <span className="diag-k">BAR ORIENTATION (LEFT → RIGHT)</span>
          <div className="diag-theme-pills">
            <button
              type="button"
              className={order.join("-") === "agents-owl-time" ? "active" : ""}
              onClick={() => onUpdateSettings({ capsuleOrder: ["agents", "owl", "time"] })}
            >
              Agents · Owl · Time
            </button>
            <button
              type="button"
              className={order.join("-") === "time-owl-agents" ? "active" : ""}
              onClick={() => onUpdateSettings({ capsuleOrder: ["time", "owl", "agents"] })}
            >
              Time · Owl · Agents
            </button>
          </div>
          <div className="diag-order-row">
            {order.map((sec, idx) => (
              <div key={sec} className="diag-order-chip">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveSection(idx, -1)}
                  title="Move left"
                >
                  ←
                </button>
                <span>{SECTION_LABELS[sec]}</span>
                <button
                  type="button"
                  disabled={idx === order.length - 1}
                  onClick={() => moveSection(idx, 1)}
                  title="Move right"
                >
                  →
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="diag-theme-row">
          <span className="diag-k">HOVER EXPAND &amp; SHRINK SPEED</span>
          <div className="diag-theme-pills">
            {(
              [
                { id: "slow", label: "Slow & Smooth" },
                { id: "normal", label: "Normal" },
                { id: "fast", label: "Fast" },
              ] as Array<{ id: HoverAnimationSpeed; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={animSpeed === opt.id ? "active" : ""}
                onClick={() => onUpdateSettings({ hoverAnimation: opt.id })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="diag-theme-row">
          <span className="diag-k">CAPSULE SCALE ({scale.toFixed(2)}×)</span>
          <div className="diag-slider-row">
            <input
              type="range"
              min="0.75"
              max="1.6"
              step="0.05"
              value={scale}
              onChange={(e) => onUpdateSettings({ capsuleScale: parseFloat(e.target.value) })}
            />
            <button type="button" onClick={() => onUpdateSettings({ capsuleScale: 1 })}>
              Reset 1×
            </button>
            <button type="button" onClick={onResetPosition}>
              Reset Position
            </button>
          </div>
        </div>

        <label className="diag-toggle">
          <input
            type="checkbox"
            checked={showClock}
            onChange={(e) => onUpdateSettings({ showClock: e.target.checked })}
          />
          <span>Show clock in capsule</span>
        </label>
        <label className="diag-toggle">
          <input
            type="checkbox"
            checked={clock24}
            disabled={!showClock}
            onChange={(e) => onUpdateSettings({ clockFormat24h: e.target.checked })}
          />
          <span>Use 24-hour clock format</span>
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
