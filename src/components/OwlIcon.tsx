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
  const strokeColor = isLight ? "#0f1a15" : "#f0fdf4";
  const bodyFill = isLight ? "#ffffff" : "#0b1914";
  const chestFill = isLight ? "rgba(15, 26, 21, 0.08)" : "rgba(167, 243, 208, 0.08)";
  const socketFill = isLight ? "#e6ede9" : "#040907";
  const irisColor = isLight ? "#d97706" : "#fbbf24";
  const browColor = awake ? irisColor : strokeColor;

  // Calm crescent eyes at rest, bright alert golden eyes with blink when awake
  const open = awake ? (blinking ? 0.12 : 1) : 0.36;
  const ry = Math.max(0.25, 3.2 * open);
  const pupilR = Math.max(0.3, 1.75 * open);
  const shineOpacity = awake ? Math.max(0, (open - 0.25) / 0.75) : 0.28;
  const lidOpacity = awake ? Math.max(0, (0.35 - open) / 0.35) : 0.9;

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
          <ellipse cx="8.2" cy="12" rx="3.2" ry={ry} />
        </clipPath>
        <clipPath id={`${clipId}-r`}>
          <ellipse cx="15.8" cy="12" rx="3.2" ry={ry} />
        </clipPath>
      </defs>

      {/* Owl silhouette with crisp ear tufts & rounded body */}
      <path
        d="M4.2 5.2 L7.8 7.8 Q12 6.8 16.2 7.8 L19.8 5.2 C21.2 9.4 20.8 15.8 17.8 19.3 C15.4 21.1 8.6 21.1 6.2 19.3 C3.2 15.8 2.8 9.4 4.2 5.2 Z"
        fill={bodyFill}
        stroke={strokeColor}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Subtle feathered chest arc */}
      <path
        d="M8.5 17.6 Q12 19.6 15.5 17.6"
        fill={chestFill}
        stroke={strokeColor}
        strokeWidth="0.75"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* Expressive brow V-ridge */}
      <path
        d="M5.4 8.2 L12 10.6 L18.6 8.2"
        fill="none"
        stroke={browColor}
        strokeWidth="1.05"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={awake ? 0.9 : 0.55}
      />

      {/* Eye sockets */}
      <circle cx="8.2" cy="12" r="3.45" fill={socketFill} stroke={strokeColor} strokeWidth="0.9" />
      <circle cx="15.8" cy="12" r="3.45" fill={socketFill} stroke={strokeColor} strokeWidth="0.9" />

      {/* Iris, pupil, and twin catchlights */}
      <g clipPath={`url(#${clipId}-l)`}>
        <circle cx="8.2" cy="12" r="3.2" fill={irisColor} />
        <circle cx="8.2" cy="12" r={pupilR} fill="#050d0a" />
        <circle cx="7.3" cy="10.9" r="0.72" fill="#ffffff" style={{ opacity: shineOpacity }} />
        <circle cx="9.1" cy="12.7" r="0.34" fill="#ffffff" style={{ opacity: shineOpacity * 0.7 }} />
      </g>
      <g clipPath={`url(#${clipId}-r)`}>
        <circle cx="15.8" cy="12" r="3.2" fill={irisColor} />
        <circle cx="15.8" cy="12" r={pupilR} fill="#050d0a" />
        <circle cx="14.9" cy="10.9" r="0.72" fill="#ffffff" style={{ opacity: shineOpacity }} />
        <circle cx="16.7" cy="12.7" r="0.34" fill="#ffffff" style={{ opacity: shineOpacity * 0.7 }} />
      </g>

      {/* Resting / blinking upper eyelid sweep */}
      <path
        d="M5.1 10.9 Q8.2 12.1 11.3 10.9"
        fill="none"
        stroke={irisColor}
        strokeWidth="1.25"
        strokeLinecap="round"
        style={{ opacity: lidOpacity }}
      />
      <path
        d="M12.7 10.9 Q15.8 12.1 18.9 10.9"
        fill="none"
        stroke={irisColor}
        strokeWidth="1.25"
        strokeLinecap="round"
        style={{ opacity: lidOpacity }}
      />

      {/* Crisp diamond beak */}
      <polygon
        points="12,12.7 13.1,14.2 12,16.4 10.9,14.2"
        fill="#f59e0b"
        stroke="#d97706"
        strokeWidth="0.45"
        strokeLinejoin="round"
      />
    </svg>
  );
};
