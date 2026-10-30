import { chmodSync, mkdirSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { UserError } from "./errors.ts";

/** How long each browser step may take before it counts as hung. Tests shorten them. */
export const LIMITS = { launch: 30_000, load: 15_000, close: 5_000 };

let launching: Promise<Page> | undefined;

/** Opens Chromium on the profile, with a user agent when given. Tests pass a fake. */
export type OpenWindow = (profile: string, userAgent?: string) => Promise<BrowserContext>;

/** WHATSAPP_HEADLESS=1 hides the window. It only works once the profile is logged in, because the QR code needs the window. */
export const isHeadless = () => process.env.WHATSAPP_HEADLESS === "1";

/** The folder that holds the profile and the send log. */
export const mcpHome = () => process.env.WHATSAPP_MCP_HOME || join(homedir(), ".whatsapp-mcp");

// Playwright's defaults mark the browser as automated (navigator.webdriver, the "controlled by automated software" bar).
// WhatsApp can read those, so the window starts like a normal Chrome.
const openChromium: OpenWindow = (profile, userAgent) =>
  chromium.launchPersistentContext(profile, {
    headless: isHeadless(),
    viewport: null,
    timeout: LIMITS.launch,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
    ...(userAgent ? { userAgent } : {}),
  });

/** The WhatsApp page in its own Chromium window and profile. Launched on first use, and again after the window closes or fails to load. */
export function whatsappPage(open: OpenWindow = openChromium): Promise<Page> {
  if (launching) return launching;
  const attempt: Promise<Page> = launch(open, () => {
    // Only forget this window, not a newer one that replaced it.
    if (launching === attempt) launching = undefined;
  });
  launching = attempt;
  attempt.catch(() => {
    if (launching === attempt) launching = undefined;
  });
  return attempt;
}

/** Closes the window if it is open. */
export async function closeBrowser(): Promise<void> {
  const page = await launching?.catch(() => undefined);
  launching = undefined;
  if (page) await closeWindow(page.context());
}

async function launch(open: OpenWindow, onClose: () => void): Promise<Page> {
  const home = mcpHome();
  const profile = join(home, "profile");
  // The profile holds the WhatsApp login, so only you may read it.
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  chmodSync(profile, 0o700);
  if (profileInUse(profile)) throw new UserError("The WhatsApp window is already open from another session");
  const openOnce = (userAgent?: string) =>
    open(profile, userAgent).catch(() => {
      throw new UserError("Couldn't open the WhatsApp window. Close any other copy of it and try again");
    });
  let context = await openOnce();
  if (isHeadless()) {
    // The hidden browser calls itself HeadlessChrome, which WhatsApp Web won't load for.
    // Reopen once with the user agent the same browser sends when visible: the same text, with "Chrome".
    const agent = await withLimit(firstPage(context).then((page) => page.evaluate(() => navigator.userAgent)), LIMITS.load, "Reading the browser's user agent").catch(async (error: unknown) => {
      await closeWindow(context);
      throw error;
    });
    if (agent.includes("HeadlessChrome")) {
      await closeWindow(context);
      context = await openOnce(agent.replace("HeadlessChrome", "Chrome"));
    }
  }
  context.on("close", onClose);
  try {
    const page = await firstPage(context);
    // Closing the tab should end the window too, so the next call starts fresh instead of using a dead page.
    page.on("close", () => void closeWindow(context).catch(() => {}));
    const url = process.env.WHATSAPP_URL || "https://web.whatsapp.com";
    await withLimit(page.goto(url, { waitUntil: "domcontentloaded", timeout: LIMITS.load }), LIMITS.load, "Loading WhatsApp");
    return page;
  } catch (error) {
    // An open window keeps the profile locked, so a failed start must close it or every retry is refused.
    await closeWindow(context);
    throw error;
  }
}

/** The window's first tab, opening one if there is none. */
function firstPage(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0];
  return page ? Promise.resolve(page) : withLimit(context.newPage(), LIMITS.load, "Opening a tab");
}

/**
 * Closes a window. If closing hangs, it only forgets the window and asks you to quit it.
 * It never kills a process, because nothing can prove which process is this tool's Chromium.
 */
async function closeWindow(context: BrowserContext): Promise<void> {
  const closed = await withLimit(context.close(), LIMITS.close, "Closing the window").then(() => true, () => false);
  if (!closed) throw new UserError("The WhatsApp window didn't close. Quit it and try again");
}

/** Rejects with "<what> took too long" when the work doesn't finish in time. */
export function withLimit<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UserError(`${what} took too long`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Chromium marks a profile in use with a SingletonLock link to "host-pid". Its error for this looks like other launch errors, so check the pid.
 * This only decides whether to refuse a launch. Signal 0 sends nothing; it only asks whether the pid is alive.
 */
export function profileInUse(profile: string): boolean {
  try {
    const pid = Number(readlinkSync(join(profile, "SingletonLock")).split("-").pop());
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
