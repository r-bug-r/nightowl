import type { CapsuleSection, HoverAnimationSpeed, NightowlSettings, ThemePreset } from "./types";

const VALID_THEMES: readonly ThemePreset[] = ["forest", "minimal-dark", "minimal-light"];
const VALID_ANIMATIONS: readonly HoverAnimationSpeed[] = ["slow", "normal", "fast"];
const VALID_SECTIONS: readonly CapsuleSection[] = ["agents", "owl", "time"];

export const DEFAULT_SETTINGS: NightowlSettings = {
  batteryThreshold: 10,
  batterySafeStop: true,
  keepDisplay: false,
  keepAwakeWithLidClosed: false,
  keepAwakeOnLaunch: false,
  openAtLogin: false,
  autoAwakeForAgents: false,
  theme: "forest",
  capsuleScale: 1,
  capsuleOrder: ["agents", "owl", "time"],
  hoverAnimation: "slow",
  clockFormat24h: false,
  showClock: true,
};

export function sanitizeSettingsPatch(patch: Partial<NightowlSettings>): Partial<NightowlSettings> {
  const clean: Partial<NightowlSettings> = {};

  if (typeof patch.batterySafeStop === "boolean") {
    clean.batterySafeStop = patch.batterySafeStop;
  }
  if (typeof patch.batteryThreshold === "number" && Number.isFinite(patch.batteryThreshold)) {
    clean.batteryThreshold = Math.max(5, Math.min(50, Math.round(patch.batteryThreshold)));
  }
  if (typeof patch.keepDisplay === "boolean") {
    clean.keepDisplay = patch.keepDisplay;
  }
  if (typeof patch.keepAwakeWithLidClosed === "boolean") {
    clean.keepAwakeWithLidClosed = patch.keepAwakeWithLidClosed;
  }
  if (typeof patch.keepAwakeOnLaunch === "boolean") {
    clean.keepAwakeOnLaunch = patch.keepAwakeOnLaunch;
  }
  if (typeof patch.openAtLogin === "boolean") {
    clean.openAtLogin = patch.openAtLogin;
  }
  if (typeof patch.autoAwakeForAgents === "boolean") {
    clean.autoAwakeForAgents = patch.autoAwakeForAgents;
  }
  if (typeof patch.theme === "string" && VALID_THEMES.includes(patch.theme as ThemePreset)) {
    clean.theme = patch.theme as ThemePreset;
  }
  if (typeof patch.capsuleScale === "number" && Number.isFinite(patch.capsuleScale)) {
    clean.capsuleScale = Math.max(0.75, Math.min(1.6, Math.round(patch.capsuleScale * 100) / 100));
  }
  if (Array.isArray(patch.capsuleOrder)) {
    const filtered = patch.capsuleOrder.filter((s): s is CapsuleSection =>
      VALID_SECTIONS.includes(s as CapsuleSection)
    );
    const unique = Array.from(new Set(filtered));
    if (unique.length === 3) {
      clean.capsuleOrder = unique;
    }
  }
  if (
    typeof patch.hoverAnimation === "string" &&
    VALID_ANIMATIONS.includes(patch.hoverAnimation as HoverAnimationSpeed)
  ) {
    clean.hoverAnimation = patch.hoverAnimation as HoverAnimationSpeed;
  }
  if (typeof patch.clockFormat24h === "boolean") {
    clean.clockFormat24h = patch.clockFormat24h;
  }
  if (typeof patch.showClock === "boolean") {
    clean.showClock = patch.showClock;
  }

  return clean;
}
