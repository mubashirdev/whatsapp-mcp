import type { Page } from "playwright-core";
import { whatsappPage } from "./browser.ts";
import { UserError } from "./errors.ts";
import { chatRowPositions, chatRows, headerName, loginState, messageRows, searchRows, selfRowPosition, selfTitle, type ChatRow, type LoginState, type MessageRow, type SearchRow } from "./extract.ts";
import { SELECTORS } from "./selectors.ts";

/** What the tools need from the WhatsApp page. The browser one drives Playwright; tests pass a fake. */
export type Driver = {
  state(): Promise<LoginState>;
  listChats(limit: number): Promise<ChatRow[]>;
  /** Opens the one chat that matches the name and returns its full name. */
  openChat(name: string): Promise<string>;
  /** Reads the newest messages of the open chat. */
  readMessages(limit: number): Promise<MessageRow[]>;
  search(query: string, limit: number): Promise<SearchRow[]>;
  currentChat(): Promise<string>;
  boxText(): Promise<string>;
  /** Types into the open chat's message box without ever pressing a bare Enter. */
  typeIntoBox(text: string): Promise<void>;
  /** Clicks Send and waits for the box to empty. Only Drafts calls it. */
  clickSend(): Promise<void>;
  clearBox(): Promise<void>;
};

/**
 * Finds the row for a chat name: the only exact match ignoring case, else the only partial match.
 * Refuses when several rows match, even with the same name, so a message never goes to the wrong one of two "Alex" chats.
 */
export function pickChat(names: string[], wanted: string): number | undefined {
  const lower = wanted.trim().toLowerCase();
  const exact = names.flatMap((name, index) => (name.toLowerCase() === lower ? [index] : []));
  const rows = exact.length ? exact : names.flatMap((name, index) => (name.toLowerCase().includes(lower) ? [index] : []));
  if (rows.length <= 1) return rows[0];
  const distinct = [...new Set(rows.map((index) => names[index]))];
  if (distinct.length === 1) throw new UserError(`Several chats are named "${distinct[0]}". Rename one in WhatsApp or use a more exact name`);
  throw new UserError(`Several chats match "${wanted}": ${distinct.join(", ")}. Use a more exact name`);
}

const SELF_WORDS = [SELECTORS.selfChatName.toLowerCase(), "me", "myself"];

/**
 * Decides which row a chat name means. The chat list holds only the top chats, so it settles exact names only.
 * Anything else goes through WhatsApp's search, which covers every chat, before a name counts as ambiguous or missing.
 */
export async function resolveChat(visible: string[], search: (name: string) => Promise<string[]>, wanted: string): Promise<{ inSearch: boolean; index: number; name: string }> {
  const lower = wanted.trim().toLowerCase();
  // Your own chat is titled with your name on the page, so it is asked for by these words, before any name matching.
  if (SELF_WORDS.includes(lower)) {
    const index = visible.indexOf(SELECTORS.selfChatName);
    if (index < 0) throw new UserError("Your own chat isn't in the loaded chat list. Open it once in the WhatsApp window and try again");
    return { inSearch: false, index, name: SELECTORS.selfChatName };
  }
  const exact = visible.flatMap((name, index) => (name.toLowerCase() === lower ? [index] : []));
  // pickChat throws the "Several chats are named" refusal for two visible rows with the same name.
  if (exact.length > 1) pickChat(exact.map((index) => visible[index]), wanted);
  if (exact.length === 1) return { inSearch: false, index: exact[0], name: visible[exact[0]] };
  const found = await search(wanted);
  const index = pickChat(found, wanted);
  if (index === undefined) throw new UserError(`No chat named "${wanted}"`);
  return { inSearch: true, index, name: found[index] };
}

/**
 * Whether the open chat is your own. Only right after this tool clicked your own chat's row, and only when the header
 * is exactly your name or carries the you-label, so "Sam Rivers Work" is never taken for "Sam Rivers".
 */
export function isOwnChat(header: { name: string; youLabel: boolean }, you: string, clickedSelf: boolean): boolean {
  return clickedSelf && (header.youLabel || (you !== "" && header.name === you));
}

const WAIT = 10_000;
const SHORT = 5_000;

