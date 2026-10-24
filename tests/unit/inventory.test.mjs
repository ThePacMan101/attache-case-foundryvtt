import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installFoundry } from "./helpers/fake-foundry.mjs";

const env = installFoundry({ system: "CoC7" });
const svc = await import("../../scripts/foundry/inventory.mjs");
const { registerHooks } = await import("../../scripts/foundry/hooks.mjs");
const { registerQueries } = await import("../../scripts/foundry/queries.mjs");

const M = "attache-case";
const pos = (c, x, y, r = false) => ({ c, x, y, r });
const flags = (f) => ({ [M]: f });
const gun = (extra = {}) => ({ name: "Revolver", type: "weapon", flags: flags({ size: { w: 3, h: 2 }, ...extra }) });
const small = (name, extra = {}) => ({ name, type: "item", flags: flags({ size: { w: 1, h: 1 }, ...extra }) });
const lastUpdate = (actor) => actor.log.filter((l) => l.op === "update").at(-1)?.updates;
const isDel = (v) => v instanceof foundry.data.operators.ForcedDeletion;

beforeAll(() => {
  registerHooks();
  registerQueries();
});

beforeEach(() => {
  env.actors.clear();
  env.notifications.length = 0;
  env.settings.set(`${M}.autoPlace`, true);
  env.settings.set(`${M}.allowWorn`, true);
  game.user.isGM = false;
});

describe("getState", () => {
  it("builds body + containers, worn, excluded and overflow lists", () => {
    const actor = env.addActor({
      items: [
        { ...gun({ pos: pos("body", 0, 0) }), _id: "gun" },
        { name: "Backpack", type: "item", _id: "pack", sort: 5, flags: flags({ container: { cols: 8, rows: 6 } }) },
        { name: "Unarmed", type: "weapon", _id: "fist", flags: { CoC7: { cocidFlag: { id: "i.weapon.brawl" } } } },
        { name: "Spot Hidden", type: "skill", _id: "skill" },
        { name: "Vest", type: "armor", _id: "vest", flags: flags({ worn: true, size: { w: 4, h: 3 } }) },
        { ...small("Lost"), _id: "lost", flags: flags({ size: { w: 1, h: 1 }, pos: pos("gone", 0, 0) }) }
      ]
    });
    const s = svc.getState(actor);
    expect(s.containers.map((c) => [c.id, c.cols, c.rows])).toEqual([["body", 5, 3], ["pack", 8, 6]]);
    expect(s.layout.placed.get("gun")).toMatchObject({ c: "body", x: 0, y: 0 });
    expect(s.worn.map((i) => i.id)).toEqual(["vest"]);
    expect(s.excluded.map((i) => i.id)).toEqual(["fist"]);
    expect(s.overflow.map((i) => i.id)).toEqual(["lost"]);
    expect(s.entries.has("skill")).toBe(false);
    const cap = svc.capacity(s);
    expect(cap.total).toBe(15 + 48);
    expect(cap.used).toBe(6);
  });

  it("uses the actor body flag, and 0x0 removes the body grid", () => {
    const actor = env.addActor({ flags: flags({ body: { cols: 0, rows: 0 } }) });
    expect(svc.getState(actor).containers).toEqual([]);
    const other = env.addActor({ flags: flags({ body: { cols: 7, rows: 2 } }) });
    expect(svc.bodyDims(other)).toEqual({ cols: 7, rows: 2, custom: true });
  });

  it("ignores worn flags when worn armor is disabled", () => {
    env.settings.set(`${M}.allowWorn`, false);
    const actor = env.addActor({ items: [{ name: "Vest", type: "armor", _id: "vest", flags: flags({ worn: true }) }] });
    const s = svc.getState(actor);
    expect(s.worn).toEqual([]);
    expect(s.overflow.map((i) => i.id)).toEqual(["vest"]);
  });

  it("getLayout returns plain data", () => {
    const actor = env.addActor({ items: [{ ...gun({ pos: pos("body", 1, 1) }), _id: "gun" }] });
    const l = svc.getLayout(actor);
    expect(l.placed.gun).toEqual({ c: "body", x: 1, y: 1, r: false, w: 3, h: 2 });
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });
});

