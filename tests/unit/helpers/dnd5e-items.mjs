/**
 * Raw dnd5e item data shaped as `system.*` and `flags.plutonium` have it live
 * (see `.llm/dnd5e-api.md` and `.llm/foundry-v14-api.md` section 21).
 */

/**
 * @param {object} spec
 * @param {string} spec.name
 * @param {string} [spec.type="loot"]
 * @param {string} [spec.value] `system.type.value`; absent for containers
 * @param {string} [spec.subtype]
 * @param {string} [spec.baseItem]
 * @param {number} [spec.weight=0]
 * @param {string} [spec.units="lb"]
 * @param {string} [spec.page] `flags.plutonium.page`
 * @param {string} [spec.hash] `flags.plutonium.hash`
 * @param {string[]} [spec.properties]
 * @param {string} [spec.identifier] `system.identifier`
 * @param {string} [spec.actorType] type of the owning actor
 * @param {object} [spec.ours] flags under attache-case
 * @param {object} [spec.system] merged last into `system`
 * @returns {object}
 */
export function item({
  name, type = "loot", value, subtype, baseItem, weight = 0, units = "lb", page, hash, properties = [], identifier,
  actorType, ours, system = {}
}) {
  const data = {
    name,
    type,
    system: { weight: { value: weight, units }, properties, quantity: 1, ...system },
    flags: {}
  };
  if (type !== "container") data.system.type = { value: value ?? "", subtype: subtype ?? "", baseItem: baseItem ?? "" };
  if (identifier) data.system.identifier = identifier;
  if (page || hash) data.flags.plutonium = { page, hash, source: "XPHB" };
  if (ours) data.flags["attache-case"] = ours;
  if (actorType) data.parent = { type: actorType };
  return data;
}

/** A longsword with everything a real import carries. */
export const LONGSWORD = { type: "weapon", value: "martialM", baseItem: "longsword", weight: 3 };
