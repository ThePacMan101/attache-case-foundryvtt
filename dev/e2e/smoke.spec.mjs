/**
 * Smoke test, per test world: launch, log in as GM, check system + module + API, open the
 * seeded character's Attaché Case and screenshot it. Console errors are written to
 * dev/artifacts/<world>-console.json; errors attributable to attache-case fail the test.
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  WORLDS, SEED_FLAG, ARTIFACTS_DIR, launchWorld, loginAs, evalInFoundry, screenshot,
  collectConsoleErrors, moduleErrors
} from "./helpers.mjs";

for (const [worldId, meta] of Object.entries(WORLDS)) {
  test(`smoke ${worldId}`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    try {
      await launchWorld(page, worldId);
      await loginAs(page, "Gamemaster");

      const info = await evalInFoundry(page, () => {
        const mod = game.modules.get("attache-case");
        return {
          system: game.system.id,
          systemVersion: game.system.version,
          core: game.release.version,
          active: mod?.active === true,
          version: mod?.version,
          apiOpen: typeof mod?.api?.open
        };
      });
      console.log(`[smoke] ${worldId}: ${JSON.stringify(info)}`);
      expect(info.system).toBe(meta.system);
      expect(info.active).toBe(true);
      expect(info.apiOpen).toBe("function");
      await screenshot(page, `${worldId}-smoke`);

      // Header control on the seeded character's sheet: v14 renders hook-added controls as entries
      // of the kebab ContextMenu (built on open), so open the menu and click our entry.
      const sheetId = await evalInFoundry(page, async (flag) => {
        const actor = game.actors.find((a) => a.getFlag(flag.scope, flag.key));
        if (!actor) return null;
        await actor.sheet.render({ force: true });
        return actor.sheet.id;
      }, SEED_FLAG);
      expect(sheetId, "seeded character exists (run dev/setup.sh)").toBeTruthy();
      const sheet = page.locator(`[id="${sheetId}"]`);
      await expect(sheet, "actor sheet rendered").toBeVisible();
      await sheet.locator("[data-action=toggleControls]").first().click();
      const entry = page.locator("#context-menu .context-item", { hasText: "Attaché Case" });
      await expect(entry, "Attaché Case header control on the actor sheet").toBeVisible();
      await screenshot(page, `${worldId}-sheet`);
      await entry.click();
      await expect(page.locator(".application.attache-case")).toHaveCount(1);
      await evalInFoundry(page, () => {
        for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame) app.close();
      });
      await page.waitForTimeout(500);
      const actorId = await evalInFoundry(page, (flag) => game.actors.find((a) => a.getFlag(flag.scope, flag.key)).id, SEED_FLAG);

      // Open the case through the public API.
      await evalInFoundry(page, (id) => game.modules.get("attache-case").api.open(game.actors.get(id)), actorId);
      const app = page.locator(".application.attache-case").first();
      await expect(app).toBeVisible();
      await page.waitForTimeout(1000);
      await screenshot(page, `${worldId}-case`);
      const layout = await evalInFoundry(page, (id) => {
        const l = game.modules.get("attache-case").api.getLayout(game.actors.get(id));
        return JSON.parse(JSON.stringify(l));
      }, actorId).catch((e) => ({ error: String(e) }));
      fs.writeFileSync(path.join(ARTIFACTS_DIR, `${worldId}-layout.json`), JSON.stringify(layout, null, 2));
    } finally {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
      fs.writeFileSync(path.join(ARTIFACTS_DIR, `${worldId}-console.json`), JSON.stringify(errors, null, 2));
      if (errors.length) console.log(`[smoke] ${worldId} console errors:\n` + errors.map((e) => `  - ${e.text}`).join("\n"));
    }
    expect(moduleErrors(errors), "console errors from attache-case").toEqual([]);
  });
}
