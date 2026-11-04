# Dev environment (Docker only)

Nothing is installed on the host; everything runs through `dev/docker-compose.yml`.

| Service   | Image                                         | Purpose                                         |
|-----------|-----------------------------------------------|-------------------------------------------------|
| `node`    | `node:22-alpine`                              | `npm test`, `npm run lint`, `npm run build:packs` |
| `foundry` | `felddy/foundryvtt:14.369`                    | Foundry VTT v14 server, http://127.0.0.1:30000 (host) / http://foundry:30000 (compose) |
| `e2e`     | `mcr.microsoft.com/playwright:v1.64.1-noble`  | Playwright 1.64.1 (deps in volume `e2e_node_modules`) |

## Credentials

Copy `.env.example` to `.env` (repo root, gitignored) and fill **either** `FOUNDRY_USERNAME` +
`FOUNDRY_PASSWORD` **or** `FOUNDRY_RELEASE_URL`, plus `FOUNDRY_ADMIN_KEY`; `FOUNDRY_LICENSE_KEY` is optional.
Plain `KEY=value` lines only. The Foundry zip is downloaded once into `dev/cache/foundry/`; after
that (and once licensed) the credentials are no longer used.

## One-time / idempotent setup

```sh
dev/setup.sh
```

Installs CoC7 + Delta Green (latest release manifests) and dnd5e (pinned to exactly 5.3.3; a failed download
is an error, never another version) into `dev/data/Data/systems`, copies Plutonium + libWrapper when this
machine has them (below), starts Foundry, copies the v14 client source to `dev/cache/foundry-src/` (`client/`,
`common/`, `public/scripts/`; grep it for API research), then creates the worlds, all with users **Gamemaster**
(GM) and **Player** (player), both without password, and a Player-owned character (flag `world.attacheSeed`):

| List in `helpers.mjs` | World | System | Modules enabled | Character | Used by |
|---|---|---|---|---|---|
| `WORLDS` | `attache-coc7` | CoC7 | `attache-case` | `Investigator Test` | `smoke`, `scenarios`, `visual`, zip check |
| `WORLDS` | `attache-dg` | deltagreen | `attache-case` | `Agent Test` | `smoke`, `scenarios`, `visual`, zip check |
| `DND5E_WORLDS` | `attache-dnd5e` | dnd5e 5.3.3 | `attache-case` | `Adventurer Test` | `dnd5e-load`, `spikes` |
| `DND5E_WORLDS` | `attache-dnd5e-plutonium` | dnd5e 5.3.3 | `attache-case`, `plutonium`, `lib-wrapper` | `Adventurer Test` | `dnd5e-load`, `spikes` |

Re-running only fills in what is missing. It ends on the setup screen. The dnd5e worlds are seeded by item name
from `dnd5e.equipment24`, on their own code path. They are not in `WORLDS` because the module has no dnd5e
profile until M1, so `smoke`, `scenarios` and `visual` cannot run there yet.

### Plutonium (local copy, never committed)

`dev/install-plutonium.sh` (called by `dev/setup.sh`) copies `plutonium` and `lib-wrapper` from the owner's install
into the gitignored `dev/data/Data/modules/`, owned by uid 1000. The source is bind-mounted read-only; any destination
under `/mnt/c` is refused; a matching copied version is left alone. Without the source (CI) it is a no-op:
`attache-dnd5e-plutonium` is not created and everything that needs it skips. Plutonium is unlicensed paid content: it stays
in `dev/data`, never in tracked files or fixtures. Setup presets `dataSources.isNoPrereleaseBrewIndexes` and
`misc.isSkipBackendCheck` so that it needs no network; specs block `*5e.tools` with `FIVE_E_TOOLS`.

The repo is mounted read-only as `Data/modules/attache-case`, so code edits are live (reload the browser;
CSS/HBS/lang hot-reload). LevelDB needs write access even to read a compendium, so Foundry gets a writable copy of
`packs/` mounted over it (`dev/data/module-packs`); `dev/setup.sh` refreshes it (stopping Foundry) whenever the repo
packs change, e.g. after `npm run build:packs`. Data lives in `dev/data/` (gitignored). Reset a world by deleting
`dev/data/Data/worlds/<id>` and re-running `dev/setup.sh`.

## Smoke test

```sh
dev/e2e/run.sh smoke.spec.mjs            # the WORLDS (CoC7, Delta Green)
dev/e2e/run.sh smoke.spec.mjs -g dg      # one world
dev/e2e/run.sh dnd5e-load.spec.mjs       # both dnd5e worlds, GM and Player
```

