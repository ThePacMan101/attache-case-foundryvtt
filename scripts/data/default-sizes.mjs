/**
 * Default item footprints for Call of Cthulhu 7e (`CoC7`) and Delta Green (`deltagreen`).
 * Pure data, consumed by scripts/core/sizes.mjs (see its JSDoc for the registry shape and the
 * lookup precedence: byId -> byName -> keywords -> byType).
 *
 * Scale: one cell is roughly a 10 cm "hand-sized" square, Resident Evil 4 attaché case style.
 * Long objects are defined horizontally (w > h); players rotate them when packing.
 * Anchors: handgun 3x2, long-barrel revolver 4x2, derringer 1x1, knife 2x1, SMG 4x3,
 * shotgun 8x2, sawed-off 5x2, rifle 9x2, elephant gun 10x2, Lewis gun 12x3, book 2x2, tome 2x3,
 * ammo 1x1, first aid kit 2x2, flashlight 2x1, body armor 4x4, helmet 2x2.
 * The default body grid ("pockets") is 5x3: a handgun and a few small things fit, a rifle does not.
 *
 * Sources covered (read from the system repositories, 2026-10):
 * - CoC7 v8.16 `compendiums/en-wiki-weapons.yaml` (44 weapons) and `en-items.yaml` (3 weapons),
 *   plus the 4 weapons embedded in the `en-examples.yaml` actors that carry a CoC id.
 * - Delta Green `packs/source/{firearms,hand-to-hand-weapons,armor}` (10 + 17 + 6 items).
 */

const EXCLUDED = "excluded";

/** @param {number} w @param {number} h */
const s = (w, h) => Object.freeze({ w, h });

// Shared footprints, so the same object class has the same size everywhere.
const SIZE = Object.freeze({
  tiny: s(1, 1),
  knife: s(2, 1),
  dagger: s(3, 1),
  largeKnife: s(4, 1),
  hatchet: s(3, 2),
  pocketPistol: s(2, 2),
  handgun: s(3, 2),
  longHandgun: s(4, 2),
  smg: s(4, 3),
  periodSmg: s(6, 3),
  sawedOff: s(5, 2),
  shotgun: s(8, 2),
  carbine: s(8, 2),
  rifle: s(9, 2),
  bigRifle: s(10, 2),
  spear: s(12, 1),
  helmet: s(2, 2),
  bodyArmor: s(4, 4)
});

/** Item types that occupy space, per system. */
const physicalTypes = {
  CoC7: ["weapon", "armor", "book", "item"],
  deltagreen: ["weapon", "armor", "gear", "tome"]
};

/*
 * CoC7 identity is `flags.CoC7.cocidFlag.id`. Compendium document ids are generated at build time
 * from the YAML, so CoC ids are the only stable key.
 *
 * Known system data bug: "Spear, Thrown" reuses the CoC id `i.weapon.shuriken`. A byId entry for
 * that id would make every thrown spear 1x1, so it is deliberately left out; both items resolve
 * through byName (English) or the shuriken/spear keywords (translations).
 * `i.weapon.spear-thrown` is listed in case the system fixes the id.
 */
const COC7_BY_ID = {
  // Hand-to-hand and thrown (folder "Hand-to-Hand Weapons")
  "i.weapon.bow": s(8, 2),
  "i.weapon.brass-knuckles": SIZE.tiny,
  "i.weapon.bullwhip": s(2, 2), // coiled
  "i.weapon.burning-torch": s(4, 1),
  "i.weapon.blackjack": s(2, 1),
  "i.weapon.club-large": s(7, 1), // baseball bat, cricket bat
  "i.weapon.club-small": s(4, 1), // police baton, nightstick
  "i.weapon.crossbow": s(6, 3),
  "i.weapon.garrote": SIZE.tiny,
  "i.weapon.hatchet-sickle": SIZE.hatchet,
  "i.weapon.knife-large": SIZE.largeKnife, // machete, bayonet
  "i.weapon.knife-medium": SIZE.dagger, // carving knife, hunting knife
  "i.weapon.knife-small": SIZE.knife, // switchblade
  "i.weapon.nunchaku": s(3, 1), // folded
  "i.weapon.rock-thrown": SIZE.tiny,
  "i.weapon.spear": SIZE.spear,
  "i.weapon.spear-thrown": s(10, 1),
  // Handguns
  "i.weapon.22-short-automatic": SIZE.pocketPistol,
  "i.weapon.25-derringer-1b": SIZE.tiny,
  "i.weapon.32-or-7-65mm-revolver": SIZE.handgun,
  "i.weapon.32-or-7-65mm-automatic": SIZE.handgun,
  "i.weapon.model-p08-luger": SIZE.handgun,
  "i.weapon.45-revolver": SIZE.handgun,
  "i.weapon.45-automatic": SIZE.handgun,
  // Rifles
  "i.weapon.22-bolt-action-rifle": SIZE.carbine,
  "i.weapon.30-lever-action-carbine": SIZE.carbine,
  "i.weapon.45-martini-henry-rifle": SIZE.rifle,
  "i.weapon.col-moran-s-air-rifle": SIZE.carbine,
  "i.weapon.303-lee-enfield": SIZE.rifle,
  "i.weapon.30-06-bolt-action-rifle": SIZE.rifle,
  "i.weapon.elephant-gun-2b": SIZE.bigRifle,
  // Shotguns
  "i.weapon.20-gauge-shotgun-2b": SIZE.shotgun,
  "i.weapon.16-gauge-shotgun-2b": SIZE.shotgun,
  "i.weapon.12-gauge-shotgun-2b": SIZE.shotgun,
  "i.weapon.12-gauge-shotgun-semi-auto": SIZE.shotgun,
  "i.weapon.12-gauge-shotgun-2b-sawed-off": SIZE.sawedOff,
  // Submachine guns: 1920s SMGs are long, wooden-stocked and drum-fed, bigger than a modern SMG.
  "i.weapon.bergmann-mp181-mp2811": SIZE.periodSmg,
  "i.weapon.thompson": SIZE.periodSmg,
  // Machine guns: the water-cooled tripod guns are not realistically portable.
  "i.weapon.browning-auto-rifle-m1918": SIZE.bigRifle,
  "i.weapon.30-browning-m1917a1": s(10, 3),
  "i.weapon.bren-gun": s(10, 3), // top-mounted magazine
  "i.weapon.mark-i-lewis-gun": s(12, 3),
  "i.weapon.vickers-303": s(10, 3),
  // en-items.yaml
  "i.weapon.brawl": EXCLUDED, // "Unarmed"
  "i.weapon.example-death-ray-prototype": SIZE.longHandgun,
  "i.weapon.example-experimental-weapon": SIZE.longHandgun,
  // Embedded in the en-examples.yaml actors
  "i.weapon.club": s(4, 1),
  "i.weapon.shotgun": SIZE.shotgun,
  "i.weapon.deadly-beak": EXCLUDED, // creature natural attack
  "i.weapon.innate-attack": EXCLUDED
};

