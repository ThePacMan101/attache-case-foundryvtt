/**
 * Shared constants. Pure module (no Foundry globals) so scripts/core can import it in Node.
 */

/** Module id, also the flag scope. */
export const MODULE_ID = "attache-case";

/** Container id of the built-in "on person" grid every actor has. */
export const BODY_ID = "body";

/** Flag keys under the `attache-case` scope. */
export const FLAGS = Object.freeze({
  /** Item: `{w, h}` GM size override. */
  SIZE: "size",
  /** Item: `boolean` — physical-type item that takes no space. */
  EXCLUDED: "excluded",
  /** Item: `{c, x, y, r}` requested placement. */
  POS: "pos",
  /** Item: `{cols, rows}` — turns the item into a container. */
  CONTAINER: "container",
  /** Item: `boolean` — armor worn on the body (takes no grid space). */
  WORN: "worn",
  /** Actor: `{cols, rows}` body grid override (0x0 = no body grid). */
  BODY: "body"
});

/** Setting keys (registered by scripts/settings.mjs). */
export const SETTINGS = Object.freeze({
  /** World: default body grid columns (an actor flag `body` overrides it). */
  DEFAULT_BODY_COLS: "defaultBodyCols",
  /** World: default body grid rows. */
  DEFAULT_BODY_ROWS: "defaultBodyRows",
  PLAYERS_CAN_EDIT_SIZES: "playersCanEditSizes",
  AUTO_PLACE: "autoPlace",
  ALLOW_WORN: "allowWorn",
  /** Client: rendered cell size in px. */
  CELL_SIZE: "cellSize",
  /** Client: show item names on tiles. */
  SHOW_NAMES: "showNames"
});

/** Allowed range of the client cell size setting, in px. */
export const CELL_SIZE_RANGE = Object.freeze({ min: 32, max: 80, step: 4 });

/** Default body grid when neither the actor flag nor the world setting says otherwise. */
export const DEFAULT_BODY = Object.freeze({ cols: 5, rows: 3 });

/** Default rendered cell size in px. */
export const DEFAULT_CELL_SIZE = 48;

/** Largest allowed item dimension and container dimension, in cells. */
export const MAX_DIM = 32;

/** Size used when nothing else matches. */
export const FALLBACK_SIZE = Object.freeze({ w: 1, h: 1 });
