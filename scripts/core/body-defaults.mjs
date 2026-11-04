/**
 * Default size of the personal inventory per game system.
 * Pure module — no Foundry globals.
 */

import { DEFAULT_BODY } from "../constants.mjs";

const BY_SYSTEM = new Map([["dnd5e", Object.freeze({ cols: 8, rows: 5 })]]);

/**
 * The body grid of a system when the GM saved no other value.
 * @param {string} systemId
 * @returns {Readonly<{cols:number, rows:number}>}
 */
export function defaultBodyFor(systemId) {
  return BY_SYSTEM.get(systemId) ?? DEFAULT_BODY;
}