/*
 * Delta Green has no stable id flag: items are matched by `_stats.compendiumSource`
 * (sizes.mjs also tries the bare trailing document id).
 *
 * "Rifle Butt" is an attack mode of a rifle the agent already carries, not a separate object:
 * excluded. "Fixed Bayonet" is also an attack mode, but the bayonet itself is a real object the
 * agent has to carry somewhere when it is not fixed, so it takes a combat-knife footprint (3x1).
 * The three "Shotgun (Firing ...)" entries are one gun per ammunition type; each is a full shotgun.
 */
const DG_FIREARMS = "Compendium.deltagreen.firearms.Item.";
const DG_MELEE = "Compendium.deltagreen.hand-to-hand-weapons.Item.";
const DG_ARMOR = "Compendium.deltagreen.armor.Item.";

const DG_BY_ID = {
  // firearms
  [`${DG_FIREARMS}mvGLbgOB9TeGBfhr`]: SIZE.longHandgun, // Heavy Pistol (Desert Eagle class)
  [`${DG_FIREARMS}7TSuCYbhLeHIRpod`]: SIZE.pocketPistol, // Light Pistol (Walther PPK class)
  [`${DG_FIREARMS}xb73X4SjsbuYs4D7`]: SIZE.handgun, // Medium Pistol (Glock class)
  [`${DG_FIREARMS}5JoNQn7l3KiOAHlE`]: SIZE.rifle, // Rifle (Heavy)
  [`${DG_FIREARMS}42sHG2tugOGgtFLK`]: SIZE.carbine, // Rifle (Light): assault rifle / carbine
  [`${DG_FIREARMS}ccNHepyVZVb6p49U`]: SIZE.bigRifle, // Rifle (Very Heavy)
  [`${DG_FIREARMS}oQhWip2JTJYY18fS`]: SIZE.shotgun, // Shotgun (Firing Nonlethal)
  [`${DG_FIREARMS}Zh1TVVNUFBxfxAOc`]: SIZE.shotgun, // Shotgun (Firing Shot)
  [`${DG_FIREARMS}DruzlEXzmEMSwoSq`]: SIZE.shotgun, // Shotgun (Firing Slug)
  [`${DG_FIREARMS}0Gz1jcY28Psezqrv`]: SIZE.smg, // Submachine Gun (SMG)
  // hand-to-hand-weapons
  [`${DG_MELEE}qEM7Gz7raecORkj0`]: s(7, 1), // Baseball Bat
  [`${DG_MELEE}c7Vl2gFQ9Tz8uQbM`]: s(3, 1), // Baton (telescopic, collapsed)
  [`${DG_MELEE}TumiVMIYL7uCGrJW`]: SIZE.tiny, // Brass Knuckles
  [`${DG_MELEE}n0e4gZfCWsfwHcQH`]: s(5, 1), // Club
  [`${DG_MELEE}TvswuYGnr0Mt6aAg`]: SIZE.dagger, // Combat Dagger
  [`${DG_MELEE}ZawdvRsFTJyB1SvW`]: SIZE.dagger, // Fixed Bayonet (see note above)
  [`${DG_MELEE}u5fnrg385Z79DUK6`]: s(4, 1), // Flashlight (Heavy), Maglite class
  [`${DG_MELEE}PkhlVFDhDUGqLdCW`]: SIZE.tiny, // Garotte
  [`${DG_MELEE}0gCwBTqSAbG9J20Y`]: SIZE.hatchet, // Hatchet
  [`${DG_MELEE}OsW9m877sce0LdsO`]: SIZE.knife, // Knife
  [`${DG_MELEE}ryiBL4PoYTutSaZ5`]: s(10, 1), // Large Sword (katana, longsword)
  [`${DG_MELEE}JAhifOCkSG5Iwaeo`]: EXCLUDED, // Rifle Butt (see note above)
  [`${DG_MELEE}bhdeIJZJA4JEi1iW`]: SIZE.spear, // Spear
  [`${DG_MELEE}b9hKP3QHJPzk45YD`]: s(8, 1), // Sword
  [`${DG_MELEE}DUJXpTwNqHJCqv6E`]: s(12, 2), // Two-handed Sword
  [`${DG_MELEE}JQEMyFfCHx38gupS`]: EXCLUDED, // Unarmed Attack
  [`${DG_MELEE}77d2U7eSBn5AaQk7`]: s(8, 2), // Wood Axe
  // armor
  [`${DG_ARMOR}oYJsYalfaNchDt34`]: s(8, 6), // Bomb Suit
  [`${DG_ARMOR}h8KAJDpLe03y2qWK`]: SIZE.helmet, // Helmet, Kevlar
  [`${DG_ARMOR}0iBS0OdEMPN6WTsu`]: s(3, 2), // Helmet, Riot (visor)
  [`${DG_ARMOR}3PqRqzKL6Y3G3N0r`]: s(4, 3), // Kevlar Vest (soft, concealable)
  [`${DG_ARMOR}W9gc014kriVkUpxq`]: SIZE.bodyArmor, // Reinforced Kevlar Vest
  [`${DG_ARMOR}Yc0n7fZZJaDKW7J1`]: s(5, 4) // Tactical Body Armor (plates and pouches)
};

