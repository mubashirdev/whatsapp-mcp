import { mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { BrowserContext } from "playwright-core";
import { closeBrowser, whatsappPage } from "../src/browser.ts";

/** A fake Chromium window whose page load fails or succeeds, counting closes. */
function fakeWindow(loads: boolean) {
  const handlers: (() => void)[] = [];
  const window = { closes: 0, fireClose: () => handlers.forEach((handler) => handler()) };
  const page = {
    on: () => {},
    goto: async () => {
      if (!loads) throw new Error("page.goto: net::ERR_CONNECTION_REFUSED");
    },
    context: () => context,
  };
  const context = {
    pages: () => [page],
    newPage: async () => page,
    on: (event: string, handler: () => void) => event === "close" && handlers.push(handler),
    close: async () => {
      window.closes++;
      window.fireClose();
    },
  };
  return { window, page, open: async () => context as unknown as BrowserContext };
}

// $TMPDIR, because some sandboxes block the system temp folder.
const home = () => realpathSync(mkdtempSync(join(process.env.TMPDIR || "/tmp", "wa-launch-")));

test("a page load that fails closes its window, and the next call opens a fresh one", async () => {
  process.env.WHATSAPP_MCP_HOME = home();
  const failing = fakeWindow(false);
  await expect(whatsappPage(failing.open)).rejects.toThrow("ERR_CONNECTION_REFUSED");
  expect(failing.window.closes).toBe(1);
  const working = fakeWindow(true);
  expect(await whatsappPage(working.open)).toBe(working.page as never);
  await closeBrowser();
  expect(working.window.closes).toBe(1);
});

test("a late close from an old window doesn't drop the window that replaced it", async () => {
  process.env.WHATSAPP_MCP_HOME = home();
  const first = fakeWindow(true);
  await whatsappPage(first.open);
  await closeBrowser();
  const second = fakeWindow(true);
  const page = await whatsappPage(second.open);
  first.window.fireClose();
  const third = fakeWindow(true);
  expect(await whatsappPage(third.open)).toBe(page);
  await closeBrowser();
});

/** A fake window that reports a user agent, recording how it was opened and whether it was closed. */
function windowWithAgent(agent: string) {
  const opened: (string | undefined)[] = [];
  let closes = 0;
  const page = { on: () => {}, goto: async () => {}, evaluate: async () => agent, context: () => context };
  const context = { pages: () => [page], newPage: async () => page, on: () => {}, close: async () => void closes++ };
  return {
    page,
    opened,
    closes: () => closes,
    open: async (_profile: string, userAgent?: string) => {
      opened.push(userAgent);
      return context as unknown as BrowserContext;
    },
  };
}

const HEADLESS_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36";
const VISIBLE_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

test("headless, a window that says HeadlessChrome is reopened once with the visible Chrome user agent", async () => {
  process.env.WHATSAPP_MCP_HOME = home();
  process.env.WHATSAPP_HEADLESS = "1";
  try {
    const window = windowWithAgent(HEADLESS_AGENT);
    await whatsappPage(window.open);
    expect(window.opened).toEqual([undefined, VISIBLE_AGENT]);
    expect(window.closes()).toBe(1);
    await closeBrowser();
  } finally {
    delete process.env.WHATSAPP_HEADLESS;
  }
});

test("with the window visible, the user agent is left alone", async () => {
  process.env.WHATSAPP_MCP_HOME = home();
  const window = windowWithAgent(HEADLESS_AGENT);
  await whatsappPage(window.open);
  expect(window.opened).toEqual([undefined]);
  await closeBrowser();
});
