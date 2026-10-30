import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { closeBrowser, isHeadless, mcpHome } from "./browser.ts";
import { Drafts, SAFE_SENDING } from "./drafts.ts";
import { registerTools } from "./tools.ts";
import { browserDriver } from "./whatsapp.ts";

// Stdout carries only MCP messages, and message text is never logged.
// The window opens on the first tool call, not here, so startup stays inside Codex's timeout.
const driver = browserDriver();
const server = new McpServer({ name: "whatsapp", version: "0.1.0" });
const drafts = new Drafts(driver, { ...SAFE_SENDING, logFile: join(mcpHome(), "sends.json") });
registerTools(server, driver, drafts, { headless: isHeadless(), pauseMs: { min: 1_500, max: 4_000 } });
await server.connect(new StdioServerTransport());
process.stdin.on("close", () => void closeBrowser().catch(() => {}).finally(() => process.exit(0)));
