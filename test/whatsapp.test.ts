import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { chatRows } from "../src/extract.ts";
import { SELECTORS as sel } from "../src/selectors.ts";
import { pickChat, resolveChat } from "../src/whatsapp.ts";

const names = ["Ali Khan", "Ali R", "Mom", "Message yourself"];

test("an exact name wins, ignoring case, even when others also contain it", () => {
  expect(names[pickChat(names, "ali r")!]).toBe("Ali R");
  expect(names[pickChat(names, "MOM")!]).toBe("Mom");
});

test("a single partial match is picked", () => {
  expect(names[pickChat(names, "yourself")!]).toBe("Message yourself");
});

test("several partial matches ask for a more exact name", () => {
  expect(() => pickChat(names, "Ali")).toThrow(`Several chats match "Ali": Ali Khan, Ali R. Use a more exact name`);
});

test("no match gives nothing, so the caller can search", () => {
  expect(pickChat(names, "Zed")).toBeUndefined();
});

test("two chats with the same exact name are refused, never picked", () => {
  expect(() => pickChat(["Alex", "Alex", "Alexandra"], "alex")).toThrow(`Several chats are named "Alex". Rename one in WhatsApp or use a more exact name`);
});

test("two chats with the same name are refused as a partial match too", () => {
  expect(() => pickChat(["Alex", "Alex", "Mom"], "ale")).toThrow(`Several chats are named "Alex". Rename one in WhatsApp or use a more exact name`);
});

test("on a page with two chats named Alex, Alex is refused and Alexandra is still found", () => {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  window.document.write(readFileSync(join(import.meta.dir, "fixtures", "whatsapp-duplicates.html"), "utf8"));
  const listed = chatRows(window.document.documentElement as unknown as Element, { limit: 50, sel }).map((chat) => chat.name);
  expect(listed).toEqual(["Alex", "Alex", "Alexandra"]);
  expect(() => pickChat(listed, "Alex")).toThrow(`Several chats are named "Alex"`);
  expect(pickChat(listed, "Alexandra")).toBe(2);
});

/** A fake WhatsApp search over every chat, counting how often it ran. */
function searchOver(all: string[]) {
  const search = async (query: string) => {
    search.runs++;
    return all.filter((name) => name.toLowerCase().includes(query.toLowerCase()));
  };
  search.runs = 0;
  return search;
}

test("visible partial matches don't block an exact chat further down: Alex is found through search", async () => {
  const search = searchOver(["Alex One", "Alex Two", "Alex"]);
  expect(await resolveChat(["Alex One", "Alex Two", "Mom"], search, "Alex")).toEqual({ inSearch: true, index: 2, name: "Alex" });
  expect(search.runs).toBe(1);
});

test("an exact visible name opens without searching", async () => {
  const search = searchOver([]);
  expect(await resolveChat(["Alex One", "Alex", "Mom"], search, "alex")).toEqual({ inSearch: false, index: 1, name: "Alex" });
  expect(search.runs).toBe(0);
});

test("two visible chats with the same exact name are refused", async () => {
  await expect(resolveChat(["Alex", "Alex"], searchOver([]), "Alex")).rejects.toThrow(`Several chats are named "Alex"`);
});

test("a partial name is settled by search, and refused when search finds several", async () => {
  expect(await resolveChat(["Mom"], searchOver(["Message yourself"]), "yourself")).toEqual({ inSearch: true, index: 0, name: "Message yourself" });
  await expect(resolveChat(["Alex One", "Alex Two"], searchOver(["Alex One", "Alex Two"]), "Ale")).rejects.toThrow(`Several chats match "Ale": Alex One, Alex Two`);
});

test("a name nobody has is reported after the search", async () => {
  await expect(resolveChat(["Mom"], searchOver(["Mom"]), "Zed")).rejects.toThrow(`No chat named "Zed"`);
});

test("Message yourself, me and myself open your own chat before any name matching", async () => {
  const visible = ["Me", "Mom", "Message yourself", "Memo group"];
  for (const wanted of ["message yourself", "Message Yourself", "me", "ME", "myself"]) {
    expect(await resolveChat(visible, searchOver([]), wanted)).toEqual({ inSearch: false, index: 2, name: "Message yourself" });
  }
});
