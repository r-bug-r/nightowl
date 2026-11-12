import React, { useEffect, useMemo, useRef, useState } from "react";
import { DiagnosticsModal } from "./components/DiagnosticsModal";
import { HarnessIcon, harnessDisplayName } from "./components/HarnessIcons";
import { OwlIcon } from "./components/OwlIcon";
import type { AgentSession, AwakeState, NightowlSettings } from "./types";

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
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
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
    dragRef.current = { active: true, lastX: e.screenX, lastY: e.screenY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleChevronPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.screenX - dragRef.current.lastX;
    const dy = e.screenY - dragRef.current.lastY;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
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

  return (
    <div
      className="tray-stage"
      ref={stageRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setHoveredSession(null);
      }}
    >
      {/* Floating Session Tooltip */}
      {hoveredSession && (
        <div className="agent-tooltip" role="status">
          <span className="agent-tt-harness">{harnessDisplayName(hoveredSession.harness)}</span>
          <span className="agent-tt-sep">·</span>
          <span className="agent-tt-proj">{hoveredSession.projectName}</span>
          <span className="agent-tt-sep">·</span>
          <span className={`agent-tt-state ${hoveredSession.state === "thinking" ? "is-thinking" : ""}`}>
            {hoveredSession.state === "thinking" ? "Thinking..." : "Ready"}
          </span>
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
              void window.nightowl?.startAwake(30 * 60_000);
              setMenuOpen(false);
            }}
          >
            Stay awake 30 mins
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void window.nightowl?.startAwake(2 * 3600_000);
              setMenuOpen(false);
            }}
          >
            Stay awake 2 hours
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void window.nightowl?.startAwake(8 * 3600_000);
              setMenuOpen(false);
            }}
          >
            Stay awake 8 hours
          </button>
          {awake.active && (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                void window.nightowl?.stopAwake();
                setMenuOpen(false);
              }}
            >
              End awake session
            </button>
          )}
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
        className={`capsule ${awake.active ? "is-awake" : ""} ${showAgentsStrip ? "is-expanded" : ""}`}
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
              onMouseEnter={() => setHoveredSession(session)}
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
          <OwlIcon awake={awake.active} size={22} />
        </button>

        {/* Slide-out Days / Hours / Minutes Inputs */}
        {timerOpen && (
          <form className="timer-fields" onSubmit={handleSubmitTimer}>
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
            <button type="submit" className="timer-go" title="Start timer">
              Go
            </button>
          </form>
        )}

        {/* Active Countdown + Hold-to-End Button */}
        {awake.active && !timerOpen && (
          <div className="awake-controls">
            <button
              type="button"
              className="countdown-btn"
              onClick={handleAddTime}
              title="Click to add 30 minutes"
            >
              {awake.endsAt ? formatCountdown(liveRemainingMs) : "Awake"}
            </button>
            <button
              type="button"
              className="hold-end-btn"
              style={
                {
                  "--hold-deg": `${Math.round(holdProgress * 360)}deg`,
                } as React.CSSProperties
              }
              onPointerDown={startHoldToEnd}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              title="Hold to stop early"
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