/** CoC7 English compendium names (fallback when the CoC id is missing). */
const COC7_BY_NAME = {
  "bow": COC7_BY_ID["i.weapon.bow"],
  "brass knuckles": COC7_BY_ID["i.weapon.brass-knuckles"],
  "bullwhip": COC7_BY_ID["i.weapon.bullwhip"],
  "burning torch": COC7_BY_ID["i.weapon.burning-torch"],
  "blackjack": COC7_BY_ID["i.weapon.blackjack"],
  "club, large": COC7_BY_ID["i.weapon.club-large"],
  "club, small": COC7_BY_ID["i.weapon.club-small"],
  "crossbow": COC7_BY_ID["i.weapon.crossbow"],
  "garrote": COC7_BY_ID["i.weapon.garrote"],
  "hatchet/sickle": COC7_BY_ID["i.weapon.hatchet-sickle"],
  "knife, large": COC7_BY_ID["i.weapon.knife-large"],
  "knife, medium": COC7_BY_ID["i.weapon.knife-medium"],
  "knife, small": COC7_BY_ID["i.weapon.knife-small"],
  "nunchaku": COC7_BY_ID["i.weapon.nunchaku"],
  "rock, thrown": COC7_BY_ID["i.weapon.rock-thrown"],
  "shuriken": SIZE.tiny,
  "spear": COC7_BY_ID["i.weapon.spear"],
  "spear, thrown": COC7_BY_ID["i.weapon.spear-thrown"],
  ".22 short automatic": COC7_BY_ID["i.weapon.22-short-automatic"],
  ".25 derringer (1b)": COC7_BY_ID["i.weapon.25-derringer-1b"],
  ".32 or 7.65mm revolver": COC7_BY_ID["i.weapon.32-or-7-65mm-revolver"],
  ".32 or 7.65mm automatic": COC7_BY_ID["i.weapon.32-or-7-65mm-automatic"],
  "model p08 luger": COC7_BY_ID["i.weapon.model-p08-luger"],
  ".45 revolver": COC7_BY_ID["i.weapon.45-revolver"],
  ".45 automatic": COC7_BY_ID["i.weapon.45-automatic"],
  ".22 bolt-action rifle": COC7_BY_ID["i.weapon.22-bolt-action-rifle"],
  ".30 lever-action carbine": COC7_BY_ID["i.weapon.30-lever-action-carbine"],
  ".45 martini-henry rifle": COC7_BY_ID["i.weapon.45-martini-henry-rifle"],
  "col. moran's air rifle": COC7_BY_ID["i.weapon.col-moran-s-air-rifle"],
  ".303 lee-enfield": COC7_BY_ID["i.weapon.303-lee-enfield"],
  ".30-06 bolt-action rifle": COC7_BY_ID["i.weapon.30-06-bolt-action-rifle"],
  "elephant gun (2b)": COC7_BY_ID["i.weapon.elephant-gun-2b"],
  "20-gauge shotgun (2b)": COC7_BY_ID["i.weapon.20-gauge-shotgun-2b"],
  "16-gauge shotgun (2b)": COC7_BY_ID["i.weapon.16-gauge-shotgun-2b"],
  "12-gauge shotgun (2b)": COC7_BY_ID["i.weapon.12-gauge-shotgun-2b"],
  "12-gauge shotgun (semi-auto)": COC7_BY_ID["i.weapon.12-gauge-shotgun-semi-auto"],
  "12-gauge shotgun (2b sawed off)": COC7_BY_ID["i.weapon.12-gauge-shotgun-2b-sawed-off"],
  "bergmann mp181/mp2811": COC7_BY_ID["i.weapon.bergmann-mp181-mp2811"],
  "thompson": COC7_BY_ID["i.weapon.thompson"],
  "browning auto rifle m1918": COC7_BY_ID["i.weapon.browning-auto-rifle-m1918"],
  ".30 browning m1917a1": COC7_BY_ID["i.weapon.30-browning-m1917a1"],
  "bren gun": COC7_BY_ID["i.weapon.bren-gun"],
  "mark i lewis gun": COC7_BY_ID["i.weapon.mark-i-lewis-gun"],
  "vickers .303": COC7_BY_ID["i.weapon.vickers-303"],
  "unarmed": EXCLUDED,
  "punch": EXCLUDED,
  "death ray (prototype)": COC7_BY_ID["i.weapon.example-death-ray-prototype"],
  "experimental weapon": COC7_BY_ID["i.weapon.example-experimental-weapon"]
};

