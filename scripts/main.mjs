/**
 * Attaché Case — entry point. Registers settings, keybindings, queries and hooks on `init`
 * and exposes the public API on the module object.
 */

import { MODULE_ID } from "./constants.mjs";
import { CONTAINER_PRESETS } from "./data/container-presets.mjs";
import { registerSettings } from "./settings.mjs";
import { registerHooks, registerKeybindings, warnIfUnsupported } from "./foundry/hooks.mjs";
import { registerQueries } from "./foundry/queries.mjs";
import { getLayout, registerSizes, onRegistryChange } from "./foundry/inventory.mjs";
import { AttacheCaseApp } from "./apps/attache-case-app.mjs";

Hooks.once("init", () => {
  registerSettings(() => AttacheCaseApp.renderAll());
  registerKeybindings();
  registerQueries();
  registerHooks();
  onRegistryChange(() => AttacheCaseApp.renderAll());

  /**
   * Public API: `game.modules.get("attache-case").api`.
   * - `open(actor)` opens (or focuses) the actor's Attaché Case window.
   * - `getLayout(actor)` returns a plain-data snapshot of containers, placements and overflow.
   * - `registerSizes(registry)` adds a size registry (shape documented in scripts/core/sizes.mjs).
   * - `presets` lists the ready-made containers.
   */
  game.modules.get(MODULE_ID).api = Object.freeze({
    open: (actor) => AttacheCaseApp.open(actor),
    getLayout,
    registerSizes,
    presets: CONTAINER_PRESETS
  });
});

Hooks.once("ready", warnIfUnsupported);
