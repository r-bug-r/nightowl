import React, { useEffect, useId, useState } from "react";
import type { ThemePreset } from "../types";

interface OwlIconProps {
  awake: boolean;
  size?: number;
  theme?: ThemePreset;
}

export const OwlIcon: React.FC<OwlIconProps> = ({ awake, size = 24, theme = "forest" }) => {
  const clipId = useId().replace(/:/g, "");
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (!awake) {
      setBlinking(false);
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      setBlinking(true);
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => setBlinking(false), 160);
    }, 4400);
    return () => {
      clearInterval(interval);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [awake]);

  const isLight = theme === "minimal-light";
  const strokeColor = isLight ? "#0f1a15" : "#f7fcf9";
  const bodyFill = isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(7, 17, 13, 0.72)";
  const socketFill = isLight ? "#e6ede9" : "#040907";
  const irisColor = isLight ? "#d97706" : "#fbbf24";

  // Reference image shows calm half-lidded golden eyes at rest, wide alert eyes when awake
  const open = awake ? (blinking ? 0.14 : 1) : 0.42;
  const ry = Math.max(0.2, 3.4 * open);
  const pupilR = Math.max(0.25, 1.85 * open);
  const shineOpacity = awake ? Math.max(0, (open - 0.25) / 0.75) : 0.35;
  const lidOpacity = awake ? Math.max(0, (0.35 - open) / 0.35) : 0.85;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="owl-svg"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`${clipId}-l`}>
          <ellipse cx="8" cy="11.8" rx="3.45" ry={ry} />
        </clipPath>
        <clipPath id={`${clipId}-r`}>
          <ellipse cx="16" cy="11.8" rx="3.45" ry={ry} />
        </clipPath>
      </defs>

      <path
        d="M3.6 6.4 L7.2 8.7 L12 10.1 L16.8 8.7 L20.4 6.4 C21.4 10.6 20.9 16.2 18 19.6 C15.5 21 8.5 21 6 19.6 C3.1 16.2 2.6 10.6 3.6 6.4 Z"
        fill={bodyFill}
        stroke={strokeColor}
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx="8" cy="11.6" r="3.65" fill={socketFill} stroke={strokeColor} strokeWidth="0.9" />
      <circle cx="16" cy="11.6" r="3.65" fill={socketFill} stroke={strokeColor} strokeWidth="0.9" />

      <g clipPath={`url(#${clipId}-l)`}>
        <circle cx="8" cy="11.8" r="3.4" fill={irisColor} />
        <circle cx="8" cy="11.8" r={pupilR} fill="#050d0a" />
        <circle cx="7.1" cy="10.8" r="0.72" fill="#ffffff" style={{ opacity: shineOpacity }} />
      </g>
      <g clipPath={`url(#${clipId}-r)`}>
        <circle cx="16" cy="11.8" r="3.4" fill={irisColor} />
        <circle cx="16" cy="11.8" r={pupilR} fill="#050d0a" />
        <circle cx="15.1" cy="10.8" r="0.72" fill="#ffffff" style={{ opacity: shineOpacity }} />
      </g>

      {/* Half-lidded / resting upper eyelid sweep */}
      <path
        d="M4.6 10.4 Q8 11.4 11.4 10.4"
        fill="none"
        stroke={irisColor}
        strokeWidth="1.25"
        strokeLinecap="round"
        style={{ opacity: lidOpacity }}
      />
      <path
        d="M12.6 10.4 Q16 11.4 19.4 10.4"
        fill="none"
        stroke={irisColor}
        strokeWidth="1.25"
        strokeLinecap="round"
        style={{ opacity: lidOpacity }}
      />

      <polygon
        points="11,12.9 12,16.1 13,12.9"
        fill="#f59e0b"
        stroke="#d97706"
        strokeWidth="0.45"
      />
    </svg>
  );
};
