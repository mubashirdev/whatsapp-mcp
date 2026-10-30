import type { Page } from "playwright-core";
import { Window } from "happy-dom";
import { SELECTORS as sel } from "../src/selectors.ts";

/**
 * A fake Playwright page over happy-dom, with only what browserDriver uses.
 * Clicking a chat row shows that row's title in the header, as WhatsApp does, unless the test makes clicks miss.
 */
export function fakePage(html: string) {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  const document = window.document;
  document.write(html);
  const root = document.documentElement as unknown as Element;
  // open is the row really open, marked like clicks. A test can change it to stand in for you clicking a chat by hand.
  const state = { box: "", open: "", sent: [] as { header: string; open: string; text: string }[], clicks: [] as string[], clicksMiss: false };
  const header = () => root.querySelector(sel.chatTitle)!;

  const click = (element: Element) => {
    const title = element.querySelector(sel.chatName)?.getAttribute("title");
    if (element.matches(sel.sendButton)) {
      state.sent.push({ header: header().textContent ?? "", open: state.open, text: state.box });
      state.box = "";
      return;
    }
    // Your own row and a contact can share a title, so clicks on your own row are marked.
    const label = `${title ?? ""}${element.querySelector(sel.selfRow) ? " (own row)" : ""}`;
    state.clicks.push(label);
    if (state.clicksMiss || !title) return;
    header().textContent = title;
    state.open = label;
  };

  const locator = (find: () => Element[]): unknown => ({
    locator: (selector: string) => locator(() => find().flatMap((element) => [...element.querySelectorAll(selector)])),
    first: () => locator(() => find().slice(0, 1)),
    nth: (index: number) => locator(() => find().slice(index, index + 1)),
    count: async () => find().length,
    evaluate: async <A, R>(fn: (element: Element, arg: A) => R, arg: A) => fn(find()[0], arg),
    textContent: async () => find()[0]?.textContent ?? null,
    innerText: async () => (find()[0]?.matches(sel.messageBox) ? state.box : (find()[0]?.textContent ?? "")),
    click: async () => click(find()[0]),
    focus: async () => {},
    fill: async () => {},
    waitFor: async () => {},
  });

  const page = {
    locator: (selector: string) => locator(() => (selector === "html" ? [root] : [...root.querySelectorAll(selector)])),
    keyboard: {
      insertText: async (text: string) => void (state.box += text),
      press: async (key: string) => {
        if (key === "Shift+Enter") state.box += "\n";
        if (key === "Backspace") state.box = "";
      },
    },
  };
  return { page: page as unknown as Page, state, header };
}

/** A chat-list row in the real page's shape. self marks your own chat's row. */
export function chatRow(title: string, self = false) {
  return `<div role="row"><div role="gridcell"><div data-testid="${self ? "message-yourself-row" : "cell-frame-container"}">
    <div data-testid="cell-frame-title"><span dir="auto" title="${title}">${title}</span>${self ? `<span data-testid="you-label">(You)</span>` : ""}</div>
  </div></div></div>`;
}

/** A logged-in page with these chat rows and this chat open. */
export function pageWith(rows: string[], openChat: string) {
  return fakePage(`<div id="app"><div aria-label="Chat list" role="grid">${rows.join("")}</div>
    <div id="main"><header><span data-testid="conversation-info-header-chat-title">${openChat}</span></header>
    <footer><div contenteditable="true" role="textbox"></div><button aria-label="Send">Send</button></footer></div></div>`);
}