describe("placement operations", () => {
  it("moves an item with one minimal update and rejects invalid moves", async () => {
    const actor = env.addActor({ items: [{ ...gun({ pos: pos("body", 0, 0) }), _id: "gun" }, { ...small("Key", { pos: pos("body", 4, 0) }), _id: "key" }] });
    expect(await svc.moveItem(actor, "gun", pos("body", 2, 0))).toBe(false); // overlaps the key
    expect(actor.log).toEqual([]);
    expect(await svc.moveItem(actor, "gun", pos("body", 0, 1))).toBe(true);
    expect(lastUpdate(actor)).toEqual([{ _id: "gun", [`flags.${M}.pos`]: pos("body", 0, 1) }]);
  });

  it("moving a worn item into the grid clears worn", async () => {
    const actor = env.addActor({ items: [{ name: "Vest", type: "armor", _id: "vest", flags: flags({ worn: true, size: { w: 2, h: 2 } }) }] });
    expect(await svc.moveItem(actor, "vest", pos("body", 0, 0))).toBe(true);
    const [u] = lastUpdate(actor);
    expect(u[`flags.${M}.pos`]).toEqual(pos("body", 0, 0));
    expect(isDel(u[`flags.${M}.worn`])).toBe(true);
    expect(actor.items.get("vest").getFlag(M, "worn")).toBeUndefined();
  });

  it("stows with the v14 deletion operator and skips no-op writes", async () => {
    const actor = env.addActor({ items: [{ ...gun({ pos: pos("body", 0, 0) }), _id: "gun" }, { ...small("Loose"), _id: "loose" }] });
    await svc.stowItem(actor, "gun");
    expect(isDel(lastUpdate(actor)[0][`flags.${M}.pos`])).toBe(true);
    actor.log.length = 0;
    await svc.stowItem(actor, "loose");
    expect(actor.log).toEqual([]);
  });

  it("wears armor only", async () => {
    const actor = env.addActor({ items: [{ name: "Vest", type: "armor", _id: "vest", flags: flags({ pos: pos("body", 0, 0) }) }, { ...gun(), _id: "gun" }] });
    expect(await svc.wearItem(actor, "gun")).toBe(false);
    expect(env.notifications.at(-1).type).toBe("warn");
    expect(await svc.wearItem(actor, "vest")).toBe(true);
    const [u] = lastUpdate(actor);
    expect(u[`flags.${M}.worn`]).toBe(true);
    expect(isDel(u[`flags.${M}.pos`])).toBe(true);
  });

  it("rotates in place, nudging into bounds, and warns when impossible", async () => {
    const actor = env.addActor({ items: [{ ...gun({ pos: pos("body", 2, 1) }), _id: "gun" }] });
    // 3x2 at (2,1) in 5x3 -> rotated 2x3 does not fit at y=1, nudged to y=0.
    expect(await svc.rotateInPlace(actor, "gun")).toBe(true);
    expect(lastUpdate(actor)[0][`flags.${M}.pos`]).toEqual(pos("body", 2, 0, true));
    const blocked = env.addActor({ flags: flags({ body: { cols: 3, rows: 2 } }), items: [{ ...gun({ pos: pos("body", 0, 0) }), _id: "gun" }] });
    expect(await svc.rotateInPlace(blocked, "gun")).toBe(false);
    expect(env.notifications.at(-1).msg).toContain("ATTACHE.Notify.CannotRotate");
  });

  it("auto-arranges in one batched update touching only changed items", async () => {
    const actor = env.addActor({
      items: [
        { ...gun({ pos: pos("body", 0, 0) }), _id: "gun" },
        { ...small("A", { pos: pos("body", 4, 2) }), _id: "a", sort: 1 },
        { ...small("B"), _id: "b", sort: 2 },
        { name: "Vest", type: "armor", _id: "vest", flags: flags({ worn: true }) }
      ]
    });
    await svc.autoArrange(actor);
    const updates = actor.log.filter((l) => l.op === "update");
    expect(updates).toHaveLength(1);
    const ids = updates[0].updates.map((u) => u._id).sort();
    expect(ids).toEqual(["a", "b"]); // the gun already sits at the top-left; worn armor untouched
    const s = svc.getState(actor);
    expect(s.overflow).toEqual([]);
  });

  it("packs unstowed items without moving placed ones", async () => {
    const actor = env.addActor({ items: [{ ...gun({ pos: pos("body", 1, 1) }), _id: "gun" }, { ...small("A"), _id: "a" }, { name: "Huge", type: "item", _id: "huge", flags: flags({ size: { w: 9, h: 9 } }) }] });
    const r = await svc.packUnstowed(actor);
    expect(r).toEqual({ placed: 1, remaining: 1 });
    expect(lastUpdate(actor).map((u) => u._id)).toEqual(["a"]);
  });
});

