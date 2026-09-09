/**
 * What fraction of the estimate a position actually collects.
 *
 * Every fee figure this desk produces is volume × fee × share, and every one of
 * them is an UPPER BOUND. The formula credits a position with every unit of
 * reported pool flow at its full share, and a pool's flow includes trades at
 * prices the position does not cover, routed through hops it is not on, in
 * blocks where someone else's liquidity was in front of it. The gap is not
 * small and it is not constant.
 *
 * That matters more than it sounds. The entry test opens a position when the
 * net rate clears zero, and the net rate is fee income less bleed. Feed it a
 * ceiling and it opens positions whose true income is below the bleed they are
 * being charged — losing positions that pass the test because the flattering
 * half of the arithmetic was measured and the sobering half was not.
 *
 * So capture is measured rather than assumed. Every sweep produces a pair: what
 * the model said the position would earn over the interval, and what actually
 * arrived. The ratio of the sums is the capture efficiency for that pool.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT DO
 *
 * It does not average ratios. One interval with a near-zero estimate and a few
 * cents of realised fees produces a ratio in the hundreds, and a mean over
 * ratios lets that one interval set the number. Sum over sum is immune.
 *
 * It does not trust a handful of samples. Under the minimum it reports
 * unmeasured, and the caller applies its haircut rather than acting on noise.
 *
 * It does not fall back to 1. An unmeasured pool is priced at a discount to its
 * ceiling, because the ceiling is the one value measurement has never returned.
 */

export type CaptureSample = {
  pool: string;
  /** What the model said this interval would earn, in quote units. */
  estimated: number;
  /** What actually arrived, in quote units. */
  realized: number;
  /** Milliseconds since epoch. */
  at: number;
};

export type CaptureConfig = {
  /** Samples below which a pool is reported unmeasured. */
  minSamples: number;
  /**
   * Capture assumed for a pool nothing has been measured on.
   *
   * A judgement, and labelled as one: it is half the ceiling, on the grounds
   * that the ceiling has never been what measurement returned. It is the number
   * a running desk replaces first, per pool, within a day of trading.
   */
  unmeasured: number;
  /**
   * Most a measurement may report.
   *
   * Above 1 is possible — the estimate can understate when a pool's reported
   * volume misses routed flow the position was on — but far above it means an
   * input is wrong, and a capture of 4 would open every pool on the board.
   */
  ceiling: number;
  /** Age at which a sample counts half as much. Pools change. */
  halfLifeMs: number;
};

export const DEFAULT_CAPTURE: CaptureConfig = {
  minSamples: 12,
  unmeasured: 0.5,
  ceiling: 1.25,
  halfLifeMs: 24 * 60 * 60 * 1000,
};

export type CaptureEstimate = {
  pool: string;
  efficiency: number;
  /** Effective sample count after decay, which is what minSamples is tested on. */
  samples: number;
  /** Total estimated and realised, in quote units, for a reader to check. */
  estimated: number;
  realized: number;
  measured: boolean;
};

/**
 * Capture per pool, from the desk's own sweeps.
 *
 * Samples decay by age so a pool that has changed character is not held to what
 * it paid last week. A sample with a non-positive estimate is dropped rather
 * than counted as a perfect miss: the model declining to predict anything is
 * not evidence the position collected nothing.
 */
export function calibrate(
  samples: CaptureSample[],
  now: number,
  config: CaptureConfig = DEFAULT_CAPTURE,
): Map<string, CaptureEstimate> {
  const totals = new Map<
    string,
    { estimated: number; realized: number; samples: number }
  >();

  for (const sample of samples) {
    if (!(sample.estimated > 0) || sample.realized < 0) continue;
    const age = Math.max(0, now - sample.at);
    const weight = Math.pow(0.5, age / config.halfLifeMs);
    if (!(weight > 0)) continue;

    const bucket = totals.get(sample.pool) ?? {
      estimated: 0,
      realized: 0,
      samples: 0,
    };
    bucket.estimated += sample.estimated * weight;
    bucket.realized += sample.realized * weight;
    bucket.samples += weight;
    totals.set(sample.pool, bucket);
  }

  const out = new Map<string, CaptureEstimate>();
  for (const [pool, t] of totals) {
    const measured = t.samples >= config.minSamples && t.estimated > 0;
    const raw = t.estimated > 0 ? t.realized / t.estimated : 0;
    out.set(pool, {
      pool,
      efficiency: measured
        ? Math.min(config.ceiling, Math.max(0, raw))
        : config.unmeasured,
      samples: t.samples,
      estimated: t.estimated,
      realized: t.realized,
      measured,
    });
  }
  return out;
}

/**
 * One capture figure across every pool the desk has traded.
 *
 * The fallback for a pool with no history of its own. A desk that has been
 * capturing 60% of its estimates everywhere is better evidence about a new pool
 * than a placeholder, and it is available from the first day of trading.
 */
export function deskWide(
  calibration: Map<string, CaptureEstimate>,
  config: CaptureConfig = DEFAULT_CAPTURE,
): CaptureEstimate | null {
  let estimated = 0;
  let realized = 0;
  let samples = 0;
  for (const e of calibration.values()) {
    estimated += e.estimated;
    realized += e.realized;
    samples += e.samples;
  }
  if (!(estimated > 0) || samples < config.minSamples) return null;
  return {
    pool: "*",
    efficiency: Math.min(config.ceiling, Math.max(0, realized / estimated)),
    samples,
    estimated,
    realized,
    measured: true,
  };
}

export type CaptureLookup = {
  efficiency: number;
  /** Where the number came from, so a board can say. */
  source: "pool" | "desk" | "assumed";
  samples: number;
};

/**
 * The capture to price a pool at, and where the number came from.
 *
 * Order is deliberate: this pool's own measurement, then the desk's, then the
 * assumption. Each step is weaker evidence than the last and the caller can see
 * which one it got, because a board that shows a measured 0.62 and an assumed
 * 0.5 identically is hiding the thing an operator most wants to know.
 */
export function captureFor(
  pool: string,
  calibration: Map<string, CaptureEstimate>,
  config: CaptureConfig = DEFAULT_CAPTURE,
  desk = deskWide(calibration, config),
): CaptureLookup {
  const own = calibration.get(pool);
  if (own?.measured) {
    return { efficiency: own.efficiency, source: "pool", samples: own.samples };
  }
  if (desk) {
    return { efficiency: desk.efficiency, source: "desk", samples: desk.samples };
  }
  return { efficiency: config.unmeasured, source: "assumed", samples: own?.samples ?? 0 };
}
