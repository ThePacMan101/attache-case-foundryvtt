/**
 * Settings registration and typed getters.
 */

import { MODULE_ID, SETTINGS, DEFAULT_BODY, DEFAULT_CELL_SIZE, CELL_SIZE_RANGE, MAX_DIM } from "./constants.mjs";

/**
 * Register every setting. Call during `init`.
 * @param {() => void} refresh re-renders open Attaché Case windows (display settings)
 */
export function registerSettings(refresh) {
  const { NumberField, BooleanField } = foundry.data.fields;
  const dim = (initial) => new NumberField({
    nullable: false, integer: true, min: 0, max: MAX_DIM, step: 1, initial
  });
  const key = (name) => `ATTACHE.Settings.${name}`;
  const common = (name, scope) => ({
    name: `${key(name)}.Name`, hint: `${key(name)}.Hint`, scope, config: true
  });

  game.settings.register(MODULE_ID, SETTINGS.DEFAULT_BODY_COLS, {
    ...common("DefaultBodyCols", "world"), type: dim(DEFAULT_BODY.cols), default: DEFAULT_BODY.cols, onChange: refresh
  });
  game.settings.register(MODULE_ID, SETTINGS.DEFAULT_BODY_ROWS, {
    ...common("DefaultBodyRows", "world"), type: dim(DEFAULT_BODY.rows), default: DEFAULT_BODY.rows, onChange: refresh
  });
  game.settings.register(MODULE_ID, SETTINGS.AUTO_PLACE, {
    ...common("AutoPlace", "world"), type: new BooleanField({ initial: true }), default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.ALLOW_WORN, {
    ...common("AllowWorn", "world"), type: new BooleanField({ initial: true }), default: true, onChange: refresh
  });
  game.settings.register(MODULE_ID, SETTINGS.PLAYERS_CAN_EDIT_SIZES, {
    ...common("PlayersCanEditSizes", "world"), type: new BooleanField({ initial: false }), default: false, onChange: refresh
  });
  game.settings.register(MODULE_ID, SETTINGS.CELL_SIZE, {
    ...common("CellSize", "client"),
    type: new NumberField({ nullable: false, integer: true, ...CELL_SIZE_RANGE, initial: DEFAULT_CELL_SIZE }),
    default: DEFAULT_CELL_SIZE,
    onChange: refresh
  });
  game.settings.register(MODULE_ID, SETTINGS.SHOW_NAMES, {
    ...common("ShowNames", "client"), type: new BooleanField({ initial: true }), default: true, onChange: refresh
  });
}

const get = (k) => game.settings.get(MODULE_ID, k);

/** @returns {{cols:number, rows:number}} world default body grid */
export function defaultBody() {
  const n = (v, d) => (Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_DIM) : d);
  return { cols: n(get(SETTINGS.DEFAULT_BODY_COLS), DEFAULT_BODY.cols), rows: n(get(SETTINGS.DEFAULT_BODY_ROWS), DEFAULT_BODY.rows) };
}

/** @returns {number} cell size in px, clamped to the allowed range */
export function cellSize() {
  const v = Number(get(SETTINGS.CELL_SIZE));
  if (!Number.isFinite(v)) return DEFAULT_CELL_SIZE;
  return Math.min(CELL_SIZE_RANGE.max, Math.max(CELL_SIZE_RANGE.min, Math.round(v)));
}

/** @returns {boolean} */
export const showNames = () => get(SETTINGS.SHOW_NAMES) !== false;
/** @returns {boolean} */
export const autoPlaceEnabled = () => get(SETTINGS.AUTO_PLACE) !== false;
/** @returns {boolean} */
export const wornEnabled = () => get(SETTINGS.ALLOW_WORN) !== false;
/** @returns {boolean} */
export const playersCanEditSizes = () => get(SETTINGS.PLAYERS_CAN_EDIT_SIZES) === true;

/**
 * Whether the current user may change sizes / exclusion of this item.
 * @param {Item} item
 * @returns {boolean}
 */
export function canEditSizes(item) {
  if (game.user.isGM) return true;
  return playersCanEditSizes() && Boolean(item?.isOwner);
}
