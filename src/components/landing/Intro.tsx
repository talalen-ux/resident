/**
 * The front door.
 *
 * Deliberately built with no JavaScript. The enter control is a real anchor to
 * #main, and the overlay hides itself with `#main:target ~ #intro` — which
 * means it works with scripts disabled, works in a static export, and cannot
 * strand a visitor behind a curtain that failed to hydrate. A gate that needs
 * JS to open is a gate that sometimes does not.
 *
 * The anchor fills the viewport, so clicking anywhere enters; it is also
 * focusable, so Enter and Space work without any key handling of our own.
 *
 * It sits after #main in the DOM because the sibling combinator needs it to,
 * and it is fixed, so DOM order costs nothing visually.
 */
export function Intro() {
  return (
    <div id="intro" aria-label="Enter Resident">
      <div className="intro-art" aria-hidden>
        <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            className="intro-bracket"
            d="M13 3H3v30h10M23 3h10v30H23"
            stroke="#C1FF72"
            strokeWidth="2"
            strokeLinecap="square"
          />
          <rect
            className="intro-line"
            x="9"
            y="17"
            width="18"
            height="2"
            fill="#C1FF72"
          />
          <rect
            className="intro-block"
            x="15"
            y="8"
            width="6"
            height="6"
            fill="#C1FF72"
          />
        </svg>
      </div>

      <p className="intro-word">Resident</p>
      <span className="intro-rule" aria-hidden />
      <p className="intro-meta">
        $RES <span aria-hidden>·</span> Robinhood Chain{" "}
        <span aria-hidden>·</span> quoted in USDG
      </p>

      <a href="#main" className="intro-enter">
        <span className="intro-enter-label">
          Enter <span className="intro-caret" aria-hidden />
        </span>
      </a>
    </div>
  );
}
