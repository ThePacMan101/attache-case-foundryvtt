/**
 * Live answers to the riskiest dnd5e 5.3.3 + Plutonium assumptions (M0), against the real server.
 * Findings live in .llm/foundry-v14-api.md section 21; raw observations in dev/artifacts/spikes/.
 *
 * Every assertion states what was OBSERVED, so a wrong assumption fails here. Where the observation
 * contradicts the notes, a "CONTRADICTS" comment says so. Later milestones turn useful checks into specs.
 *
 * Worlds: S2 and S5 run in attache-dnd5e-plutonium (skipped without the local copy), S3, S4, S6 and S7
 * in the clean attache-dnd5e. S1 needs a module's init that it can prepend code to, so it borrows Plutonium's
 * script, in the Plutonium world (it ran that way in M0, when the server did not yet send ours to dnd5e).
 * Everything created is flagged `world.attacheSpike` and deleted again.
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  ARTIFACTS_DIR, FIVE_E_TOOLS, launchWorld, loginAs, collectConsoleErrors, moduleErrors, plutoniumInstalled,
  waitForPlutonium
} from "./helpers.mjs";

const CLEAN = "attache-dnd5e";
const PLUTONIUM = "attache-dnd5e-plutonium";
const SPIKE_FLAG = { scope: "world", key: "attacheSpike" };
const SPIKE_DIR = path.join(ARTIFACTS_DIR, "spikes");

/** Keep the raw observations of a spike next to the screenshots, and print them. */
function record(name, data) {
  fs.mkdirSync(SPIKE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SPIKE_DIR, `${name}.json`), JSON.stringify(data, null, 2));
  console.log(`[${name}] ${JSON.stringify(data)}`);
}

/**
 * A logged-in client with the canvas off, with Plutonium's remote host blocked. `routes` adds more
 * routes before the first request. Remote requests that were blocked end up in `blocked`.
 */
async function open(browser, worldId, user, { routes } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => localStorage.setItem("core.noCanvas", "true"));
  const blocked = [];
  await ctx.route(FIVE_E_TOOLS, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  if (routes) await routes(ctx);
  const page = await ctx.newPage();
  const errors = collectConsoleErrors(page);
  await launchWorld(page, worldId);
  await loginAs(page, user);
  return { ctx, page, errors, blocked };
}

/** Delete everything earlier spikes left behind, and close every window. */
async function clean(page) {
  await page.evaluate(async (flag) => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    const actors = game.actors.filter((a) => a.getFlag(flag.scope, flag.key));
    if (actors.length) await Actor.deleteDocuments(actors.map((a) => a.id));
  }, SPIKE_FLAG);
}

/** Item data from the system compendium, by name. */
const FROM_PACK = async (names) => {
  const pack = game.packs.get("dnd5e.equipment24");
  const index = await pack.getIndex();
  const out = {};
  for (const name of names) {
    const entry = index.find((e) => e.name === name);
    out[name] = game.items.fromCompendium(await pack.getDocument(entry._id));
  }
  return out;
};

// -------------------------------------------------------------------------------------------------
// S1: game.system at our init, a system-dependent setting default, a saved value wins.
// The registration is added in the browser only, by prepending to a module script as it is served, so it
// runs exactly when a module's code would. Nothing changes on disk. The script is Plutonium's, an ordinary
// module like ours (see the top of this file); the settings namespace is still ours, which core does not
// check against a package.
// -------------------------------------------------------------------------------------------------
const S1_KEY = "spikeBodyCols";
const orderPrefix = (label) => `
(globalThis.__order ??= []).push("evaluate:${label}");
Hooks.once("init", () => globalThis.__order.push("init:${label}"));
`;
const S1_PREFIX = `
globalThis.__s1 = { atEvaluation: globalThis.game?.system?.id ?? null };
Hooks.once("init", () => {
  const id = game.system?.id;
  const initial = id === "dnd5e" ? 8 : 5;
  Object.assign(globalThis.__s1, {
    atInit: id ?? null,
    systemVersion: game.system?.version ?? null,
    configDnd5eAtInit: Boolean(globalThis.CONFIG?.DND5E),
    gameDnd5eAtInit: Boolean(game.dnd5e),
    itemModelsAtInit: Object.keys(CONFIG.Item.dataModels ?? {}).length,
    initial
  });
  game.settings.register("attache-case", "${S1_KEY}", {
    scope: "world", config: false, default: initial,
    type: new foundry.data.fields.NumberField({ nullable: false, integer: true, min: 0, max: 32, step: 1, initial })
  });
});
`;

