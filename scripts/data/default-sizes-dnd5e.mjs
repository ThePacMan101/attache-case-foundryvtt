/**
 * Default item footprints for dnd5e: a registry fragment that scripts/data/default-sizes.mjs adds to
 * DEFAULT_REGISTRY. Only sizes and item names. Rule order and table shapes: scripts/core/sizes.mjs.
 *
 * Scale (D-003): the CoC7 family of footprints, one cell about 10 cm, with long weapons capped at length 8
 * so common kit fits the 8x5 body. Pike and lance stay 10x1, in Unstowed unless the bag is large.
 * Anchors: dagger 2x1, shortsword 4x1, longsword 6x1, greatsword 8x2, greataxe 6x3, quarterstaff 8x1,
 * spear 8x1, shortbow 6x2, longbow 8x2, light crossbow 6x3, potion 1x1, scroll 2x1, arrows 2x1, rope 2x2,
 * plate 4x5, shield 3x3.
 */

const s = (w, h) => Object.freeze({ w, h });

const IRREGULAR = Object.freeze({ knife: "knives", quarterstaff: "quarterstaves", staff: "staves" });

function plural(name) {
  if (IRREGULAR[name]) return IRREGULAR[name];
  if (/(s|x|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

/** `{name: size}` with each name's plural too: Plutonium has `arrow`, dnd5e's pack `Arrows`. */
const both = (table) => Object.fromEntries(Object.entries(table).flatMap(([name, size]) => [[name, size], [plural(name), size]]));

/** Every weapon of the rules, whether or not dnd5e has a `baseItem` key for it. */
const WEAPONS = both({
  battleaxe: s(4, 2), blowgun: s(4, 1), club: s(4, 1), dagger: s(2, 1), dart: s(1, 1), flail: s(4, 2), glaive: s(8, 2),
  greataxe: s(6, 3), greatclub: s(6, 2), greatsword: s(8, 2), halberd: s(8, 2), handaxe: s(2, 2), "hand crossbow": s(3, 2),
  "heavy crossbow": s(8, 3), javelin: s(6, 1), lance: s(10, 1), "light crossbow": s(6, 3), "light hammer": s(2, 1), longbow: s(8, 2),
  longsword: s(6, 1), mace: s(3, 1), maul: s(6, 2), morningstar: s(4, 2), musket: s(8, 2), net: s(3, 2), pike: s(10, 1), pistol: s(3, 2),
  quarterstaff: s(8, 1), rapier: s(6, 1), scimitar: s(5, 1), shortsword: s(4, 1), sickle: s(2, 2), spear: s(8, 1), shortbow: s(6, 2),
  sling: s(2, 1), trident: s(8, 2), "war pick": s(4, 2), warhammer: s(4, 2), whip: s(2, 2),
  // Not in dnd5e's weaponIds, so Plutonium leaves baseItem empty on these and on their variants.
  "double-bladed scimitar": s(8, 1), hoopak: s(8, 2), yklwa: s(5, 1), "hooked shortspear": s(5, 1), "light repeating crossbow": s(6, 3),
  revolver: s(3, 2), shotgun: s(8, 2), "automatic pistol": s(3, 2), "semiautomatic pistol": s(3, 2), "laser pistol": s(3, 2),
  "automatic rifle": s(8, 2), "hunting rifle": s(8, 2), "laser rifle": s(8, 2), "antimatter rifle": s(8, 2)
});

const ARMOR = {
  "padded armor": s(4, 3), "leather armor": s(4, 3), "studded leather armor": s(4, 3), "studded leather": s(4, 3), "chain shirt": s(4, 3),
  breastplate: s(4, 3), "hide armor": s(4, 4), "scale mail": s(4, 4), "half plate armor": s(4, 4), "half plate": s(4, 4), "ring mail": s(4, 4),
  "chain mail": s(4, 4), "spiked armor": s(4, 4), "splint armor": s(4, 5), splint: s(4, 5), "plate armor": s(4, 5), plate: s(4, 5),
  shield: s(3, 3), shields: s(3, 3)
};

const AMMUNITION = {
  ...both({ arrow: s(2, 1), bolt: s(2, 1), "crossbow bolt": s(2, 1), "sling bullet": s(1, 1), needle: s(1, 1), "blowgun needle": s(1, 1), "firearm bullet": s(1, 1), "modern bullet": s(1, 1), "renaissance bullet": s(1, 1), "energy cell": s(1, 1) }),
  "arrows (20)": s(2, 1), "bolts (20)": s(2, 1), "crossbow bolts (20)": s(2, 1), "sling bullets (20)": s(1, 1), "needles (50)": s(1, 1), "blowgun needles (50)": s(1, 1),
  "bullets, sling": s(1, 1), "bullets, firearm": s(1, 1), "ammunition (varies)": s(1, 1)
};

/** Magic weapons dnd5e sells with no base item: its 2024 pack has 22, all weightless. */
const NAMED_WEAPONS = {
  "flame tongue": s(6, 1), "frost brand": s(6, 1), "holy avenger": s(6, 1), "dragon slayer": s(6, 1), "giant slayer": s(6, 1), "luck blade": s(6, 1),
  "nine lives stealer": s(6, 1), defender: s(6, 1), "sun blade": s(6, 1), oathbow: s(8, 2), "clawed gauntlet": s(2, 1)
};

/**
 * Carrying sizes of containers. M4 gives real bags a grid instead; vessels, and a bag the GM switched off,
 * stay items of these sizes.
 */
const CONTAINERS = {
  ...both({ backpack: s(4, 4), sack: s(3, 2), pouch: s(2, 1), basket: s(4, 3), chest: s(6, 4), barrel: s(5, 5), bucket: s(3, 3), jug: s(2, 2), pitcher: s(2, 2), tankard: s(2, 1), quiver: s(4, 2), waterskin: s(2, 2), vial: s(1, 1), flask: s(1, 1) }),
  saddlebags: s(4, 3), "component pouch": s(2, 1), "left pouch": s(2, 1), "right pouch": s(2, 1), "central pouch": s(2, 1),
  "iron pot": s(3, 2), "pot, iron": s(3, 2), "glass bottle": s(2, 1), "bottle, glass": s(2, 1), "alms box": s(2, 2),
  "crossbow bolt case": s(3, 1), "case, crossbow bolt": s(3, 1), "map or scroll case": s(3, 1), "case, map or scroll": s(3, 1), "scroll case": s(3, 1), "map case": s(3, 1),
  "bag of holding": s(2, 2), "bag of devouring": s(2, 2), "handy haversack": s(3, 3), "efficient quiver": s(4, 2),
  "long compartment": s(1, 1), "midsize compartment": s(1, 1), "short compartment": s(1, 1), "folding boat": s(3, 1),
  "burglar's pack": s(4, 4), "diplomat's pack": s(6, 4), "dungeoneer's pack": s(4, 4), "entertainer's pack": s(4, 4), "explorer's pack": s(4, 4),
  "priest's pack": s(4, 4), "scholar's pack": s(4, 4), "monster hunter's pack": s(4, 4)
};

const TOOLS = {
  "alchemist's supplies": s(3, 2), "brewer's supplies": s(4, 2), "calligrapher's supplies": s(2, 2), "carpenter's tools": s(4, 2), "cartographer's tools": s(3, 2),
  "cobbler's tools": s(3, 2), "cook's utensils": s(3, 2), "glassblower's tools": s(3, 2), "jeweler's tools": s(2, 2), "leatherworker's tools": s(3, 2), "mason's tools": s(4, 2),
  "painter's supplies": s(3, 2), "potter's tools": s(3, 2), "smith's tools": s(4, 2), "tinker's tools": s(4, 2), "weaver's tools": s(3, 2), "woodcarver's tools": s(3, 2),
  "thieves' tools": s(2, 1), "disguise kit": s(3, 2), "forgery kit": s(3, 2), "herbalism kit": s(3, 2), "navigator's tools": s(3, 2), "poisoner's kit": s(2, 2),
  "dice set": s(1, 1), dice: s(1, 1), "playing card set": s(1, 1), "playing cards set": s(1, 1), "playing cards": s(1, 1), "dragonchess set": s(2, 2), dragonchess: s(2, 2),
  "chess set": s(2, 2), "three-dragon ante set": s(1, 1), "three-dragon ante": s(1, 1),
  bagpipes: s(4, 3), drum: s(3, 3), dulcimer: s(5, 3), flute: s(3, 1), horn: s(2, 2), lute: s(5, 2), lyre: s(3, 2), "pan flute": s(2, 1), shawm: s(4, 1), viol: s(5, 2)
};

const GEAR = {
  ...both({
    rope: s(2, 2), torch: s(3, 1), candle: s(1, 1), bedroll: s(4, 2), blanket: s(3, 2), tent: s(4, 3), crowbar: s(4, 1), hammer: s(3, 1), sledgehammer: s(6, 2), shovel: s(5, 2),
    pole: s(8, 1), ladder: s(8, 2), lamp: s(2, 1), book: s(2, 2), spellbook: s(2, 2), potion: s(1, 1), scroll: s(2, 1), wand: s(2, 1), rod: s(3, 1), staff: s(8, 1), piton: s(1, 1),
    caltrop: s(1, 1), mirror: s(1, 1), whetstone: s(1, 1), lock: s(1, 1), key: s(1, 1), map: s(1, 1), bell: s(1, 1), trinket: s(1, 1), abacus: s(3, 2), hourglass: s(2, 1), spyglass: s(3, 1)
  }),
  "potion of healing": s(1, 1), rations: s(1, 1), "rations (1 day)": s(1, 1), tinderbox: s(1, 1), chain: s(2, 2), "chain (10 feet)": s(2, 2), "grappling hook": s(2, 2), "block and tackle": s(3, 2),
  "pole (10-foot)": s(8, 1), "ladder (10-foot)": s(8, 2), "miner's pick": s(6, 2), "two-person tent": s(4, 3), "hempen rope (50 feet)": s(2, 2), "hempen rope (50 ft.)": s(2, 2),
  "silk rope (50 feet)": s(2, 2), "silk rope (50 ft.)": s(2, 2), "hooded lantern": s(2, 2), "bullseye lantern": s(2, 2), "lantern, hooded": s(2, 2), "lantern, bullseye": s(2, 2),
  "mess kit": s(2, 1), "healer's kit": s(2, 2), "climber's kit": s(3, 2), "merchant's scale": s(3, 2), "fishing tackle": s(3, 2), "hunting trap": s(3, 3), "ball bearings": s(1, 1),
  "iron spike": s(1, 1), "iron spikes": s(1, 1), "iron spikes (10)": s(1, 1), "spikes, iron": s(1, 1), "ink pen": s(1, 1), ink: s(1, 1), "ink bottle": s(1, 1), paper: s(1, 1), parchment: s(1, 1),
  chalk: s(1, 1), soap: s(1, 1), perfume: s(1, 1), string: s(1, 1), "string, 10 ft.": s(1, 1), "sealing wax": s(1, 1), "signal whistle": s(1, 1), "signet ring": s(1, 1), "magnifying glass": s(1, 1),
  "portable ram": s(6, 2), "ram, portable": s(6, 2), censer: s(2, 1), "block of incense": s(1, 1), "stick of incense": s(1, 1), "prayer wheel": s(2, 1), "book of lore": s(2, 2), "prayer book": s(2, 2),
  "small knife": s(2, 1), "holy symbol": s(1, 1), "holy symbol (varies)": s(1, 1), "arcane focus": s(1, 1), "arcane focus (varies)": s(1, 1), "druidic focus": s(1, 1), "druidic focus (varies)": s(1, 1),
  "elven chain": s(4, 4), "efreeti chain": s(4, 4), "common clothes": s(3, 2), "fine clothes": s(3, 2), "traveler's clothes": s(3, 2), "clothes, fine": s(3, 2), "clothes, traveler's": s(3, 2),
  costume: s(3, 2), "costume clothes": s(3, 2), robe: s(3, 2), robes: s(3, 2), vestments: s(3, 2), "exotic saddle": s(4, 3), "military saddle": s(4, 3), "pack saddle": s(4, 3), "riding saddle": s(4, 3), "bit and bridle": s(2, 2)
};

/*
 * dnd5e's own keywords, first match wins. The patterns run on the raw name and on the normalized one (no
 * accents, lowercase), so they are written accent-free. Portuguese terms are pt-BR: the owner's world has
 * Portuguese names. They carry `systems` by design: a keyword of ours must not change a CoC7 or Delta Green size.
 * Types keep the words honest: a whip keyword must not catch a Feather Token (Whip), nor a bolt one a scroll.
 */
const WEAPON = ["weapon"];
const WORN = ["equipment", "loot"];
const CARRIED = ["consumable", "loot", "equipment", "tool", "container"];
const SMALL = ["consumable", "loot", "equipment"];
const k = (pattern, size, types) => ({ systems: ["dnd5e"], pattern, size, ...(types ? { types } : {}) });

/** Words that end the part of a name that says what the object is: "Chest of Gems", "Livro sobre a arvore". */
const CONNECTORS = "of|with|from|crafted|made|for|to|in|on|de|do|da|dos|das|com|sobre|para|em|feito|feita";

/**
 * A pattern for the noun that heads a name. English puts it last ("Carved Harp of Oak", "Cartographer's Map
 * Case"), Portuguese first ("Saco Velho de Moedas"). A noun that merely modifies another does not count:
 * "Shield Guardian Amulet" is an amulet, "Barrel Key" a key.
 * @param {string} en alternatives, English
 * @param {string} pt alternatives, Portuguese, accent-free
 * @param {string} [not] words that disqualify the whole name
 * @returns {RegExp}
 */
const headNoun = (en, pt, not) => new RegExp(
  `^${not ? `(?!.*\\b(?:${not})\\b)` : ""}(?:(?:(?!(?:${CONNECTORS})\\b)[^\\s,(]+ )*?(?:${en}|${pt})(?= (?:${CONNECTORS})\\b|\\s*[,(]|$)|(?:${pt})\\b)`,
  "i"
);

const KEYWORDS = [
  // --- Before ammunition: "Spell Scroll: Lightning Bolt", "Wand of Lightning Bolts" ------------------
  k(/\b(scrolls?|pergaminhos?)\b/i, s(2, 1), SMALL),
  k(/\b(wands?|varinhas?)\b/i, s(2, 1)),
  k(/\b(rods?|cetros?)\b/i, s(3, 1)),
  k(/\b(quarterstaff|staff|staves|cajados?|bordao|bordoes)\b/i, s(8, 1)),

  // --- Ammunition ----------------------------------------------------------------------------------
  k(/\b(arrows?|flechas?|bolts?|virotes?)\b/i, s(2, 1), ["consumable", "loot"]),
  k(/\b(ammunition|bullets?|needles?|cartridges?|municao|municoes|balas?|agulhas?|cartuchos?)\b/i, s(1, 1), ["consumable", "loot"]),

  // --- Armor, before jewellery: "Ring Mail" --------------------------------------------------------
  k(/\b(plate armou?r|full plate|splint|armadura de placas|armadura completa|talas)\b|^placas\b/i, s(4, 5), ["equipment"]),
  k(/\b(half plate|chain mail|ring mail|scale mail|hide armou?r|meia armadura|cota de malha|cota de aneis|cota de escamas|brunea|gibao de peles)\b/i, s(4, 4), ["equipment"]),
  k(/\b(breastplate|chain shirt|leather armou?r|studded|padded|peitoral|camis[ao]o? de malha|armadura de couro|couro batido|acolchoada)\b|^couro\b/i, s(4, 3), ["equipment"]),
  k(/\b(armou?r|armaduras?)\b/i, s(4, 4), ["equipment"]),

  // --- Before the head nouns: "Saco de Dormir" is no sack ------------------------------------------
  k(/\b(bedrolls?|saco de dormir|sleeping bags?)\b/i, s(4, 2), CARRIED),
  k(/\b(lock ?picks?|gazuas?)\b/i, s(1, 1), CARRIED),

  // --- Head noun, before small things: a "Chest of Gems" is a chest --------------------------------
  k(headNoun("chests?", "baus?"), s(6, 4), CARRIED),
  k(headNoun("barrels?", "barris|barril"), s(5, 5), CARRIED),
  k(headNoun("kegs?|casks?", "barricas?|pipas?"), s(4, 3), CARRIED),
  k(headNoun("backpacks?|packs?", "mochilas?|pacotes?"), s(4, 4), CARRIED),
  k(headNoun("baskets?|saddlebags?", "cestos?|cestas?|alforjes?"), s(4, 3), CARRIED),
  k(headNoun("sacks?", "sacos?"), s(3, 2), CARRIED),
  k(headNoun("bags?", "bolsas?"), s(2, 2), CARRIED),
  k(headNoun("pouch(?:es)?", "algibeiras?"), s(2, 1), CARRIED),
  k(headNoun("boxes|box|crates?", "caixas?|caixotes?"), s(2, 2), CARRIED),
  k(headNoun("cases?", "estojos?"), s(3, 1), CARRIED),
  k(headNoun("waterskins?|jugs?|pitchers?", "odres?|jarros?|jarras?"), s(2, 2), CARRIED),
  k(headNoun("buckets?", "baldes?"), s(3, 3), CARRIED),
  k(headNoun("pots?", "panelas?"), s(3, 2), CARRIED),
  k(headNoun("bottles?|tankards?", "garrafas?|canecas?"), s(2, 1), CARRIED),
  k(headNoun("ropes?|chains?", "cordas?|correntes?"), s(2, 2), CARRIED),
  k(headNoun("books?|tomes?|manuals?|grimoires?|spellbooks?", "livros?|tomos?|manuais|grimorios?"), s(2, 2), CARRIED),
  k(headNoun("armou?r", "armaduras?"), s(4, 4), CARRIED),
  k(headNoun("belts?|girdles?|gloves?|gauntlets?|bracers?", "cintos?|luvas?|manoplas?|braceletes?"), s(2, 1), WORN),
  k(headNoun("boots?|helms?|helmets?", "botas?|elmos?|capacetes?"), s(2, 2), WORN),
  k(headNoun("cloaks?|capes?|mantles?|robes?", "capas?|mantos?|tunicas?"), s(3, 2), WORN),
  k(headNoun("harps?|lutes?|viols?", "harpas?|alaudes?|violas?"), s(5, 2), CARRIED),
  k(headNoun("drums?", "tambor(?:es)?"), s(3, 3), CARRIED),
  k(headNoun("flutes?", "flautas?"), s(2, 1), CARRIED),
  k(headNoun("horns?", "chifres?|trompas?"), s(2, 2), CARRIED),

  // --- Small things --------------------------------------------------------------------------------
  k(/\b(potions?|pocoes?|pocao|elixirs?|elixires|philters?|filtros?|antitoxin|antidotos?|vials?|frascos?|ampolas?|flasks?|oils?|oleos?|acids?|acidos?|poisons?|venoms?|venenos?|peconhas?|ointments?|pomadas?|unguentos?|holy water|agua benta|alchemist'?s fire|fogo alquimico|fogo de alquimista|perfumes?|inks?|tintas?|dust of|po de)\b/i, s(1, 1), SMALL),
  k(/\b(rings?|aneis|anel|amulets?|amuletos?|necklaces?|colar(es)?|periapts?|medallions?|medalhao|medalhoes|talismans?|talismas?|brooch(es)?|broches?|scarabs?|escaravelhos?|pearls?|perolas?|gems?|gemas?|jewels?|joias?|ioun stones?|pedras? ioun|stones?|pedras?|tokens?|coins?|moedas?|figurines?|estatuetas?|beads?|keys?|chaves?|locks?|cadeados?|fechaduras?|holy symbols?|simbolos? sagrados?|focus|focos?|totems?|totens?|emblems?|emblemas?|mistletoe|visco|decks?|baralhos?|cards?|cartas?|dice|dados?|candles?|velas?|whistles?|apitos?|chalk|giz|soap|sabao|papers?|papeis|papel|parchments?|maps?|mapas?|tinderbox|pederneira|rations?|racao|racoes|manacles?)\b/i, s(1, 1), SMALL),
  k(/\b(shields?|escudos?)\b/i, s(3, 3), WORN),

  // --- Worn ----------------------------------------------------------------------------------------
  k(/\b(helms?|helmets?|elmos?|capacetes?|boots?|botas?|slippers?|sandalias?|horseshoes?|ferraduras?)\b/i, s(2, 2), WORN),
  k(/\b(circlets?|tiaras?|headbands?|diadems?|diademas?|crowns?|coroas?|hats?|chapeus?|chapeu|gloves?|luvas?|gauntlets?|manoplas?|bracers?|braceletes?|belts?|cintos?|girdles?)\b/i, s(2, 1), WORN),
  k(/\b(goggles|lenses|oculos|eyes of)\b/i, s(1, 1), WORN),
  k(/\b(cloaks?|capes?|capas?|mantles?|mantos?|robes?|tunicas?|clothes|clothing|roupas?|costumes?|trajes?|fantasias?|vestments|wings of)\b/i, s(3, 2), WORN),
  k(/\b(saddles?|selas?)\b/i, s(4, 3), WORN),

  // --- Weapons, compound names first ---------------------------------------------------------------
  k(/\b(greatswords?|great swords?|two-?handed swords?|espadas? grandes?|espadas? de duas maos|montantes?|greatsword)\b/i, s(8, 2), WEAPON),
  k(/\b(shortswords?|short swords?|espadas? curtas?|gladios?)\b/i, s(4, 1), WEAPON),
  k(/\b(swords?|blades?|espadas?|laminas?|rapieira|sabres?|cimitarras?)\b/i, s(6, 1), WEAPON),
  k(/\b(daggers?|knife|knives|adagas?|punhal|punhais|facas?)\b/i, s(2, 1), WEAPON),
  k(/\b(greataxes?|great axes?|machados? grandes?)\b/i, s(6, 3), WEAPON),
  k(/\b(handaxes?|machadinhas?)\b/i, s(2, 2), WEAPON),
  k(/\b(axes?|machados?)\b/i, s(4, 2), WEAPON),
  k(/\b(mauls?|malhos?|marretas?|greatclubs?|clavas? grandes?)\b/i, s(6, 2), WEAPON),
  k(/\b(light hammers?|martelos? leves?)\b/i, s(2, 1), WEAPON),
  k(/\b(hammers?|martelos?|flails?|manguais|mangual|morningstars?|picaretas?|maca estrela|estrelas? da manha)\b/i, s(4, 2), WEAPON),
  k(/\b(maces?|macas?)\b/i, s(3, 1), WEAPON),
  k(/\b(clubs?|clavas?|porretes?)\b/i, s(4, 1), WEAPON),
  k(/\b(pikes?|lances?|pique|piques)\b/i, s(10, 1), WEAPON),
  k(/\b(glaives?|halberds?|tridents?|alabardas?|tridentes?|glaive)\b/i, s(8, 2), WEAPON),
  k(/\b(spears?|lancas?)\b/i, s(8, 1), WEAPON),
  k(/\b(javelins?|azagaias?)\b/i, s(6, 1), WEAPON),
  k(/\b(darts?|dardos?)\b/i, s(1, 1), WEAPON),
  k(/\b(hand crossbows?|bestas? de mao)\b/i, s(3, 2), WEAPON),
  k(/\b(heavy crossbows?|bestas? pesadas?)\b/i, s(8, 3), WEAPON),
  k(/\b(crossbows?|bestas?)\b/i, s(6, 3), WEAPON),
  k(/\b(longbows?|long bows?|arcos? longos?)\b/i, s(8, 2), WEAPON),
  k(/\b(bows?|arcos?)\b/i, s(6, 2), WEAPON),
  k(/\b(whips?|chicotes?)\b/i, s(2, 2), WEAPON),
  k(/\b(sickles?|foices?)\b/i, s(2, 2), WEAPON),
  k(/\b(slings?|fundas?)\b/i, s(2, 1), WEAPON),
  k(/\b(nets?|redes?)\b/i, s(3, 2), WEAPON),
  k(/\b(blowguns?|zarabatanas?)\b/i, s(4, 1), WEAPON),
  k(/\b(pistols?|revolvers?|pistolas?|revolveres?)\b/i, s(3, 2), WEAPON),
  k(/\b(muskets?|rifles?|shotguns?|mosquetes?|fuzis|fuzil|espingardas?)\b/i, s(8, 2), WEAPON),
  k(/\b(weapons?|armas?)\b/i, s(4, 1), WEAPON),

  // --- Mounts and vehicles are `loot` from Plutonium: too big for most bodies (OPEN_QUESTIONS Q-3); before "Pack Mule" reads as a pack ---
  k(headNoun(
    "warhorses?|horses?|pon(?:y|ies)|mules?|donkeys?|camels?|elephants?|mastiffs?|oxen|ox|cows?|wagons?|carts?|carriages?|chariots?|sleds?|ships?|warships?|galleys?|keelboats?|longships?|rowboats?|boats?|canoes?|airships?",
    "cavalos?|poneis|ponei|mulas?|burros?|camelos?|elefantes?|bois|boi|vacas?|carrocas?|bigas?|trenos?|navios?|galeras?|barcos?|canoas?",
    "toys?|models?|miniatures?|carved|bottles?|brinquedos?|miniaturas?|garrafas?"
  ), s(8, 5), ["loot"]),

  // --- Gear ----------------------------------------------------------------------------------------
  k(/\b(backpacks?|mochilas?|packs?|pacotes?)\b/i, s(4, 4), CARRIED),
  k(/\b(chests?|baus?)\b/i, s(6, 4), CARRIED),
  k(/\b(barrels?|barris|barril)\b/i, s(5, 5), CARRIED),
  k(/\b(baskets?|cestos?|cestas?|saddlebags?|alforjes?)\b/i, s(4, 3), CARRIED),
  k(/\b(sacks?|sacos?)\b/i, s(3, 2), CARRIED),
  k(/\b(pouch(es)?|bolsas?|algibeiras?)\b/i, s(2, 1), CARRIED),
  k(/\b(quivers?|aljavas?)\b/i, s(4, 2), CARRIED),
  k(/\b(waterskins?|odres?|jugs?|jarros?|jarras?|pitchers?)\b/i, s(2, 2), CARRIED),
  k(/\b(buckets?|baldes?)\b/i, s(3, 3), CARRIED),
  k(/\b(pots?|panelas?)\b/i, s(3, 2), CARRIED),
  k(/\b(bottles?|garrafas?|tankards?|canecas?)\b/i, s(2, 1), CARRIED),
  k(/\b(rope|ropes|cordas?|chains?|correntes?|grappling hooks?|ganchos?)\b/i, s(2, 2), CARRIED),
  k(/\b(torch(es)?|tochas?)\b/i, s(3, 1), CARRIED),
  k(/\b(lanterns?|lanternas?)\b/i, s(2, 2), CARRIED),
  k(/\b(lamps?|lampioes|lampiao|lamparinas?)\b/i, s(2, 1), CARRIED),
  k(/\b(blankets?|cobertor(es)?)\b/i, s(3, 2), CARRIED),
  k(/\b(tents?|barracas?)\b/i, s(4, 3), CARRIED),
  k(/\b(ladders?|escadas?)\b/i, s(8, 2), CARRIED),
  k(/\b(poles?|varas?|brooms?|vassouras?)\b/i, s(8, 1), CARRIED),
  k(/\b(shovels?|pa|pas)\b/i, s(5, 2), CARRIED),
  k(/\b(crowbars?|pe de cabra)\b/i, s(4, 1), CARRIED),
  k(/\b(sledgehammers?|marretas?|picks?|picaretas?)\b/i, s(6, 2), CARRIED),
  k(/\b(hammers?|martelos?)\b/i, s(3, 1), CARRIED),
  k(/\b(carpets?|tapetes?)\b/i, s(6, 2), CARRIED),
  k(/\b(tomes?|tomos?|books?|livros?|manuals?|manuais|manual|spellbooks?|grimoires?|grimorios?)\b/i, s(2, 2), CARRIED),
  k(/\b(thieves'? tools|ferramentas de ladrao)\b/i, s(2, 1), CARRIED),
  k(/\b(kits?|tools|supplies|utensils|ferramentas|utensilios|suprimentos)\b/i, s(3, 2), CARRIED),
  k(/\b(horns?|chifres?|trompas?)\b/i, s(2, 2), CARRIED),
  k(/\b(pipes|flautas?|flutes?)\b/i, s(2, 1), CARRIED),
  k(/\b(lutes?|alaudes?|viols?|violas?)\b/i, s(5, 2), CARRIED),
  k(/\b(drums?|tambor(es)?)\b/i, s(3, 3), CARRIED),
  k(/\b(crystal ball|bola de cristal|orbs?|orbes?)\b/i, s(2, 2), CARRIED),
  k(/\b(spyglass(es)?|lunetas?)\b/i, s(3, 1), CARRIED)
];

/** Unknown name: what the item's data says it is. A wondrous item or a trinket could be anything, so weight decides. */
const BY_SUBTYPE = {
  "weapon:simpleM": s(3, 1), "weapon:martialM": s(4, 1), "weapon:simpleR": s(4, 2), "weapon:martialR": s(6, 2), "weapon:improv": s(2, 1),
  "equipment:light": s(4, 3), "equipment:medium": s(4, 4), "equipment:heavy": s(4, 5), "equipment:shield": s(3, 3), "equipment:clothing": s(3, 2),
  "equipment:ring": s(1, 1), "equipment:rod": s(3, 1), "equipment:wand": s(2, 1),
  "consumable:ammo": s(1, 1), "consumable:ammo:arrow": s(2, 1), "consumable:ammo:crossbowBolt": s(2, 1), "consumable:potion": s(1, 1), "consumable:poison": s(1, 1),
  "consumable:scroll": s(2, 1), "consumable:food": s(1, 1), "consumable:wand": s(2, 1), "consumable:rod": s(3, 1),
  "tool:art": s(3, 2), "tool:music": s(3, 2), "tool:game": s(1, 1),
  "loot:gem": s(1, 1), "loot:treasure": s(1, 1), "loot:art": s(2, 2)
};

/** Pounds to cells. The top band fills an 8x5 body, so a cow fits only an empty one. */
const WEIGHT_BANDS = [
  { max: 1, size: s(1, 1) },
  { max: 2, size: s(2, 1) },
  { max: 5, size: s(2, 2) },
  { max: 10, size: s(3, 2) },
  { max: 20, size: s(4, 2) },
  { max: 35, size: s(4, 3) },
  { max: 70, size: s(5, 4) },
  { max: 150, size: s(6, 4) },
  { size: s(8, 5) }
];

/** The dnd5e part of DEFAULT_REGISTRY. */
export const DND5E_SIZES = Object.freeze({
  byName: { dnd5e: { ...WEAPONS, ...ARMOR, ...AMMUNITION, ...NAMED_WEAPONS, ...CONTAINERS, ...TOOLS, ...GEAR } },
  baseNames: { dnd5e: { ...WEAPONS, ...ARMOR } },
  keywords: KEYWORDS,
  bySubtype: { dnd5e: BY_SUBTYPE },
  weightBands: { dnd5e: WEIGHT_BANDS }
});
