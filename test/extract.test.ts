import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { chatRowPositions, chatRows, loginState, messageRows, searchRows } from "../src/extract.ts";
import { SELECTORS as sel } from "../src/selectors.ts";

/** Loads a fixture page into happy-dom and returns its root element. */
function load(name: string): Element {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  window.document.write(readFileSync(join(import.meta.dir, "fixtures", name), "utf8"));
  return window.document.documentElement as unknown as Element;
}

/** Rebuilds a function from its source, as page.evaluate does, so a closure or import would break it. */
function isolated<T>(fn: T): T {
  return new Function(`return (${String(fn)})`)() as T;
}

test("chat list gives name, last message, time and unread count", () => {
  const root = load("whatsapp.html");
  expect(chatRows(root, { limit: 20, sel })).toEqual([
    { name: "Ali Khan", last: "See you at 5", time: "10:42", unread: 2 },
    { name: "Ali R", last: "[image]", time: "09:15", unread: 0 },
    { name: "Mom", last: "Call me when you land", time: "Yesterday", unread: 0 },
    { name: "Message yourself", last: "note to self", time: "28/10/2026", unread: 0 },
  ]);
});

test("chat list stops at the limit", () => {
  const root = load("whatsapp.html");
  expect(chatRows(root, { limit: 2, sel }).map((chat) => chat.name)).toEqual(["Ali Khan", "Ali R"]);
});

test("open chat gives text, multi-line, emoji and media messages in order", () => {
  const root = load("whatsapp.html");
  expect(messageRows(root, { limit: 50, sel })).toEqual([
    { fromMe: false, sender: "Ali Khan", time: "10:30, 30/10/2026", text: "Hi there 👋" },
    { fromMe: true, sender: "You", time: "10:31, 30/10/2026", text: "Line one\nLine two" },
    { fromMe: false, sender: "Ali Khan", time: "10:32", text: "[image]" },
    { fromMe: false, sender: "Ali Khan", time: "10:33", text: "[voice]" },
    { fromMe: true, sender: "You", time: "10:34, 30/10/2026", text: "[image] Look at this" },
    { fromMe: false, sender: "Ali Khan", time: "10:35", text: "[video]" },
    { fromMe: false, sender: "Ali Khan", time: "10:36", text: "[file] notes.pdf" },
    { fromMe: false, sender: "Ali Khan", time: "10:37", text: "[sticker]" },
    { fromMe: false, sender: "Ali Khan", time: "10:42, 30/10/2026", text: "See you at 5" },
  ]);
});

test("messages keep the newest ones when over the limit", () => {
  const root = load("whatsapp.html");
  expect(messageRows(root, { limit: 2, sel }).map((message) => message.text)).toEqual(["[sticker]", "See you at 5"]);
});

test("search results give chat, text and sender when shown", () => {
  const root = load("whatsapp.html");
  expect(searchRows(root, { limit: 20, sel })).toEqual([
    { chat: "Ali Khan", time: "10:42", text: "See you at 5" },
    { chat: "Family", sender: "Sara", time: "Yesterday", text: "See you on Sunday" },
  ]);
  expect(searchRows(root, { limit: 1, sel })).toHaveLength(1);
});

test("login state tells ready, QR and loading apart", () => {
  expect(loginState(load("whatsapp.html"), sel)).toBe("ready");
  expect(loginState(load("whatsapp-qr.html"), sel)).toBe("qr");
  const window = new Window();
  expect(loginState(window.document.documentElement as unknown as Element, sel)).toBe("loading");
});

test("extract functions run with no imports or closures, as page.evaluate needs", () => {
  const root = load("whatsapp.html");
  expect(isolated(chatRows)(root, { limit: 1, sel })).toHaveLength(1);
  expect(isolated(messageRows)(root, { limit: 1, sel })).toHaveLength(1);
  expect(isolated(searchRows)(root, { limit: 1, sel })).toHaveLength(1);
  expect(isolated(loginState)(root, sel)).toBe("ready");
});

test("search heading rows like Chats and Messages are skipped and don't use up the limit", () => {
  const root = load("whatsapp.html");
  const headings = root.querySelectorAll("[aria-label='Search results.'] h2");
  expect(headings.length).toBe(2);
  expect(searchRows(root, { limit: 2, sel }).map((row) => row.chat)).toEqual(["Ali Khan", "Family"]);
});

test("your own chat is listed as Message yourself, not under your name", () => {
  const root = load("whatsapp.html");
  expect(root.querySelector("[data-testid='message-yourself-row'] span[title]")?.getAttribute("title")).toBe("Sam Rivers");
  expect(chatRows(root, { limit: 20, sel }).map((chat) => chat.name)).toContain("Message yourself");
  expect(chatRows(root, { limit: 20, sel }).map((chat) => chat.name)).not.toContain("Sam Rivers");
});

