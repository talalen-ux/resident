/**
 * Is the journal somewhere that survives a redeploy?
 *
 * The journal is the record of what the desk owns. A keeper that restarts
 * without it believes it holds nothing, and opens a position it already has.
 * That is the worst failure in this system that does not involve a stolen key,
 * and it is caused by a configuration mistake rather than by any bug.
 *
 * The Dockerfile used to state the requirement with a VOLUME directive. Railway
 * rejects the whole Dockerfile if one is present ("docker VOLUME is not
 * supported, use Railway Volumes"), and in any case a VOLUME directive only
 * ever declared an anonymous volume that a platform was free to ignore. It
 * documented an intention and enforced nothing.
 *
 * This checks the thing itself: a real volume is a different filesystem from
 * the image it is mounted into, so its device id differs from its parent's.
 */

import { dirname, resolve } from "node:path";

export type VolumeVerdict = {
  durable: boolean;
  /** The directory the verdict is about. */
  mountPoint: string;
  reason: string;
};

/**
 * Device id of a path, or null when it does not exist.
 *
 * Injected rather than imported so this can be tested without a real mount,
 * which is not something a test suite can arrange.
 */
export type DeviceOf = (path: string) => number | null;

/**
 * Walk up to the nearest directory that exists, then ask whether it is a mount.
 *
 * The journal file itself will not exist on a first run, and neither will its
 * directory unless something created it, so the question has to be asked of an
 * ancestor.
 */
export function checkJournalVolume(
  journalPath: string,
  deviceOf: DeviceOf,
): VolumeVerdict {
  let dir = dirname(resolve(journalPath));
  let device = deviceOf(dir);
  while (device === null && dir !== dirname(dir)) {
    dir = dirname(dir);
    device = deviceOf(dir);
  }

  if (device === null) {
    return {
      durable: false,
      mountPoint: dir,
      reason: `nothing on the path to ${journalPath} exists`,
    };
  }

  // Keep where the journal actually lives. The walk below ends at the root
  // whenever there is no mount, and reporting the root would tell an operator
  // nothing about the directory they configured.
  const journalDir = dir;

  // Walk the whole chain to the root, not just one step. A volume mounted at
  // /data holds a journal at /data/journals/keeper.ndjson just as durably, and
  // stopping at the first directory would call that ephemeral.
  while (dir !== dirname(dir)) {
    const parent = dirname(dir);
    const parentDevice = deviceOf(parent);
    if (parentDevice !== null && parentDevice !== device) {
      return {
        durable: true,
        mountPoint: dir,
        reason: `${dir} is a separate filesystem, so it outlives the container`,
      };
    }
    dir = parent;
    device = parentDevice ?? device;
  }

  return {
    durable: false,
    mountPoint: journalDir,
    reason:
      journalDir === "/"
        ? `${journalPath} is on the root filesystem, which a redeploy replaces`
        : `${journalDir} is part of the image, not a mounted volume. ` +
          "Everything written there is lost on the next deploy.",
  };
}

/** What to print when the journal would not survive. Long on purpose. */
export function volumeFailure(journalPath: string, verdict: VolumeVerdict): string {
  return (
    `The journal at ${journalPath} would not survive a redeploy.\n` +
    `  ${verdict.reason}\n\n` +
    "The journal is the record of what the desk owns. A keeper that restarts\n" +
    "without it believes it holds nothing, and opens a position it already has.\n\n" +
    "On Railway: Service, then Settings, then Volumes, then Add Volume, with\n" +
    "mount path /data. Add it before the deploy, not after.\n\n" +
    "To run without one deliberately, unset RESIDENT_REQUIRE_VOLUME."
  );
}