test("S1 system id, setting default and init order", async ({ browser }) => {
  test.skip(!plutoniumInstalled(), "no Plutonium copy on this machine");
  const { ctx, page, errors } = await open(browser, PLUTONIUM, "Gamemaster", {
    routes: async (c) => {
      const prepend = (pattern, prefix) => c.route(pattern, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: prefix + await response.text() });
      });
      await prepend(/\/modules\/lib-wrapper\/lib-wrapper\.js/, orderPrefix("lib-wrapper"));
      await prepend(/\/modules\/plutonium\/js\/Bundle\.js/, orderPrefix("plutonium") + S1_PREFIX);
      await prepend(/\/systems\/dnd5e\/dnd5e\.mjs/, orderPrefix("dnd5e"));
    }
  });
  const read = () => page.evaluate((key) => ({
    s1: globalThis.__s1,
    order: globalThis.__order,
    moduleScripts: [...document.querySelectorAll("script[type=module]")].map((el) => el.getAttribute("src")),
    value: game.settings.get("attache-case", key),
    stored: game.settings.storage.get("world").find((s) => s.key === `attache-case.${key}`)?.value ?? null
  }), S1_KEY);
  const reload = async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.game?.ready === true);
  };
  const removeSetting = () => page.evaluate(async (key) => {
    await game.settings.storage.get("world").find((s) => s.key === `attache-case.${key}`)?.delete();
  }, S1_KEY);

  await removeSetting();
  await reload();
  const fresh = await read();
  await page.evaluate((key) => game.settings.set("attache-case", key, 12), S1_KEY);
  await reload();
  const saved = await read();
  await removeSetting();
  await reload();
  const deleted = await read();
  await removeSetting();
  record("S1", { fresh, saved, deleted });
  await ctx.close();

  expect(fresh.s1.atInit, "game.system.id is readable at our init").toBe("dnd5e");
  // An ordinary module loads and inits after the system. A `library: true` module such as lib-wrapper
  // comes BEFORE it, so "modules init after the system" is not a general rule. module.json has no `library`.
  // Since M1 declares dnd5e in module.json, ours is served too, also after the system.
  expect(fresh.moduleScripts.slice(2)).toEqual(["modules/lib-wrapper/lib-wrapper.js", "systems/dnd5e/dnd5e.mjs", "modules/attache-case/scripts/main.mjs", "modules/plutonium/js/Bundle.js"]);
  expect(fresh.order).toEqual(["evaluate:lib-wrapper", "evaluate:dnd5e", "evaluate:plutonium", "init:lib-wrapper", "init:dnd5e", "init:plutonium"]);
  expect(fresh.s1.configDnd5eAtInit, "CONFIG.DND5E is set by the time an ordinary module inits").toBe(true);
  expect(fresh.s1.gameDnd5eAtInit, "game.dnd5e is set by the time an ordinary module inits").toBe(true);
  expect(fresh.s1.itemModelsAtInit, "the system's item models are registered").toBeGreaterThan(0);
  expect(fresh.s1.atEvaluation, "game.system is NOT readable while the script is evaluated").toBeNull();
  expect(fresh.value, "default computed from the system").toBe(8);
  expect(saved.value, "a saved value wins after reload").toBe(12);
  expect(saved.s1.initial, "the default is still computed").toBe(8);
  expect(deleted.value, "the default returns once the saved value is gone").toBe(8);
  expect(deleted.stored).toBeNull();
  expect(moduleErrors(errors)).toEqual([]);
});

// -------------------------------------------------------------------------------------------------
// S2 + S5: real Plutonium imports, offline.
// -------------------------------------------------------------------------------------------------

