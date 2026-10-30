import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { domOutline } from "../src/extract.ts";
import { runDump } from "../src/dump.ts";
import { DUMP_KNOWN_VALUES, KNOWN_VALUES } from "../src/selectors.ts";

function load(): Element {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  window.document.write(readFileSync(join(import.meta.dir, "fixtures", "whatsapp.html"), "utf8"));
  return window.document.documentElement as unknown as Element;
}

/** Every text and free-form attribute value in the page: names, messages, senders, ids. Fixed UI labels are left out. */
function privateValues(root: Element): string[] {
  const values = new Set<string>();
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (element.tagName === "SCRIPT") continue;
    for (const child of Array.from(element.childNodes)) if (child.nodeType === 3) values.add((child.textContent ?? "").trim());
    for (const attribute of Array.from(element.attributes)) {
      // type and aria-selected hold fixed words ("text", "false") that would falsely match the outline's own "#text<n>" and "+false_" marks.
      if (!["id", "role", "data-testid", "data-icon", "contenteditable", "dir", "type", "aria-selected"].includes(attribute.name)) values.add(attribute.value);
    }
  }
  return [...values].filter((value) => value.length >= 3 && !KNOWN_VALUES.includes(value));
}

test("the outline keeps the page structure and fixed labels", () => {
  const outline = domOutline(load(), KNOWN_VALUES);
  expect(outline).toContain(`div aria-label="Chat list" role="grid"`);
  expect(outline).toContain(`input role="textbox" aria-label=<26>`);
  expect(outline).toContain(`data-testid="cell-frame-title"`);
  expect(outline).toContain(`button aria-label="Send" #text<4>`);
  expect(outline).toContain(`id="main"`);
});

test("the outline shows no message, chat name, sender or id from the page", () => {
  const root = load();
  const outline = domOutline(root, KNOWN_VALUES);
  const secrets = privateValues(root);
  for (const secret of ["Ali Khan", "Mom", "Sara", "Sam Rivers", "See you at 5", "Line one", "notes.pdf", "3EB0A1", "2 unread messages"]) {
    expect(secrets.some((value) => value.includes(secret))).toBe(true);
  }
  expect(secrets.filter((secret) => outline.includes(secret))).toEqual([]);
  expect(outline).not.toContain("👋");
  expect(outline).toContain(`aria-label=<17>`);
});

test("after a search, the outline shows neither the search word nor the hits", () => {
  const root = load();
  const box = root.querySelector("[data-testid='chat-list-search-container'] input")!;
  // WhatsApp keeps the typed word in the value attribute and highlights it in each hit.
  box.setAttribute("value", "zebrafish");
  root.querySelector("[aria-label='Search results.'] span[dir='auto']")!.innerHTML = "<span class='matched-text'>zebrafish</span> at noon";
  const outline = domOutline(root, KNOWN_VALUES);
  expect(outline).not.toContain("zebrafish");
  expect(outline).toContain("value=<9>");
});

/** A fake WhatsApp page for runDump, where filling the search box fails with a Playwright-style error. */
function failingSearchPage() {
  const locator: Record<string, unknown> = {
    evaluate: async (fn: { name: string }) => (fn.name === "loginState" ? "ready" : "html #text<5>"),
    fill: async () => {
      throw new Error('locator.fill: Timeout 10000ms exceeded.\nCall log:\n  - fill("zebrafish")\n  - element text "Hi mom, the code is 4411"');
    },
    click: async () => {},
  };
  locator.locator = () => locator;
  locator.first = () => locator;
  return { locator: () => locator, waitForTimeout: async () => {} };
}

test("dump-dom prints only a fixed step name when a page step fails, never the search word or page text", async () => {
  const printed: string[] = [];
  const write = (text: string) => void printed.push(text);
  let closed = false;
  const code = await runDump(["--search", "zebrafish"], {
    open: async () => failingSearchPage() as never,
    close: async () => void (closed = true),
    out: write,
    err: write,
  });
  expect(code).toBe(1);
  expect(printed).toEqual(["dump-dom failed at: searching"]);
  expect(closed).toBe(true);
});

test("dump-dom still explains a wrong option in plain words", async () => {
  const printed: string[] = [];
  const write = (text: string) => void printed.push(text);
  const code = await runDump(["--bogus"], { open: async () => failingSearchPage() as never, close: async () => {}, out: write, err: write });
  expect(code).toBe(1);
  expect(printed).toEqual(["Use no option, --open-first, --open-self, or --search <word>"]);
});

test("the outline shows a message's status only as WhatsApp's fixed words, and hides any other label", () => {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  window.document.write(`<div data-testid="msg-meta"><span aria-label=" Read "><svg></svg></span><span aria-label="Delivered"></span><span aria-label="Hi mom"></span></div>`);
  const outline = domOutline(window.document.documentElement as unknown as Element, DUMP_KNOWN_VALUES);
  expect(outline).toContain(`span aria-label=" Read "`);
  expect(outline).toContain(`span aria-label="Delivered"`);
  expect(outline).toContain(`span aria-label=<6>`);
  expect(outline).not.toContain("Hi mom");
});

/** A fake page for runDump that records clicks, with or without your own chat's row loaded. */
function clickRecordingPage(hasSelfRow: boolean) {
  const clicked: string[] = [];
  const locatorFor = (path: string): Record<string, unknown> => ({
    evaluate: async (fn: { name: string }) => (fn.name === "loginState" ? "ready" : "html #text<5>"),
    count: async () => (path.includes("message-yourself-row") && !hasSelfRow ? 0 : 1),
    click: async () => void clicked.push(path),
    first: () => locatorFor(path),
    locator: (inner: string) => locatorFor(`${path} >> ${inner}`),
  });
  return { clicked, page: { locator: (selector: string) => locatorFor(selector), waitForTimeout: async () => {} } };
}

test("--open-self opens only your own chat's row, never the top chat", async () => {
  const { clicked, page } = clickRecordingPage(true);
  const printed: string[] = [];
  const code = await runDump(["--open-self"], { open: async () => page as never, close: async () => {}, out: (text) => void printed.push(text), err: (text) => void printed.push(text) });
  expect(code).toBe(0);
  expect(clicked).toEqual(["[role='grid'][aria-label='Chat list'] >> [data-testid='message-yourself-row']"]);
});

test("--open-self clicks nothing and says so when your own chat isn't loaded", async () => {
  const { clicked, page } = clickRecordingPage(false);
  const printed: string[] = [];
  const code = await runDump(["--open-self"], { open: async () => page as never, close: async () => {}, out: (text) => void printed.push(text), err: (text) => void printed.push(text) });
  expect(code).toBe(1);
  expect(clicked).toEqual([]);
  expect(printed).toEqual(["Your own chat isn't in the loaded chat list. Scroll to it in the WhatsApp window and try again"]);
});
