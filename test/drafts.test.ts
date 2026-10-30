import { expect, test } from "bun:test";
import { Drafts } from "../src/drafts.ts";
import { fakeDriver } from "./fake-driver.ts";

test("a draft is typed into the chat's box and never sent, even with several lines", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const { chat } = await drafts.draft("mom", "Line one\nLine two\nLine three");
  expect(chat).toBe("Mom");
  expect(fake.boxes.get("Mom")).toBe("Line one\nLine two\nLine three");
  expect(fake.sendClicks).toBe(0);
});

test("send sends the draft once and a second send is refused", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const { id } = await drafts.draft("Mom", "Hi");
  expect(await drafts.send(id)).toBe("Mom");
  expect(fake.sent).toEqual([{ chat: "Mom", text: "Hi" }]);
  await expect(drafts.send(id)).rejects.toThrow("That draft was already sent");
  expect(fake.sendClicks).toBe(1);
});

test("an unknown draft id is refused", async () => {
  const { driver, fake } = fakeDriver();
  await expect(new Drafts(driver).send("nope")).rejects.toThrow("No draft with that id");
  expect(fake.sendClicks).toBe(0);
});

test("send is refused when the box text changed after the draft", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const { id } = await drafts.draft("Mom", "Hi");
  fake.boxes.set("Mom", "Hi, and something else");
  await expect(drafts.send(id)).rejects.toThrow("The message box no longer holds that draft, so nothing was sent");
  expect(fake.sendClicks).toBe(0);
});

test("send opens the draft's own chat, even when another chat is showing", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const { id } = await drafts.draft("Mom", "Hi");
  await driver.openChat("Ali Khan");
  await drafts.send(id);
  expect(fake.sent).toEqual([{ chat: "Mom", text: "Hi" }]);
});

test("send refuses when the draft's chat doesn't actually open", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const { id } = await drafts.draft("Mom", "Hi");
  fake.boxes.set("Ali Khan", "Hi");
  fake.stuckOn = "Ali Khan";
  await expect(drafts.send(id)).rejects.toThrow(`Couldn't open "Mom"`);
  expect(fake.sendClicks).toBe(0);
});

test("draft refuses when the target chat doesn't actually open, and leaves the showing chat alone", async () => {
  const { driver, fake } = fakeDriver();
  fake.stuckOn = "Ali Khan";
  await expect(new Drafts(driver).draft("Mom", "Hi")).rejects.toThrow(`Couldn't open "Mom"`);
  expect(fake.boxes.get("Ali Khan")).toBe("");
  expect(fake.boxes.get("Mom")).toBe("");
});

test("text the user typed blocks a new draft and stays as it is", async () => {
  const { driver, fake } = fakeDriver();
  fake.boxes.set("Mom", "half a thought");
  await expect(new Drafts(driver).draft("Mom", "Hi")).rejects.toThrow("already has text in it");
  expect(fake.boxes.get("Mom")).toBe("half a thought");
});

test("a new draft replaces our own open draft in the same chat, and the old id stops working", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const first = await drafts.draft("Mom", "Hi");
  const second = await drafts.draft("Mom", "Hello");
  expect(fake.boxes.get("Mom")).toBe("Hello");
  await expect(drafts.send(first.id)).rejects.toThrow("That draft was discarded");
  await drafts.send(second.id);
  expect(fake.sent).toEqual([{ chat: "Mom", text: "Hello" }]);
});

test("discard clears the draft from its own chat only", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const { id } = await drafts.draft("Mom", "Hi");
  await driver.openChat("Ali Khan");
  await driver.typeIntoBox("Hi");
  expect(await drafts.discard(id)).toBe(`The draft in "Mom" was removed`);
  expect(fake.boxes.get("Mom")).toBe("");
  expect(fake.boxes.get("Ali Khan")).toBe("Hi");
  await expect(drafts.send(id)).rejects.toThrow("That draft was discarded");
});

test("discard leaves text the user edited alone", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const { id } = await drafts.draft("Mom", "Hi");
  fake.boxes.set("Mom", "Hi mom, edited");
  expect(await drafts.discard(id)).toContain("left as it is");
  expect(fake.boxes.get("Mom")).toBe("Hi mom, edited");
});

test("line endings and nbsp that WhatsApp changes still count as the same draft", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const { id } = await drafts.draft("Mom", "a b\nc");
  fake.boxes.set("Mom", "a b\r\nc");
  await drafts.send(id);
  expect(fake.sendClicks).toBe(1);
});

test("a draft that types in wrong is cleared and not kept", async () => {
  const { driver, fake } = fakeDriver();
  driver.typeIntoBox = async () => {
    fake.boxes.set("Mom", "mangled");
  };
  await expect(new Drafts(driver).draft("Mom", "Hi")).rejects.toThrow("didn't type in correctly");
  expect(fake.boxes.get("Mom")).toBe("");
  expect(fake.sendClicks).toBe(0);
});

test("an empty message is refused", async () => {
  const { driver } = fakeDriver();
  await expect(new Drafts(driver).draft("Mom", "  ")).rejects.toThrow("The message is empty");
});

test("typing that fails halfway clears what it typed, so it can't block or be sent later", async () => {
  const { driver, fake } = fakeDriver();
  driver.typeIntoBox = async () => {
    fake.boxes.set("Mom", "Line one\n");
    throw new Error("keyboard.press: Timeout 5000ms exceeded");
  };
  await expect(new Drafts(driver).draft("Mom", "Line one\nLine two")).rejects.toThrow("Timeout");
  expect(fake.boxes.get("Mom")).toBe("");
  expect(fake.sendClicks).toBe(0);
});

test("bug 19: when clearing leaves the text in the box, discard says so plainly and the draft stays open", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const { id } = await drafts.draft("Mom", "Hi");
  const realClear = driver.clearBox;
  // WhatsApp's editor sometimes ignores the clear and keeps the text.
  driver.clearBox = async () => {};
  await expect(drafts.discard(id)).rejects.toThrow(`Couldn't clear the draft in "Mom"; clear it in the window`);
  expect(fake.boxes.get("Mom")).toBe("Hi");
  // Still open: once clearing works, the same id discards it.
  driver.clearBox = realClear;
  expect(await drafts.discard(id)).toBe(`The draft in "Mom" was removed`);
  expect(fake.boxes.get("Mom")).toBe("");
  expect(fake.sendClicks).toBe(0);
});