/** Installs the hook recorder and the import helpers in the page. */
async function installImportTools(page) {
  await waitForPlutonium(page);
  await page.evaluate(() => {
    const brief = (item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      parent: item.parent?.id ?? null,
      flags: foundry.utils.deepClone(item.flags?.plutonium ?? null),
      systemType: foundry.utils.deepClone(item.system?.type ?? null),
      container: item.system?.container ?? null,
      equipped: item.system?.equipped ?? null,
      quantity: item.system?.quantity ?? null,
      img: item.img
    });
    const log = [];
    const handles = [
      ["preCreateItem", Hooks.on("preCreateItem", (item, data, options) => {
        log.push({
          hook: "preCreateItem", ...brief(item),
          dataFlat: Object.keys(data).filter((k) => k.includes(".")),
          dataFlagsPlutonium: foundry.utils.deepClone(data.flags?.plutonium ?? null),
          dataSystemContainer: data.system?.container ?? null,
          options: Object.keys(options),
          parentInActor: item.system?.container ? Boolean(item.parent?.items.get(item.system.container)) : null,
          actorItems: item.parent?.items.size ?? null
        });
      })],
      ["createItem", Hooks.on("createItem", (item, options) => {
        log.push({ hook: "createItem", ...brief(item), options: Object.keys(options), render: options.render });
      })],
      ["updateItem", Hooks.on("updateItem", (item, changes, options) => {
        log.push({ hook: "updateItem", ...brief(item), changes: foundry.utils.deepClone(changes), options: Object.keys(options) });
      })]
    ];
    const importItem = async (actor, name, source) => {
      const api = game.modules.get("plutonium").api;
      const importer = await api.importer.pGetImporter({ page: "items.html" });
      const hash = UrlUtil.URL_TO_HASH_BUILDER["items.html"]({ name, source });
      const entry = await DataLoader.pCacheAndGet("items.html", source, hash, { isCopy: true });
      if (!entry) return { hash, found: false };
      const before = log.length;
      const summary = await importer.pImportEntry(entry, new api.importer.ImportOpts({ actor }));
      return {
        hash, found: true, status: String(summary?.status),
        imported: summary?.imported?.length ?? null,
        hooks: log.slice(before).map((l) => `${l.hook}:${l.name}`)
      };
    };
    const stop = () => { for (const [name, id] of handles) Hooks.off(name, id); };
    globalThis.__imports = { log, brief, importItem, stop };
  });
}

