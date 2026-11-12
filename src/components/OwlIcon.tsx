import React, { useEffect, useId, useState } from "react";

interface OwlIconProps {
  awake: boolean;
  size?: number;
}

export const OwlIcon: React.FC<OwlIconProps> = ({ awake, size = 22 }) => {
  const clipId = useId().replace(/:/g, "");
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (!awake) {
      setBlinking(false);
      return;
    }
    const interval = setInterval(() => {
      setBlinking(true);
      const t = setTimeout(() => setBlinking(false), 160);
      return () => clearTimeout(t);
    }, 4400);
    return () => clearInterval(interval);
  }, [awake]);

  const open = awake ? (blinking ? 0.12 : 1) : 0.08;
  const ry = Math.max(0.1, 3.5 * open);
  const pupilR = Math.max(0.2, 2.0 * open);
  const shineOpacity = Math.max(0, (open - 0.25) / 0.75);
  const sleepOpacity = Math.max(0, (0.35 - open) / 0.35);

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
          <ellipse cx="8" cy="11.5" rx="3.5" ry={ry} />
        </clipPath>
        <clipPath id={`${clipId}-r`}>
          <ellipse cx="16" cy="11.5" rx="3.5" ry={ry} />
        </clipPath>
      </defs>

      <path
        d="M3.5 6.5 L7 8.8 L12 10.2 L17 8.8 L20.5 6.5 C21.5 10.5 21 16 18 19.5 C15.5 21 8.5 21 6 19.5 C3 16 2.5 10.5 3.5 6.5 Z"
        fill="rgba(10, 24, 18, 0.55)"
        stroke="#eefbf4"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 6.5 L7 8.8 L12 10.2 L17 8.8 L20.5 6.5"
        fill="none"
        stroke="#eefbf4"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx="8" cy="11.5" r="3.7" fill="#030806" stroke="#eefbf4" strokeWidth="0.8" />
      <circle cx="16" cy="11.5" r="3.7" fill="#030806" stroke="#eefbf4" strokeWidth="0.8" />

      <g clipPath={`url(#${clipId}-l)`}>
        <circle cx="8" cy="11.5" r="3.5" fill="#fbbf24" />
        <circle cx="8" cy="11.5" r={pupilR} fill="#050d0a" />
        <circle cx="7.1" cy="10.4" r="0.8" fill="#ffffff" style={{ opacity: shineOpacity }} />
      </g>
      <g clipPath={`url(#${clipId}-r)`}>
        <circle cx="16" cy="11.5" r="3.5" fill="#fbbf24" />
        <circle cx="16" cy="11.5" r={pupilR} fill="#050d0a" />
        <circle cx="15.1" cy="10.4" r="0.8" fill="#ffffff" style={{ opacity: shineOpacity }} />
      </g>

      <path
        d="M4.8 11.8 Q8 14.0 11.2 11.8"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="1.35"
        strokeLinecap="round"
        style={{ opacity: sleepOpacity }}
      />
      <path
        d="M12.8 11.8 Q16 14.0 19.2 11.8"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="1.35"
        strokeLinecap="round"
        style={{ opacity: sleepOpacity }}
      />

      <polygon
        points="11,12.8 12,15.6 13,12.8"
        fill="#f59e0b"
        stroke="#d97706"
        strokeWidth="0.45"
      />
    </svg>
  );
};
