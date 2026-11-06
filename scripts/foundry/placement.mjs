/**
 * Where an item is, and what a new place means for its data (PLAN A1, A3; D-001, D-002, D-005).
 * `placementFields` is the only source of the pos flag, `system.container` and `system.equipped`, so that a move, a
 * copy and a create cannot disagree. On a system with no native bags it writes our flags and nothing else.
 */

import { FLAGS } from "../constants.mjs";
import { wornEnabled } from "../settings.mjs";
import { hasNativeBags, isNativeGrid, isWearable, moduleFlags, nativeParent, profile } from "./system-adapter.mjs";
import { deletion, flagPath } from "./util.mjs";

/**
 * Whether this item counts as worn: derived from the system's data where it has it, else our flag.
 * Equipped alone says nothing: armor in a bag still sets AC in dnd5e, and is not on anyone's back here.
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isWorn(item) {
  if (!wornEnabled() || !isWearable(item)) return false;
  const isEquipped = profile()?.isEquipped;
  return isEquipped ? isEquipped(item) && !nativeParent(item) : moduleFlags(item)[FLAGS.WORN] === true;
}

/**
 * Whether the user put this item in Unstowed on purpose: nothing automatic may take it out again. The flag holds
 * `null` for that; absent means nobody has placed it yet. Systems with no native bags never read it this way.
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isUnstowedByUser(item) {
  return hasNativeBags() && moduleFlags(item)[FLAGS.POS] === null;
}

/**
 * The update fields of a placement, as flat keys and only those that change. Native keys are written only for a user
 * action: an automatic path never rewrites a real character's bags or armor (D-008, D-009).
 *
 * `system.equipped` follows PLAN A3, and only when Worn is on and the item is wearable:
 * - Worn, to a cell or Unstowed: false.
 * - In a bag and stale-equipped, to the same bag or a rotation: nothing.
 * - In a bag and stale-equipped, anywhere else: false, or it would jump to Worn.
 * - To Worn, from anywhere: true.
 *
 * @param {Item|object} item document, or raw data of an item about to be created on `actor`
 * @param {object} place
 * @param {{c:string,x:number,y:number,r:boolean}|null} [place.pos] null = no cell
 * @param {boolean} [place.worn=false]
 * @param {boolean} [place.stowed=false] with no pos: store `null` rather than removing the flag
 * @param {object} [context]
 * @param {Actor} [context.actor] the actor it is or will be on
 * @param {boolean} [context.userAction=false]
 * @returns {object} flat update keys; empty when nothing changes
 */
export function placementFields(item, { pos = null, worn = false, stowed = false } = {}, { actor = item?.parent, userAction = false } = {}) {
  const fields = {};
  const flags = moduleFlags(item);
  const current = flags[FLAGS.POS];
  if (pos) {
    const p = { c: pos.c, x: pos.x, y: pos.y, r: Boolean(pos.r) };
    if (!current || current.c !== p.c || current.x !== p.x || current.y !== p.y || Boolean(current.r) !== p.r) fields[flagPath(FLAGS.POS)] = p;
  } else if (stowed) {
    if (current !== null) fields[flagPath(FLAGS.POS)] = null;
  } else if (current !== undefined) {
    fields[flagPath(FLAGS.POS)] = deletion();
  }

  if (!hasNativeBags()) {
    if (worn) fields[flagPath(FLAGS.WORN)] = true;
    else if (flags[FLAGS.WORN] !== undefined) fields[flagPath(FLAGS.WORN)] = deletion();
    return fields;
  }
  if (flags[FLAGS.WORN] !== undefined) fields[flagPath(FLAGS.WORN)] = deletion();
  if (!userAction) return fields;

  const holder = nativeParent(item, actor)?.id ?? null;
  const target = !worn && pos && isNativeGrid(actor?.items?.get(pos.c)) ? pos.c : null;
  if (holder !== target) fields["system.container"] = target;
  if (wornEnabled() && isWearable(item, actor)) {
    const equipped = profile().isEquipped(item);
    if (worn) {
      if (!equipped) fields["system.equipped"] = true;
    } else if (equipped && (!holder || holder !== target)) {
      fields["system.equipped"] = false;
    }
  }
  return fields;
}