describe("transfers", () => {
  it("creates on the target first, then deletes the source", async () => {
    const a = env.addActor({ items: [{ ...gun({ pos: pos("body", 0, 0) }), _id: "gun" }] });
    const b = env.addActor({ name: "B" });
    const ok = await svc.transferItem(a.items.get("gun"), b, { kind: "cell", pos: pos("body", 2, 1) });
    expect(ok).toBe(true);
    expect(a.items.size).toBe(0);
    const [created] = [...b.items.values()];
    expect(created.getFlag(M, "pos")).toEqual(pos("body", 2, 1));
    expect(b.log[0].op).toBe("create");
    expect(a.log.at(-1).op).toBe("delete");
  });

  it("falls back to any free spot (rotated if needed) and rolls back when the delete fails", async () => {
    const a = env.addActor({ items: [{ ...gun(), _id: "gun" }] });
    const b = env.addActor({ name: "B", flags: flags({ body: { cols: 2, rows: 3 } }) });
    a.failDelete = true;
    const ok = await svc.transferItem(a.items.get("gun"), b, { kind: "cell", pos: pos("body", 5, 5) });
    expect(ok).toBe(false);
    expect(a.items.size).toBe(1); // source kept
    expect(b.items.size).toBe(0); // copy rolled back
    expect(b.log.find((l) => l.op === "create").datas[0].flags[M].pos).toEqual(pos("body", 0, 0, true));
    expect(env.notifications.at(-1).type).toBe("error");
  });

  it("relays to the GM when the target is not owned, and the GM validates ownership", async () => {
    const a = env.addActor({ items: [{ ...gun(), _id: "gun" }] });
    const b = env.addActor({ name: "Friend", owner: false, playerOwner: true });
    env.gm.queries.length = 0;
    const ok = await svc.transferItem(a.items.get("gun"), b);
    expect(ok).toBe(true);
    expect(env.gm.queries[0].name).toBe(`${M}.transfer`);
    expect(b.items.size).toBe(1);
    expect(a.items.size).toBe(0);
  });

  it("the GM handler rejects a requester that does not own the source", async () => {
    const a = env.addActor({ owner: false, items: [{ ...gun(), _id: "gun" }] });
    const b = env.addActor({ playerOwner: true });
    const res = await CONFIG.queries[`${M}.transfer`](
      { itemUuid: a.items.get("gun").uuid, targetUuid: b.uuid, userId: "user1" }, { user: game.user }
    );
    expect(res).toEqual({ ok: false, error: "notGM" });
    game.user.isGM = true;
    const sender = { id: "user1", isGM: false, documentName: "User" };
    const res2 = await CONFIG.queries[`${M}.transfer`]({ itemUuid: a.items.get("gun").uuid, targetUuid: b.uuid }, { user: sender });
    expect(res2).toEqual({ ok: false, error: "notOwner" });
    // The sender comes only from core's query context, never from the (spoofable) query data.
    const res3 = await CONFIG.queries[`${M}.transfer`]({ itemUuid: a.items.get("gun").uuid, targetUuid: b.uuid, userId: "gm1" }, {});
    expect(res3).toEqual({ ok: false, error: "unknownUser" });
    expect(a.items.size).toBe(1);
  });

  it("the GM handler only relays physical inventory items", async () => {
    const a = env.addActor({ items: [{ _id: "sk", name: "Spot Hidden", type: "skill" }] });
    const b = env.addActor({ playerOwner: true });
    game.user.isGM = true;
    const sender = { id: "user1", isGM: false, documentName: "User" };
    const res = await CONFIG.queries[`${M}.transfer`]({ itemUuid: a.items.get("sk").uuid, targetUuid: b.uuid }, { user: sender });
    expect(res).toEqual({ ok: false, error: "invalid" });
    expect(a.items.size).toBe(1);
    expect(b.items.size).toBe(0);
  });

  it("refuses targets without a player owner and warns when no GM is online", async () => {
    const a = env.addActor({ items: [{ ...gun(), _id: "gun" }] });
    const npc = env.addActor({ owner: false, playerOwner: false });
    expect(await svc.transferItem(a.items.get("gun"), npc)).toBe(false);
    const friend = env.addActor({ owner: false, playerOwner: true });
    const gm = game.users.activeGM;
    game.users.activeGM = null;
    expect(await svc.transferItem(a.items.get("gun"), friend)).toBe(false);
    expect(env.notifications.at(-1).msg).toContain("ATTACHE.Notify.NoGM");
    game.users.activeGM = gm;
    expect(a.items.size).toBe(1);
  });
});

