import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionJournal } from "./sessionJournal";

describe("SessionJournal", () => {
  let tmpDir: string;
  let journalPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightowl-journal-"));
    journalPath = path.join(tmpDir, "session.json");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reports clean startup when no journal exists", async () => {
    const journal = new SessionJournal(journalPath);
    const res = await journal.reconcileOnStartup();
    expect(res.recoveredFromCrash).toBe(false);
    expect(res.previousRecord).toBeNull();
  });

  it("detects uncleaned active session on startup and clears it", async () => {
    const journal = new SessionJournal(journalPath);
    await journal.writeActive(Date.now() + 60_000, false);

    const res = await journal.reconcileOnStartup();
    expect(res.recoveredFromCrash).toBe(true);

    const secondPass = await journal.reconcileOnStartup();
    expect(secondPass.recoveredFromCrash).toBe(false);
  });

  it("reports clean startup after explicit clear()", async () => {
    const journal = new SessionJournal(journalPath);
    await journal.writeActive(Date.now() + 60_000, false);
    await journal.clear(true);

    const res = await journal.reconcileOnStartup();
    expect(res.recoveredFromCrash).toBe(false);
  });
});