`dnd5e-load.spec.mjs` only proves loading: the module is active and no console error mentions it.

Per world: launch, log in as Gamemaster, assert `game.system.id`, module active,
`api.open` is a function, Attaché Case header control on the seeded actor's sheet (soft), open the case
via `api.open`, and fail on console errors mentioning attache-case. Artifacts in `dev/artifacts/`:
`<world>-smoke.png`, `<world>-sheet.png`, `<world>-case.png`, `<world>-console.json` (all console errors),
`<world>-layout.json` (`api.getLayout`), and `test-results/` (trace + screenshot on failure).

## Regression suite (QA)

```sh
dev/e2e/run.sh scenarios.spec.mjs                 # 14 scenarios x 2 worlds, GM + Player clients (~4 min)
dev/e2e/run.sh scenarios.spec.mjs -g "attache-dg.*05"   # one scenario in one world
dev/e2e/run.sh visual.spec.mjs                    # showcase actor, dark + light, next to the system sheet
SAVE_DOCS=1 dev/e2e/run.sh visual.spec.mjs -g coc7      # also refresh docs/screenshot-{dark,light}.png
QA_SHOTS=1 dev/e2e/run.sh scenarios.spec.mjs -g ...     # screenshot every pointer drag mid-flight
dev/e2e/run.sh                                    # everything (all the specs below and above)
```

`scenarios.spec.mjs` creates its own fixture actors (flag `world.attacheQA`, deleted at the start of each run) with exact
placements, drives the UI with real mouse/keyboard events (pointer drags, R/wheel/right-click rotation, context menus,
HTML5 drops from the sidebar and compendiums) and asserts the item flags. It runs with the core `noCanvas` client setting
(much faster without a GPU). Helpers: `dev/e2e/qa.mjs`. The last test per world fails on any console error/warning that
mentions attache-case (`dev/artifacts/<world>-scenarios-console.json`). It creates a "Player2" user for the GM-relay test.

## Spikes

```sh
dev/e2e/run.sh spikes.spec.mjs            # live answers about dnd5e 5.3.3 + Plutonium
```

Each spike asserts what was observed, so a wrong assumption fails. Findings: `.llm/foundry-v14-api.md` section 21. Raw
observations: `dev/artifacts/spikes/S*.json`. S2 and S5 run in `attache-dnd5e-plutonium` (skipped without the copy), the rest in
`attache-dnd5e`. Fixtures carry the flag `world.attacheSpike` and are deleted again.

## Release zip on a clean install

```sh
dev/zip-check.sh                          # over 6 minutes: run it in the background
```

Builds `dist/module.zip` with `dev/package.sh`, unpacks it as the only copy of this module into a clean `dev/data-zip/` (gitignored),
copies the systems and Plutonium from `dev/data` (so run `dev/setup.sh` once first), provisions every world, and runs
`smoke.spec.mjs`, which covers `WORLDS` for now. The normal stack is stopped first and Foundry is left stopped.

## Rebuilding compendiums

```sh
dev/rebuild-packs.sh                      # stop Foundry, npm run build:packs, refresh dev/data/module-packs, restart
```

`packs/` is tracked and a rebuild changes its bytes even when `packs-src/` did not change, so run this only when the sources did.

## Ad-hoc screenshots

```sh
dev/e2e/run.sh node shot.mjs --world attache-dg --user Player \
  --eval 'game.modules.get("attache-case").api.open(game.user.character)' --wait 1500 --out dg-player.png
```

Options: `--world`, `--user`, `--eval` (repeatable; expression or statements, may `await`; result printed),
`--wait <ms>`, `--selector <css>` (element shot), `--width/--height`, `--out` (file in `dev/artifacts/`).

## Writing specs

Put `*.spec.mjs` in `dev/e2e/` and use `helpers.mjs`: `launchWorld(page, worldId)`, `loginAs(page, user)`,
`evalInFoundry(page, fn, args)`, `screenshot(page, name)`, `collectConsoleErrors(page)` (+ `moduleErrors`),
`shutdownWorld(page)`, `postAction(page, route, body)`. Only one world runs at a time, so specs run serially.
`waitForPlutonium(page)`, `plutoniumInstalled()`. `dev/e2e/run.sh <args>` = `npx playwright test <args>`;
`dev/e2e/run.sh node|npx|bash ...` runs any command.

## Other commands

```sh
docker compose -f dev/docker-compose.yml logs -f foundry   # server log
docker compose -f dev/docker-compose.yml down              # stop (data is kept)
```

Each project's stack uses port 30000: check `docker ps`, then stop the other stack or set `FOUNDRY_HOST_PORT`.
