/**
 * GM-relayed operations through CONFIG.queries (registered on every client; only the queried
 * GM runs the handler). Data comes from a player client, so everything is re-validated here.
 */

import { MODULE_ID } from "../constants.mjs";
import { TRANSFER_QUERY, executeTransfer, canGiveTo, itemSize } from "./inventory.mjs";
import { isSupportedActor } from "./system-adapter.mjs";

/**
 * The sender of a query. Core calls handlers as `handler(queryData, {timeout, user})`, where
 * `user` is the User the server received the query from (v14 `#handleUserQuery`), so it cannot
 * be spoofed through the query data.
 * @param {{user?: User}} [context]
 * @returns {User|null}
 */
function resolveSender(context) {
  const user = context?.user;
  return user?.documentName === "User" ? user : null;
}

const TARGET_KINDS = new Set(["cell", "overflow", "worn", "auto"]);

/** Accept only well-formed drop targets. */
function cleanTarget(target) {
  if (!target || !TARGET_KINDS.has(target.kind)) return { kind: "auto" };
  if (target.kind !== "cell") return { kind: target.kind };
  const p = target.pos;
  if (!p || typeof p.c !== "string" || !Number.isInteger(p.x) || !Number.isInteger(p.y)) return { kind: "auto" };
  return { kind: "cell", pos: { c: p.c, x: p.x, y: p.y, r: Boolean(p.r) } };
}

/**
 * GM handler: move an item owned by the requesting user to an actor they may give to.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function onTransfer(data, context) {
  if (!game.user.isGM) return { ok: false, error: "notGM" };
  const user = resolveSender(context);
  if (!user) return { ok: false, error: "unknownUser" };
  const item = await fromUuid(String(data?.itemUuid ?? ""));
  const target = await fromUuid(String(data?.targetUuid ?? ""));
  if (item?.documentName !== "Item" || !item.parent || target?.documentName !== "Actor") return { ok: false, error: "notFound" };
  if (!isSupportedActor(item.parent) || !isSupportedActor(target) || item.parent === target) return { ok: false, error: "invalid" };
  // Only items that show up as tiles can be given (no skills, spells, containers or excluded items).
  if (!itemSize(item).size) return { ok: false, error: "invalid" };
  if (!item.parent.testUserPermission(user, "OWNER")) return { ok: false, error: "notOwner" };
  if (!canGiveTo(target, user)) return { ok: false, error: "target" };
  try {
    const created = await executeTransfer(item, target, cleanTarget(data.target));
    return { ok: true, itemId: created.id };
  } catch (err) {
    // Lost the race against a concurrent transfer of the same item (rolled back): not an error.
    if (!item.parent.items.has(item.id)) return { ok: false, error: "gone" };
    console.error(`${MODULE_ID} | relayed transfer failed`, err);
    return { ok: false, error: "failed" };
  }
}

/** Register our queries. Call during `init`. */
export function registerQueries() {
  CONFIG.queries[TRANSFER_QUERY] = onTransfer;
}
