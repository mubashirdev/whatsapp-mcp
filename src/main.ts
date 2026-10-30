import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeBrowser, isHeadless } from "./browser.ts";
import { Drafts } from "./drafts.ts";
import { registerTools } from "./tools.ts";
import { browserDriver } from "./whatsapp.ts";

// Stdout carries only MCP messages, and message text is never logged.
// The window opens on the first tool call, not here, so startup stays inside Codex's timeout.
const driver = browserDriver();
const server = new McpServer({ name: "whatsapp", version: "0.1.0" });
registerTools(server, driver, new Drafts(driver), { headless: isHeadless() });
await server.connect(new StdioServerTransport());
process.stdin.on("close", () => void closeBrowser().catch(() => {}).finally(() => process.exit(0)));
