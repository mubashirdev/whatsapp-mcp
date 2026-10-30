// The real-browser tests, run with Node, the runtime the tool uses: node --test test/browser.node-test.ts
// Playwright supports Node, not Bun, and under bun test some launches stalled with Chromium already answering.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { closeBrowser, profileInUse, whatsappPage } from "../src/browser.ts";
import { Drafts } from "../src/drafts.ts";
import { registerTools } from "../src/tools.ts";
import { browserDriver } from "../src/whatsapp.ts";
import { within } from "./helpers.ts";

const fixture = (name: string) => pathToFileURL(join(import.meta.dirname, "fixtures", name)).href;
const freshHome = () => realpathSync(mkdtempSync(join(process.env.TMPDIR || "/tmp", "wa-browser-")));

/** A real-browser test that fails with a clear message after 45s instead of hanging the run, and always closes the window. */
function browserTest(name: string, body: () => Promise<void>) {
  test(name, { timeout: 60_000 }, () =>
    within(45_000, body(), `"${name}"`).finally(() => within(10_000, closeBrowser(), "Closing the browser").catch(() => {})),
  );
}

browserTest("in a real browser, a multi-line draft isn't sent and send_draft sends it once", async () => {
  process.env.WHATSAPP_MCP_HOME = freshHome();
  process.env.WHATSAPP_URL = fixture("whatsapp.html");
  const driver = browserDriver();
  const server = new McpServer({ name: "whatsapp", version: "0.0.0" });
  registerTools(server, driver, new Drafts(driver));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    return { isError: result.isError === true, text: result.content.map((part) => (part.type === "text" ? part.text : "")).join("") };
  };
  const page = await whatsappPage();
  const sent = () => page.evaluate(() => (window as unknown as { sent: { chat: string; text: string }[] }).sent);

  const listed = await call("list_chats", { limit: 2 });
  assert.deepEqual(JSON.parse(listed.text).map((chat: { name: string }) => chat.name), ["Ali Khan", "Ali R"]);

  const drafted = await call("draft_message", { chat: "message yourself", text: "Line one\nLine two\nLine three" });
  assert.equal(drafted.isError, false);
  const { draft_id } = JSON.parse(drafted.text);
  assert.equal(await driver.currentChat(), "Message yourself");
  assert.equal(await driver.boxText(), "Line one\nLine two\nLine three");
  assert.deepEqual(await sent(), []);

  assert.deepEqual(await call("send_draft", { draft_id }), { isError: false, text: `Sent to "Message yourself"` });
  // The fixture logs the header, which shows your own name in your own chat.
  assert.deepEqual(await sent(), [{ chat: "Sam Rivers", text: "Line one\nLine two\nLine three" }]);
  assert.deepEqual(await call("send_draft", { draft_id }), { isError: true, text: "That draft was already sent" });
  assert.equal((await sent()).length, 1);

  const second = JSON.parse((await call("draft_message", { chat: "Mom", text: "keep me" })).text);
  assert.deepEqual(await call("discard_draft", { draft_id: second.draft_id }), { isError: false, text: `The draft in "Mom" was removed` });
  assert.equal(await driver.boxText(), "");
  assert.equal((await sent()).length, 1);
  await client.close();
});

browserTest("in a real browser, two chats named Alex are refused without clicking either", async () => {
  process.env.WHATSAPP_MCP_HOME = freshHome();
  process.env.WHATSAPP_URL = fixture("whatsapp-duplicates.html");
  const driver = browserDriver();
  const drafts = new Drafts(driver);
  await assert.rejects(driver.openChat("Alex"), /Several chats are named "Alex"/);
  await assert.rejects(drafts.draft("alex", "Hi"), /Several chats are named "Alex"/);
  const page = await whatsappPage();
  assert.equal(await page.evaluate(() => (window as unknown as { clicks: number }).clicks), 0);
  assert.equal(await driver.openChat("Alexandra"), "Alexandra");
});

browserTest("in a real browser, a page that fails to load closes its window, and a retry opens", async () => {
  const home = freshHome();
  process.env.WHATSAPP_MCP_HOME = home;
  // Port 9 is refused, so the first page load fails.
  process.env.WHATSAPP_URL = "http://127.0.0.1:9/";
  await assert.rejects(whatsappPage());
  assert.equal(profileInUse(join(home, "profile")), false);
  process.env.WHATSAPP_URL = fixture("whatsapp.html");
  const page = await whatsappPage();
  assert.equal(await page.title(), "WhatsApp");
});