/** The Driver for the real WhatsApp page, through Playwright. Every page call has a timeout. */
export function browserDriver(getPage: () => Promise<Page> = whatsappPage): Driver {
  const html = async () => (await getPage()).locator("html");

  // Set by openRow: whether the last row this tool clicked was your own chat's row.
  let clickedSelf = false;

  const currentChat = async () => {
    const header = await (await html()).evaluate(headerName, SELECTORS, { timeout: SHORT });
    if (!header) return "";
    // Your own chat's header shows your name, but it is listed as selfChatName.
    const you = await (await html()).evaluate(selfTitle, SELECTORS, { timeout: SHORT });
    return isOwnChat(header, you, clickedSelf) ? SELECTORS.selfChatName : header.name;
  };

  const boxText = async () => {
    const text = await (await getPage()).locator(SELECTORS.messageBox).innerText({ timeout: SHORT });
    // An empty box still holds an empty line in WhatsApp's editor.
    return text.trim() ? text : "";
  };

  const until = async (check: () => Promise<boolean>, ms: number) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return check();
  };

  const searchFor = async (query: string) => {
    const box = (await getPage()).locator(SELECTORS.searchBox);
    await box.fill(query, { timeout: SHORT });
    await (await getPage()).locator(SELECTORS.searchResults).waitFor({ timeout: WAIT });
  };

  const clearSearch = async () => {
    await (await getPage()).locator(SELECTORS.searchBox).fill("", { timeout: SHORT });
  };

  /** Clicks the chat row at this index, the same order the extract functions read, and checks it opened. */
  /** Clicks the chat that is hit number index of the readers, and checks it opened. */
  const openRow = async (container: string, match: string, index: number) => {
    const self = match === SELECTORS.selfChatName;
    // Your own chat is always clicked, by its own row, so a chat that only looks like it is never taken for it.
    if (self || (await currentChat()) !== match) {
      // The readers skip heading rows, so hit index is not DOM row index. Click the row it was read from.
      const positions = await (await html()).evaluate(chatRowPositions, { container, sel: SELECTORS }, { timeout: SHORT });
      const position = self ? await (await html()).evaluate(selfRowPosition, { container, sel: SELECTORS }, { timeout: SHORT }) : positions[index];
      if (position === undefined || position < 0) throw new UserError(`Couldn't open "${match}"`);
      clickedSelf = false;
      await (await getPage()).locator(container).locator(SELECTORS.chatRow).nth(position).click({ timeout: SHORT });
      clickedSelf = self;
    }
    if (!(await until(async () => (await currentChat()) === match, SHORT))) throw new UserError(`Couldn't open "${match}"`);
    return match;
  };

  return {
    state: async () => (await html()).evaluate(loginState, SELECTORS, { timeout: SHORT }),

    listChats: async (limit) => (await html()).evaluate(chatRows, { limit, sel: SELECTORS }, { timeout: SHORT }),

    openChat: async (name) => {
      // Every read, draft, send and discard opens its chat here, so this is the one place a name becomes a row.
      const listed = await (await html()).evaluate(chatRows, { limit: 500, sel: SELECTORS }, { timeout: SHORT });
      let searched = false;
      try {
        const pick = await resolveChat(listed.map((chat) => chat.name), async (query) => {
          searched = true;
          await searchFor(query);
          const found = await (await html()).evaluate(searchRows, { limit: 500, sel: SELECTORS }, { timeout: SHORT });
          return found.map((row) => row.chat);
        }, name);
        // The search results must still be showing for their row to be clicked, so cleanup waits until after.
        return await openRow(pick.inSearch ? SELECTORS.searchResults : SELECTORS.chatList, pick.name, pick.index);
      } finally {
        // Never hide the real error behind a failed cleanup.
        if (searched) await clearSearch().catch(() => {});
      }
    },

    readMessages: async (limit) => (await html()).evaluate(messageRows, { limit, sel: SELECTORS }, { timeout: SHORT }),

    search: async (query, limit) => {
      try {
        await searchFor(query);
        return await (await html()).evaluate(searchRows, { limit, sel: SELECTORS }, { timeout: SHORT });
      } finally {
        // Never hide the real error behind a failed cleanup.
        await clearSearch().catch(() => {});
      }
    },

    currentChat,
    boxText,

    typeIntoBox: async (text) => {
      const page = await getPage();
      await page.locator(SELECTORS.messageBox).focus({ timeout: SHORT });
      // A bare Enter sends in WhatsApp, so lines are joined with Shift+Enter and never contain a newline.
      const lines = text.replace(/\r\n/g, "\n").split("\n");
      for (const [index, line] of lines.entries()) {
        if (index > 0) await page.keyboard.press("Shift+Enter");
        // Typed key by key at a person's speed: pasting a whole message in an instant looks like a bot.
        if (line) await page.keyboard.type(line, { delay: 40 + Math.random() * 60 });
      }
    },

    clickSend: async () => {
      await (await getPage()).locator(SELECTORS.sendButton).click({ timeout: SHORT });
      if (!(await until(async () => (await boxText()) === "", WAIT))) {
        throw new UserError("Send was clicked but the message box didn't empty. Check the WhatsApp window");
      }
    },

    clearBox: async () => {
      const page = await getPage();
      // A click puts the cursor inside WhatsApp's editor; focus alone may not, and then the keys go nowhere.
      await page.locator(SELECTORS.messageBox).click({ timeout: SHORT });
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
    },
  };
}
