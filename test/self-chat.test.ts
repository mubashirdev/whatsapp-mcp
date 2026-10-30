import { expect, test } from "bun:test";
import { Drafts } from "../src/drafts.ts";
import { browserDriver, isOwnChat } from "../src/whatsapp.ts";
import { chatRow, pageWith } from "./fake-page.ts";

// Your name is "Sam Rivers". "Sam Rivers Work" is another chat whose name starts with yours.

test("a header counts as your own chat only right after clicking your own row, and only with your exact name or the you-label", () => {
  expect(isOwnChat({ name: "Sam Rivers", youLabel: false }, "Sam Rivers", true)).toBe(true);
  expect(isOwnChat({ name: "Sam Rivers", youLabel: true }, "Sam Rivers", true)).toBe(true);
  expect(isOwnChat({ name: "Sam Rivers Work", youLabel: false }, "Sam Rivers", true)).toBe(false);
  expect(isOwnChat({ name: "Sam Rivers", youLabel: false }, "Sam Rivers", false)).toBe(false);
  expect(isOwnChat({ name: "Sam Rivers", youLabel: false }, "", true)).toBe(false);
});

test("with Sam Rivers Work open, a draft and send to Message yourself go to your own chat, never to Sam Rivers Work", async () => {
  const { page, state } = pageWith([chatRow("Sam Rivers Work"), chatRow("Sam Rivers", true), chatRow("Mom")], "Sam Rivers Work");
  const driver = browserDriver(async () => page);
  const drafts = new Drafts(driver);
  const { id, chat } = await drafts.draft("Message yourself", "note");
  expect(chat).toBe("Message yourself");
  expect(state.clicks).toEqual(["Sam Rivers (own row)"]);
  await drafts.send(id);
  expect(state.sent).toEqual([{ header: "Sam Rivers", open: "Sam Rivers (own row)", text: "note" }]);
});

test("if clicking your own row doesn't open it, the draft is refused and Sam Rivers Work's box stays empty", async () => {
  const { page, state } = pageWith([chatRow("Sam Rivers Work"), chatRow("Sam Rivers", true)], "Sam Rivers Work");
  state.clicksMiss = true;
  const drafts = new Drafts(browserDriver(async () => page));
  await expect(drafts.draft("me", "note")).rejects.toThrow(`Couldn't open "Message yourself"`);
  expect(state.box).toBe("");
  expect(state.sent).toEqual([]);
  // The driver waits up to 5s for the chat to open before it refuses.
}, 10_000);

test("a contact literally named Message yourself is never taken for your own chat", async () => {
  const { page, state } = pageWith([chatRow("Message yourself"), chatRow("Sam Rivers", true)], "Mom");
  const driver = browserDriver(async () => page);
  expect(await driver.openChat("Message yourself")).toBe("Message yourself");
  expect(state.clicks).toEqual(["Sam Rivers (own row)"]);
});

test("a contact with exactly your name, opened by hand, is not taken for your own chat", async () => {
  const { page, state } = pageWith([chatRow("Sam Rivers"), chatRow("Sam Rivers", true)], "Sam Rivers");
  const driver = browserDriver(async () => page);
  await driver.openChat("Message yourself");
  expect(state.clicks).toEqual(["Sam Rivers (own row)"]);
  expect(await driver.currentChat()).toBe("Message yourself");
});

test("after you switch by hand to a contact with exactly your name, a send to me still clicks your own row first", async () => {
  const { page, state } = pageWith([chatRow("Sam Rivers"), chatRow("Sam Rivers", true)], "Mom");
  const driver = browserDriver(async () => page);
  await driver.openChat("me");
  // You click the contact "Sam Rivers" in the window. The header reads the same as your own chat's.
  state.open = "Sam Rivers";
  const drafts = new Drafts(driver);
  const { id } = await drafts.draft("me", "note");
  await drafts.send(id);
  expect(state.sent).toEqual([{ header: "Sam Rivers", open: "Sam Rivers (own row)", text: "note" }]);
});
