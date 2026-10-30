import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Drafts } from "../src/drafts.ts";
import { NOT_LOGGED_IN, registerTools, STILL_LOADING } from "../src/tools.ts";
import type { Driver } from "../src/whatsapp.ts";
import { fakeDriver } from "./fake-driver.ts";

/** Connects a real MCP client to the tools over the fake driver. */
async function connect(driver: Driver, loadWaitMs = 50, headless = false) {
  const server = new McpServer({ name: "whatsapp", version: "0.0.0" });
  registerTools(server, driver, new Drafts(driver), { loadWaitMs, headless });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    return { isError: result.isError === true, text };
  };
  return { client, call };
}

/** A well-formed draft id that no draft has. */
const NO_SUCH_DRAFT = "00000000-0000-4000-8000-000000000000";

const ALL_CALLS: [string, Record<string, unknown>][] = [
  ["list_chats", {}],
  ["read_messages", { chat: "Mom" }],
  ["search_messages", { query: "hi" }],
  ["draft_message", { chat: "Mom", text: "Hi" }],
  ["send_draft", { draft_id: NO_SUCH_DRAFT }],
  ["discard_draft", { draft_id: NO_SUCH_DRAFT }],
];

test("exactly six tools are listed, with read and send hints", async () => {
  const { client } = await connect(fakeDriver().driver);
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual(["discard_draft", "draft_message", "list_chats", "read_messages", "search_messages", "send_draft"]);
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  for (const name of ["list_chats", "read_messages", "search_messages"]) expect(byName[name].annotations?.readOnlyHint).toBe(true);
  expect(byName.send_draft.annotations?.destructiveHint).toBe(true);
  expect(byName.send_draft.description).toContain("only after the user explicitly says send");
});

test("limits use the default, and are clamped to the maximum and to at least 1", async () => {
  const { driver, fake } = fakeDriver();
  const { call } = await connect(driver);
  await call("list_chats");
  await call("list_chats", { limit: 999 });
  await call("read_messages", { chat: "Mom", limit: 5000 });
  await call("read_messages", { chat: "Mom", limit: 1 });
  await call("search_messages", { query: "x", limit: 51 });
  await call("search_messages", { query: "x" });
  expect(fake.limits).toEqual([20, 50, 200, 1, 50, 20]);
});

test("every tool returns the not-logged-in text when the QR code shows", async () => {
  const { driver, fake } = fakeDriver();
  fake.login = "qr";
  const { call } = await connect(driver);
  for (const [name, args] of ALL_CALLS) expect(await call(name, args)).toEqual({ isError: true, text: NOT_LOGGED_IN });
  expect(fake.sendClicks).toBe(0);
});

test("a page that never finishes loading returns the loading text", async () => {
  const { driver, fake } = fakeDriver();
  fake.login = "loading";
  const { call } = await connect(driver, 30);
  expect(await call("list_chats")).toEqual({ isError: true, text: STILL_LOADING });
});

test("a call waits for the page to finish loading", async () => {
  const { driver, fake } = fakeDriver();
  fake.login = "loading";
  const { call } = await connect(driver, 2000);
  setTimeout(() => (fake.login = "ready"), 100);
  const result = await call("list_chats", { limit: 1 });
  expect(result.isError).toBe(false);
  expect(JSON.parse(result.text)).toEqual([{ name: "Ali Khan", last: "", time: "", unread: 0 }]);
});

test("draft, then send through the tools sends once", async () => {
  const { driver, fake } = fakeDriver();
  const { call } = await connect(driver);
  const drafted = await call("draft_message", { chat: "message yourself", text: "one\ntwo" });
  expect(drafted.isError).toBe(false);
  const { draft_id, chat } = JSON.parse(drafted.text);
  expect(chat).toBe("Message yourself");
  expect(fake.sendClicks).toBe(0);
  expect(await call("send_draft", { draft_id })).toEqual({ isError: false, text: `Sent to "Message yourself"` });
  expect(await call("send_draft", { draft_id })).toEqual({ isError: true, text: "That draft was already sent" });
  expect(fake.sent).toEqual([{ chat: "Message yourself", text: "one\ntwo" }]);
});

test("driver errors come back as plain error text", async () => {
  const { call } = await connect(fakeDriver().driver);
  expect(await call("read_messages", { chat: "Nobody" })).toEqual({ isError: true, text: `No chat named "Nobody"` });
});

test("calls run one at a time on the single page", async () => {
  const { driver } = fakeDriver();
  let busy = 0;
  let overlap = false;
  driver.listChats = async () => {
    if (busy++) overlap = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
    busy--;
    return [];
  };
  const { call } = await connect(driver);
  await Promise.all([call("list_chats"), call("list_chats"), call("list_chats")]);
  expect(overlap).toBe(false);
});

test("every chat tool refuses a name two chats share, before touching any box", async () => {
  const { driver, fake } = fakeDriver(["Alex", "Alex", "Mom"]);
  let typed = 0;
  driver.typeIntoBox = async () => {
    typed++;
  };
  const { call } = await connect(driver);
  const refused = `Several chats are named "Alex". Rename one in WhatsApp or use a more exact name`;
  expect(await call("read_messages", { chat: "Alex" })).toEqual({ isError: true, text: refused });
  expect(await call("draft_message", { chat: "alex", text: "Hi" })).toEqual({ isError: true, text: refused });
  expect(typed).toBe(0);
  expect(fake.sendClicks).toBe(0);
});

