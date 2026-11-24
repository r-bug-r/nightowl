import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettingsPatch } from "./settings";

describe("Nightowl settings defaults & sanitization", () => {
  it("uses safe public release defaults (lid-close opt-in, login off, battery cutoff 10%)", () => {
    expect(DEFAULT_SETTINGS.keepAwakeWithLidClosed).toBe(false);
    expect(DEFAULT_SETTINGS.openAtLogin).toBe(false);
    expect(DEFAULT_SETTINGS.batterySafeStop).toBe(true);
    expect(DEFAULT_SETTINGS.batteryThreshold).toBe(10);
    expect(DEFAULT_SETTINGS.keepDisplay).toBe(false);
  });

  it("clamps numeric settings and rejects invalid enum/order values", () => {
    const clean = sanitizeSettingsPatch({
      capsuleScale: 99,
      batteryThreshold: 2,
      theme: "neon-invalid" as unknown as "forest",
      hoverAnimation: "warp" as unknown as "slow",
      capsuleOrder: ["owl", "owl"] as unknown as ["agents", "owl", "time"],
      openAtLogin: true,
    });

    expect(clean.capsuleScale).toBe(1.6);
    expect(clean.batteryThreshold).toBe(5);
    expect(clean.theme).toBeUndefined();
    expect(clean.hoverAnimation).toBeUndefined();
    expect(clean.capsuleOrder).toBeUndefined();
    expect(clean.openAtLogin).toBe(true);
  });

  it("accepts valid custom capsule orders and themes", () => {
    const clean = sanitizeSettingsPatch({
      capsuleScale: 0.72,
      batteryThreshold: 80,
      theme: "minimal-light",
      hoverAnimation: "fast",
      capsuleOrder: ["time", "owl", "agents"],
    });

    expect(clean.capsuleScale).toBe(0.75);
    expect(clean.batteryThreshold).toBe(50);
    expect(clean.theme).toBe("minimal-light");
    expect(clean.hoverAnimation).toBe("fast");
    expect(clean.capsuleOrder).toEqual(["time", "owl", "agents"]);
  });
});
