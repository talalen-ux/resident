/**
 * Whether the journal survives a redeploy.
 *
 * These assertions are about a configuration mistake, not a bug: every one of
 * them describes a container that starts cleanly, runs correctly, and loses the
 * record of what the desk owns the next time it is deployed.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { checkJournalVolume, volumeFailure } from "../src/lib/keeper/volume.ts";

/** A fake filesystem: path to device id. Absent means the path does not exist. */
const fs = (entries) => (path) => (path in entries ? entries[path] : null);

test("a mounted volume is durable", () => {
  const verdict = checkJournalVolume(
    "/data/keeper.ndjson",
    fs({ "/": 1, "/data": 2 }),
  );
  assert.equal(verdict.durable, true);
  assert.equal(verdict.mountPoint, "/data");
});

test("a directory baked into the image is not durable, however real it looks", () => {
  // This is the failure mode the check exists for: /data is present, writable,
  // and the keeper runs perfectly. It is simply part of the image.
  const verdict = checkJournalVolume(
    "/data/keeper.ndjson",
    fs({ "/": 1, "/data": 1 }),
  );
  assert.equal(verdict.durable, false);
  assert.match(verdict.reason, /part of the image/);
});

test("a missing mount point walks up and is reported against the root", () => {
  const verdict = checkJournalVolume("/data/keeper.ndjson", fs({ "/": 1 }));
  assert.equal(verdict.durable, false);
  assert.equal(verdict.mountPoint, "/");
  assert.match(verdict.reason, /root filesystem/);
});

test("a volume mounted deeper than the journal's own directory still counts", () => {
  const verdict = checkJournalVolume(
    "/data/journals/keeper.ndjson",
    fs({ "/": 1, "/data": 2, "/data/journals": 2 }),
  );
  assert.equal(verdict.durable, true);
  // The mount is at /data; /data/journals is a directory inside it and shares
  // its device, so the walk must not stop at the first directory it finds.
  assert.equal(verdict.mountPoint, "/data");
});

test("a relative path is resolved before anything is asked of it", () => {
  const asked = [];
  checkJournalVolume(".keeper/dry-run.ndjson", (path) => {
    asked.push(path);
    return null;
  });
  assert.ok(
    asked.every((p) => p.startsWith("/")),
    `every probe should be absolute, got ${asked.join(", ")}`,
  );
});

test("the failure message names the path, the cause and the fix", () => {
  const verdict = checkJournalVolume(
    "/data/keeper.ndjson",
    fs({ "/": 1, "/data": 1 }),
  );
  const message = volumeFailure("/data/keeper.ndjson", verdict);
  assert.match(message, /\/data\/keeper\.ndjson/);
  assert.match(message, /part of the image/);
  assert.match(message, /Add Volume/);
  // An operator who meant it must be told how to proceed, or they will reach
  // for something worse than the variable.
  assert.match(message, /RESIDENT_REQUIRE_VOLUME/);
});
