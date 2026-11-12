import fs from "node:fs/promises";
import path from "node:path";

export interface SessionJournalRecord {
  active: boolean;
  startedAt: number;
  endsAt: number | null;
  keepDisplay: boolean;
  cleanExit: boolean;
  updatedAt: number;
}

export interface RecoveryCheckResult {
  recoveredFromCrash: boolean;
  previousRecord: SessionJournalRecord | null;
}

export class SessionJournal {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async reconcileOnStartup(): Promise<RecoveryCheckResult> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SessionJournalRecord;
      const recoveredFromCrash = Boolean(parsed && parsed.active && !parsed.cleanExit);

      await this.clear(true);
      return {
        recoveredFromCrash,
        previousRecord: parsed,
      };
    } catch {
      return {
        recoveredFromCrash: false,
        previousRecord: null,
      };
    }
  }

  async writeActive(endsAt: number | null, keepDisplay: boolean): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const now = Date.now();
    const record: SessionJournalRecord = {
      active: true,
      startedAt: now,
      endsAt,
      keepDisplay,
      cleanExit: false,
      updatedAt: now,
    };
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(record, null, 2), "utf8");
    await fs.rename(tmpPath, this.filePath);
  }

  async clear(cleanExit = true): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      const record: SessionJournalRecord = {
        active: false,
        startedAt: 0,
        endsAt: null,
        keepDisplay: false,
        cleanExit,
        updatedAt: Date.now(),
      };
      const tmpPath = `${this.filePath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(record, null, 2), "utf8");
      await fs.rename(tmpPath, this.filePath);
    } catch {
      // ignore cleanup failures
    }
  }
}
