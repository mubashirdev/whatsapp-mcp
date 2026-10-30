import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { profileInUse } from "../src/browser.ts";

// The real-browser tests are in browser.node-test.ts and run with Node: node --test test/browser.node-test.ts

test("a profile counts as in use only while the Chromium that locked it is alive", () => {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR || "/tmp", "wa-lock-")));
  const free = join(dir, "free");
  const live = join(dir, "live");
  const stale = join(dir, "stale");
  for (const profile of [free, live, stale]) mkdirSync(profile);
  symlinkSync(`my-mac.local-${process.pid}`, join(live, "SingletonLock"));
  symlinkSync("my-mac.local-999999", join(stale, "SingletonLock"));
  expect(profileInUse(free)).toBe(false);
  expect(profileInUse(live)).toBe(true);
  expect(profileInUse(stale)).toBe(false);
});
