/**
 * Alternative item images: validating the `art` flag and choosing what to show.
 * Pure module — no Foundry globals. `bindArtFallback` only touches the elements it is given.
 */

/** Last link of the fallback chain (core's default item icon). */
export const DEFAULT_ICON = "icons/svg/item-bag.svg";

/** Characters no image path needs: markup, and the controls browsers strip out of URL schemes. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f<>"]/;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const WEB_SCHEMES = new Set(["http", "https"]);

/**
 * Validate an image path or URL.
 * @param {*} value
 * @returns {string|null} the trimmed path, or null when it cannot be used as item art
 */
export function sanitizeArt(value) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || FORBIDDEN.test(path)) return null;
  const scheme = path.match(SCHEME)?.[1].toLowerCase();
  return scheme && !WEB_SCHEMES.has(scheme) ? null : path;
}

/**
 * What an image element should show: `src` first, then `fallback` if that file fails to load.
 * @param {{art?: *, img?: *}} source the `art` flag and the item's own image
 * @param {{conceal?: boolean}} [options] conceal: ignore the art (see the system profile)
 * @returns {{src: string, fallback: string}} an empty fallback ends the chain
 */
export function resolveArt({ art, img } = {}, { conceal = false } = {}) {
  const own = typeof img === "string" && img ? img : DEFAULT_ICON;
  const chosen = conceal ? null : sanitizeArt(art);
  if (chosen) return { src: chosen, fallback: own };
  return { src: own, fallback: own === DEFAULT_ICON ? "" : DEFAULT_ICON };
}

/**
 * Walk the chain art -> item image -> default icon on any image inside `root` that carries a
 * `data-fallback` attribute, once per link. Error events do not bubble, hence the capture phase, which
 * also survives re-renders of the root's content. Works on any root, the drag ghost on
 * `document.body` included, and on any document (no `instanceof`, so pop-out windows work).
 * @param {EventTarget} root
 */
export function bindArtFallback(root) {
  root.addEventListener("error", ({ target: img }) => {
    if (img?.tagName !== "IMG" || !img.hasAttribute("data-fallback")) return;
    const next = img.dataset.fallback;
    if (!next) return;
    img.dataset.fallback = next === DEFAULT_ICON ? "" : DEFAULT_ICON;
    img.src = next;
  }, true);
}
