import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Drafts, SAFE_SENDING, sendRefusal, textHash } from "../src/drafts.ts";
import { fakeDriver } from "./fake-driver.ts";

const MIN = 60_000;
const NOW = 100 * 24 * 60 * MIN;

const at = (times: number[]) => times.map((time, i) => ({ at: time, hash: `other-${i}` }));
const HI = textHash("Hi");

test("sends are refused when too soon, or over the hourly or daily count", () => {
  expect(sendRefusal([], NOW, HI, SAFE_SENDING)).toBe("");
  expect(sendRefusal(at([NOW - 10_000]), NOW, HI, SAFE_SENDING)).toContain("Wait 20 seconds");
  const hour = at(Array.from({ length: 8 }, (_, i) => NOW - (i + 1) * 5 * MIN));
  expect(sendRefusal(hour, NOW, HI, SAFE_SENDING)).toContain("8 messages in the last hour");
  const day = Array.from({ length: 30 }, (_, i) => NOW - (i + 1) * 30 * MIN);
  expect(sendRefusal(at(day), NOW, HI, SAFE_SENDING)).toContain("30 messages in the last 24 hours");
  expect(sendRefusal(at(day.map((time) => time - 24 * 60 * MIN)), NOW, HI, SAFE_SENDING)).toBe("");
});

test("the same text is refused for 24 hours, whatever the spacing", () => {
  expect(sendRefusal([{ at: NOW - 60 * MIN, hash: textHash(" Hi ") }], NOW, HI, SAFE_SENDING)).toContain("already sent in the last 24 hours");
  expect(sendRefusal([{ at: NOW - 25 * 60 * MIN, hash: HI }], NOW, HI, SAFE_SENDING)).toBe("");
});

test("a second send right after the first is refused, and the send log survives a restart", async () => {
  const logFile = join(mkdtempSync(join(tmpdir(), "wa-safety-")), "sends.json");
  const { driver, fake } = fakeDriver();
  const drafts = new Drafts(driver, { ...SAFE_SENDING, logFile });
  await drafts.send((await drafts.draft("Mom", "One")).id);
  const second = await drafts.draft("Ali Khan", "Two");
  await expect(drafts.send(second.id)).rejects.toThrow("Too soon after the last send");
  expect(fake.sent).toEqual([{ chat: "Mom", text: "One" }]);
  expect(fake.boxes.get("Ali Khan")).toBe("Two");
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  expect(log).toEqual([{ at: expect.any(Number), hash: textHash("One") }]);

  const restarted = new Drafts(driver, { ...SAFE_SENDING, logFile });
  fake.boxes.set("Ali Khan", "");
  await expect(restarted.send((await restarted.draft("Ali Khan", "Two")).id)).rejects.toThrow("Too soon");
});

test("a chat where the other side never wrote is refused, but your own chat is allowed", async () => {
  const { driver, fake } = fakeDriver();
  driver.readMessages = async () => [{ fromMe: true, sender: "", time: "10:00", text: "hi" }];
  const drafts = new Drafts(driver, SAFE_SENDING);
  await expect(drafts.draft("Mom", "Hi")).rejects.toThrow(`"Mom" hasn't written to you`);
  expect(fake.boxes.get("Mom")).toBe("");
  await drafts.draft("me", "Note to self");
  expect(fake.boxes.get("Message yourself")).toBe("Note to self");
});
