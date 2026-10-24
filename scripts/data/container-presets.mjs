/**
 * Ready-made containers, usable in both eras (1920s CoC and modern CoC / Delta Green).
 * Same scale as default-sizes.mjs (one cell ~ 10 cm). Reference loads:
 * the 9x5 Attaché Case takes a rifle (9x2) plus sidearms; a Backpack (8x6) takes a shotgun but
 * not a rifle; a Gun Case or Duffel Bag (12 columns) takes anything up to a Lewis gun (12x3).
 *
 * Icons are core Foundry icons. CoC7/DG only reference `icons/svg/*`, so every path below was
 * cross-checked against the item compendiums of the dnd5e system (6.0.6, maintained by Foundry,
 * compatibility minimum 14.367), which reference the same core files.
 */

/**
 * @typedef {object} ContainerPreset
 * @property {string} key          stable identifier
 * @property {string} name         i18n key, ATTACHE.Preset.<Key>.Name
 * @property {string} description  i18n key, ATTACHE.Preset.<Key>.Description
 * @property {number} cols
 * @property {number} rows
 * @property {string} img          core Foundry icon path
 */

/** @param {string} key camelCase key @returns {string} PascalCase i18n segment */
const i18nKey = (key) => key.charAt(0).toUpperCase() + key.slice(1);

const preset = (key, cols, rows, img) => Object.freeze({
  key,
  name: `ATTACHE.Preset.${i18nKey(key)}.Name`,
  description: `ATTACHE.Preset.${i18nKey(key)}.Description`,
  cols,
  rows,
  img
});

/** @type {ReadonlyArray<ContainerPreset>} smallest to largest */
export const CONTAINER_PRESETS = Object.freeze([
  preset("beltPouch", 3, 2, "icons/containers/bags/pouch-leather-silver-brown.webp"),
  preset("coatPockets", 4, 2, "icons/equipment/back/mantle-collared-black.webp"),
  preset("tacticalVest", 6, 3, "icons/equipment/chest/vest-cloth-tattered-tan.webp"),
  preset("satchel", 6, 4, "icons/containers/bags/sack-simple-leather-tan.webp"),
  preset("doctorsBag", 6, 5, "icons/containers/bags/pack-leather-black-brown.webp"),
  preset("attacheCase", 9, 5, "icons/containers/chest/chest-simple-box-brown.webp"),
  preset("backpack", 8, 6, "icons/containers/bags/pack-leather-tan.webp"),
  preset("gunCase", 12, 3, "icons/containers/boxes/crate-heavy-yellow.webp"),
  preset("suitcase", 10, 6, "icons/containers/chest/chest-elm-steel-brown.webp"),
  preset("militaryRucksack", 10, 7, "icons/containers/bags/pack-leather-brown.webp"),
  preset("duffelBag", 12, 6, "icons/containers/bags/sack-cloth-green-blue.webp"),
  preset("steamerTrunk", 14, 8, "icons/containers/chest/chest-reinforced-steel-red.webp")
]);

/**
 * Localized strings for the presets, shaped like the lang files so they can be merged into
 * lang/en.json and lang/pt-BR.json.
 */
export const PRESET_STRINGS = Object.freeze({
  en: {
    ATTACHE: {
      Preset: {
        BeltPouch: {
          Name: "Belt Pouch",
          Description: "A small leather pouch on the belt. Ammunition, a lighter, a few keys."
        },
        CoatPockets: {
          Name: "Coat Pockets",
          Description: "The deep pockets of an overcoat or field jacket. Room for a handgun and small things."
        },
        TacticalVest: {
          Name: "Tactical Vest",
          Description: "Load-bearing vest with magazine and utility pouches. Everything within reach."
        },
        Satchel: {
          Name: "Satchel",
          Description: "Shoulder bag for notebooks, a camera and the day's essentials."
        },
        DoctorsBag: {
          Name: "Doctor's Bag",
          Description: "Hinged leather medical bag. Fits a first aid kit, instruments and a revolver."
        },
        AttacheCase: {
          Name: "Attaché Case",
          Description: "A rigid case with a foam-lined interior. Packed well, it holds a rifle and sidearms."
        },
        Backpack: {
          Name: "Backpack",
          Description: "Everyday canvas or nylon backpack. Takes a shotgun, but not a full-length rifle."
        },
        GunCase: {
          Name: "Gun Case",
          Description: "Long hard case for rifles and shotguns. Not much room for anything else."
        },
        Suitcase: {
          Name: "Suitcase",
          Description: "Travel suitcase. Plenty of room, but slow to open in a hurry."
        },
        MilitaryRucksack: {
          Name: "Military Rucksack",
          Description: "Framed field pack for long operations and expeditions."
        },
        DuffelBag: {
          Name: "Duffel Bag",
          Description: "Long cylindrical kit bag. Fits long guns and a lot of gear."
        },
        SteamerTrunk: {
          Name: "Steamer Trunk",
          Description: "Heavy travel trunk for an expedition. Not something you carry while running."
        }
      }
    }
  },
  "pt-BR": {
    ATTACHE: {
      Preset: {
        BeltPouch: {
          Name: "Bolsa de Cinto",
          Description: "Uma pequena bolsa de couro presa ao cinto. Munição, um isqueiro, algumas chaves."
        },
        CoatPockets: {
          Name: "Bolsos do Casaco",
          Description: "Os bolsos fundos de um sobretudo ou jaqueta de campo. Cabe uma arma curta e coisas pequenas."
        },
        TacticalVest: {
          Name: "Colete Tático",
          Description: "Colete de carga com porta-carregadores e bolsos utilitários. Tudo ao alcance da mão."
        },
        Satchel: {
          Name: "Bolsa a Tiracolo",
          Description: "Bolsa de ombro para cadernos, uma câmera e o essencial do dia."
        },
        DoctorsBag: {
          Name: "Maleta de Médico",
          Description: "Maleta médica de couro com fecho. Cabe um kit de primeiros socorros, instrumentos e um revólver."
        },
        AttacheCase: {
          Name: "Maleta Attaché",
          Description: "Uma maleta rígida forrada de espuma. Bem organizada, leva um fuzil e armas curtas."
        },
        Backpack: {
          Name: "Mochila",
          Description: "Mochila comum de lona ou náilon. Cabe uma espingarda, mas não um fuzil inteiro."
        },
        GunCase: {
          Name: "Case de Armas",
          Description: "Estojo rígido e comprido para fuzis e espingardas. Sobra pouco espaço para outras coisas."
        },
        Suitcase: {
          Name: "Mala de Viagem",
          Description: "Mala de viagem. Muito espaço, mas demorada de abrir com pressa."
        },
        MilitaryRucksack: {
          Name: "Mochila Militar",
          Description: "Mochila de campanha com armação, para operações longas e expedições."
        },
        DuffelBag: {
          Name: "Bolsa de Lona",
          Description: "Bolsa cilíndrica e comprida. Cabe armas longas e muito equipamento."
        },
        SteamerTrunk: {
          Name: "Baú de Viagem",
          Description: "Baú pesado para expedições. Não é algo para carregar correndo."
        }
      }
    }
  }
});
