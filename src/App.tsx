import React, { useEffect, useMemo, useRef, useState } from "react";
import { DiagnosticsModal } from "./components/DiagnosticsModal";
import { HarnessIcon, harnessDisplayName } from "./components/HarnessIcons";
import { OwlIcon } from "./components/OwlIcon";
import type { AgentSession, AwakeState, NightowlSettings, ThemePreset } from "./types";

const HOLD_TO_END_MS = 600;

const DEFAULT_AWAKE: AwakeState = {
  active: false,
  endsAt: null,
  remainingMs: 0,
  keepDisplay: false,
  batterySafeStop: true,
  autoAwakeForAgents: false,
  autoAwakeActive: false,
  recoveredFromCrash: false,
  recoveryNote: null,
  power: {
    acLineOnline: true,
    hasBattery: false,
    batteryPercent: 100,
    charging: false,
    batterySaver: false,
  },
};

const DEFAULT_SETTINGS: NightowlSettings = {
  batteryThreshold: 10,
  batterySafeStop: true,
  keepDisplay: false,
  autoAwakeForAgents: false,
  theme: "forest",
};

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const App: React.FC = () => {
  const isDiagnostics = useMemo(
    () => new URLSearchParams(window.location.search).get("view") === "diagnostics",
    []
  );

  const [awake, setAwake] = useState<AwakeState>(DEFAULT_AWAKE);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [settings, setSettings] = useState<NightowlSettings>(DEFAULT_SETTINGS);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Capsule UI states
  const [hovered, setHovered] = useState(false);
  const [hoveredSession, setHoveredSession] = useState<AgentSession | null>(null);
  const [hoveredControl, setHoveredControl] = useState<
    "timer" | "awake" | "countdown" | "screen" | "stop" | null
  >(null);
  const [timerOpen, setTimerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [days, setDays] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");

  // Hold-to-end state
  const [holdProgress, setHoldProgress] = useState(0);
  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef<number>(0);

  // Dragging capsule
  const dragRef = useRef<{ active: boolean; moved: boolean; lastX: number; lastY: number }>({
    active: false,
    moved: false,
    lastX: 0,
    lastY: 0,
  });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const hoursInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      setClock(formatClock(now));
      setNowMs(now.getTime());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    window.nightowl?.getState().then((res) => {
      setAwake(res.awake);
      setSessions(res.sessions);
      setSettings(res.settings);
    });
    unsub = window.nightowl?.onStateUpdate((payload) => {
      setAwake(payload.awake);
      setSessions(payload.sessions);
      setSettings(payload.settings);
    });
    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (isDiagnostics) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setTimerOpen(false);
      }
    };
    const onBlur = () => {
      setMenuOpen(false);
      setHovered(false);
      setHoveredSession(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [isDiagnostics]);

  // Keep transparent window bounds matched to capsule + open popovers
  useEffect(() => {
    if (isDiagnostics) return;
    const el = stageRef.current;
    if (!el) return;

    const sendSize = () => {
      const rect = el.getBoundingClientRect();
      window.nightowl?.resizeCapsule(Math.ceil(rect.width) + 8, Math.ceil(rect.height) + 8);
    };

    sendSize();
    const ro = new ResizeObserver(sendSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isDiagnostics, hovered, timerOpen, menuOpen, sessions.length, awake.active, hoveredSession]);

  const liveRemainingMs = awake.endsAt ? Math.max(0, awake.endsAt - nowMs) : 0;

  const handleToggleTimer = () => {
    setMenuOpen(false);
    setTimerOpen((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => hoursInputRef.current?.focus(), 40);
      }
      return next;
    });
  };

  const handleSubmitTimer = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = Math.max(0, parseInt(days || "0", 10) || 0);
    const h = Math.max(0, parseInt(hours || "0", 10) || 0);
    const m = Math.max(0, parseInt(minutes || "0", 10) || 0);
    const totalMs = (d * 86400 + h * 3600 + m * 60) * 1000;
    if (totalMs <= 0) {
      setTimerOpen(false);
      return;
    }
    const next = await window.nightowl?.startAwake(totalMs);
    if (next) setAwake(next);
    setDays("");
    setHours("");
    setMinutes("");
    setTimerOpen(false);
  };

  const handleAddTime = async () => {
    const next = await window.nightowl?.addAwakeTime(30 * 60_000);
    if (next) setAwake(next);
  };

  const cancelHold = () => {
    if (holdRafRef.current !== null) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    setHoldProgress(0);
  };

  const startHoldToEnd = () => {
    cancelHold();
    holdStartRef.current = performance.now();
    const tick = (now: number) => {
      const pct = Math.min(1, (now - holdStartRef.current) / HOLD_TO_END_MS);
      setHoldProgress(pct);
      if (pct >= 1) {
        holdRafRef.current = null;
        setHoldProgress(0);
        void window.nightowl?.stopAwake().then((next) => next && setAwake(next));
        return;
      }
      holdRafRef.current = requestAnimationFrame(tick);
    };
    holdRafRef.current = requestAnimationFrame(tick);
  };

  const handleFocusAgent = async (session: AgentSession) => {
    if (!session.hwnd) return;
    await window.nightowl?.focusSession(session.hwnd);
  };

  const handleChevronPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { active: true, moved: false, lastX: e.screenX, lastY: e.screenY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleChevronPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.screenX - dragRef.current.lastX;
    const dy = e.screenY - dragRef.current.lastY;
    if (Math.abs(dx) >= 2 || Math.abs(dy) >= 2) {
      dragRef.current.moved = true;
      dragRef.current.lastX = e.screenX;
      dragRef.current.lastY = e.screenY;
      window.nightowl?.moveCapsuleBy(dx, dy);
    }
  };

  const handleChevronPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  if (isDiagnostics) {
    return (
      <DiagnosticsModal
        awake={awake}
        sessions={sessions}
        settings={settings}
        onToggleSetting={async (key, val) => {
          const next = await window.nightowl?.updateSettings({ [key]: val });
          if (next) setSettings(next);
        }}
        onSelectTheme={async (theme) => {
          const next = await window.nightowl?.updateSettings({ theme });
          if (next) setSettings(next);
        }}
        onStartQuick={async (hrs) => {
          const next = await window.nightowl?.startAwake(hrs * 3600_000);
          if (next) setAwake(next);
        }}
        onStop={async () => {
          const next = await window.nightowl?.stopAwake();
          if (next) setAwake(next);
        }}
        onFocusSession={(hwnd) => {
          void window.nightowl?.focusSession(hwnd);
        }}
      />
    );
  }

  const showAgentsStrip = hovered && sessions.length > 0;
  const showAsleepActions = !awake.active && (hovered || timerOpen);
  const showExpandedAwakeExtras = awake.active && hovered && !timerOpen;
  const showTimerPopover = !menuOpen && !hoveredSession && (hoveredControl === "timer" || timerOpen);
  const isCapsuleExpanded = showAgentsStrip || showAsleepActions || showExpandedAwakeExtras;

  return (
    <div
      className="tray-stage"
      data-theme={settings.theme || "forest"}
      ref={stageRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setHoveredSession(null);
        setHoveredControl(null);
      }}
    >
      {/* OMP Session HUD-style Floating Preview Card */}
      {!menuOpen && hoveredSession && (
        <div className="agent-preview-card" role="status">
          <div className="agent-pc-head">
            <span className="agent-pc-brand">
              <HarnessIcon harness={hoveredSession.harness} state={hoveredSession.state} size={13} />
              <span className="agent-pc-harness">{harnessDisplayName(hoveredSession.harness)}</span>
            </span>
            <span className="agent-pc-badges">
              <span className="agent-pc-source">
                {hoveredSession.source === "cli" ? "CLI" : "Desktop"}
              </span>
              <span
                className={`agent-pc-state ${
                  hoveredSession.state === "thinking" ? "is-thinking" : ""
                }`}
              >
                {hoveredSession.state === "thinking" ? "Thinking..." : "Ready"}
              </span>
            </span>
          </div>
          <div className="agent-pc-project">{hoveredSession.projectName}</div>
          {(hoveredSession.preview || hoveredSession.windowTitle) && (
            <div className="agent-pc-preview">
              {hoveredSession.preview || hoveredSession.windowTitle}
            </div>
          )}
          <div className="agent-pc-foot">Click icon to focus window</div>
        </div>
      )}

      {/* Floating Timer Options Popover (on hover or click of Timer icon) */}
      {showTimerPopover && (
        <div
          className="capsule-hover-popover"
          role="dialog"
          aria-label="Timer presets and custom duration"
          onMouseEnter={() => setHoveredControl("timer")}
          onMouseLeave={() => setHoveredControl((prev) => (prev === "timer" ? null : prev))}
        >
          <div className="popover-chips">
            {[
              { label: "30m", mins: 30 },
              { label: "2h", mins: 120 },
              { label: "8h", mins: 480 },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="popover-chip"
                onClick={() => {
                  setTimerOpen(false);
                  setHoveredControl(null);
                  void window.nightowl?.startAwake(preset.mins).then((next) => next && setAwake(next));
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <form
            className="timer-fields"
            onSubmit={(e) => {
              handleSubmitTimer(e);
              setHoveredControl(null);
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="D"
              aria-label="Days"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
            />
            <input
              ref={hoursInputRef}
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="H"
              aria-label="Hours"
              value={hours}
              onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))}
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="M"
              aria-label="Minutes"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
            />
            <button type="submit" className="timer-go" title="Start custom timer">
              ✓
            </button>
          </form>
        </div>
      )}

      {/* Floating Control Hint Pill (on hover of Quick Awake, Countdown, Screen, Stop) */}
      {!menuOpen && !hoveredSession && !showTimerPopover && hoveredControl && (
        <div className="capsule-hover-hint" role="status">
          {hoveredControl === "awake" && "Quick Awake · Stay awake until stopped"}
          {hoveredControl === "countdown" && "Click to add +30m"}
          {hoveredControl === "screen" &&
            (settings.keepDisplay ? "Screen: Stays lit" : "Screen: Turns off")}
          {hoveredControl === "stop" && "Hold 0.6s to stop"}
        </div>
      )}

      {/* Right-Click / Chevron Context Menu */}
      {menuOpen && (
        <div className="tray-menu" role="menu" aria-label="Nightowl options">
          <div className="tray-menu-head">
            <span>{awake.active ? "Keeping PC awake" : "Normal sleep"}</span>
            <span className="tray-menu-meta">
              {awake.power.hasBattery ? `${awake.power.batteryPercent}%` : "AC"}
            </span>
          </div>
          <div className="tray-menu-sep" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void window.nightowl?.updateSettings({
                autoAwakeForAgents: !settings.autoAwakeForAgents,
              });
            }}
          >
            <span>Auto-awake while agents think</span>
            <span className="menu-check">{settings.autoAwakeForAgents ? "On" : "Off"}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void window.nightowl?.updateSettings({
                batterySafeStop: !settings.batterySafeStop,
              });
            }}
          >
            <span>Battery safety (&lt;10%)</span>
            <span className="menu-check">{settings.batterySafeStop ? "On" : "Off"}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void window.nightowl?.updateSettings({
                keepDisplay: !settings.keepDisplay,
              });
            }}
          >
            <span>Keep screen lit</span>
            <span className="menu-check">{settings.keepDisplay ? "On" : "Off"}</span>
          </button>
          <div className="tray-menu-sep" />
          <div className="tray-theme-row" role="group" aria-label="Theme preset">
            {(
              [
                { id: "forest", label: "Forest" },
                { id: "minimal-dark", label: "Min Dark" },
                { id: "minimal-light", label: "Min Light" },
              ] as Array<{ id: ThemePreset; label: string }>
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`tray-theme-pill ${settings.theme === preset.id ? "active" : ""}`}
                onClick={() => {
                  void window.nightowl?.updateSettings({ theme: preset.id }).then((next) => {
                    if (next) setSettings(next);
                  });
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="tray-menu-sep" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              window.nightowl?.openDiagnostics();
              setMenuOpen(false);
            }}
          >
            Settings &amp; Diagnostics...
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              window.nightowl?.resetCapsulePosition();
              setMenuOpen(false);
            }}
          >
            Reset tray position
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => window.nightowl?.quitApp()}
          >
            Exit Nightowl
          </button>
        </div>
      )}

      {/* Main Nightowl System Tray Capsule */}
      <div
        className={`capsule ${awake.active ? "is-awake" : ""} ${isCapsuleExpanded ? "is-expanded" : ""}`}
        onContextMenu={(e) => {
          e.preventDefault();
          setTimerOpen(false);
          setMenuOpen((prev) => !prev);
        }}
      >
        <div className="capsule-specular" aria-hidden="true" />

        {/* Overflow / Drag Chevron */}
        <button
          type="button"
          className="capsule-chevron"
          title="Options (or drag to move)"
          aria-label="Nightowl options"
          onClick={() => {
            if (dragRef.current.moved) {
              dragRef.current.moved = false;
              return;
            }
            setTimerOpen(false);
            setMenuOpen((prev) => !prev);
          }}
          onPointerDown={handleChevronPointerDown}
          onPointerMove={handleChevronPointerMove}
          onPointerUp={handleChevronPointerUp}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 10l4-4 4 4" />
          </svg>
        </button>

        {/* Expandable Agent Sessions Strip (on hover) */}
        <div className={`agent-strip ${showAgentsStrip ? "open" : ""}`}>
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`agent-btn agent-${session.harness} ${session.state === "thinking" ? "is-thinking" : ""} ${session.hwnd ? "" : "no-hwnd"}`}
              onClick={() => void handleFocusAgent(session)}
              onMouseEnter={() => {
                setHoveredControl(null);
                setHoveredSession(session);
              }}
              onMouseLeave={() => setHoveredSession((cur) => (cur?.id === session.id ? null : cur))}
              aria-label={`${harnessDisplayName(session.harness)}: ${session.projectName}`}
            >
              <HarnessIcon harness={session.harness} state={session.state} size={17} />
            </button>
          ))}
        </div>

        {/* Golden Ring + Owl Mascot */}
        <button
          type="button"
          className="owl-ring-btn"
          onClick={handleToggleTimer}
          aria-label={awake.active ? "Set or adjust timer" : "Set an awake timer"}
          title={awake.active ? "Click to set a new timer" : "Click to set an awake timer"}
        >
          <OwlIcon awake={awake.active} size={25} theme={settings.theme} />
        </button>

        {/* Expanded Asleep Controls: Icon-only Timer + Quick Awake (hover for options) */}
        {showAsleepActions && (
          <div className="capsule-action-pair">
            <button
              type="button"
              className={`capsule-icon-action ${timerOpen ? "is-active" : ""}`}
              aria-label="Timer options"
              onMouseEnter={() => {
                setHoveredSession(null);
                setHoveredControl("timer");
              }}
              onMouseLeave={() => setHoveredControl((prev) => (prev === "timer" ? null : prev))}
              onClick={handleToggleTimer}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.45" />
                <path
                  d="M8 5.5v3l2 1.2M6.2 1.8h3.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.45"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="capsule-icon-action is-accent"
              aria-label="Quick Awake"
              onMouseEnter={() => {
                setHoveredSession(null);
                setHoveredControl("awake");
              }}
              onMouseLeave={() => setHoveredControl((prev) => (prev === "awake" ? null : prev))}
              onClick={() => {
                setTimerOpen(false);
                setHoveredControl(null);
                void window.nightowl?.startAwake(null).then((next) => next && setAwake(next));
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M9.2 1.8L4.3 8.8h3.5l-1 5.4 4.9-7H8.2l1-5.4z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Active Countdown + Minimal Screen Toggle + Hold-to-End Button */}
        {awake.active && (
          <div className="awake-controls">
            <button
              type="button"
              className="countdown-btn"
              aria-label="Remaining awake time, click to add 30 minutes"
              onMouseEnter={() => {
                setHoveredSession(null);
                setHoveredControl("countdown");
              }}
              onMouseLeave={() => setHoveredControl((prev) => (prev === "countdown" ? null : prev))}
              onClick={handleAddTime}
            >
              <span>{awake.endsAt ? formatCountdown(liveRemainingMs) : "Awake"}</span>
            </button>
            {showExpandedAwakeExtras && (
              <button
                type="button"
                className={`capsule-icon-btn ${settings.keepDisplay ? "is-on" : ""}`}
                aria-label={settings.keepDisplay ? "Screen stays lit" : "Screen turns off"}
                onMouseEnter={() => {
                  setHoveredSession(null);
                  setHoveredControl("screen");
                }}
                onMouseLeave={() => setHoveredControl((prev) => (prev === "screen" ? null : prev))}
                onClick={() => {
                  void window.nightowl?.updateSettings({ keepDisplay: !settings.keepDisplay }).then((next) => {
                    if (next) setSettings(next);
                  });
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2" y="3" width="12" height="8.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.35" />
                  <path d="M5.5 13.5h5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
                  {settings.keepDisplay && <circle cx="8" cy="7.2" r="1.4" fill="currentColor" />}
                </svg>
              </button>
            )}
            <button
              type="button"
              className="hold-end-btn"
              style={
                {
                  "--hold-deg": `${Math.round(holdProgress * 360)}deg`,
                } as React.CSSProperties
              }
              onMouseEnter={() => {
                setHoveredSession(null);
                setHoveredControl("stop");
              }}
              onMouseLeave={() => setHoveredControl((prev) => (prev === "stop" ? null : prev))}
              onPointerDown={startHoldToEnd}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              aria-label="Hold to end awake session"
            >
              ×
            </button>
          </div>
        )}

        {/* Vertical Divider + Live Clock */}
        <span className="capsule-divider" aria-hidden="true" />
        <span className="capsule-clock">{clock}</span>
      </div>
    </div>
  );
};