test("S2 real Plutonium imports, offline", async ({ browser }) => {
  test.skip(!plutoniumInstalled(), "no Plutonium copy on this machine");
  const { ctx, page, errors, blocked } = await open(browser, PLUTONIUM, "Gamemaster");
  await clean(page);
  await installImportTools(page);

  const out = await page.evaluate(async (flag) => {
    const { log, brief, importItem, stop } = globalThis.__imports;
    const actor = await Actor.create({ name: "Spike Importer", type: "character", flags: { [flag.scope]: { [flag.key]: true } } });
    const runs = {};
    const snapshot = {};
    runs.longsword = await importItem(actor, "Longsword", "XPHB");
    runs.plusOne = await importItem(actor, "+1 Longsword", "XDMG");
    runs.pack = await importItem(actor, "Dungeoneer's Pack", "XPHB");
    runs.arrows1 = await importItem(actor, "Arrows (20)", "XPHB");
    snapshot.arrowsAfterFirst = actor.items.filter((i) => /^arrow/i.test(i.name)).map(brief);
    runs.arrows2 = await importItem(actor, "Arrows (20)", "XPHB");
    snapshot.items = actor.items.map(brief);

    // A creature goes to the world directory as a new actor.
    const api = game.modules.get("plutonium").api;
    const before = new Set(game.actors.map((a) => a.id));
    const hash = UrlUtil.URL_TO_HASH_BUILDER["bestiary.html"]({ name: "Bugbear Warrior", source: "XMM" });
    const mon = await DataLoader.pCacheAndGet("bestiary.html", "XMM", hash, { isCopy: true });
    const logStart = log.length;
    const summary = await api.importer.creature.pImportEntry(mon);
    const creature = game.actors.find((a) => !before.has(a.id));
    const creatureHooks = log.slice(logStart).map((l) => `${l.hook}:${l.name}`);
    snapshot.creature = creature ? {
      name: creature.name, type: creature.type,
      items: creature.items.map((i) => ({
        ...brief(i), weight: i.system.weight?.value ?? null, baseItem: i.system.type?.baseItem ?? null
      }))
    } : null;
    runs.creature = { hash, found: Boolean(mon), status: String(summary?.status), hooks: creatureHooks };
    if (creature) await creature.update({ [`flags.${flag.scope}.${flag.key}`]: true });
    stop();
    return { runs, snapshot, log };
  }, SPIKE_FLAG);
  record("S2", { ...out, blocked: [...new Set(blocked)].slice(0, 20), consoleErrors: errors.map((e) => e.text.slice(0, 200)).slice(0, 40) });
  await clean(page);
  await ctx.close();

  const items = out.snapshot.items;
  const find = (name) => items.find((i) => i.name === name);
  const COMPLETE = "Symbol(taskExitComplete)";
  for (const run of Object.values(out.runs)) expect.soft(run.status, `import ${run.hash}`).toBe(COMPLETE);

  expect.soft(find("Longsword")?.flags).toEqual({ page: "items.html", source: "XPHB", hash: "longsword_xphb" });
  expect.soft(find("Longsword")?.systemType?.baseItem).toBe("longsword");
  expect.soft(find("Longsword")?.equipped).toBe(true);
  expect.soft(find("Longsword")?.img, "remote art").toMatch(/^https:\/\/cdn\.5e\.tools\//);
  expect.soft(out.runs.longsword.hooks).toEqual(["preCreateItem:Longsword", "createItem:Longsword"]);

  // CONTRADICTS the notes' `%2B1%20longsword_xdmg`: Plutonium lowercases the whole hash.
  expect.soft(find("+1 Longsword")?.flags?.hash).toBe("%2b1%20longsword_xdmg");
  expect.soft(find("+1 Longsword")?.systemType?.baseItem).toBe("longsword");

  // One create per entry, the bag first, contents carrying system.container in the create data.
  expect.soft(out.runs.pack.imported).toBe(9);
  expect.soft(out.runs.pack.hooks[0]).toBe("preCreateItem:Backpack");
  expect.soft(out.runs.pack.hooks.filter((h) => h.startsWith("createItem")).length).toBe(9);
  expect.soft(out.runs.pack.hooks.some((h) => h.startsWith("updateItem")), "no later update of contents").toBe(false);
  const bag = find("Backpack");
  expect.soft(bag?.type).toBe("container");
  expect.soft(bag?.equipped, "even the bag is equipped").toBe(true);
  expect.soft(items.filter((i) => i.container === bag?.id).map((i) => i.name).sort())
    .toEqual(["Caltrops", "Crowbar", "Oil", "Rations", "Rope", "Tinderbox", "Torch", "Waterskin"]);
  expect.soft(find("Waterskin")?.type, "a nested container").toBe("container");
  for (const name of ["Rope", "Tinderbox"]) {
    expect.soft(find(name)?.type).toBe("equipment");
    expect.soft(find(name)?.systemType?.value).toBe("trinket");
    expect.soft(find(name)?.equipped, `${name} is equipped inside the bag`).toBe(true);
  }

  // CONTRADICTS the assumption that the entry name carries over: "Arrows (20)" imports as a 20-strong
  // "Arrow", with the hash of the single item, not of the entry that was asked for.
  expect.soft(out.runs.arrows1.hash).toBe("arrows%20(20)_xphb");
  expect.soft(out.snapshot.arrowsAfterFirst.map((i) => [i.name, i.quantity, i.flags.hash])).toEqual([["Arrow", 20, "arrow_xphb"]]);
  expect.soft(out.runs.arrows1.hooks).toEqual(["preCreateItem:Arrow", "createItem:Arrow"]);
  expect.soft(out.runs.arrows2.hooks, "a stack merge is updateItem only").toEqual(["updateItem:Arrow"]);
  expect.soft(items.filter((i) => /^arrow/i.test(i.name)).map((i) => i.quantity), "one stack").toEqual([40]);

  // Creature: natural attack vs gear, as the notes say.
  const monster = (name) => out.snapshot.creature?.items.find((i) => i.name === name);
  expect.soft(out.snapshot.creature?.type).toBe("npc");
  expect.soft([monster("Grab")?.type, monster("Grab")?.systemType?.value, monster("Grab")?.flags?.page, monster("Grab")?.weight])
    .toEqual(["weapon", "natural", "monsterAction", 0]);
  expect.soft([monster("Light Hammer")?.flags?.page, monster("Light Hammer")?.weight, monster("Light Hammer")?.baseItem])
    .toEqual(["monsterAction", 2, "lighthammer"]);
  expect.soft([monster("Hide Armor")?.flags?.page, monster("Hide Armor")?.equipped, monster("Hide Armor")?.weight])
    .toEqual(["items.html", true, 12]);
  expect.soft(monster("Abduct")?.type, "traits are feats").toBe("feat");

  // Offline: the imports finished, and only images were ever asked of the blocked host.
  for (const url of blocked) expect.soft(url).toMatch(/\.(webp|png|jpg|jpeg|svg)(\?|$)/i);
  expect.soft(moduleErrors(errors)).toEqual([]);
});

test("S5 flags and nesting at preCreateItem", async ({ browser }) => {
  test.skip(!plutoniumInstalled(), "no Plutonium copy on this machine");
  const { ctx, page, errors } = await open(browser, PLUTONIUM, "Gamemaster");
  await clean(page);
  await installImportTools(page);
  const out = await page.evaluate(async (flag) => {
    const { log, importItem, stop } = globalThis.__imports;
    const actor = await Actor.create({ name: "Spike Nesting", type: "character", flags: { [flag.scope]: { [flag.key]: true } } });
    await importItem(actor, "Dungeoneer's Pack", "XPHB");
    stop();
    return log.filter((l) => l.hook === "preCreateItem");
  }, SPIKE_FLAG);
  record("S5", out);
  await clean(page);
  await ctx.close();

  expect.soft(out.length).toBeGreaterThan(3);
  const [bag, ...contents] = out;
  expect.soft(bag.type, "the container comes first").toBe("container");
  expect.soft(bag.container).toBeNull();
  expect.soft(out.map((entry) => entry.actorItems), "one create at a time").toEqual(out.map((_, i) => i));
  for (const entry of out) {
    expect.soft(entry.flags?.page, `${entry.name}: item.flags.plutonium is nested`).toBeTruthy();
    expect.soft(entry.dataFlat, `${entry.name}: no flattened keys in the data argument`).toEqual([]);
    expect.soft(entry.dataFlagsPlutonium?.page, `${entry.name}: data.flags.plutonium is nested`).toBeTruthy();
  }
  for (const entry of contents) {
    expect.soft(entry.container, `${entry.name}: system.container set at preCreate`).toBeTruthy();
    expect.soft(entry.parentInActor, `${entry.name}: its bag is already on the actor`).toBe(true);
  }
  expect.soft(moduleErrors(errors)).toEqual([]);
});

// -------------------------------------------------------------------------------------------------
// S3: kebab entries on dnd5e sheets. Hooks are temporary, in this page only.
// -------------------------------------------------------------------------------------------------
test("S3 kebab entries on dnd5e sheets", async ({ browser }) => {
  const { ctx, page, errors } = await open(browser, CLEAN, "Gamemaster");
  await clean(page);
  const ids = await page.evaluate(async ({ flag }) => {
    const actor = await Actor.create({ name: "Spike Sheets", type: "character", flags: { [flag.scope]: { [flag.key]: true } } });
    const [item, bag] = await actor.createEmbeddedDocuments("Item", [
      { name: "Spike Dagger", type: "weapon" }, { name: "Spike Bag", type: "container" }
    ]);
    const addEntry = (app, controls, name, hook) => {
      globalThis.__s3[hook].push(`${app.constructor.name}:${app.document.id}`);
      if (controls.some((c) => c.action === name)) return;
      controls.push({
        action: name, icon: "fa-solid fa-flask", label: name, visible: true,
        onClick: (...args) => globalThis.__s3.clicks.push({
          hook, sheet: app.constructor.name, doc: app.document.id,
          args: args.map((a) => a?.constructor?.name ?? typeof a)
        })
      });
    };
    globalThis.__s3 = { item5e: [], itemV2: [], documentV2: [], actorV2: [], clicks: [] };
    Hooks.on("getHeaderControlsItemSheet5e", (app, controls) => addEntry(app, controls, "Spike Item Entry", "item5e"));
    Hooks.on("getHeaderControlsItemSheetV2", (app) => globalThis.__s3.itemV2.push(app.constructor.name));
    Hooks.on("getHeaderControlsDocumentSheetV2", (app) => globalThis.__s3.documentV2.push(app.constructor.name));
    Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => addEntry(app, controls, "Spike Actor Entry", "actorV2"));
    return { actor: actor.id, item: item.id, bag: bag.id };
  }, { flag: SPIKE_FLAG });

  /** Open a sheet, open its kebab with the mouse, click our entry with the mouse. */
  const clickEntry = async (open, label) => {
    const sheetId = await page.evaluate(open, ids);
    const sheet = page.locator(`[id="${sheetId}"]`);
    await expect(sheet).toBeVisible();
    await sheet.locator("[data-action=toggleControls]").first().click();
    const entry = page.locator("#context-menu .context-item", { hasText: label });
    await expect(entry, `${label} is in the kebab of ${sheetId}`).toBeVisible();
    const clicksBefore = await page.evaluate(() => globalThis.__s3.clicks.length);
    await entry.click();
    await page.waitForFunction((n) => globalThis.__s3.clicks.length > n, clicksBefore, { timeout: 5000 });
    await expect(page.locator("#context-menu")).toHaveCount(0);
    return sheetId;
  };

  const itemSheet = await clickEntry(async ({ actor, item }) => {
    const sheet = game.actors.get(actor).items.get(item).sheet;
    await sheet.render({ force: true });
    return sheet.id;
  }, "Spike Item Entry");
  const bagSheet = await clickEntry(async ({ actor, bag }) => {
    const sheet = game.actors.get(actor).items.get(bag).sheet;
    await sheet.render({ force: true });
    return sheet.id;
  }, "Spike Item Entry");
  const actorSheet = await clickEntry(async ({ actor }) => {
    const sheet = game.actors.get(actor).sheet;
    await sheet.render({ force: true });
    return sheet.id;
  }, "Spike Actor Entry");

  const s3 = await page.evaluate(() => globalThis.__s3);
  record("S3", { itemSheet, bagSheet, actorSheet, ...s3, itemV2: s3.itemV2.length, documentV2: [...new Set(s3.documentV2)] });
  await clean(page);
  await ctx.close();

  expect(s3.item5e.some((s) => s.startsWith("ItemSheet5e:")), "fires on the item sheet").toBe(true);
  expect(s3.item5e.some((s) => s.startsWith("ContainerSheet:")), "fires on the container sheet").toBe(true);
  expect(s3.itemV2, "getHeaderControlsItemSheetV2 does not fire").toEqual([]);
  expect(s3.documentV2, "the common ancestor's hook fires on all three").toEqual(expect.arrayContaining(["ItemSheet5e", "ContainerSheet", "CharacterActorSheet"]));
  expect(s3.actorV2.length).toBeGreaterThan(0);
  expect(s3.clicks.every((c) => c.args[0] === "PointerEvent"), "onClick gets the pointer event").toBe(true);
  expect(s3.clicks.map((c) => c.sheet)).toEqual(["ItemSheet5e", "ContainerSheet", "CharacterActorSheet"]);
  expect(moduleErrors(errors)).toEqual([]);
});

