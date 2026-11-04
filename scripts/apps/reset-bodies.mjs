/**
 * Settings menu "Reset Custom Sizes": puts every actor back on the world default body grid.
 * Core only offers a menu button for an ApplicationV2 class it can construct and render; this one has
 * no window of its own, because the existing confirmation dialog says everything needed.
 */

import { actorsWithCustomBody, clearBodyOverrides } from "../foundry/inventory.mjs";
import { notify } from "../foundry/util.mjs";
import { confirmDialog } from "./dialogs.mjs";

/**
 * Count the actors with a custom size, ask, and clear them.
 * @returns {Promise<void>}
 */
export async function resetBodies() {
  if (!game.user.isGM) return;
  const { base, tokens } = actorsWithCustomBody();
  const count = base.length + tokens.length;
  if (!count) {
    notify("info", "ATTACHE.Notify.NoCustomBodies");
    return;
  }
  if (!await confirmDialog("ATTACHE.Settings.ResetBodies.Name", "ATTACHE.Config.ResetBodiesConfirm", { count })) return;
  const { cleared, failed } = await clearBodyOverrides();
  if (failed) notify("error", "ATTACHE.Notify.SaveFailed");
  if (cleared) notify("info", "ATTACHE.Notify.BodiesCleared", { count: cleared });
}

export class ResetBodies extends foundry.applications.api.ApplicationV2 {
  /** @override - there is no window: rendering runs the reset. */
  async render() {
    await resetBodies();
    return this;
  }
}
