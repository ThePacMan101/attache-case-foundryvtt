/**
 * Small Foundry helpers shared by the services and apps.
 */

import { MODULE_ID } from "../constants.mjs";

/**
 * Localize (and format, when data is given) a string. v14 `localize(key, data)` formats.
 * @param {string} key
 * @param {object} [data]
 * @returns {string}
 */
export function loc(key, data) {
  return data ? game.i18n.localize(key, data) : game.i18n.localize(key);
}

/**
 * Show a notification with an already localized message (NotificationOptions.localize was
 * ignored before 14.367, so we never rely on it).
 * @param {"info"|"warn"|"error"|"success"} type
 * @param {string} key i18n key
 * @param {object} [data]
 */
export function notify(type, key, data) {
  ui.notifications[type]?.(loc(key, data));
}

/** @returns {object} a v14 deletion operator for update data (replaces the deprecated `-=key`). */
export function deletion() {
  return new foundry.data.operators.ForcedDeletion();
}

/**
 * Flattened update key for one of our flags.
 * @param {string} key
 * @returns {string}
 */
export function flagPath(key) {
  return `flags.${MODULE_ID}.${key}`;
}

/** Log once per key (console only). */
const logged = new Set();
export function warnOnce(key, ...args) {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(`${MODULE_ID} |`, ...args);
}

/**
 * Human label for an item type, from the system's type labels when available.
 * @param {string} type
 * @returns {string}
 */
export function typeLabel(type) {
  const label = CONFIG.Item?.typeLabels?.[type];
  return label ? loc(label) : type;
}
