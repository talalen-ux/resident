import { ImageResponse } from "next/og";

/**
 * The share card. Every link to this site in a chat, a feed or a Telegram
 * group renders this, so it carries the mark, the name and the one line that
 * says what the protocol is — not a screenshot of a page nobody can read at
 * card size.
 *
 * No custom font is loaded on purpose: fetching one at build time is a network
 * dependency that fails closed and ships a broken card. The default face is
 * legible at this scale and the layout does not depend on exact metrics.
 */
export const alt =
  "Resident, a liquidity protocol for tokenized equities on Robinhood Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1A1C17";
const LIME = "#C1FF72";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: LIME,
          color: INK,
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="72" height="72" viewBox="0 0 36 36" fill="none">
            <path
              d="M13 3H3v30h10M23 3h10v30H23"
              stroke={INK}
              strokeWidth="2.5"
              strokeLinecap="square"
            />
            <rect x="9" y="17" width="18" height="2.5" fill={INK} />
            <rect x="15" y="8" width="6" height="6" fill={INK} />
          </svg>
          <span style={{ fontSize: 56, fontWeight: 600, letterSpacing: -1.5 }}>
            Resident
          </span>
        </div>

        {/* Satori ignores <br />, so each line is its own element. Left as one
            string it ran off the right edge of the card. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {["A liquidity protocol for", "tokenized equities."].map((line) => (
            <span
              key={line}
              style={{ fontSize: 72, lineHeight: 1.12, letterSpacing: -2 }}
            >
              {line}
            </span>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontSize: 26,
            borderTop: `2px solid ${INK}`,
            paddingTop: 28,
          }}
        >
          <span style={{ fontWeight: 600 }}>$RES</span>
          <span style={{ opacity: 0.55 }}>·</span>
          <span>Robinhood Chain</span>
          <span style={{ opacity: 0.55 }}>·</span>
          <span>15% of profit to holders, every 15 minutes</span>
        </div>
      </div>
    ),
    size,
  );
}
