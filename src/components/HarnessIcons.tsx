import React from "react";
import type { AgentHarness, AgentSessionState } from "../types";

interface HarnessIconProps {
  harness: AgentHarness;
  state: AgentSessionState;
  size?: number;
}

export const HarnessIcon: React.FC<HarnessIconProps> = ({
  harness,
  state,
  size = 18,
}) => {
  const isThinking = state === "thinking";

  if (harness === "claude") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={`harness-svg harness-claude ${isThinking ? "is-thinking" : "is-idle"}`}
        aria-hidden="true"
      >
        {/* Claude Code starburst mark */}
        <g className="claude-burst" transform-origin="12 12">
          <line x1="12" y1="2.8" x2="12" y2="21.2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
          <line x1="2.8" y1="12" x2="21.2" y2="12" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
          <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <circle cx="12" cy="12" r="2.6" fill="#050d0a" stroke="currentColor" strokeWidth="1.5" />
        </g>
      </svg>
    );
  }

  if (harness === "codex") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={`harness-svg harness-codex ${isThinking ? "is-thinking" : "is-idle"}`}
        aria-hidden="true"
      >
        {/* Codex geometric hex-knot mark */}
        <g className="codex-knot">
          <polygon
            points="12,2.8 19.8,7.3 19.8,16.7 12,21.2 4.2,16.7 4.2,7.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M12 6.2 L16.8 9 L16.8 15 L12 17.8 L7.2 15 L7.2 9 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
            opacity="0.85"
          />
          <circle cx="12" cy="12" r="2.1" fill="currentColor" />
        </g>
      </svg>
    );
  }

  // Antigravity mark (shared for agy CLI and Antigravity 2.0 app)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`harness-svg harness-agy ${isThinking ? "is-thinking" : "is-idle"}`}
      aria-hidden="true"
    >
      <g className="agy-orbit">
        <ellipse
          cx="12"
          cy="12"
          rx="9"
          ry="4.2"
          transform="rotate(-28 12 12)"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          opacity="0.8"
        />
        <circle cx="18.6" cy="8.5" r="1.5" fill="currentColor" className="agy-moon" />
      </g>
      <path
        d="M12 5.2 L16.2 16.8 L12 14.4 L7.8 16.8 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        className="agy-delta"
      />
    </svg>
  );
};

export function harnessDisplayName(harness: AgentHarness): string {
  switch (harness) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "antigravity":
      return "Antigravity";
  }
}
