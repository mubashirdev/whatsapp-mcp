import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { Drafts, splitMentions } from "../src/drafts.ts";
import { mentionNames } from "../src/extract.ts";
import { SELECTORS } from "../src/selectors.ts";
import { pickMember } from "../src/whatsapp.ts";
import { fakeDriver } from "./fake-driver.ts";

const MEMBERS = ["Ilyas Khan", "Umair Ahmad", "Umair Ali", "Abu Bakar"];

test("a mention picks the exact name, else the one name with a word starting with it", () => {
  expect(pickMember(MEMBERS, "ilyas")).toBe(0);
  expect(pickMember(MEMBERS, "Umair Ahmad")).toBe(1);
  expect(pickMember(MEMBERS, "khan")).toBe(0);
  expect(pickMember(["Ali", "Ali Raza"], "ali")).toBe(0);
});

test("a mention that fits several members, or none, is refused with the names to ask about", () => {
  expect(() => pickMember(MEMBERS, "umair")).toThrow(`Several people in this group match "umair": Umair Ahmad, Umair Ali. Ask the user which one`);
  expect(() => pickMember(MEMBERS, "zara")).toThrow(`No one in this group matches "zara"`);
});

test("the text is split at each @mention, longest name first, ignoring case", () => {
  expect(splitMentions("hi @Ilyas and @umair ahmad!", ["umair", "umair ahmad", "ilyas"])).toEqual([
    { text: "hi " },
    { text: "@Ilyas", mention: "Ilyas" },
    { text: " and " },
    { text: "@umair ahmad", mention: "umair ahmad" },
    { text: "!" },
  ]);
  expect(splitMentions("no tags", [])).toEqual([{ text: "no tags" }]);
  expect(() => splitMentions("hi Ilyas", ["ilyas"])).toThrow("Put @ilyas in the text where that mention goes");
});

test("the mention list gives members only, without the ~ of unsaved names, never people outside the group", () => {
  const window = new Window();
  window.document.write(`<div id="wa-popovers-bucket">
    <button><div data-testid="contact-mention-list-item"><div><div data-testid="mention-primary">Ilyas Khan</div></div></div></button>
    <button><div data-testid="contact-mention-list-item"><div><div data-testid="mention-primary">~ Ali</div></div></div></button>
    <button><div role="button" data-testid="non-participant-mention-list-item"><div data-testid="mention-primary">Umair Ahmad</div></div></button>
  </div>`);
  expect(mentionNames(window.document.documentElement as unknown as Element, SELECTORS)).toEqual(["Ilyas Khan", "Ali"]);
});

test("a draft with mentions tags each member and returns the text with their real names", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  const draft = await drafts.draft("Mom", "@ilyas @umair ahmad game at 5\nbring bats", ["ilyas", "umair ahmad"]);
  expect(draft.text).toBe("@Ilyas Khan @Umair Ahmad game at 5\nbring bats");
  expect(fake.boxes.get("Mom")).toBe(draft.text);
  await drafts.send(draft.id);
  expect(fake.sent).toEqual([{ chat: "Mom", text: "@Ilyas Khan @Umair Ahmad game at 5\nbring bats" }]);
});

test("an unclear mention leaves the box empty, so the user can be asked", async () => {
  const { driver, fake } = fakeDriver();
  await expect(new Drafts(driver).draft("Mom", "hey @umair", ["umair"])).rejects.toThrow("Umair Ahmad, Umair Ali");
  expect(fake.boxes.get("Mom")).toBe("");
});

test("find_members lists matching members and refuses when the box has text", async () => {
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver);
  expect(await drafts.findMembers("Mom", "umair")).toEqual({ chat: "Mom", members: ["Umair Ahmad", "Umair Ali"] });
  fake.boxes.set("Mom", "typing");
  await expect(drafts.findMembers("Mom", "umair")).rejects.toThrow("has text in it");
});
