# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-24

First release. Requires Foundry VTT 14.359 or later (tested on 14.369) with Call of Cthulhu 7th Edition
(`CoC7`, tested with 8.16) or Delta Green (`deltagreen`, tested with 2.0.1).

### Added
- Grid inventory window for actors, opened from the **⋮** menu of the actor sheet, the Actors sidebar
  right-click menu, the `I` key (rebindable) or the module API. Observers get a read-only view.
- Items with a size in cells. Drag & drop with a green/red fit preview; rotate with `R`, right-click or
  the mouse wheel while dragging, or `R` / right-click → Rotate on a placed item. `Escape` cancels a
  drag; arrow keys move a focused item and `Enter` opens it; double-click opens the item sheet.
- An "On Person" grid (world default 5x3, changeable per actor, 0 = none) plus any number of container
  items (bags, cases), each with its own grid.
- 12 ready-made containers (Belt Pouch 3x2 to Steamer Trunk 14x8), in the GM's Configure dialog and in
  an "Attaché Case: Containers" compendium for each system.
- Default sizes for the weapons, armor and gear in the CoC7 and Delta Green compendiums, name keywords
  (English and Brazilian Portuguese) and item-type fallbacks for everything else. Unarmed attacks take
  no space.
- "Unstowed" tray for items without a valid spot. Nothing is blocked or deleted; a shrunk container
  keeps its items' positions until they are moved.
- "Worn" strip for armor, which then takes no grid space.
- Automatic placement of new items, a button to place unstowed items without moving the others, and
  "Auto-arrange" to repack everything.
- Giving items to other characters by dragging into their open case or with "Give to…"; relayed
  through a connected GM when the player does not own the target.
- Dropping items from the sidebar, a compendium or a sheet onto a specific cell.
- GM tools: Inventory Size dialog (size, reset to default, takes no space, container), Exclude/Include
  with a GM-only "Not carried" list, Make Container, Delete, per-actor Configure dialog (body grid,
  add/resize/remove containers) and container menus (resize, open sheet, remove).
- Settings: body grid columns/rows, place new items, worn armor, players edit sizes (world); cell size
  and item names (client).
- Light and dark theme support; English and Brazilian Portuguese.
- API at `game.modules.get("attache-case").api`: `open`, `getLayout`, `registerSizes`, `presets`.

[Unreleased]: https://github.com/OWNER/attache-case/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/OWNER/attache-case/releases/tag/v1.0.0