// -------------------------------------------------------------------------------------------------
// S4: core file picker element for a Player without FILES_BROWSE (and the GM, for comparison).
// -------------------------------------------------------------------------------------------------
async function filePickerDialog(page) {
  await page.evaluate(() => {
    globalThis.__s4 = { result: "pending" };
    foundry.applications.api.DialogV2.prompt({
      window: { title: "Spike File Picker" },
      content: '<file-picker name="spike" type="image" value="icons/svg/item-bag.svg"></file-picker>',
      ok: {
        label: "Spike OK",
        callback: (_event, button) => button.form.elements.spike.value
      },
      rejectClose: false
    }).then((value) => { globalThis.__s4.result = value; });
  });
  const picker = page.locator("file-picker[name=spike]");
  await expect(picker).toBeVisible();
  return picker;
}

test("S4 file picker as Player and GM", async ({ browser }) => {
  const player = await open(browser, CLEAN, "Player");
  const picker = await filePickerDialog(player.page);
  const dom = await picker.evaluate((el) => ({
    outerHTML: el.outerHTML,
    can: game.user.can("FILES_BROWSE"),
    role: game.user.role,
    tag: customElements.get("file-picker")?.name,
    input: { disabled: el.input?.disabled, type: el.input?.type, value: el.input?.value },
    buttons: el.querySelectorAll("button").length
  }));
  const input = picker.locator("input");
  await input.click();
  await player.page.keyboard.press("Control+A");
  await player.page.keyboard.type("icons/svg/mystery-man.svg");
  await player.page.keyboard.press("Tab");
  const typed = await picker.evaluate((el) => el.value);
  await player.page.getByRole("button", { name: "Spike OK" }).click();
  await player.page.waitForFunction(() => globalThis.__s4.result !== "pending");
  const result = await player.page.evaluate(() => globalThis.__s4.result);
  await player.ctx.close();

  const gm = await open(browser, CLEAN, "Gamemaster");
  const gmPicker = await filePickerDialog(gm.page);
  const gmDom = await gmPicker.evaluate((el) => ({
    outerHTML: el.outerHTML, can: game.user.can("FILES_BROWSE"), buttons: el.querySelectorAll("button").length
  }));
  await gm.ctx.close();
  record("S4", { player: dom, typed, result, gm: gmDom });

  expect(dom.tag, "the element is registered as file-picker").toBeTruthy();
  expect(dom.can, "Player has no FILES_BROWSE").toBe(false);
  expect(dom.input.disabled).toBe(false);
  expect(dom.buttons, "the browse button is absent, not disabled").toBe(0);
  expect(typed).toBe("icons/svg/mystery-man.svg");
  expect(result, "the typed path reaches the form").toBe("icons/svg/mystery-man.svg");
  expect(gmDom.can).toBe(true);
  expect(gmDom.buttons).toBe(1);
  expect(moduleErrors(player.errors)).toEqual([]);
});

