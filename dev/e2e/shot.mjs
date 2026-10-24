/**
 * Ad-hoc screenshot CLI for agents:
 *   dev/e2e/run.sh node shot.mjs --world attache-coc7 --user Gamemaster \
 *     --eval "game.actors.contents[0].sheet.render({force:true})" --wait 1500 --out sheet.png
 * Options:
 *   --world <id>      world to launch (default attache-coc7)
 *   --user <name>     user to log in as (default Gamemaster)
 *   --eval <js>       JS run in the page after `ready` (expression or statements; may await;
 *                     repeatable, run in order). Its result is printed as JSON.
 *   --wait <ms>       wait after the last eval before the shot (default 1000)
 *   --selector <css>  screenshot only this element instead of the viewport
 *   --width/--height  viewport (default 1600x1000)
 *   --out <name.png>  file name in dev/artifacts (default shot.png)
 * Console errors seen during the run are printed at the end.
 */

import { chromium } from "@playwright/test";
import { launchWorld, loginAs, screenshot, collectConsoleErrors, ARTIFACTS_DIR } from "./helpers.mjs";
import path from "node:path";

const args = { world: "attache-coc7", user: "Gamemaster", eval: [], wait: "1000", out: "shot.png",
  width: "1600", height: "1000", selector: "" };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, "");
  if (!(key in args)) throw new Error(`Unknown option ${argv[i]}`);
  const value = argv[++i];
  if (Array.isArray(args[key])) args[key].push(value);
  else args[key] = value;
}

/** Evaluate a source string as an async expression, falling back to a statement body. */
async function runSnippet(page, code) {
  try {
    return await page.evaluate(`(async () => (${code}))()`);
  } catch (err) {
    if (!/SyntaxError/.test(String(err))) throw err;
    return page.evaluate(`(async () => { ${code} })()`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(args.width), height: Number(args.height) } });
const errors = collectConsoleErrors(page);
let code = 0;
try {
  await launchWorld(page, args.world);
  await loginAs(page, args.user);
  for (const snippet of args.eval) {
    const result = await runSnippet(page, snippet);
    let printable;
    try { printable = JSON.stringify(result); } catch { printable = String(result); }
    console.log(`[shot] eval -> ${printable ?? "undefined"}`);
  }
  await page.waitForTimeout(Number(args.wait));
  let file;
  if (args.selector) {
    file = path.join(ARTIFACTS_DIR, args.out);
    await page.locator(args.selector).first().screenshot({ path: file });
  } else {
    file = await screenshot(page, args.out);
  }
  console.log(`[shot] wrote ${path.relative("/work", file)}`);
} catch (err) {
  code = 1;
  console.error(`[shot] FAILED: ${err.stack ?? err}`);
} finally {
  if (errors.length) console.log("[shot] console errors:\n" + errors.map((e) => `  - ${e.text}`).join("\n"));
  await browser.close();
}
process.exit(code);
