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

Installs CoC7 + Delta Green (latest release manifests) into `dev/data/Data/systems`, starts Foundry,
copies the v14 client source to `dev/cache/foundry-src/` (`client/`, `common/`, `public/scripts/`; grep it
for API research), then creates worlds `attache-coc7` (CoC7) and `attache-dg` (deltagreen) with:
users **Gamemaster** (GM) and **Player** (player), both without password; module `attache-case` enabled;
a Player-owned character (`Investigator Test` / `Agent Test`, flag `world.attacheSeed`) carrying three
compendium weapons and armor. Re-running only fills in what is missing. It ends on the setup screen.

The repo is mounted read-only as `Data/modules/attache-case`, so code edits are live (reload the browser;
CSS/HBS/lang hot-reload). LevelDB needs write access even to read a compendium, so Foundry gets a writable copy of
`packs/` mounted over it (`dev/data/module-packs`); `dev/setup.sh` refreshes it (stopping Foundry) whenever the repo
packs change, e.g. after `npm run build:packs`. Data lives in `dev/data/` (gitignored). Reset a world by deleting
`dev/data/Data/worlds/<id>` and re-running `dev/setup.sh`.

## Smoke test

```sh
dev/e2e/run.sh smoke.spec.mjs            # both worlds
dev/e2e/run.sh smoke.spec.mjs -g dg      # one world
```

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
dev/e2e/run.sh                                    # everything (smoke + scenarios + visual)
```

`scenarios.spec.mjs` creates its own fixture actors (flag `world.attacheQA`, deleted at the start of each run) with exact
placements, drives the UI with real mouse/keyboard events (pointer drags, R/wheel/right-click rotation, context menus,
HTML5 drops from the sidebar and compendiums) and asserts the item flags. It runs with the core `noCanvas` client setting
(much faster without a GPU). Helpers: `dev/e2e/qa.mjs`. The last test per world fails on any console error/warning that
mentions attache-case (`dev/artifacts/<world>-scenarios-console.json`). It creates a "Player2" user for the GM-relay test.

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
`dev/e2e/run.sh <args>` = `npx playwright test <args>`; `dev/e2e/run.sh node|npx|bash ...` runs any command.

## Other commands

```sh
docker compose -f dev/docker-compose.yml logs -f foundry   # server log
docker compose -f dev/docker-compose.yml down              # stop (data is kept)
```