test("an empty chat list on a ready page is an error, not an empty answer", async () => {
  const { call } = await connect(fakeDriver([]).driver);
  expect(await call("list_chats")).toEqual({ isError: true, text: "Couldn't read your chats. WhatsApp may have changed its page" });
});

test("a raw page error never reaches the reply or the logs, only a fixed sentence does", async () => {
  const { driver } = fakeDriver();
  // Playwright errors carry a call log with what was typed and what the page showed.
  driver.search = async () => {
    throw new Error('locator.fill: Timeout 5000ms exceeded.\nCall log:\n  - fill("secret query")\n  - element text "Hi mom, the code is 4411"');
  };
  const { call } = await connect(driver);
  const logged: string[] = [];
  const saved = { error: console.error, log: console.log, write: process.stderr.write };
  console.error = (...parts: unknown[]) => void logged.push(parts.join(" "));
  console.log = (...parts: unknown[]) => void logged.push(parts.join(" "));
  process.stderr.write = ((chunk: string) => logged.push(String(chunk)) > 0) as typeof process.stderr.write;
  try {
    expect(await call("search_messages", { query: "secret query" })).toEqual({ isError: true, text: "WhatsApp didn't respond. Try again" });
  } finally {
    Object.assign(console, { error: saved.error, log: saved.log });
    process.stderr.write = saved.write;
  }
  expect(logged.join("\n")).not.toMatch(/secret query|Hi mom|4411/);
});

test("our own plain sentences still reach you as they are", async () => {
  const { call } = await connect(fakeDriver().driver);
  expect(await call("send_draft", { draft_id: NO_SUCH_DRAFT })).toEqual({ isError: true, text: "No draft with that id" });
});

test("with WHATSAPP_HEADLESS a QR code can't be scanned, so every tool says to start once without it", async () => {
  const { driver, fake } = fakeDriver();
  fake.login = "qr";
  const { call } = await connect(driver, 50, true);
  for (const [name, args] of ALL_CALLS) {
    expect(await call(name, args)).toEqual({ isError: true, text: "Not logged in: start once without WHATSAPP_HEADLESS to scan the QR code" });
  }
});

/** The fake driver, counting every call made to it. */
function countingDriver() {
  const { driver } = fakeDriver();
  const calls: string[] = [];
  for (const name of Object.keys(driver) as (keyof Driver)[]) {
    const real = driver[name] as (...args: unknown[]) => Promise<unknown>;
    (driver as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls.push(name);
      return real(...args);
    };
  }
  return { driver, calls };
}

const BAD_INPUT: [string, Record<string, unknown>, string][] = [
  ["read_messages", { chat: "" }, "Give the chat's name"],
  ["read_messages", { chat: "   " }, "Give the chat's name"],
  ["draft_message", { chat: " ", text: "Hi" }, "Give the chat's name"],
  ["draft_message", { chat: "Mom", text: "" }, "The message is empty"],
  ["draft_message", { chat: "Mom", text: "  \n " }, "The message is empty"],
  ["search_messages", { query: "  " }, "Give something to search for"],
  ["list_chats", { limit: "ten" }, "The limit must be a whole number, 1 or more"],
  ["list_chats", { limit: -3 }, "The limit must be a whole number, 1 or more"],
  ["read_messages", { chat: "Mom", limit: 0 }, "The limit must be a whole number, 1 or more"],
  ["search_messages", { query: "hi", limit: 2.5 }, "The limit must be a whole number, 1 or more"],
  ["send_draft", { draft_id: "x" }, "That isn't a draft id from draft_message"],
  ["send_draft", { draft_id: "" }, "That isn't a draft id from draft_message"],
  ["discard_draft", { draft_id: "12345" }, "That isn't a draft id from draft_message"],
];

test("bad input gets a plain error and never reaches the driver", async () => {
  const { driver, calls } = countingDriver();
  const { call } = await connect(driver);
  for (const [name, args, sentence] of BAD_INPUT) {
    const result = await call(name, args);
    expect({ name, args, isError: result.isError, hasSentence: result.text.includes(sentence) }).toEqual({ name, args, isError: true, hasSentence: true });
  }
  expect(calls).toEqual([]);
});

test("a chat name and search are trimmed before use, and a draft keeps its own spacing", async () => {
  const { driver, fake } = fakeDriver();
  const { call } = await connect(driver);
  const drafted = JSON.parse((await call("draft_message", { chat: "  Mom  ", text: "  two spaces" })).text);
  expect(drafted.chat).toBe("Mom");
  expect(fake.boxes.get("Mom")).toBe("  two spaces");
});

test("bug 18: draft_message and send_draft tell the agent both rules: send only on an explicit send, and discard when the user declines", async () => {
  const { client } = await connect(fakeDriver().driver);
  const { tools } = await client.listTools();
  for (const name of ["draft_message", "send_draft"]) {
    const description = tools.find((tool) => tool.name === name)?.description ?? "";
    expect({ name, send: description.includes("only after the user explicitly says send") }).toEqual({ name, send: true });
    expect({ name, decline: description.includes("If the user declines (no, don't send, cancel), call discard_draft with this draft id.") }).toEqual({ name, decline: true });
  }
});

test("bug 20: the note draft_message returns also says to discard the draft when the user declines", async () => {
  const { call } = await connect(fakeDriver().driver);
  const { note } = JSON.parse((await call("draft_message", { chat: "Mom", text: "Hi" })).text);
  expect(note).toContain("only after the user explicitly says send");
  expect(note).toContain("If the user declines (no, don't send, cancel), call discard_draft with this draft id.");
});