describe("drops and creation", () => {
  it("dropping a world item on a cell creates it there (rotated if only that fits)", async () => {
    const actor = env.addActor({ flags: flags({ body: { cols: 2, rows: 4 } }) });
    const source = env.addActor({ items: [{ ...gun(), _id: "src" }] });
    const created = await svc.addFromDrop(actor, { type: "Item", uuid: source.items.get("src").uuid }, { kind: "cell", pos: pos("body", 0, 1) });
    expect(created.getFlag(M, "pos")).toEqual(pos("body", 0, 1, true));
    expect(source.items.size).toBe(1); // HTML5 drops copy, like core sheets
  });

  it("dropping an item of the same actor just moves it", async () => {
    const actor = env.addActor({ items: [{ ...small("Key", { pos: pos("body", 0, 0) }), _id: "key" }] });
    await svc.addFromDrop(actor, { type: "Item", uuid: actor.items.get("key").uuid }, { kind: "cell", pos: pos("body", 3, 2) });
    expect(actor.items.size).toBe(1);
    expect(actor.items.get("key").getFlag(M, "pos")).toEqual(pos("body", 3, 2));
  });

  it("ignores non-inventory items", async () => {
    const actor = env.addActor();
    const source = env.addActor({ items: [{ name: "Spot Hidden", type: "skill", _id: "sk" }] });
    expect(await svc.addFromDrop(actor, { type: "Item", uuid: source.items.get("sk").uuid }, { kind: "auto" })).toBeNull();
    expect(actor.items.size).toBe(0);
  });

  it("auto-places a multi-item create without overlaps (cells reserved across preCreate calls)", async () => {
    const actor = env.addActor();
    await actor.createEmbeddedDocuments("Item", [gun(), gun(), small("Key"), gun()]);
    const s = svc.getState(actor);
    // 5x3 body: one revolver (3x2), the key, then the rest overflows; nothing overlaps.
    expect(s.layout.placed.size + s.overflow.length).toBe(4);
    expect(s.layout.placed.size).toBeGreaterThanOrEqual(2);
    const raw = [...actor.items.values()].map((i) => i.getFlag(M, "pos")).filter(Boolean);
    expect(raw.length).toBe(s.layout.placed.size);
    expect(env.notifications.filter((n) => n.type === "info")).toHaveLength(0); // aggregated, async
    await new Promise((r) => setTimeout(r, 80));
    expect(env.notifications.filter((n) => n.type === "info")).toHaveLength(1);
  });

  it("does not auto-place when the setting is off, and keeps a valid copied pos", async () => {
    env.settings.set(`${M}.autoPlace`, false);
    const actor = env.addActor();
    await actor.createEmbeddedDocuments("Item", [small("Key")]);
    expect([...actor.items.values()][0].getFlag(M, "pos")).toBeUndefined();
    env.settings.set(`${M}.autoPlace`, true);
    await actor.createEmbeddedDocuments("Item", [small("Coin", { pos: pos("body", 4, 2) })]);
    expect(actor.items.find((i) => i.name === "Coin").getFlag(M, "pos")).toEqual(pos("body", 4, 2));
  });

  it("adding a preset container localizes its name and packs unstowed items into it", async () => {
    const actor = env.addActor({ flags: flags({ body: { cols: 0, rows: 0 } }), items: [{ ...gun(), _id: "gun" }] });
    const pack = await svc.addPresetContainer(actor, "backpack");
    expect(pack.type).toBe("item");
    expect(pack.name).toBe("ATTACHE.Preset.Backpack.Name");
    expect(pack.getFlag(M, "container")).toEqual({ cols: 8, rows: 6 });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.items.get("gun").getFlag(M, "pos")).toMatchObject({ c: pack.id, x: 0, y: 0 });
  });

  it("removing a container repacks its contents elsewhere or unstows them", async () => {
    const actor = env.addActor({
      items: [
        { name: "Bag", type: "item", _id: "bag", flags: flags({ container: { cols: 6, rows: 4 } }) },
        { ...small("Key", { pos: pos("bag", 5, 3) }), _id: "key" },
        { name: "Rifle", type: "weapon", _id: "rifle", flags: flags({ size: { w: 6, h: 2 }, pos: pos("bag", 0, 0) }) }
      ]
    });
    await svc.removeContainer(actor, "bag");
    expect(actor.items.has("bag")).toBe(false);
    expect(actor.items.get("key").getFlag(M, "pos")).toMatchObject({ c: "body" });
    expect(actor.items.get("rifle").getFlag(M, "pos")).toBeUndefined();
  });
});

