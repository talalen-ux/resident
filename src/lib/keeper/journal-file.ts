/**
 * The journal on disk, one JSON object per line.
 *
 * Append-only and never rewritten, so a crash can truncate the last line but
 * cannot corrupt an earlier one. {@link FileJournal.read} drops a trailing
 * partial line rather than failing to start: the record that was being written
 * when the process died is exactly the record the keeper must treat as never
 * having happened.
 *
 * Kept in its own module because it is the only part of the keeper that touches
 * a filesystem, and the rest is imported by code that must not.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { JournalRecord } from "./types.ts";
import type { Journal } from "./registry.ts";

export class FileJournal implements Journal {
  readonly path: string;
  private ready: Promise<void> | null = null;

  constructor(path: string) {
    this.path = path;
  }

  private ensureDir(): Promise<void> {
    this.ready ??= mkdir(dirname(this.path), { recursive: true }).then(
      () => undefined,
    );
    return this.ready;
  }

  async append(record: JournalRecord): Promise<void> {
    await this.ensureDir();
    await appendFile(this.path, JSON.stringify(record) + "\n", "utf8");
  }

  async read(): Promise<JournalRecord[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const lines = text.split("\n");
    const records: JournalRecord[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        records.push(JSON.parse(line) as JournalRecord);
      } catch {
        // Only the final line may be half-written. A parse failure anywhere
        // else means the file was edited or corrupted, and replaying past it
        // would produce a state that is wrong rather than merely incomplete.
        if (i === lines.length - 1) break;
        throw new Error(
          `${this.path}: line ${i + 1} is not valid JSON. The journal is the ` +
            "record of what the keeper owns; refusing to replay past it.",
        );
      }
    }
    return records;
  }
}
