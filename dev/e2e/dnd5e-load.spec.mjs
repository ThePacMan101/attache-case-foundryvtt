/**
 * Both dnd5e worlds load with no console error that mentions the module, for GM and Player.
 * While module.json does not declare dnd5e the server does not send the module to the client at all
 * (seen in M0), so this asserts that refusal; with no module code loaded the console check is then
 * vacuous. Once M1 adds the systems entry the same test requires the module to be active. Even then it
 * ONLY proves loading. M1 replaces this with a real dnd5e smoke spec.
 */

import { test, expect } from "@playwright/test";
import {
  DND5E_WORLDS, FIVE_E_TOOLS, launchWorld, loginAs, collectConsoleErrors, moduleErrors, plutoniumInstalled,
  manifestSupports, waitForPlutonium
} from "./helpers.mjs";

for (const [worldId, meta] of Object.entries(DND5E_WORLDS)) {
  const wantsPlutonium = meta.modules.includes("plutonium");
  for (const user of ["Gamemaster", "Player"]) {
    test(`loads ${worldId} as ${user}`, async ({ browser }) => {
      test.skip(wantsPlutonium && !plutoniumInstalled(), "no Plutonium copy on this machine");
      const ctx = await browser.newContext();
      await ctx.route(FIVE_E_TOOLS, (route) => route.abort());
      const page = await ctx.newPage();
      const errors = collectConsoleErrors(page);
      await launchWorld(page, worldId);
      await loginAs(page, user);
      if (wantsPlutonium) await waitForPlutonium(page);

      const info = await page.evaluate(() => ({
        system: game.system.id,
        systemVersion: game.system.version,
        served: game.modules.has("attache-case"),
        enabled: game.settings.get("core", "moduleConfiguration")["attache-case"] === true,
        ours: game.modules.get("attache-case")?.active === true,
        api: typeof game.modules.get("attache-case")?.api?.open,
        plutonium: game.modules.get("plutonium")?.active === true,
        libWrapper: game.modules.get("lib-wrapper")?.active === true
      }));
      console.log(`[load] ${worldId} ${user}: ${JSON.stringify(info)}`);
      await ctx.close();
      expect(info.system).toBe("dnd5e");
      expect(info.systemVersion).toBe("5.3.3");
      expect(info.enabled, "attache-case enabled in the world").toBe(true);
      const declared = manifestSupports("dnd5e");
      expect(info.served, "the server sends the module only if module.json declares dnd5e").toBe(declared);
      expect(info.ours, "attache-case active").toBe(declared);
      expect(info.api).toBe(declared ? "function" : "undefined");
      expect(info.plutonium).toBe(wantsPlutonium);
      expect(info.libWrapper).toBe(wantsPlutonium);
      expect(moduleErrors(errors), "console errors from attache-case").toEqual([]);
    });
  }
}