/** Delta Green English compendium names. */
const DG_BY_NAME = {
  "heavy pistol": DG_BY_ID[`${DG_FIREARMS}mvGLbgOB9TeGBfhr`],
  "light pistol": DG_BY_ID[`${DG_FIREARMS}7TSuCYbhLeHIRpod`],
  "medium pistol": DG_BY_ID[`${DG_FIREARMS}xb73X4SjsbuYs4D7`],
  "rifle (heavy)": DG_BY_ID[`${DG_FIREARMS}5JoNQn7l3KiOAHlE`],
  "rifle (light)": DG_BY_ID[`${DG_FIREARMS}42sHG2tugOGgtFLK`],
  "rifle (very heavy)": DG_BY_ID[`${DG_FIREARMS}ccNHepyVZVb6p49U`],
  "shotgun (firing nonlethal)": DG_BY_ID[`${DG_FIREARMS}oQhWip2JTJYY18fS`],
  "shotgun (firing shot)": DG_BY_ID[`${DG_FIREARMS}Zh1TVVNUFBxfxAOc`],
  "shotgun (firing slug)": DG_BY_ID[`${DG_FIREARMS}DruzlEXzmEMSwoSq`],
  "submachine gun (smg)": DG_BY_ID[`${DG_FIREARMS}0Gz1jcY28Psezqrv`],
  "baseball bat": DG_BY_ID[`${DG_MELEE}qEM7Gz7raecORkj0`],
  "baton": DG_BY_ID[`${DG_MELEE}c7Vl2gFQ9Tz8uQbM`],
  "brass knuckles": DG_BY_ID[`${DG_MELEE}TumiVMIYL7uCGrJW`],
  "club": DG_BY_ID[`${DG_MELEE}n0e4gZfCWsfwHcQH`],
  "combat dagger": DG_BY_ID[`${DG_MELEE}TvswuYGnr0Mt6aAg`],
  "fixed bayonet": DG_BY_ID[`${DG_MELEE}ZawdvRsFTJyB1SvW`],
  "flashlight (heavy)": DG_BY_ID[`${DG_MELEE}u5fnrg385Z79DUK6`],
  "garotte": DG_BY_ID[`${DG_MELEE}PkhlVFDhDUGqLdCW`],
  "hatchet": DG_BY_ID[`${DG_MELEE}0gCwBTqSAbG9J20Y`],
  "knife": DG_BY_ID[`${DG_MELEE}OsW9m877sce0LdsO`],
  "large sword": DG_BY_ID[`${DG_MELEE}ryiBL4PoYTutSaZ5`],
  "rifle butt": EXCLUDED,
  "spear": DG_BY_ID[`${DG_MELEE}bhdeIJZJA4JEi1iW`],
  "sword": DG_BY_ID[`${DG_MELEE}b9hKP3QHJPzk45YD`],
  "two-handed sword": DG_BY_ID[`${DG_MELEE}DUJXpTwNqHJCqv6E`],
  "unarmed attack": EXCLUDED,
  "wood axe": DG_BY_ID[`${DG_MELEE}77d2U7eSBn5AaQk7`],
  "bomb suit": DG_BY_ID[`${DG_ARMOR}oYJsYalfaNchDt34`],
  "helmet, kevlar": DG_BY_ID[`${DG_ARMOR}h8KAJDpLe03y2qWK`],
  "helmet, riot": DG_BY_ID[`${DG_ARMOR}0iBS0OdEMPN6WTsu`],
  "kevlar vest": DG_BY_ID[`${DG_ARMOR}3PqRqzKL6Y3G3N0r`],
  "reinforced kevlar vest": DG_BY_ID[`${DG_ARMOR}W9gc014kriVkUpxq`],
  "tactical body armor": DG_BY_ID[`${DG_ARMOR}Yc0n7fZZJaDKW7J1`]
};

/*
 * Keyword rules, first match wins. sizes.mjs tests each pattern against the raw item name and
 * against its normalized form (lowercase, accents stripped), so patterns are written accent-free
 * and match "Revólver" through "revolver". Portuguese terms are pt-BR.
 * Ordering: exclusions and compound names first, then specific before generic
 * (e.g. "lança-granadas" before "lança", "cano serrado" before "espingarda", "caixa de fósforos"
 * before "caixa", "pé de cabra" before tools, ammo before the guns it names).
 * WEAPON restricts words that are ambiguous outside weapons (bow tie, arco = arch, besta = beast).
 */
const WEAPON = ["weapon"];

const k = (pattern, size, types) => (types ? { pattern, size, types } : { pattern, size });

