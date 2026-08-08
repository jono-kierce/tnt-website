/**
 * Where the TNT artwork lives, and which crops pull the two marks out of it.
 *
 * Two generators read this: `scripts/build-logo.mjs` (the website's assets) and
 * `graphics/scripts/build-assets.mjs` (the Instagram templates' inlined mask).
 * They want different files out the other end — the site serves PNGs over HTTP,
 * the templates inline a `data:` URI because Chromium won't load a mask across
 * a `file://` origin — but they must crop the *same* mark, or the header and
 * the post drift apart.
 *
 * Only the alpha channel is ever used: the marks ship as masks and take their
 * ink from CSS (site) or from a tint at compose time (favicon, og). That's why
 * the white artwork is the source and the black one is never opened — on alpha
 * they are the same drawing.
 */

/** Source artwork, relative to the repo root. */
export const LOGO_SOURCE = "logos/white logo ' no text.png";

/** Crops, in source pixels: [left, top, right, bottom] of the 2732×2048 file. */
export const MARKS = {
  /**
   * The crest alone: TNT, laurel, crossed racquets, ball. Stops above the
   * handwritten "Tuesday Night Tennis", which the site and the templates both
   * set in type next to it.
   */
  crest: [725, 18, 2048, 1518],
  /** The full lockup, script included — for anything with room for it. */
  lockup: [725, 18, 2048, 1998],
};
