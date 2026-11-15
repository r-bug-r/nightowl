import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DiagnosticsModal } from "./components/DiagnosticsModal";
import { HarnessIcon, harnessDisplayName } from "./components/HarnessIcons";
import { OwlIcon } from "./components/OwlIcon";
import type { AgentSession, AwakeState, CapsuleSection, NightowlSettings, ThemePreset } from "./types";

const HOLD_TO_END_MS = 600;
const MAX_VISIBLE_SESSIONS = 5;

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
  capsuleOrder: ["agents", "owl", "time"],
  hoverAnimation: "slow",
  clockFormat24h: false,
  showClock: true,
};

function formatClock(date: Date, use24h = false): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: !use24h });
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

function formatRelativeAge(updatedAt: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
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
  const [hoveredOverflow, setHoveredOverflow] = useState(false);
  const [hoveredControl, setHoveredControl] = useState<
    "owl" | "timer" | "countdown" | "screen" | "stop" | null
  >(null);
  const [timerOpen, setTimerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorVersion, setAnchorVersion] = useState(0);
  const [floatingRight, setFloatingRight] = useState<number | undefined>(undefined);
  const [caretOffset, setCaretOffset] = useState<number>(24);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const floatingSlotRef = useRef<HTMLDivElement | null>(null);
  const hoveredElRef = useRef<HTMLElement | null>(null);
  const hoverGraceRef = useRef<number | null>(null);

  const [days, setDays] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");

  // Hold-to-end state
  const [holdProgress, setHoldProgress] = useState(0);
  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef<number>(0);

  // Dragging & resizing capsule
  const [liveScale, setLiveScale] = useState<number | null>(null);
  const capsuleScale = liveScale ?? settings.capsuleScale ?? 1;
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });
  const suppressNextClickRef = useRef(false);
  const resizeGripRef = useRef<{
    active: boolean;
    startX: number;
    startScale: number;
    lastScale: number;
  }>({
    active: false,
    startX: 0,
    startScale: 1,
    lastScale: 1,
  });
  const stageLeaveGraceRef = useRef<number | null>(null);
  const lastSentSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const resizeRafRef = useRef<number | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const hoursInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClock(formatClock(now, Boolean(settings.clockFormat24h)));
      setNowMs(now.getTime());
    };
    updateClock();
    const t = setInterval(updateClock, 1000);
    return () => clearInterval(t);
  }, [settings.clockFormat24h]);

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
        setHoveredControl(null);
        setHoveredSession(null);
        setHoveredOverflow(false);
      }
    };
    const onBlur = () => {
      setMenuOpen(false);
      setTimerOpen(false);
      setHovered(false);
      setHoveredSession(null);
      setHoveredOverflow(false);
      setHoveredControl(null);
      dragRef.current.active = false;
      dragRef.current.moved = false;
      resizeGripRef.current.active = false;
      setLiveScale(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const stage = stageRef.current;
      if (stage && !stage.contains(e.target as Node)) {
        setMenuOpen(false);
        setTimerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerdown", onPointerDown);
      if (hoverGraceRef.current !== null) {
        window.clearTimeout(hoverGraceRef.current);
        hoverGraceRef.current = null;
      }
      if (stageLeaveGraceRef.current !== null) {
        window.clearTimeout(stageLeaveGraceRef.current);
        stageLeaveGraceRef.current = null;
      }
    };
  }, [isDiagnostics]);

  // Fixed-size transparent window: never resize at runtime (resizing caused flicker + upward jumps).
  // Instead, toggle click-through so only visible UI captures the mouse.
  const ignoreMouseRef = useRef(true);
  useEffect(() => {
    if (isDiagnostics) return;
    const setIgnore = (ignore: boolean) => {
      if (ignoreMouseRef.current === ignore) return;
      ignoreMouseRef.current = ignore;
      window.nightowl?.setIgnoreMouse(ignore);
    };
    const onMove = (e: MouseEvent) => {
      if (dragRef.current.active || resizeGripRef.current.active) {
        setIgnore(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      const overUi = Boolean(
        target?.closest(".capsule, .agent-preview-card, .capsule-hover-popover, .capsule-hover-hint, .tray-menu")
      );
      setIgnore(!overUi);
    };
    const onLeave = () => {
      if (!dragRef.current.active && !resizeGripRef.current.active) setIgnore(true);
    };
    window.nightowl?.setIgnoreMouse(true);
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [isDiagnostics]);

  const liveRemainingMs = awake.endsAt ? Math.max(0, awake.endsAt - nowMs) : 0;

  const handleToggleQuickAwake = async () => {
    setTimerOpen(false);
    setMenuOpen(false);
    setHoveredControl(null);
    if (awake.active) {
      const next = await window.nightowl?.stopAwake();
      if (next) setAwake(next);
    } else {
      const next = await window.nightowl?.startAwake(null);
      if (next) setAwake(next);
    }
  };

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

  useEffect(() => {
    if (isDiagnostics) return;
    window.nightowl?.setCapsuleFocusable(timerOpen);
  }, [isDiagnostics, timerOpen]);

  const handleFocusAgent = async (session: AgentSession) => {
    if (!session.hwnd) return;
    await window.nightowl?.focusSession(session.hwnd, session.projectName, session.id);
  };

  const handleCapsulePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, .capsule-resize-grip")) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
    };
  };

  const handleCapsulePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const totalDx = e.screenX - dragRef.current.startX;
    const totalDy = e.screenY - dragRef.current.startY;
    if (!dragRef.current.moved && Math.hypot(totalDx, totalDy) < 4) return;
    if (!dragRef.current.moved) {
      dragRef.current.moved = true;
      suppressNextClickRef.current = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    const dx = e.screenX - dragRef.current.lastX;
    const dy = e.screenY - dragRef.current.lastY;
    if (dx !== 0 || dy !== 0) {
      dragRef.current.lastX = e.screenX;
      dragRef.current.lastY = e.screenY;
      window.nightowl?.moveCapsuleBy(dx, dy);
    }
  };

  const handleCapsulePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (dragRef.current.moved) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
    }
    dragRef.current.moved = false;
  };

  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const cur = settings.capsuleScale ?? 1;
    resizeGripRef.current = {
      active: true,
      startX: e.screenX,
      startScale: cur,
      lastScale: cur,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!resizeGripRef.current.active) return;
    const dx = resizeGripRef.current.startX - e.screenX; // drag left = bigger, drag right = smaller
    const nextScale = Math.max(
      0.75,
      Math.min(1.6, Math.round((resizeGripRef.current.startScale + dx / 180) * 100) / 100)
    );
    resizeGripRef.current.lastScale = nextScale;
    setLiveScale(nextScale);
  };

  const handleResizePointerUp = (e: React.PointerEvent) => {
    if (!resizeGripRef.current.active) return;
    resizeGripRef.current.active = false;
    const finalScale = resizeGripRef.current.lastScale;
    setLiveScale(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    void window.nightowl?.updateSettings({ capsuleScale: finalScale }).then((next) => {
      if (next) setSettings(next);
    });
  };

  if (isDiagnostics) {
    return (
      <DiagnosticsModal
        awake={awake}
        sessions={sessions}
        settings={settings}
        onUpdateSettings={async (patch) => {
          const next = await window.nightowl?.updateSettings(patch);
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
        onFocusSession={(session) => {
          if (!session.hwnd) return;
          void window.nightowl?.focusSession(session.hwnd, session.projectName, session.id);
        }}
        onResetPosition={() => {
          window.nightowl?.resetCapsulePosition();
        }}
      />
    );
  }

  const cancelHoverGrace = () => {
    if (hoverGraceRef.current !== null) {
      window.clearTimeout(hoverGraceRef.current);
      hoverGraceRef.current = null;
    }
  };

  const scheduleClearHoverTargets = (delayMs = 90) => {
    cancelHoverGrace();
    hoverGraceRef.current = window.setTimeout(() => {
      hoverGraceRef.current = null;
      setHoveredControl(null);
      setHoveredSession(null);
      setHoveredOverflow(false);
    }, delayMs);
  };

  const scheduleClearTimerHover = () => scheduleClearHoverTargets(140);
  const scheduleClearOverflow = () => scheduleClearHoverTargets(140);

  const updateAnchorFromTarget = (el: HTMLElement | null) => {
    hoveredElRef.current = el;
    setAnchorVersion((v) => v + 1);
  };

  const visibleSessions = sessions.slice(0, MAX_VISIBLE_SESSIONS);
  const overflowSessions = sessions.slice(MAX_VISIBLE_SESSIONS);

  const showAgentsStrip = hovered && sessions.length > 0;
  const showAsleepActions = !awake.active && (hovered || timerOpen);
  const showExpandedAwakeExtras = awake.active && hovered && !timerOpen;
  const showTimerPopover =
    !menuOpen && !hoveredSession && !hoveredOverflow && (hoveredControl === "timer" || timerOpen);
  const isCapsuleExpanded = showAgentsStrip || showAsleepActions || showExpandedAwakeExtras;
  const showHintPill =
    !menuOpen && !hoveredSession && !hoveredOverflow && !showTimerPopover && Boolean(hoveredControl);

  useLayoutEffect(() => {
    const slot = floatingSlotRef.current;
    const floating = floatingRef.current;
    const target = hoveredElRef.current;
    if (!slot || !floating || !target || !target.isConnected) {
      setFloatingRight(undefined);
      return;
    }

    const measure = () => {
      const slotRect = slot.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const floatingWidth = floating.offsetWidth;
      const anchorFromSlotRight = slotRect.right - (targetRect.left + targetRect.width / 2);
      const maxRight = Math.max(0, slotRect.width - floatingWidth);
      const nextRight = Math.max(
        0,
        Math.min(maxRight, Math.round(anchorFromSlotRight - floatingWidth / 2))
      );
      const nextCaret = Math.max(
        14,
        Math.min(floatingWidth - 14, Math.round(floatingWidth - (anchorFromSlotRight - nextRight)))
      );
      setFloatingRight((prev) => (prev === nextRight ? prev : nextRight));
      setCaretOffset((prev) => (prev === nextCaret ? prev : nextCaret));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(slot);
    return () => ro.disconnect();
  }, [anchorVersion, hoveredSession, hoveredOverflow, showTimerPopover, showHintPill, hoveredControl, isCapsuleExpanded]);

  const floatingStyle =
    floatingRight !== undefined
      ? ({ marginRight: `${floatingRight}px`, "--caret-x": `${caretOffset}px` } as React.CSSProperties)
      : undefined;

  const cancelStageLeaveGrace = () => {
    if (stageLeaveGraceRef.current !== null) {
      window.clearTimeout(stageLeaveGraceRef.current);
      stageLeaveGraceRef.current = null;
    }
  };

  return (
    <div
      className="tray-stage"
      data-theme={settings.theme || "forest"}
      data-anim={settings.hoverAnimation || "slow"}
      style={{ "--capsule-scale": capsuleScale } as React.CSSProperties}
      ref={stageRef}
      onMouseEnter={() => {
        cancelHoverGrace();
        cancelStageLeaveGrace();
        setHovered(true);
      }}
      onMouseLeave={() => {
        cancelHoverGrace();
        cancelStageLeaveGrace();
        stageLeaveGraceRef.current = window.setTimeout(() => {
          stageLeaveGraceRef.current = null;
          setHovered(false);
          setHoveredSession(null);
          setHoveredOverflow(false);
          setHoveredControl(null);
        }, 120);
      }}
    >
      {/* OMP Session HUD-style Floating Preview Card */}
      {!menuOpen && hoveredSession && (
        <div className="floating-slot" ref={floatingSlotRef}>
          <div
            ref={floatingRef}
            className="agent-preview-card has-caret"
            role="status"
            style={floatingStyle}
          >
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
            <div className="agent-pc-foot">
              <span>{formatRelativeAge(hoveredSession.updatedAt, nowMs)}</span>
              <span>Click icon to focus</span>
            </div>
          </div>
        </div>
      )}

      {/* Overflow Sessions Card (+N) */}
      {!menuOpen && !hoveredSession && hoveredOverflow && overflowSessions.length > 0 && (
        <div className="floating-slot" ref={floatingSlotRef}>
          <div
            ref={floatingRef}
            className="agent-preview-card agent-overflow-card has-caret"
            role="dialog"
            aria-label="More active agent sessions"
            style={floatingStyle}
            onMouseEnter={() => {
              cancelHoverGrace();
              setHoveredOverflow(true);
            }}
            onMouseLeave={scheduleClearOverflow}
          >
            <div className="agent-pc-head">
              <span className="agent-pc-harness">+{overflowSessions.length} more sessions</span>
              <span className="agent-pc-source">{sessions.length} total</span>
            </div>
            <div className="overflow-list">
              {overflowSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="overflow-row"
                  onClick={() => void handleFocusAgent(s)}
                >
                  <HarnessIcon harness={s.harness} state={s.state} size={13} />
                  <span className="overflow-proj">{s.projectName}</span>
                  <span className={`agent-pc-state ${s.state === "thinking" ? "is-thinking" : ""}`}>
                    {s.state === "thinking" ? "Thinking" : "Ready"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating Timer Options Popover (on hover or click of Timer icon) */}
      {showTimerPopover && (
        <div className="floating-slot" ref={floatingSlotRef}>
          <div
            ref={floatingRef}
            className="capsule-hover-popover has-caret"
            role="dialog"
            aria-label="Timer presets and custom duration"
            style={floatingStyle}
            onMouseEnter={() => {
              cancelHoverGrace();
              setHoveredControl("timer");
            }}
            onMouseLeave={scheduleClearTimerHover}
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
                    void window.nightowl
                      ?.startAwake(preset.mins * 60_000)
                      .then((next) => next && setAwake(next));
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
        </div>
      )}

      {/* Floating Control Hint Pill (on hover of Owl, Quick Awake, Countdown, Screen, Stop) */}
      {showHintPill && (
        <div className="floating-slot" ref={floatingSlotRef}>
          <div
            ref={floatingRef}
            className="capsule-hover-hint has-caret"
            role="status"
            style={floatingStyle}
          >
            {hoveredControl === "owl" &&
              (awake.active ? "Click to allow sleep · Ctrl+Shift+O" : "Click to stay awake · Ctrl+Shift+O")}
            {hoveredControl === "countdown" &&
              (awake.autoAwakeActive && !awake.endsAt
                ? "Auto-awake · Agent is thinking"
                : "Click to add +30m")}
            {hoveredControl === "screen" &&
              (settings.keepDisplay ? "Screen: Stays lit" : "Screen: Turns off")}
            {hoveredControl === "stop" && "Hold 0.6s to stop"}
          </div>
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
          <div className="tray-theme-row" role="group" aria-label="Capsule size">
            {(
              [
                { label: "Small", scale: 0.88 },
                { label: "Normal", scale: 1.0 },
                { label: "Large", scale: 1.2 },
              ] as Array<{ label: string; scale: number }>
            ).map((sz) => (
              <button
                key={sz.label}
                type="button"
                className={`tray-theme-pill ${Math.abs(capsuleScale - sz.scale) < 0.06 ? "active" : ""}`}
                onClick={() => {
                  void window.nightowl?.updateSettings({ capsuleScale: sz.scale }).then((next) => {
                    if (next) setSettings(next);
                  });
                }}
              >
                {sz.label}
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
        className={`capsule ${awake.active ? "is-awake" : ""} ${
          awake.autoAwakeActive && !awake.endsAt ? "is-auto-awake" : ""
        } ${isCapsuleExpanded ? "is-expanded" : ""}`}
        onPointerDown={handleCapsulePointerDown}
        onPointerMove={handleCapsulePointerMove}
        onPointerUp={handleCapsulePointerUp}
        onPointerCancel={handleCapsulePointerUp}
        onClickCapture={(e) => {
          if (suppressNextClickRef.current) {
            e.stopPropagation();
            e.preventDefault();
            suppressNextClickRef.current = false;
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setTimerOpen(false);
          setMenuOpen((prev) => !prev);
        }}
      >
        <div
          className="capsule-resize-grip"
          title="Drag horizontally to resize"
          aria-hidden="true"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        />
        <div className="capsule-specular" aria-hidden="true" />

        {/* Overflow / Drag Chevron */}
        <button
          type="button"
          className="capsule-chevron"
          title="Options (or drag capsule to move)"
          aria-label="Nightowl options"
          onClick={() => {
            setTimerOpen(false);
            setMenuOpen((prev) => !prev);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 10l4-4 4 4" />
          </svg>
        </button>

        {(settings.capsuleOrder && settings.capsuleOrder.length === 3
          ? settings.capsuleOrder
          : (["agents", "owl", "time"] as CapsuleSection[])
        ).map((section) => {
          if (section === "agents") {
            if (sessions.length === 0) return null;
            return (
              <div key="agents" className={`agent-strip ${showAgentsStrip ? "open" : ""}`}>
                {visibleSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={`agent-btn agent-${session.harness} ${session.state === "thinking" ? "is-thinking" : ""} ${session.hwnd ? "" : "no-hwnd"}`}
                    onClick={() => void handleFocusAgent(session)}
                    onMouseEnter={(e) => {
                      cancelHoverGrace();
                      updateAnchorFromTarget(e.currentTarget);
                      setHoveredControl(null);
                      setHoveredOverflow(false);
                      setHoveredSession(session);
                    }}
                    onMouseLeave={() => scheduleClearHoverTargets()}
                    aria-label={`${harnessDisplayName(session.harness)}: ${session.projectName}`}
                  >
                    <HarnessIcon harness={session.harness} state={session.state} size={12} />
                  </button>
                ))}
                {overflowSessions.length > 0 && (
                  <button
                    type="button"
                    className="agent-overflow-pill"
                    onMouseEnter={(e) => {
                      cancelHoverGrace();
                      updateAnchorFromTarget(e.currentTarget);
                      setHoveredControl(null);
                      setHoveredSession(null);
                      setHoveredOverflow(true);
                    }}
                    onMouseLeave={scheduleClearOverflow}
                    aria-label={`${overflowSessions.length} more active agent sessions`}
                  >
                    +{overflowSessions.length}
                  </button>
                )}
              </div>
            );
          }

          if (section === "owl") {
            return (
              <div key="owl" className="capsule-owl-group">
                {!awake.active ? (
                  <div className={`capsule-collapsible ${showAsleepActions ? "open" : ""}`}>
                    <button
                      type="button"
                      className={`capsule-icon-action ${timerOpen ? "is-active" : ""}`}
                      aria-label="Timer options"
                      onMouseEnter={(e) => {
                        cancelHoverGrace();
                        updateAnchorFromTarget(e.currentTarget);
                        setHoveredSession(null);
                        setHoveredOverflow(false);
                        setHoveredControl("timer");
                      }}
                      onMouseLeave={scheduleClearTimerHover}
                      onClick={(e) => {
                        cancelHoverGrace();
                        updateAnchorFromTarget(e.currentTarget);
                        handleToggleTimer();
                      }}
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
                  </div>
                ) : (
                  <div className={`capsule-collapsible ${showExpandedAwakeExtras ? "open" : ""}`}>
                    <button
                      type="button"
                      className={`capsule-icon-btn ${settings.keepDisplay ? "is-on" : ""}`}
                      aria-label={settings.keepDisplay ? "Screen stays lit" : "Screen turns off"}
                      onMouseEnter={(e) => {
                        cancelHoverGrace();
                        updateAnchorFromTarget(e.currentTarget);
                        setHoveredSession(null);
                        setHoveredOverflow(false);
                        setHoveredControl("screen");
                      }}
                      onMouseLeave={() => scheduleClearHoverTargets()}
                      onClick={() => {
                        void window.nightowl
                          ?.updateSettings({ keepDisplay: !settings.keepDisplay })
                          .then((next) => {
                            if (next) setSettings(next);
                          });
                      }}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <rect
                          x="2"
                          y="3"
                          width="12"
                          height="8.5"
                          rx="1.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.35"
                        />
                        <path
                          d="M5.5 13.5h5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.35"
                          strokeLinecap="round"
                        />
                        {settings.keepDisplay && <circle cx="8" cy="7.2" r="1.4" fill="currentColor" />}
                      </svg>
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="owl-ring-btn"
                  onMouseEnter={(e) => {
                    cancelHoverGrace();
                    updateAnchorFromTarget(e.currentTarget);
                    setHoveredSession(null);
                    setHoveredOverflow(false);
                    setHoveredControl("owl");
                  }}
                  onMouseLeave={() => scheduleClearHoverTargets()}
                  onClick={() => void handleToggleQuickAwake()}
                  aria-label={awake.active ? "Allow sleep" : "Keep PC awake"}
                >
                  <OwlIcon awake={awake.active} size={18} theme={settings.theme} />
                </button>
              </div>
            );
          }

          // section === "time"
          const showClock = settings.showClock !== false;
          if (!awake.active && !showClock) return null;
          return (
            <div key="time" className="capsule-time-group">
              {awake.active && (
                <div className="awake-controls">
                  <button
                    type="button"
                    className={`countdown-btn ${awake.autoAwakeActive && !awake.endsAt ? "is-auto" : ""}`}
                    aria-label="Remaining awake time, click to add 30 minutes"
                    onMouseEnter={(e) => {
                      cancelHoverGrace();
                      updateAnchorFromTarget(e.currentTarget);
                      setHoveredSession(null);
                      setHoveredOverflow(false);
                      setHoveredControl("countdown");
                    }}
                    onMouseLeave={() => scheduleClearHoverTargets()}
                    onClick={handleAddTime}
                  >
                    {awake.autoAwakeActive && !awake.endsAt ? (
                      <>
                        <span className="auto-dot" aria-hidden="true" />
                        <span>Auto</span>
                      </>
                    ) : (
                      <span>{awake.endsAt ? formatCountdown(liveRemainingMs) : "Awake"}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="hold-end-btn"
                    style={
                      {
                        "--hold-deg": `${Math.round(holdProgress * 360)}deg`,
                      } as React.CSSProperties
                    }
                    onMouseEnter={(e) => {
                      cancelHoverGrace();
                      updateAnchorFromTarget(e.currentTarget);
                      setHoveredSession(null);
                      setHoveredOverflow(false);
                      setHoveredControl("stop");
                    }}
                    onMouseLeave={() => scheduleClearHoverTargets()}
                    onPointerDown={startHoldToEnd}
                    onPointerUp={cancelHold}
                    onPointerLeave={cancelHold}
                    onPointerCancel={cancelHold}
                    aria-label="Hold to end awake session"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M5 5l6 6M11 5l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              )}

              {showClock && (
                <>
                  <span className="capsule-divider" aria-hidden="true" />
                  <span className="capsule-clock">{clock}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
