import React, { useEffect, useState } from "react";
import type {
  AgentSession,
  AwakeState,
  CapsuleSection,
  HoverAnimationSpeed,
  NightowlSettings,
  ThemePreset,
  UpdateCheckResult,
} from "../types";
import { HarnessIcon, harnessDisplayName } from "./HarnessIcons";
import { OwlIcon } from "./OwlIcon";

interface DiagnosticsModalProps {
  awake: AwakeState;
  sessions: AgentSession[];
  settings: NightowlSettings;
  onUpdateSettings: (patch: Partial<NightowlSettings>) => void;
  onSelectTheme: (theme: ThemePreset) => void;
  onStartQuick: (hours: number | null) => void;
  onStop: () => void;
  onFocusSession: (session: AgentSession) => void;
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

interface SwitchRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

const SwitchRow: React.FC<SwitchRowProps> = ({ label, hint, checked, disabled, onChange }) => (
  <div className={`diag-switch-row ${disabled ? "is-disabled" : ""}`}>
    <div className="diag-switch-copy">
      <span className="diag-switch-label">{label}</span>
      {hint && <span className="diag-switch-hint">{hint}</span>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`diag-switch ${checked ? "is-on" : ""}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="diag-switch-thumb" aria-hidden="true" />
    </button>
  </div>
);

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
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [copiedDiag, setCopiedDiag] = useState(false);

  useEffect(() => {
    document.title = "Nightowl Settings & Diagnostics";
    document.documentElement.classList.add("is-diagnostics");
    return () => {
      document.documentElement.classList.remove("is-diagnostics");
    };
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

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const res = await window.nightowl?.checkForUpdates();
      if (res) setUpdateResult(res);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleCopyDiagnostics = async () => {
    const summary = {
      version: awake.appVersion ?? "0.2.0",
      active: awake.active,
      autoAwakeActive: awake.autoAwakeActive,
      lidOverrideActive: Boolean(awake.lidOverrideActive),
      nativeHealthy: awake.nativeHealthy !== false,
      nativeError: awake.nativeError ?? null,
      shortcutRegistered: awake.shortcutRegistered !== false,
      recoveredFromCrash: awake.recoveredFromCrash,
      power: awake.power,
      detectedSessions: sessions.map((s) => ({ harness: s.harness, source: s.source, state: s.state })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      setCopiedDiag(true);
      setTimeout(() => setCopiedDiag(false), 1800);
    } catch {
      // clipboard unavailable
    }
  };

  const animSpeed: HoverAnimationSpeed = settings.hoverAnimation ?? "slow";
  const scale = settings.capsuleScale ?? 1;
  const showClock = settings.showClock !== false;
  const clock24 = Boolean(settings.clockFormat24h);
  const versionLabel = `v${awake.appVersion ?? "0.2.0"}`;

  return (
    <div className="diag-shell" data-theme={settings.theme || "forest"}>
      <header className="diag-header">
        <div className="diag-brand">
          <span className="owl-ring-sm">
            <OwlIcon awake={awake.active} size={20} theme={settings.theme} />
          </span>
          <div>
            <div className="diag-title-row">
              <h1>Nightowl</h1>
              <span className="diag-meta-chip">{versionLabel}</span>
              <span
                className="diag-meta-chip"
                title={
                  awake.shortcutRegistered === false
                    ? "Global shortcut Ctrl+Shift+O is currently used by another app"
                    : "Global toggle hotkey"
                }
              >
                {awake.shortcutRegistered === false ? "Hotkey busy" : "Ctrl+Shift+O"}
              </span>
            </div>
            <p className="diag-sub">Windows tray keep-awake &amp; agent HUD</p>
          </div>
        </div>
        <span className={`diag-pill ${awake.active ? "is-awake" : ""}`}>
          {awake.active ? "Keeping PC awake" : "Normal sleep"}
        </span>
      </header>

      {awake.nativeHealthy === false && (
        <div className="diag-banner is-error" role="alert">
          <strong>Native power helper issue:</strong> {awake.nativeError || "Win32 helper unavailable."}
        </div>
      )}

      {awake.recoveryNote && (
        <div className="diag-banner is-info" role="status">
          {awake.recoveryNote}
        </div>
      )}

      <section className="diag-card">
        <div className="diag-card-bar">
          <span>awake-session</span>
          <span>
            {awake.active && awake.endsAt
              ? formatRemaining(awake.remainingMs)
              : awake.active
                ? awake.autoAwakeActive && !awake.manualAwake
                  ? "auto-awake (agent)"
                  : "until stopped"
                : "idle"}
          </span>
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
            <span className="diag-k">HELPER &amp; RECOVERY</span>
            <span className="diag-v">
              {awake.nativeHealthy === false
                ? "Helper offline"
                : awake.lidOverrideActive
                  ? "AC lid override active"
                  : awake.recoveredFromCrash
                    ? "Cleared prior session"
                    : "Healthy · Clean state"}
            </span>
          </div>
          <div className="diag-stat">
            <span className="diag-k">OPEN AGENTS</span>
            <span className="diag-v">{sessions.length} detected</span>
          </div>
        </div>

        <div className="diag-actions">
          <button type="button" onClick={() => onStartQuick(null)}>Always Awake (∞)</button>
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
        <SwitchRow
          label={`Stop automatically below ${settings.batteryThreshold}% battery`}
          checked={settings.batterySafeStop}
          onChange={(batterySafeStop) => onUpdateSettings({ batterySafeStop })}
        />
        <div className={`diag-theme-row ${!settings.batterySafeStop ? "is-dimmed" : ""}`}>
          <span className="diag-k">BATTERY THRESHOLD</span>
          <div className="diag-theme-pills">
            {[5, 10, 15, 20].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={!settings.batterySafeStop}
                className={settings.batteryThreshold === pct ? "active" : ""}
                onClick={() => onUpdateSettings({ batteryThreshold: pct })}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
        <SwitchRow
          label="Stay awake automatically while an agent is thinking"
          hint="Claude Code, Codex, and Antigravity"
          checked={settings.autoAwakeForAgents}
          onChange={(autoAwakeForAgents) => onUpdateSettings({ autoAwakeForAgents })}
        />
        <SwitchRow
          label="Keep screen lit during awake sessions"
          hint="Off lets your display sleep to save power"
          checked={settings.keepDisplay}
          onChange={(keepDisplay) => onUpdateSettings({ keepDisplay })}
        />
        <SwitchRow
          label="Keep awake with lid closed (AC only, opt-in)"
          hint="Restores on exit · Keep laptop on a ventilated flat surface"
          checked={Boolean(settings.keepAwakeWithLidClosed)}
          onChange={(keepAwakeWithLidClosed) => onUpdateSettings({ keepAwakeWithLidClosed })}
        />
        <SwitchRow
          label="Start Nightowl with Windows"
          hint="Runs quietly in your system tray at sign-in"
          checked={Boolean(settings.openAtLogin)}
          onChange={(openAtLogin) => onUpdateSettings({ openAtLogin })}
        />
        <SwitchRow
          label="Start awake on launch"
          hint="Useful for remote-controlled workstations"
          checked={Boolean(settings.keepAwakeOnLaunch)}
          onChange={(keepAwakeOnLaunch) => {
            onUpdateSettings({ keepAwakeOnLaunch });
            if (keepAwakeOnLaunch) onStartQuick(null);
          }}
        />
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

        <SwitchRow
          label="Show clock in capsule"
          checked={showClock}
          onChange={(next) => onUpdateSettings({ showClock: next })}
        />
        <SwitchRow
          label="Use 24-hour clock format"
          checked={clock24}
          disabled={!showClock}
          onChange={(clockFormat24h) => onUpdateSettings({ clockFormat24h })}
        />

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
                  <div className="diag-sess-info">
                    <div className="diag-sess-name">{s.projectName}</div>
                    <div className="diag-sess-meta">
                      <span>{harnessDisplayName(s.harness)}</span>
                      <span className="diag-sess-tag">{s.source === "cli" ? "CLI" : "Desktop"}</span>
                      <span className={`diag-sess-state ${s.state === "thinking" ? "is-thinking" : ""}`}>
                        {s.state === "thinking" ? "Thinking..." : "Ready"}
                      </span>
                    </div>
                    {s.preview && <div className="diag-sess-preview">{s.preview}</div>}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!s.hwnd}
                  onClick={() => s.hwnd && onFocusSession(s)}
                >
                  {s.hwnd ? "Focus" : "No window"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="diag-footer">
        <div className="diag-footer-left">
          <button
            type="button"
            className="diag-link-btn"
            disabled={checkingUpdate}
            onClick={() => void handleCheckUpdates()}
          >
            {checkingUpdate ? "Checking..." : "Check for updates"}
          </button>
          <button
            type="button"
            className="diag-link-btn"
            onClick={() => void handleCopyDiagnostics()}
          >
            {copiedDiag ? "Copied diagnostics" : "Copy diagnostics"}
          </button>
          {updateResult?.status === "update-available" && (
            <button
              type="button"
              className="diag-link-btn is-accent"
              onClick={() => void window.nightowl?.openExternal(updateResult.releaseUrl)}
            >
              Update v{updateResult.latestVersion} ↗
            </button>
          )}
          {updateResult?.status === "up-to-date" && (
            <span className="diag-update-note">Up to date ({versionLabel})</span>
          )}
          {updateResult?.status === "error" && (
            <span className="diag-update-note">{updateResult.error}</span>
          )}
        </div>
        <div className="diag-footer-links">
          <button
            type="button"
            className="diag-text-link"
            onClick={() => void window.nightowl?.openExternal("https://nightowl.sheif.org/docs/index.html")}
          >
            Docs
          </button>
          <button
            type="button"
            className="diag-text-link"
            onClick={() => void window.nightowl?.openExternal("https://github.com/r-bug-r/nightowl")}
          >
            GitHub
          </button>
        </div>
      </footer>
    </div>
  );
};
