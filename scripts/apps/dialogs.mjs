/**
 * Small DialogV2-based prompts: confirm, resize a grid, pick the actor to give an item to.
 */

import { MAX_DIM } from "../constants.mjs";
import { canGiveTo } from "../foundry/inventory.mjs";
import { loc, notify } from "../foundry/util.mjs";

const { DialogV2 } = foundry.applications.api;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Yes/no confirmation.
 * @param {string} titleKey
 * @param {string} contentKey
 * @param {object} [data]
 * @returns {Promise<boolean>}
 */
export async function confirmDialog(titleKey, contentKey, data) {
  const result = await DialogV2.confirm({
    window: { title: loc(titleKey, data) },
    classes: ["attache-dialog"],
    content: `<p>${esc(loc(contentKey, data))}</p>`,
    rejectClose: false,
    modal: true
  });
  return result === true;
}

/**
 * Ask for new grid dimensions.
 * @param {string} name container name (for the title)
 * @param {{cols:number, rows:number}} current
 * @param {{min?:number}} [options] smallest allowed value (0 for the body grid)
 * @returns {Promise<{cols:number, rows:number}|null>}
 */
export async function promptResize(name, current, { min = 1 } = {}) {
  const field = (key, label, value) => `
    <div class="form-group">
      <label for="attache-resize-${key}">${esc(loc(label))}</label>
      <input id="attache-resize-${key}" type="number" name="${key}" value="${value}" min="${min}" max="${MAX_DIM}" step="1" required>
    </div>`;
  const result = await DialogV2.input({
    window: { title: loc("ATTACHE.Config.ResizeTitle", { name }) },
    classes: ["attache-dialog"],
    content: field("cols", "ATTACHE.Config.Columns", current.cols) + field("rows", "ATTACHE.Config.Rows", current.rows),
    ok: { label: "ATTACHE.Config.Save", icon: "fa-solid fa-check" },
    rejectClose: false
  });
  if (!result) return null;
  const n = (v) => Math.min(MAX_DIM, Math.max(min, Math.trunc(Number(v)) || 0));
  return { cols: n(result.cols), rows: n(result.rows) };
}

/**
 * Let the user pick another actor to give an item to.
 * @param {Item} item
 * @returns {Promise<Actor|null>}
 */
export async function promptGiveTarget(item) {
  const source = item.parent;
  const actors = game.actors.filter((a) => a !== source && canGiveTo(a));
  if (!actors.length) {
    notify("info", "ATTACHE.Notify.NoGiveTargets");
    return null;
  }
  actors.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name, game.i18n.lang));
  const options = actors.map((a, i) => `
    <label class="attache-give-option">
      <input type="radio" name="actor" value="${esc(a.id)}"${i === 0 ? " checked" : ""}>
      <img src="${esc(a.img)}" alt="">
      <span>${esc(a.name)}</span>
    </label>`).join("");
  const result = await DialogV2.wait({
    window: { title: loc("ATTACHE.Config.GiveTitle", { name: item.name }), icon: "fa-solid fa-hand-holding" },
    classes: ["attache-dialog", "attache-give"],
    content: `<div class="attache-give-list">${options}</div>`,
    buttons: [
      {
        action: "give", label: "ATTACHE.Config.Give", icon: "fa-solid fa-hand-holding", default: true,
        callback: (_event, button) => button.form.elements.actor?.value ?? null
      },
      { action: "cancel", label: "ATTACHE.Config.Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return null;
  return game.actors.get(result) ?? null;
}
