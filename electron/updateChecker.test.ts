import { describe, expect, it } from "vitest";
import { checkForUpdates, compareSemver, isAllowedExternalUrl } from "./updateChecker";

describe("updateChecker", () => {
  it("compares semantic versions accurately with or without v prefix", () => {
    expect(compareSemver("0.2.0", "0.2.1")).toBe(-1);
    expect(compareSemver("v0.2.0", "0.2.0")).toBe(0);
    expect(compareSemver("0.10.0", "0.2.9")).toBe(1);
    expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
    expect(compareSemver("0.2.0-beta.1", "0.2.0")).toBe(-1);
  });

  it("reports update-available when GitHub latest release is newer", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.3.0",
          html_url: "https://github.com/r-bug-r/nightowl/releases/tag/v0.3.0",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const res = await checkForUpdates("0.2.0", mockFetch);
    expect(res.status).toBe("update-available");
    expect(res.latestVersion).toBe("0.3.0");
    expect(res.releaseUrl).toBe("https://github.com/r-bug-r/nightowl/releases/tag/v0.3.0");
  });

  it("reports up-to-date when current matches or exceeds latest release", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.2.0",
          html_url: "https://github.com/r-bug-r/nightowl/releases/tag/v0.2.0",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const res = await checkForUpdates("0.2.0", mockFetch);
    expect(res.status).toBe("up-to-date");
    expect(res.latestVersion).toBe("0.2.0");
  });

  it("rejects untrusted release URLs and returns safe fallback URL", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.4.0",
          html_url: "https://evil.example.com/payload.exe",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const res = await checkForUpdates("0.2.0", mockFetch);
    expect(res.status).toBe("update-available");
    expect(res.releaseUrl).toBe("https://github.com/r-bug-r/nightowl/releases");
  });

  it("returns error gracefully on non-200 responses", async () => {
    const mockFetch = async () => new Response("Not Found", { status: 404 });
    const res = await checkForUpdates("0.2.0", mockFetch);
    expect(res.status).toBe("error");
    expect(res.error).toContain("404");
  });

  it("restricts external URLs to official Nightowl GitHub and site hosts", () => {
    expect(isAllowedExternalUrl("https://github.com/r-bug-r/nightowl/releases")).toBe(true);
    expect(isAllowedExternalUrl("https://nightowl.sheif.org/docs/index.html")).toBe(true);
    expect(isAllowedExternalUrl("https://evil.example.com")).toBe(false);
    expect(isAllowedExternalUrl("file:///C:/Windows/System32/cmd.exe")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
  });
});
