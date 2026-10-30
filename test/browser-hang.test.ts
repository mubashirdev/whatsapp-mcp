import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { BrowserContext } from "playwright-core";
import { closeBrowser, LIMITS, whatsappPage } from "../src/browser.ts";
import { within } from "./helpers.ts";

const DIDNT_CLOSE = "The WhatsApp window didn't close. Quit it and try again";
const ALREADY_OPEN = "The WhatsApp window is already open from another session";

/** A fake Chromium that locks the profile like the real one, with a page that may fail to load and a close() that may never finish. */
function fakeChromium({ loads, closes, hangs = "" }: { loads: boolean; closes: boolean; hangs?: "" | "goto" | "newPage" }) {
  // A real process stands in for Chromium and holds the lock, so "still running" and "already open" are real.
  const chromium = Bun.spawn(["sleep", "30"], { stdio: ["ignore", "ignore", "ignore"] });
  // Unref, so a failing test still lets the run end.
  chromium.unref();
  const page = {
    on: () => {},
    goto: () => {
      if (hangs === "goto") return new Promise<void>(() => {});
      return loads ? Promise.resolve() : Promise.reject(new Error("page.goto: net::ERR_CONNECTION_REFUSED"));
    },
    context: () => context,
  };
  const context = {
    pages: () => (hangs === "newPage" ? [] : [page]),
    newPage: () => (hangs === "newPage" ? new Promise<never>(() => {}) : Promise.resolve(page)),
    on: () => {},
    // Like Playwright, a close that works resolves once the browser has exited.
    close: () => (closes ? quit() : new Promise<void>(() => {})),
  };
  const open = async (profile: string) => {
    mkdirSync(profile, { recursive: true });
    // Like Chromium, take over a lock whose process is gone.
    rmSync(join(profile, "SingletonLock"), { force: true });
    symlinkSync(`${hostname()}-${chromium.pid}`, join(profile, "SingletonLock"));
    return context as unknown as BrowserContext;
  };
  /** Stands in for you quitting the stuck window. */
  const quit = async () => {
    chromium.kill();
    await chromium.exited;
  };
  return { chromium, page, open, quit };
}

const home = () => realpathSync(mkdtempSync(join(process.env.TMPDIR || "/tmp", "wa-hang-")));

async function isRunning(proc: { exitCode: number | null; signalCode: string | null }) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return proc.exitCode === null && proc.signalCode === null;
}

/** Runs a test with shorter browser limits, and puts them back after. */
async function withShortLimits(work: () => Promise<void>) {
  const saved = { ...LIMITS };
  Object.assign(LIMITS, { load: 300, close: 300 });
  try {
    await work();
  } finally {
    Object.assign(LIMITS, saved);
  }
}

test("a failed page load whose window never closes ends within the limit, kills nothing, and opens again once you quit it", async () => {
  process.env.WHATSAPP_MCP_HOME = home();
  const stuck = fakeChromium({ loads: false, closes: false });
  await expect(within(8_000, whatsappPage(stuck.open), "The failed launch")).rejects.toThrow(DIDNT_CLOSE);
  expect(await isRunning(stuck.chromium)).toBe(true);
  await stuck.quit();
  const working = fakeChromium({ loads: true, closes: true });
  expect(await within(2_000, whatsappPage(working.open), "The retry")).toBe(working.page as never);
  await closeBrowser();
}, 10_000);

test("while the stuck window is still open, the next call says it is already open", () =>
  withShortLimits(async () => {
    process.env.WHATSAPP_MCP_HOME = home();
    const stuck = fakeChromium({ loads: false, closes: false });
    await expect(within(3_000, whatsappPage(stuck.open), "The failed launch")).rejects.toThrow(DIDNT_CLOSE);
    const next = fakeChromium({ loads: true, closes: true });
    await expect(within(2_000, whatsappPage(next.open), "The next call")).rejects.toThrow(ALREADY_OPEN);
    await stuck.quit();
    next.chromium.kill();
  }));

test("a page load that never answers times out, closes the window, and the retry opens", () =>
  withShortLimits(async () => {
    process.env.WHATSAPP_MCP_HOME = home();
    const hung = fakeChromium({ loads: true, closes: true, hangs: "goto" });
    await expect(within(3_000, whatsappPage(hung.open), "The hung load")).rejects.toThrow("Loading WhatsApp took too long");
    const working = fakeChromium({ loads: true, closes: true });
    expect(await within(2_000, whatsappPage(working.open), "The retry")).toBe(working.page as never);
    await closeBrowser();
  }));

test("a tab that never opens times out and closes the window", () =>
  withShortLimits(async () => {
    process.env.WHATSAPP_MCP_HOME = home();
    const hung = fakeChromium({ loads: true, closes: true, hangs: "newPage" });
    await expect(within(3_000, whatsappPage(hung.open), "The hung tab")).rejects.toThrow("Opening a tab took too long");
    await within(2_000, hung.chromium.exited, "The window closing");
  }));

test("closeBrowser on a window that never closes ends within the limit, kills nothing, and forgets the window", () =>
  withShortLimits(async () => {
    process.env.WHATSAPP_MCP_HOME = home();
    const stuck = fakeChromium({ loads: true, closes: false });
    const page = await whatsappPage(stuck.open);
    await expect(within(2_000, closeBrowser(), "closeBrowser")).rejects.toThrow(DIDNT_CLOSE);
    expect(await isRunning(stuck.chromium)).toBe(true);
    await stuck.quit();
    const working = fakeChromium({ loads: true, closes: true });
    const next = await within(2_000, whatsappPage(working.open), "The next start");
    expect(next).toBe(working.page as never);
    expect(next).not.toBe(page);
    await closeBrowser();
  }));