/** An open chat with one drawn message row, shaped by the given attributes and inner HTML. */
function chatWith(rowAttributes: string, inner = "") {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  window.document.write(`<div id="main"><header><span data-testid="conversation-info-header-chat-title">Ali Khan</span></header>
    <div role="row"><div ${rowAttributes}><div data-testid="msg-container">${inner}<div class="copyable-text" data-pre-plain-text="[10:30, 30/10/2026] Sam Rivers: "><span class="selectable-text">made up</span></div></div></div></div></div>`);
  return window.document.documentElement as unknown as Element;
}

test("a message is yours by the status icon in its msg-meta or a tail-out, as on the real page", () => {
  const fromMe = (root: Element) => messageRows(root, { limit: 5, sel })[0].fromMe;
  const status = `<div data-testid="msg-meta"><span dir="auto"><span>10:30</span></span><div><span aria-hidden="true" aria-label=" Read "><svg></svg></span></div></div>`;
  const noStatus = `<div data-testid="msg-meta"><span dir="auto"><span>10:30</span></span></div>`;
  expect(fromMe(chatWith(`data-id="3EB0A1B2C3"`, status))).toBe(true);
  expect(fromMe(chatWith(`data-id="3EB0A1B2C3"`, `<span data-testid="tail-out" data-icon="tail-out"></span>${noStatus}`))).toBe(true);
  expect(fromMe(chatWith(`data-id="3EB0A1B2C3"`, `<span data-testid="tail-in" data-icon="tail-in"></span>${noStatus}`))).toBe(false);
  expect(fromMe(chatWith(`data-id="3EB0A1B2C3"`, noStatus))).toBe(false);
  // A tail-in settles it, even if an incoming message shows some labelled icon, like a star.
  expect(fromMe(chatWith(`data-id="3EB0A1B2C3"`, `<span data-testid="tail-in" data-icon="tail-in"></span>${status}`))).toBe(false);
  // A label with no icon, like "Edited", is not a delivery status.
  expect(fromMe(chatWith(`data-id="3EB0A1B2C3"`, `<div data-testid="msg-meta"><span aria-label="Edited">Edited</span></div>`))).toBe(false);
  // The guessed signals are not on the real page and no longer count.
  expect(fromMe(chatWith(`data-id="true_111@c.us_A1" class="message-out"`, `<span data-icon="msg-dblcheck"></span>${noStatus}`))).toBe(false);
});

test("a message from you is labelled You even when the page writes your name", () => {
  const [message] = messageRows(chatWith(`data-id="3EB0A1B2C3"`, `<div data-testid="msg-meta"><div><span aria-label=" Read "><svg></svg></span></div></div>`), { limit: 5, sel });
  expect(message.sender).toBe("You");
});

test("the row clicked for a hit is the row that hit was read from, with headings in between", () => {
  const root = load("whatsapp.html");
  for (const container of [sel.searchResults, sel.chatList]) {
    const read = container === sel.searchResults ? searchRows(root, { limit: 50, sel }).map((row) => row.chat) : chatRows(root, { limit: 50, sel }).map((chat) => chat.name);
    const positions = chatRowPositions(root, { container, sel });
    const domRows = [...root.querySelector(container)!.querySelectorAll(sel.chatRow)];
    expect(positions).toHaveLength(read.length);
    read.forEach((name, index) => {
      const row = domRows[positions[index]];
      expect(row.querySelector(sel.selfRow) ? sel.selfChatName : row.querySelector(sel.chatName)?.getAttribute("title")).toBe(name);
    });
  }
  // In the search results, hit 0 is DOM row 1, because row 0 is the "Chats" heading.
  expect(chatRowPositions(root, { container: sel.searchResults, sel })[0]).toBe(1);
});

test("a chat's preview is its shown text, not the title with its hidden direction marks", () => {
  const root = load("whatsapp.html");
  const self = chatRows(root, { limit: 20, sel }).find((chat) => chat.name === "Message yourself")!;
  expect(root.querySelector("[data-testid='message-yourself-row'] [data-testid='last-msg-status']")!.getAttribute("title")).toBe("\u202anote to self\u202c");
  expect(self.last).toBe("note to self");
});

test("a message row WhatsApp hasn't drawn yet is skipped, not returned as an empty message", () => {
  const root = load("whatsapp.html");
  expect(root.querySelector("[data-id='3EB0B0']")).not.toBeNull();
  const messages = messageRows(root, { limit: 50, sel });
  expect(messages).toHaveLength(9);
  expect(messages.some((message) => !message.text && !message.time)).toBe(false);
});

test("a picture shows as [image] when its thumb is a button, as on the real page", () => {
  const root = load("whatsapp.html");
  expect(root.querySelector("div[role='button'][data-testid='image-thumb']")).not.toBeNull();
  expect(messageRows(root, { limit: 50, sel })[2].text).toBe("[image]");
});
