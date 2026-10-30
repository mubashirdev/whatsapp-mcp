import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Drafts } from "./drafts.ts";
import type { Driver } from "./whatsapp.ts";
import { UserError } from "./errors.ts";

export const LIMITS = {
  chats: { default: 20, max: 50 },
  messages: { default: 50, max: 200 },
  search: { default: 20, max: 50 },
};

export const NOT_LOGGED_IN = "Not logged in: scan the QR code in the WhatsApp window";
export const NOT_LOGGED_IN_HEADLESS = "Not logged in: start once without WHATSAPP_HEADLESS to scan the QR code";
export const STILL_LOADING = "WhatsApp is still loading, try again in a moment";
export const CANT_READ_CHATS = "Couldn't read your chats. WhatsApp may have changed its page";
export const NO_RESPONSE = "WhatsApp didn't respond. Try again";

/**
 * How long a call waits for WhatsApp to finish loading, whether the window is hidden (WHATSAPP_HEADLESS=1),
 * and the random pause between calls, so a burst of calls doesn't click through chats faster than a person.
 */
export type ToolOptions = { loadWaitMs?: number; headless?: boolean; pauseMs?: { min: number; max: number } };

function clamp(limit: number | undefined, { default: fallback, max }: { default: number; max: number }): number {
  return Math.min(Math.max(Math.floor(limit ?? fallback), 1), max);
}

function reply(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

/** Registers the six WhatsApp tools. Calls run one at a time, because there is one page. */
export function registerTools(server: McpServer, driver: Driver, drafts: Drafts, { loadWaitMs = 15_000, headless = false, pauseMs = { min: 0, max: 0 } }: ToolOptions = {}): void {
  let queue: Promise<unknown> = Promise.resolve();
  let lastCallEnded = 0;

  async function pause(): Promise<void> {
    const wait = lastCallEnded + pauseMs.min + Math.random() * (pauseMs.max - pauseMs.min) - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }

  async function ready(): Promise<void> {
    const deadline = Date.now() + loadWaitMs;
    while (true) {
      const state = await driver.state();
      if (state === "ready") return;
      // A hidden window's QR code can't be scanned.
      if (state === "qr") throw new UserError(headless ? NOT_LOGGED_IN_HEADLESS : NOT_LOGGED_IN);
      if (Date.now() >= deadline) throw new UserError(STILL_LOADING);
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, loadWaitMs)));
    }
  }

  function run(work: () => Promise<unknown>): Promise<CallToolResult> {
    const result = queue.then(async () => {
      await pause();
      try {
        await ready();
        return reply(await work());
      } finally {
        lastCallEnded = Date.now();
      }
    });
    queue = result.catch(() => {});
    // Only our own sentences go back. Other errors can quote what was typed or shown on the page.
    return result.catch((error: unknown): CallToolResult => ({ isError: true, content: [{ type: "text", text: error instanceof UserError ? error.message : NO_RESPONSE }] }));
  }

  // Bad input is refused here, before any call touches WhatsApp, with a sentence you can act on.
  const limitError = "The limit must be a whole number, 1 or more";
  const limit = z.number({ error: limitError }).int(limitError).min(1, limitError).optional();
  const chat = z.string().trim().min(1, "Give the chat's name");
  const draftId = z.uuid({ error: "That isn't a draft id from draft_message" });

  server.registerTool("list_chats", {
    description: `Lists the chats at the top of the WhatsApp chat list, newest first (default ${LIMITS.chats.default}, at most ${LIMITS.chats.max}).`,
    inputSchema: { limit },
    annotations: { readOnlyHint: true },
  }, (input) => run(async () => {
    const chats = await driver.listChats(clamp(input.limit, LIMITS.chats));
    // The page is ready, so the chat list is there. No rows means the selectors no longer match, not that you have no chats.
    if (!chats.length) throw new UserError(CANT_READ_CHATS);
    return chats;
  }));

  server.registerTool("read_messages", {
    description: `Opens a chat by name and reads its newest loaded messages, oldest first (default ${LIMITS.messages.default}, at most ${LIMITS.messages.max}). Opening a chat marks it read.`,
    inputSchema: { chat, limit },
    annotations: { readOnlyHint: true },
  }, (input) => run(async () => {
    const chat = await driver.openChat(input.chat);
    return { chat, messages: await driver.readMessages(clamp(input.limit, LIMITS.messages)) };
  }));

  server.registerTool("search_messages", {
    description: `Searches all chats with WhatsApp's own search and returns the message hits (default ${LIMITS.search.default}, at most ${LIMITS.search.max}).`,
    inputSchema: { query: z.string().trim().min(1, "Give something to search for"), limit },
    annotations: { readOnlyHint: true },
  }, (input) => run(() => driver.search(input.query, clamp(input.limit, LIMITS.search))));

  server.registerTool("draft_message", {
    description: "Types a message into a chat's message box in the WhatsApp window, where the user can see it. It does not send. Show the user the draft. Call send_draft only after the user explicitly says send. If the user declines (no, don't send, cancel), call discard_draft with this draft id.",
    // The text keeps its own spacing; it only must not be blank.
    inputSchema: { chat, text: z.string().refine((text) => text.trim() !== "", "The message is empty") },
  }, (input) => run(async () => {
    const draft = await drafts.draft(input.chat, input.text);
    return {
      draft_id: draft.id,
      chat: draft.chat,
      note: "Typed into the box, not sent. Call send_draft only after the user explicitly says send. If the user declines (no, don't send, cancel), call discard_draft with this draft id.",
    };
  }));

  server.registerTool("send_draft", {
    description: "Sends a draft made by draft_message. Call it only after the user explicitly says send for this draft. If the user declines (no, don't send, cancel), call discard_draft with this draft id. It sends once, and only if the box still holds the draft unchanged.",
    inputSchema: { draft_id: draftId },
    annotations: { destructiveHint: true },
  }, (input) => run(async () => `Sent to "${await drafts.send(input.draft_id)}"`));

  server.registerTool("discard_draft", {
    description: "Removes a draft from the message box without sending it. Leaves the box alone if the user changed it.",
    inputSchema: { draft_id: draftId },
  }, (input) => run(() => drafts.discard(input.draft_id)));
}