// -------------------------------------------------------------------------------------------------
// S6: custom operation keys on a second client; order of a same-batch container and its children.
// -------------------------------------------------------------------------------------------------
test("S6 operation markers and same-batch containers", async ({ browser }) => {
  const gm = await open(browser, CLEAN, "Gamemaster");
  await clean(gm.page);
  const actorId = await gm.page.evaluate(async (flag) => {
    const player = game.users.getName("Player");
    const actor = await Actor.create({
      name: "Spike Markers", type: "character",
      ownership: { default: 0, [player.id]: 3 }, flags: { [flag.scope]: { [flag.key]: true } }
    });
    await actor.createEmbeddedDocuments("Item", [{ name: "Spike Marked", type: "loot" }]);
    return actor.id;
  }, SPIKE_FLAG);
  const player = await open(browser, CLEAN, "Player");

  // Records every hook on both clients, including what was on the actor at that moment.
  const install = (page) => page.evaluate((actorId) => {
    const log = [];
    const here = (item) => (item.parent?.id === actorId ? item.parent : null);
    Hooks.on("updateItem", (item, changes, options, userId) => {
      if (here(item)) log.push({ hook: "updateItem", name: item.name, marker: options["attache-case"] ?? null, keys: Object.keys(options), mine: userId === game.user.id });
    });
    Hooks.on("preCreateItem", (item, _data, options) => {
      if (!here(item)) return;
      log.push({
        hook: "preCreateItem", name: item.name, marker: options["attache-case"] ?? null,
        parentOnActor: item.system.container ? Boolean(item.parent.items.get(item.system.container)) : null,
        onActor: item.parent.items.map((i) => i.name)
      });
    });
    Hooks.on("createItem", (item, options, userId) => {
      if (!here(item)) return;
      log.push({
        hook: "createItem", name: item.name, marker: options["attache-case"] ?? null, mine: userId === game.user.id,
        onActor: item.parent.items.map((i) => i.name)
      });
    });
    globalThis.__s6 = log;
  }, actorId);
  await install(gm.page);
  await install(player.page);

  const fromPlayer = await player.page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.getName("Spike Marked");
    await actor.updateEmbeddedDocuments("Item", [{ _id: item.id, "flags.world.spikeMark": 1 }], { "attache-case": { synced: true } });
    await item.update({ "flags.world.spikeMark": 2 }, { "attache-case": { synced: "item.update" } });
    const id = () => foundry.utils.randomID();
    const bagFirst = id();
    await actor.createEmbeddedDocuments("Item", [
      { _id: bagFirst, name: "Batch Bag A", type: "container" },
      { _id: id(), name: "Batch Child A1", type: "loot", system: { container: bagFirst } },
      { _id: id(), name: "Batch Child A2", type: "loot", system: { container: bagFirst } }
    ], { keepId: true, "attache-case": { placed: true } });
    const bagLast = id();
    await actor.createEmbeddedDocuments("Item", [
      { _id: id(), name: "Batch Child B1", type: "loot", system: { container: bagLast } },
      { _id: id(), name: "Batch Child B2", type: "loot", system: { container: bagLast } },
      { _id: bagLast, name: "Batch Bag B", type: "container" }
    ], { keepId: true });
    await new Promise((r) => setTimeout(r, 500));
    return globalThis.__s6;
  }, actorId);
  await gm.page.waitForTimeout(1000);
  const onGm = await gm.page.evaluate(() => globalThis.__s6);
  record("S6", { player: fromPlayer, gm: onGm });
  await clean(gm.page);
  await player.ctx.close();
  await gm.ctx.close();

  const updatesOnGm = onGm.filter((l) => l.hook === "updateItem");
  expect(updatesOnGm.length).toBe(2);
  expect(updatesOnGm[0].mine).toBe(false);
  expect(updatesOnGm[0].marker, "marker on the second client").toEqual({ synced: true });
  expect(updatesOnGm[1].marker).toEqual({ synced: "item.update" });
  for (const log of [fromPlayer, onGm]) {
    const created = (name) => log.find((l) => l.hook === "createItem" && l.name === name);
    for (const bag of ["Batch Bag A", "Batch Bag B"]) {
      const suffix = bag.slice(-1);
      expect(created(bag).onActor, `${bag}: all children are on the actor at its createItem`)
        .toEqual(expect.arrayContaining([`Batch Child ${suffix}1`, `Batch Child ${suffix}2`]));
    }
  }
  const createdOrder = onGm.filter((l) => l.hook === "createItem").map((l) => l.name);
  expect(createdOrder, "createItem follows batch order on the second client").toEqual([
    "Batch Bag A", "Batch Child A1", "Batch Child A2", "Batch Child B1", "Batch Child B2", "Batch Bag B"
  ]);
  expect(onGm.find((l) => l.name === "Batch Bag A").marker, "create marker on the second client").toEqual({ placed: true });
  expect(onGm.some((l) => l.hook === "preCreateItem"), "preCreateItem runs on the writing client only").toBe(false);
  const pre = (name) => fromPlayer.find((l) => l.hook === "preCreateItem" && l.name === name);
  expect(pre("Batch Child A1").parentOnActor, "preCreateItem of a child: parent not yet on the actor").toBe(false);
  expect(pre("Batch Child B1").parentOnActor).toBe(false);
  expect(moduleErrors(gm.errors)).toEqual([]);
  expect(moduleErrors(player.errors)).toEqual([]);
});

