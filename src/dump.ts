import type { Page } from "playwright-core";
import { UserError } from "./errors.ts";
import { domOutline, loginState } from "./extract.ts";
import { DUMP_KNOWN_VALUES, SELECTORS } from "./selectors.ts";

/** Where runDump gets the page and sends its output. dump-dom passes the real window and the terminal; tests pass fakes. */
export type DumpIO = { open: () => Promise<Page>; close: () => Promise<void>; out: (text: string) => void; err: (text: string) => void };

/**
 * Prints the WhatsApp page's outline, with text and labels only as lengths, and returns the exit code.
 * A failed step prints only its name: Playwright's own error can quote the search word or page text.
 */
export async function runDump(args: string[], { open, close, out, err }: DumpIO): Promise<number> {
  const [mode, word] = args;
  if (mode && !["--open-first", "--open-self", "--search"].includes(mode)) return fail(err, new UserError("Use no option, --open-first, --open-self, or --search <word>"), "");
  if (mode === "--search" && !word) return fail(err, new UserError("Give a word to search for: --search <word>"), "");
  let step = "opening the WhatsApp window";
  try {
    const page = await open();
    const html = page.locator("html");
    step = "waiting for the chat list";
    const deadline = Date.now() + 120_000;
    let state = await html.evaluate(loginState, SELECTORS, { timeout: 10_000 });
    while (state !== "ready" && Date.now() < deadline) {
      if (state === "qr") err("Scan the QR code in the WhatsApp window…");
      await page.waitForTimeout(2_000);
      state = await html.evaluate(loginState, SELECTORS, { timeout: 10_000 });
    }
    if (state !== "ready") err(`The chat list didn't show (state: ${state}). This is the page as it is now.`);
    if (mode === "--open-first") {
      step = "opening the top chat";
      await page.locator(SELECTORS.chatList).locator(SELECTORS.chatRow).first().click({ timeout: 10_000 });
    }
    if (mode === "--open-self") {
      step = "opening your own chat";
      const self = page.locator(SELECTORS.chatList).locator(SELECTORS.selfRow);
      if (!(await self.count())) throw new UserError("Your own chat isn't in the loaded chat list. Scroll to it in the WhatsApp window and try again");
      await self.first().click({ timeout: 10_000 });
    }
    if (mode === "--search") {
      step = "searching";
      await page.locator(SELECTORS.searchBox).fill(word, { timeout: 10_000 });
    }
    // Give the chat or the search results time to render before taking the outline.
    if (mode) await page.waitForTimeout(3_000);
    step = "reading the page";
    out(await html.evaluate(domOutline, DUMP_KNOWN_VALUES, { timeout: 30_000 }));
    return 0;
  } catch (error) {
    return fail(err, error, step);
  } finally {
    // Always free the window and its profile lock. A failed close is reported by its own plain sentence, if any.
    await close().catch((error: unknown) => {
      if (error instanceof UserError) err(error.message);
    });
  }
}

function fail(err: (text: string) => void, error: unknown, step: string): number {
  err(error instanceof UserError ? error.message : `dump-dom failed at: ${step}`);
  return 1;
}
