/**
 * Playwright helpers for driving the local Foundry VTT v14 dev server (see dev/README.md).
 * All functions take a Playwright `Page`. Foundry is reached at FOUNDRY_URL (http://foundry:30000
 * inside the compose network).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Base URL of the Foundry server. */
export const FOUNDRY_URL = (process.env.FOUNDRY_URL || "http://localhost:30000").replace(/\/$/, "");

/** Where screenshots and other artifacts go (dev/artifacts). */
export const ARTIFACTS_DIR = path.resolve(HERE, "..", "artifacts");

/** Test worlds created by dev/setup.sh. */
export const WORLDS = {
  "attache-coc7": { system: "CoC7", title: "Attaché Case — CoC7", actorType: "character" },
  "attache-dg": { system: "deltagreen", title: "Attaché Case — Delta Green", actorType: "agent" }
};

/** Flag scope/key that marks the seeded test character. */
export const SEED_FLAG = { scope: "world", key: "attacheSeed" };

const ADMIN_KEY = () => process.env.FOUNDRY_ADMIN_KEY || "";

/**
 * GET /api/status: `{active, version, world, system, users, ...}` (no auth needed).
 * @returns {Promise<object|null>}
 */
export async function serverStatus() {
  try {
    const res = await fetch(`${FOUNDRY_URL}/api/status`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Wait until the Foundry HTTP server answers /api/status.
 * @param {number} timeoutMs
 */
export async function waitForServer(timeoutMs = 300_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const status = await serverStatus();
    if (status) return status;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Foundry did not answer at ${FOUNDRY_URL}/api/status within ${timeoutMs} ms`);
}

/**
 * Get past the licence / EULA screen and the admin-key screen, ending on /setup.
 * Safe to call when there is nothing to do. Only valid while no world is active.
 * @param {import("@playwright/test").Page} page
 */
export async function ensureSetupAccess(page) {
  await page.goto(`${FOUNDRY_URL}/setup`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 6; i++) {
    const url = new URL(page.url());
    if (url.pathname.endsWith("/license")) {
      await acceptLicense(page);
    } else if (url.pathname.endsWith("/auth")) {
      await page.locator("input[name=adminPassword], input[name=adminKey], input[type=password]").first()
        .fill(ADMIN_KEY());
      await Promise.all([
        page.waitForURL((u) => !u.pathname.endsWith("/auth"), { timeout: 30_000 }),
        page.locator("button[type=submit], button[name=action][value=adminAuth]").first().click()
      ]);
    } else if (url.pathname.endsWith("/setup")) {
      await page.waitForFunction(() => globalThis.game?.ready !== false, null, { timeout: 60_000 }).catch(() => {});
      await dismissSetupDialogs(page);
      return;
    } else {
      throw new Error(`Unexpected page while reaching /setup: ${page.url()} (is a world still running?)`);
    }
    await page.waitForLoadState("domcontentloaded");
  }
  throw new Error(`Could not reach /setup, stuck at ${page.url()}`);
}

/**
 * First-run licence screen: optional key entry, then the EULA agreement.
 * @param {import("@playwright/test").Page} page
 */
async function acceptLicense(page) {
  // The licence page is rendered client-side (AppV2), so wait for either form to exist.
  await page.locator("#eula-form, input[name=licenseKey]").first().waitFor({ timeout: 30_000 });
  const keyInput = page.locator("input[name=licenseKey]");
  if (await keyInput.count() && await keyInput.isVisible() && process.env.FOUNDRY_LICENSE_KEY) {
    await keyInput.fill(process.env.FOUNDRY_LICENSE_KEY);
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.locator("button[type=submit]").first().click()
    ]);
  }
  const agree = page.locator("#eula-agree, input[name=agree]").first();
  if (await agree.count()) {
    await agree.check();
    await Promise.all([
      page.waitForURL((u) => !u.pathname.endsWith("/license"), { timeout: 30_000 }),
      page.locator("#sign").click()
    ]);
  }
}

/**
 * Close the dialogs/tours the setup screen may open on first visit (telemetry, tours, news).
 * @param {import("@playwright/test").Page} page
 */
async function dismissSetupDialogs(page) {
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    try { globalThis.foundry?.nue?.Tour?.activeTour?.exit?.(); } catch { /* none */ }
    for (const app of foundry.applications.instances?.values?.() ?? []) {
      if (app instanceof foundry.applications.api.DialogV2) app.close();
    }
  }).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
}

/**
 * POST a JSON action to a server route from the browser session (keeps the admin cookie).
 * @param {import("@playwright/test").Page} page
 * @param {string} route e.g. "/setup" or "/join"
 * @param {object} body e.g. {action: "launchWorld", world: "attache-coc7"}
 * @returns {Promise<{status:number, body:any}>}
 */
export async function postAction(page, route, body) {
  return page.evaluate(async ({ route, body }) => {
    const res = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  }, { route, body });
}

/**
 * Return the server to the setup screen if a world is running (v14: POST /setup worldShutdown + admin key).
 * @param {import("@playwright/test").Page} page
 */
export async function shutdownWorld(page) {
  const status = await serverStatus();
  if (!status?.active) return;
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "domcontentloaded" });
  const res = await postAction(page, "/setup", { action: "worldShutdown", adminPassword: ADMIN_KEY() });
  if (res.status >= 400) throw new Error(`Shutdown failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  await waitFor(async () => !(await serverStatus())?.active, 60_000, "world shutdown");
}

/**
 * Make `worldId` the active world (shutting down another one if needed) and end on /join.
 * @param {import("@playwright/test").Page} page
 * @param {string} worldId
 */
export async function launchWorld(page, worldId) {
  const status = await serverStatus();
  if (status?.active && status.world === worldId) {
    await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "domcontentloaded" });
    return;
  }
  if (status?.active) await shutdownWorld(page);
  await ensureSetupAccess(page);
  const res = await postAction(page, "/setup", { action: "launchWorld", world: worldId });
  if (res.status >= 400) throw new Error(`launchWorld ${worldId} failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  await waitFor(async () => {
    const s = await serverStatus();
    return s?.active && s.world === worldId;
  }, 180_000, `world ${worldId} to launch`);
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "domcontentloaded" });
}

/**
 * Log in on /join as `userName` (no password) and wait for `game.ready`.
 * @param {import("@playwright/test").Page} page
 * @param {string} userName e.g. "Gamemaster" or "Player"
 * @param {string} [password]
 */
export async function loginAs(page, userName, password = "") {
  if (!new URL(page.url()).pathname.endsWith("/join")) {
    await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "domcontentloaded" });
  }
  const select = page.locator("select[name=userId]");
  await select.waitFor({ timeout: 60_000 });
  await select.selectOption({ label: userName });
  await page.locator("input[name=password]").fill(password);
  await Promise.all([
    page.waitForURL((u) => u.pathname.endsWith("/game"), { timeout: 60_000 }),
    page.locator("button[name=join]").click()
  ]);
  await waitForGameReady(page);
}

/**
 * Wait until the game client finished its `ready` hook.
 * @param {import("@playwright/test").Page} page
 */
export async function waitForGameReady(page, timeoutMs = 120_000) {
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: timeoutMs });
  // Let first-render apps (sidebar, notifications) settle.
  await page.waitForTimeout(1000);
  // Headless Chromium has no GPU: core shows a permanent "no hardware acceleration" warning whose
  // box covers the top-right of the screen (and window headers there). Dismiss startup notices.
  await page.evaluate(() => ui.notifications?.clear?.()).catch(() => {});
}

/**
 * Run `fn(args)` in the Foundry page and return its (serializable) result.
 * @param {import("@playwright/test").Page} page
 * @param {Function} fn
 * @param {any} [args]
 */
export async function evalInFoundry(page, fn, args) {
  return page.evaluate(fn, args);
}

/**
 * Save a full-page screenshot to dev/artifacts/<name>(.png).
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 * @returns {Promise<string>} absolute path written
 */
export async function screenshot(page, name) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const file = path.join(ARTIFACTS_DIR, name.endsWith(".png") ? name : `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/**
 * Start collecting console errors/warnings and uncaught page errors. Call before navigating.
 * The returned array fills live: `{type, text, location}`.
 * @param {import("@playwright/test").Page} page
 * @returns {Array<{type:string, text:string, location:string}>}
 */
export function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const loc = msg.location();
    errors.push({ type: "console", text: msg.text(), location: loc?.url ? `${loc.url}:${loc.lineNumber}` : "" });
  });
  page.on("pageerror", (err) => {
    errors.push({ type: "pageerror", text: `${err.name}: ${err.message}`, location: err.stack ?? "" });
  });
  return errors;
}

/**
 * Errors attributable to our module (by message or stack location).
 * @param {Array<{text:string, location:string}>} errors
 */
export function moduleErrors(errors) {
  return errors.filter((e) => /attache-case|Attach[eé] ?Case|ATTACHE\./i.test(`${e.text}\n${e.location}`));
}

/**
 * Poll `predicate` until truthy.
 * @param {() => Promise<any>} predicate
 * @param {number} timeoutMs
 * @param {string} what
 */
export async function waitFor(predicate, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