describe("configuration writes", () => {
  it("writes only changed flags and removes flags with the deletion operator", async () => {
    const actor = env.addActor({ items: [{ ...gun(), _id: "gun" }] });
    const item = actor.items.get("gun");
    await svc.setItemConfig(item, { size: { w: 3, h: 2 } });
    expect(actor.log).toEqual([]); // unchanged
    await svc.setItemConfig(item, { size: null, excluded: true });
    const [u] = lastUpdate(actor);
    expect(isDel(u[`flags.${M}.size`])).toBe(true);
    expect(u[`flags.${M}.excluded`]).toBe(true);
  });

  it("including a registry-excluded item forces excluded:false", async () => {
    const actor = env.addActor({ items: [{ name: "Unarmed", type: "weapon", _id: "fist", flags: { CoC7: { cocidFlag: { id: "i.weapon.brawl" } } } }] });
    await svc.toggleExcluded(actor.items.get("fist"));
    expect(lastUpdate(actor)[0][`flags.${M}.excluded`]).toBe(false);
    expect(svc.getState(actor).overflow.map((i) => i.id)).toEqual(["fist"]);
  });

  it("making an item a container unsets its pos", async () => {
    const actor = env.addActor({ items: [{ ...small("Box", { pos: pos("body", 0, 0) }), _id: "box" }] });
    await svc.setItemConfig(actor.items.get("box"), { container: { cols: 4, rows: 4 } });
    const [u] = lastUpdate(actor);
    expect(u[`flags.${M}.container`]).toEqual({ cols: 4, rows: 4 });
    expect(isDel(u[`flags.${M}.pos`])).toBe(true);
  });

  it("body reset deletes the actor flag; registerSizes extends the registry", async () => {
    const actor = env.addActor({ flags: flags({ body: { cols: 2, rows: 2 } }) });
    await svc.setBody(actor, null);
    expect(actor.getFlag(M, "body")).toBeUndefined();
    svc.registerSizes({ byName: { CoC7: { "magic lamp": { w: 2, h: 3 } } } });
    expect(svc.itemSize({ name: "Magic Lamp", type: "item", flags: {} }).size).toEqual({ w: 2, h: 3 });
    expect(() => svc.registerSizes(null)).toThrow();
  });
});

describe("review fixes", () => {
  it("two concurrent transfers of the same item leave exactly one copy", async () => {
    const a = env.addActor({ items: [{ ...gun({ pos: pos("body", 0, 0) }), _id: "gun" }] });
    const b = env.addActor({ name: "B" });
    const c = env.addActor({ name: "C" });
    const item = a.items.get("gun");
    const before = env.notifications.length;
    const results = await Promise.all([svc.transferItem(item, b), svc.transferItem(item, c)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    // The loser of the race is silent: one "given" notice, no error.
    expect(env.notifications.slice(before).map((n) => n.type)).toEqual(["info"]);
    expect(a.items.size).toBe(0);
    expect(b.items.size + c.items.size).toBe(1);
    // A third attempt on the already-gone item never creates anything.
    await expect(svc.executeTransfer(item, c)).rejects.toThrow();
    expect(b.items.size + c.items.size).toBe(1);
  });

  it("resizing a container keeps the pos of displaced items and packs only the other unstowed ones", async () => {
    const actor = env.addActor({
      flags: flags({ body: { cols: 2, rows: 2 } }),
      items: [
        { name: "Bag", type: "item", _id: "bag", flags: flags({ container: { cols: 4, rows: 4 } }) },
        { ...small("Key", { pos: pos("bag", 3, 3) }), _id: "key" },
        { ...small("Coin"), _id: "coin" }
      ]
    });
    const bag = actor.items.get("bag");
    const changed = { flags: { [M]: { container: { cols: 2, rows: 2 } } } };
    await actor.updateEmbeddedDocuments("Item", [{ _id: "bag", [`flags.${M}.container`]: { cols: 2, rows: 2 } }]);
    Hooks.call("updateItem", bag, changed, {}, game.user.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.items.get("key").getFlag(M, "pos")).toEqual(pos("bag", 3, 3)); // kept for when the bag grows back
    expect(actor.items.get("coin").getFlag(M, "pos")).toMatchObject({ c: "body", x: 0, y: 0 });
    expect(svc.getState(actor).overflow.map((i) => i.id)).toEqual(["key"]);
  });
});