// -------------------------------------------------------------------------------------------------
// S7: a Player owner writes system.container and system.equipped; AC follows.
// -------------------------------------------------------------------------------------------------
test("S7 Player writes container and equipped, AC follows", async ({ browser }) => {
  const gm = await open(browser, CLEAN, "Gamemaster");
  await clean(gm.page);
  const actorId = await gm.page.evaluate(async ({ flag, fromPack }) => {
    const pick = (0, eval)(`(${fromPack})`);
    const packed = await pick(["Chain Mail"]);
    const player = game.users.getName("Player");
    const actor = await Actor.create({
      name: "Spike Armor", type: "character",
      ownership: { default: 0, [player.id]: 3 }, flags: { [flag.scope]: { [flag.key]: true } }
    });
    await actor.createEmbeddedDocuments("Item", [
      { ...packed["Chain Mail"], system: { ...packed["Chain Mail"].system, equipped: false } },
      { name: "Spike Pouch", type: "container" },
      { name: "Spike Rock", type: "loot" }
    ]);
    return actor.id;
  }, { flag: SPIKE_FLAG, fromPack: FROM_PACK.toString() });
  const player = await open(browser, CLEAN, "Player");

  const out = await player.page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const mail = actor.items.getName("Chain Mail");
    const rock = actor.items.getName("Spike Rock");
    const bag = actor.items.getName("Spike Pouch");
    const res = {};
    const ac = () => actor.system.attributes.ac.value;

    await rock.update({ "system.container": bag.id });
    res.viaItemUpdate = rock.system.container;
    res.bagContents = (await bag.system.contents)?.size ?? [...(bag.system.contents ?? [])].length;
    await actor.updateEmbeddedDocuments("Item", [{ _id: rock.id, "system.container": null }]);
    res.viaEmbedded = rock.system.container;
    await actor.update({ items: [{ _id: rock.id, "system.container": bag.id }] }).catch((e) => { res.actorUpdateError = String(e); });
    res.viaActorUpdate = rock.system.container;

    res.acBefore = ac();
    const hook = new Promise((resolve) => {
      const id = Hooks.on("updateItem", (item) => {
        if (item.id !== mail.id) return;
        Hooks.off("updateItem", id);
        resolve({ inHook: ac(), mailEquippedInHook: item.system.equipped });
      });
    });
    await mail.update({ "system.equipped": true });
    Object.assign(res, await hook);
    res.acAfter = ac();
    await mail.update({ "system.equipped": false });
    res.acOff = ac();
    return res;
  }, actorId);
  const onGm = await gm.page.evaluate((actorId) => game.actors.get(actorId).system.attributes.ac.value, actorId);
  record("S7", { ...out, acOnGmAfterOff: onGm });
  await clean(gm.page);
  await player.ctx.close();
  await gm.ctx.close();

  expect(out.viaEmbedded, "updateEmbeddedDocuments clears system.container").toBeNull();
  expect(out.viaItemUpdate, "item.update sets system.container").toBeTruthy();
  expect(out.viaActorUpdate, "actor.update with an items array also writes it").toBeTruthy();
  expect(out.actorUpdateError).toBeUndefined();
  expect(out.bagContents).toBe(1);
  expect(out.inHook, "AC is already recomputed inside the updateItem hook").toBe(16);
  expect(out.acBefore).toBe(10);
  expect(out.acAfter, "Chain Mail gives AC 16").toBe(16);
  expect(out.acOff).toBe(10);
  expect(onGm).toBe(10);
  expect(moduleErrors(player.errors)).toEqual([]);
});