const KEYWORDS = [
  // --- Not objects: natural and improvised attacks --------------------------------------------
  k(/\b(brass knuckles?|knuckle[- ]?dusters?|soco[- ]ingles)\b/i, SIZE.tiny),
  k(/\b(unarmed|brawl|punch|kick|headbutt|grapple|bite|claws?|talons?|tentacles?|natural (attack|weapon)|desarmado|briga|soco|chute|cabecada|agarrao|mordida|garras?|tentaculos?|ataque natural|innate attack)\b/i, EXCLUDED, WEAPON),
  k(/\b(rifle butt|gun butt|pistol whip|coronhada|coronha)\b/i, EXCLUDED, WEAPON),

  // --- Armor (before ammo: "bullet-proof vest") -------------------------------------------------
  k(/\b(bomb suit|eod suit|traje (anti-?bomba|antibombas?|de desarmamento))\b/i, s(8, 6)),
  k(/\b(tactical (body )?armou?r|plate carrier|colete tatico|armadura tatica)\b/i, s(5, 4)),
  k(/\b(body armou?r|bullet-?proof|flak jacket|colete (a prova de balas|balistico)|armadura)\b/i, SIZE.bodyArmor),
  k(/\b(kevlar|vest|colete)\b(?! pocket)/i, s(4, 3)),
  k(/\b(riot helmet|capacete (de choque|antitumulto))\b/i, s(3, 2)),
  k(/\b(helmet|capacete|elmo)\b/i, SIZE.helmet),
  k(/\b(riot shield|ballistic shield|escudo)\b/i, s(4, 6)),
  k(/\b(gas mask|respirator|mascara de gas|mascara anti-?gas)\b/i, s(2, 2)),

  // --- Ammunition -------------------------------------------------------------------------------
  k(/\b(ammo|ammunition|rounds?|bullets?|cartridges?|shells?|speed ?loaders?|stripper clips?|clips?|magazines?|municao|municoes|balas?|cartuchos?|projeteis|carregadores?|pentes?)\b/i, SIZE.tiny),
  k(/\b(arrows?|crossbow bolts?|quiver|flechas?|virotes?|aljava)\b/i, s(6, 1)),

  // --- Heavy weapons ----------------------------------------------------------------------------
  k(/\b(rocket launcher|bazooka|rpg|m72|law rocket|at-?4|lanca[- ]foguetes|bazuca)\b/i, s(10, 2)),
  k(/\b(grenade launcher|m79|m203|lanca[- ]granadas)\b/i, s(6, 2)),
  k(/\b(flame ?thrower|lanca[- ]chamas)\b/i, s(8, 3)),
  k(/\b(lewis gun|lewis machine gun)\b/i, s(12, 3)),
  k(/\b(vickers|m1917|maxim gun|gatling|minigun|heavy machine ?gun|hmg|metralhadora pesada)\b/i, s(10, 3)),
  k(/\b(machine ?gun|lmg|bren|m60|m249|mg ?42|mg ?3|pkm|metralhadora)\b/i, s(10, 3)),
  k(/\b(browning automatic rifle|browning auto rifle|bar m1918)\b/i, SIZE.bigRifle),

  // --- Submachine guns --------------------------------------------------------------------------
  k(/\b(thompson|tommy ?gun|chicago typewriter|bergmann|mp ?18|mp ?28)\b/i, SIZE.periodSmg),
  k(/\b(machine pistol|pistola[- ]metralhadora|skorpion|glock 18|mac-?10|mac-?11|tec-?9)\b/i, SIZE.longHandgun),
  k(/\b(sub-?machine ?gun|smg|submetralhadora|uzi|mp ?5|mp ?7|mp-?40|tmp|sten|p90)\b/i, SIZE.smg),

  // --- Long guns --------------------------------------------------------------------------------
  k(/\b(sawed[- ]?off|sawn[- ]?off|cano serrado|canos serrados|lupara|coach gun)\b/i, SIZE.sawedOff),
  k(/\b(elephant gun|nitro express|big[- ]game rifle|barrett|anti-?materi[ae]l|\.50 bmg|cacador de elefantes)\b/i, SIZE.bigRifle),
  k(/\b(shotguns?|espingardas?|escopetas?|(10|12|16|20|28)[- ]?(gauge|ga)|calibre (12|16|20|28))\b|\.410\b/i, SIZE.shotgun),
  k(/\b(scope|rifle scope|mira telescopica|luneta de tiro)\b/i, s(3, 1)),
  k(/\b(assault rifle|battle rifle|carbines?|carabinas?|fuzil de assalto|m4|m16|ar-?15|ak-?47|ak-?74|akm|famas|g36|aug|sks|m1 carbine|lever[- ]action|air rifle|rifle de ar)\b/i, SIZE.carbine),
  k(/\b(rifles?|fuzil|fuzis|sniper|winchester|springfield|mauser|lee-?enfield|enfield|garand|martini-henry|musket|mosquete|arcabuz)\b/i, SIZE.rifle),
  k(/\b(crossbow|besta)\b/i, s(6, 3), WEAPON),
  k(/\b(long ?bow|short ?bow|compound bow|recurve|bow|arco)\b/i, s(8, 2), WEAPON),

  // --- Handguns ---------------------------------------------------------------------------------
  k(/\b(derringer|garrucha)\b/i, SIZE.tiny),
  k(/\b(magnum|desert eagle|long[- ]barrel(l?ed)?|cano longo|buntline|python|anaconda|heavy pistol|pistola pesada)\b|\.(44|357|454|500|50)\b/i, SIZE.longHandgun),
  k(/\b(pocket pistol|pistola de bolso|light pistol|pistola leve|vest pocket|ppk)\b|\.(22|25)\b/i, SIZE.pocketPistol),
  k(/\b(revolvers?|colt|smith ?& ?wesson|s ?& ?w|webley|nagant)\b/i, SIZE.handgun),
  k(/\b(pistols?|pistolas?|handguns?|automatic|automatica|semi-?auto|glock|beretta|luger|walther|sig ?sauer|1911|browning|makarov|tokarev|arma curta|sidearm|flare gun|sinalizador|(9|10) ?mm|7[.,]65 ?mm)\b|\.(32|38|380|45|40)\b/i, SIZE.handgun),
  k(/\b(taser|stun gun|arma de choque)\b/i, SIZE.knife),
  k(/\b(guns?|firearms?|arma de fogo)\b/i, SIZE.handgun),

  // --- Explosives -------------------------------------------------------------------------------
  k(/\b(dynamite|dinamite|tnt|c-?4|semtex|plastic explosive|explosivo plastico|explosives?|explosivos?)\b/i, SIZE.knife),
  k(/\b(grenades?|granadas?|flashbang|smoke bomb|bomba de fumaca)\b/i, SIZE.tiny),
  k(/\b(molotov|coquetel molotov)\b/i, SIZE.knife),
  k(/\b(detonators?|detonador(es)?|blasting cap|espoleta|fuse|pavio)\b/i, SIZE.tiny),
  k(/\b(pipe bomb|bomba caseira|bombs?|bombas?)\b/i, s(3, 2)),

  // --- Melee ------------------------------------------------------------------------------------
  k(/\b(chainsaw|motosserra)\b/i, s(7, 3)),
  k(/\b(two-?handed sword|greatsword|great sword|claymore|zweihander|montante|espada de duas maos)\b/i, s(12, 2)),
  k(/\b(katana|long ?sword|large sword|bastard sword|espada longa|espada grande)\b/i, s(10, 1)),
  k(/\b(sword ?cane|cane sword|bengala[- ]espada)\b/i, s(8, 1)),
  k(/\b(swords?|espadas?|sabre|rapier|rapieira|florete|cutlass|cimitarra|scimitar|wakizashi)\b/i, s(8, 1)),
  k(/\b(machete|facao|knife, large|large knife|faca grande)\b/i, SIZE.largeKnife),
  k(/\b(bayonet|baioneta|bowie|combat knife|faca de combate|faca tatica|dagger|adaga|punhal|dirk|trench knife|kukri)\b/i, SIZE.dagger),
  k(/\b(pocket ?knife|pen ?knife|canivete|switchblade|straight razor|razor|navalha|scalpel|bisturi|box cutter|estilete)\b/i, SIZE.tiny),
  k(/\b(knife|knives|faca|facas)\b/i, SIZE.knife),
  k(/\b(pick ?axe|picareta)\b/i, s(7, 2)),
  k(/\b(wood axe|fire axe|felling axe|battle axe|machado de lenhador|machado de bombeiro|axe|machado)\b/i, s(8, 2)),
  k(/\b(hatchet|tomahawk|sickle|machadinha|foice)\b/i, SIZE.hatchet),
  k(/\b(sledge ?hammer|marreta)\b/i, s(7, 2)),
  k(/\b(crowbar|pry ?bar|pe de cabra|alavanca)\b/i, s(5, 1)),
  k(/\b(baseball bat|cricket bat|taco de beisebol|bastao de beisebol)\b/i, s(7, 1)),
  k(/\b(blackjack|sap|cassetete de couro)\b/i, SIZE.knife),
  k(/\b(telescopic baton|expandable baton|asp|bastao retratil|cassetete retratil)\b/i, s(3, 1)),
  k(/\b(nightstick|night stick|baton|truncheon|cudgel|cosh|tonfa|cassetete|cacetete|porrete|clava|clubs?|bastao|lead pipe|cano de chumbo)\b/i, s(4, 1)),
  k(/\b(spears?|javelins?|lancas?|azagaia|dardo de caca|pike|halberd|alabarda|trident|tridente)\b/i, SIZE.spear),
  k(/\b(quarter ?staff|bo staff|walking staff|wizard'?s staff|cajado|bordao)\b/i, SIZE.spear),
  k(/\b(whips?|bullwhip|chicote|relho)\b/i, s(2, 2)),
  k(/\b(garrott?e|garotte|garrote)\b/i, SIZE.tiny),
  k(/\b(nunchaku|nunchucks?|nunchaco)\b/i, s(3, 1)),
  k(/\b(shuriken|throwing stars?|estrelas? ninja)\b/i, SIZE.tiny),

  // --- Light ------------------------------------------------------------------------------------
  k(/\b(oil lamp|kerosene lamp|hurricane lamp|lantern|lampiao|lamparina|candeeiro|lanterna a (oleo|querosene|gas))\b/i, s(2, 3)),
  k(/\b(heavy flashlight|maglite|lanterna pesada|lanterna tatica)\b/i, s(4, 1)),
  k(/\b(penlight|pen light|lanterna de bolso|lanterna de cabeca|headlamp)\b/i, SIZE.tiny),
  k(/\b(flashlights?|electric torch|pocket torch|lanternas?)\b/i, SIZE.knife),
  k(/\b(burning torch|torch|tocha|archote)\b/i, s(4, 1)),
  k(/\b(lighters?|isqueiros?|zippo|matches|matchbox|fosforos?|caixa de fosforos|candles?|velas?)\b/i, SIZE.tiny),

  // --- Medical ----------------------------------------------------------------------------------
  k(/\b(first[- ]aid|primeiros[- ]socorros|med ?kit|medical kit|kit medico|trauma kit|ifak|surgical kit|kit cirurgico)\b/i, s(2, 2)),
  k(/\b(bandages?|ataduras?|curativos?|gauze|gaze|tourniquet|torniquete|band-?aid|esparadrapo)\b/i, SIZE.tiny),
  k(/\b(syringes?|seringas?|hypodermic|injector|injection|injecao|epi-?pen|morphine|morfina|adrenaline|adrenalina|antidote|antidoto)\b/i, SIZE.tiny),
  k(/\b(pills?|pilulas?|comprimidos?|remedios?|medicines?|medicamentos?|medication|painkillers?|analgesicos?|aspirin|aspirina|vials?|frascos?|ampoules?|ampolas?|potions?|pocoes?|pocao|laudanum|laudano|herbs?|ervas?|stethoscope|estetoscopio)\b/i, SIZE.tiny),

  // --- Rope, tools, survival --------------------------------------------------------------------
  k(/\b(grappling hook|gancho( de escalada)?|ropes?|cordas?|chains?|correntes?)\b/i, s(2, 2)),
  k(/\b(handcuffs|manacles|algemas|zip ?ties|abracadeiras?|lock ?picks?|lockpicking|gazuas?|kit de arrombamento|picklock)\b/i, SIZE.tiny),
  k(/\b(tool ?kit|tool ?box|caixa de ferramentas|kit de ferramentas|maleta de ferramentas)\b/i, s(4, 2)),
  k(/\b(bolt cutters?|corta[- ]vergalhao|alicate corta[- ]cadeado)\b/i, s(6, 1)),
  k(/\b(entrenching tool|e-?tool|folding shovel|pa dobravel|pa de trincheira)\b/i, s(4, 2)),
  k(/\b(shovel|spade|pa|pa de corte)\b/i, s(9, 2)),
  k(/\b(saw|hacksaw|serrote|serra|arco de serra)\b/i, s(5, 2)),
  k(/\b(hammer|martelo|wrench|spanner|chave inglesa|chave de boca|screwdrivers?|chaves? de fenda|pliers|alicate|wire cutters|cortador de arame|drill|furadeira)\b/i, s(3, 1)),
  k(/\b(fishing rod|vara de pescar)\b/i, s(10, 1)),
  k(/\b(metal detector|detector de metais)\b/i, s(8, 2)),
  k(/\b(umbrella|guarda-?chuva|sombrinha|walking stick|walking cane|cane|bengala)\b/i, s(8, 1)),
  k(/\b(tent|barraca|sleeping bag|saco de dormir|bedroll)\b/i, s(4, 2)),
  k(/\b(blankets?|cobertor(es)?)\b/i, s(3, 2)),
  k(/\b(binoculars?|binoculos?|field glasses|night vision|nvg|visao noturna)\b/i, s(2, 2)),
  k(/\b(telescope|spyglass|telescopio|luneta)\b/i, s(4, 1)),
  k(/\b(camcorder|movie camera|video camera|filmadora|camera de video)\b/i, s(3, 2)),
  k(/\b(cameras?|camaras?|kodak|polaroid|maquina fotografica)\b/i, s(2, 2)),
  k(/\b(geiger counter|contador geiger|dosimeter|dosimetro)\b/i, s(3, 2)),

  // --- Electronics and communication ------------------------------------------------------------
  k(/\b(field radio|radio set|wireless set|shortwave|ham radio|radio de campanha|radio de ondas curtas|transmissor|transmitter|transceiver)\b/i, s(4, 3)),
  k(/\b(walkie[- ]?talkies?|radios?|handheld radio|radio comunicador)\b/i, SIZE.knife),
  k(/\b(laptops?|notebook (computer|pc|gamer|dell|lenovo|hp|acer|asus|apple)|computador portatil|macbook)\b/i, s(3, 2)),
  // "notebook" is a paper notebook in English but a laptop in pt-BR: 2x2 serves either reading.
  k(/\b(notebooks?|tablet (computer|pc)|ipad|kindle|e-?reader)\b/i, s(2, 2)),
  k(/\b(phones?|telephones?|cell ?phones?|smart ?phones?|mobile|iphone|celular(es)?|telefones?|sat ?phone|telefone via satelite|pager|bip)\b/i, SIZE.tiny),
  k(/\b(tape recorder|voice recorder|dictaphone|recorder|gravador)\b/i, SIZE.knife),
  k(/\b(gps|batter(y|ies)|pilhas?|baterias?|flash ?drive|pen ?drive|usb|hard drive|hd externo|sd card|cartao de memoria|bug|listening device|escuta|microphone|microfone|wire ?tap|grampo)\b/i, SIZE.tiny),

  // --- Books and papers -------------------------------------------------------------------------
  k(/\b(tomes?|tomos?|grimoires?|grimorios?|necronomicon|al azif|codex|codices?|codice|liber|unaussprechlichen|cultes des goules|de vermis|pnakotic|eltdown|r'?lyeh|book of eibon|livro de eibon|king in yellow|rei de amarelo)\b/i, s(2, 3)),
  k(/\b(scrolls?|pergaminhos?|papyrus|papiros?)\b/i, SIZE.knife),
  k(/\b(journals?|diar(y|ies)|diarios?|log ?book|ledger|livro[- ]caixa|caderno|sketchbook)\b/i, s(2, 2)),
  k(/\b(notepad|note ?pad|pocket notebook|caderneta|bloco de notas|agenda|address book)\b/i, SIZE.tiny),
  k(/\b(books?|livros?|bibles?|biblias?|novel|romance|manual|handbook|guia|encyclopedia|enciclopedia|dictionary|dicionario)\b/i, s(2, 2)),
  k(/\b(atlas|documents?|documentos?|dossiers?|dossies?|files?|folders?|papers|papeis|arquivos?|relatorios?|reports?)\b/i, s(2, 2)),
  k(/\b(maps?|mapas?|charts?|cartas? nauticas?|letters?|cartas?|envelopes?|telegrams?|telegramas?|photo(graph)?s?|fotos?|fotografias?|newspapers?|jornais?|jornal|clippings?|recortes?|tickets?|bilhetes?|ingressos?|passagens?)\b/i, SIZE.tiny),
  k(/\b(badges?|distintivos?|credentials?|credenciais|id card|passports?|passaportes?|identidade|licen[cs]es?|licencas?|crachas?|business cards?|cartao de visita)\b/i, SIZE.tiny),

  // --- Money and personal effects ---------------------------------------------------------------
  k(/\b(wallets?|carteiras?|purse|money|dinheiro|cash|coins?|moedas?|dollars?|dolares|banknotes?|notas|cheques?|checks?)\b/i, SIZE.tiny),
  k(/\b(keys?|chaves?|key ?ring|chaveiro|keycard)\b/i, SIZE.tiny),
  k(/\b(pocket ?watch|watch|wristwatch|relogio( de bolso)?|compass|bussola|magnifying glass|lupa|lente de aumento|loupe|glasses|oculos|spectacles|monocle|monoculo|mirror|espelho|chalk|giz)\b/i, SIZE.tiny),
  k(/\b(cigarettes?|cigarros?|cigars?|charutos?|pipe|cachimbo|tobacco|tabaco|fumo)\b/i, SIZE.tiny),
  k(/\b(crystal ball|bola de cristal|scrying (orb|mirror))\b/i, s(2, 2)),
  k(/\b(crucifix|crucifixo|rosary|rosario|cross|cruz|holy water|agua benta|amulets?|amuletos?|talismans?|talisma|charms?|pendants?|pingentes?|medallions?|medalhao|medalha|rings?|aneis|anel|necklaces?|colar(es)?|jewel(s|ry)?|joias?|gems?|gemas?|crystals?|cristais|cristal)\b/i, SIZE.tiny),

  // --- Food and drink ---------------------------------------------------------------------------
  k(/\b(hip flask|flasks?|garrafa de bolso|cantil de bolso)\b/i, SIZE.tiny),
  k(/\b(canteen|cantil|water bottle|cantis)\b/i, s(2, 2)),
  k(/\b(thermos|garrafa termica)\b/i, s(3, 1)),
  k(/\b(bottles?|garrafas?|wine|vinho|whisk(e)?y|bourbon|gin|rum|vodka|cachaca)\b/i, SIZE.knife),
  k(/\b(rations?|racao|racoes|mre|food|comida|lanches?|snacks?|sandwich(es)?|sanduiches?|canned|tin can|enlatados?|latas?|chocolate|biscuits?|biscoitos?)\b/i, SIZE.tiny),

  // --- Clothing ---------------------------------------------------------------------------------
  k(/\b(coats?|overcoat|trench ?coat|casacos?|sobretudo|jackets?|jaquetas?|uniforms?|uniformes?|disguise|disfarce|clothes|clothing|roupas?)\b/i, s(3, 3)),
  k(/\b(hats?|chapeus?|chapeu|caps?|gloves?|luvas?|scarf|cachecol|boots|botas)\b/i, s(2, 1)),

  // --- Mythos curios and art --------------------------------------------------------------------
  k(/\b(statues?|estatuas?|busts?|bustos?)\b/i, s(3, 3)),
  k(/\b(idols?|idolos?|statuettes?|estatuetas?|figurines?|effig(y|ies)|efigies?|totems?|totens?|fetish(es)?|fetiches?)\b/i, s(2, 2)),
  k(/\b(skulls?|cranios?|caveiras?|masks?|mascaras?|orbs?|orbes?|urns?|urnas?|jars?|potes?|jarros?|canopic|vases?|vasos?|clay tablets?|tabuletas?|puzzle box|lament configuration)\b/i, s(2, 2)),
  k(/\b(relics?|reliquias?|artifacts?|artefatos?|artefacts?|fragments?|fragmentos?|shards?|discs?|discos?|stones?|pedras?|rocks?)\b/i, SIZE.tiny),
  k(/\b(paintings?|pinturas?|quadros?|canvas|tela)\b/i, s(4, 3)),
  k(/\b(boxes|box|caixas?|crates?|engradados?|chests?|bau)\b/i, s(2, 2))
];

/** Last-resort footprints by item type. */
const byType = {
  CoC7: { weapon: s(2, 2), armor: s(3, 3), book: s(2, 2), item: s(1, 1) },
  deltagreen: { weapon: s(2, 2), armor: s(3, 3), tome: s(2, 2), gear: s(1, 1) }
};

/** The module's built-in size registry (see scripts/core/sizes.mjs for the shape). */
export const DEFAULT_REGISTRY = Object.freeze({
  physicalTypes,
  byId: { CoC7: COC7_BY_ID, deltagreen: DG_BY_ID },
  byName: { CoC7: COC7_BY_NAME, deltagreen: DG_BY_NAME },
  keywords: KEYWORDS,
  byType
});
