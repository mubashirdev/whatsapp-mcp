import { randomUUID } from "node:crypto";
import type { Driver } from "./whatsapp.ts";
import { UserError } from "./errors.ts";

type Draft = { chat: string; text: string; state: "open" | "sent" | "discarded" };

/** Compares box text loosely only where WhatsApp changes it by itself: line endings and nbsp. */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/ /g, " ");
}

/** Messages typed into a chat's box but not sent. The only code that clicks Send. */
export class Drafts {
  #driver: Driver;
  #drafts = new Map<string, Draft>();

  constructor(driver: Driver) {
    this.#driver = driver;
  }

  /** Types the text into the chat's box and returns the draft id. Never sends. */
  async draft(chat: string, text: string): Promise<{ id: string; chat: string }> {
    if (!text.trim()) throw new UserError("The message is empty");
    const name = await this.#open(chat);
    const box = normalize(await this.#driver.boxText());
    if (box) {
      const own = this.#openDraftIn(name, box);
      if (!own) throw new UserError(`The message box in "${name}" already has text in it. Send or clear it in the WhatsApp window first`);
      await this.#driver.clearBox();
      own.state = "discarded";
    }
    // The box was empty before typing, so on any failure clearing it removes only what we typed.
    try {
      await this.#driver.typeIntoBox(text);
    } catch (error) {
      await this.#driver.clearBox().catch(() => {});
      throw error;
    }
    if (normalize(await this.#driver.boxText()) !== normalize(text)) {
      await this.#driver.clearBox();
      throw new UserError("The draft didn't type in correctly, so the box was cleared and nothing was sent");
    }
    const id = randomUUID();
    this.#drafts.set(id, { chat: name, text, state: "open" });
    return { id, chat: name };
  }

  /** Sends a draft once, and only if the box still holds exactly its text. */
  async send(id: string): Promise<string> {
    const draft = this.#openDraft(id);
    await this.#open(draft.chat);
    if (normalize(await this.#driver.boxText()) !== normalize(draft.text)) {
      throw new UserError("The message box no longer holds that draft, so nothing was sent");
    }
    // Marked first, so an error after the click can never lead to a second send.
    draft.state = "sent";
    await this.#driver.clickSend();
    return draft.chat;
  }

  /** Clears a draft from the box, unless someone changed the box since. */
  async discard(id: string): Promise<string> {
    const draft = this.#openDraft(id);
    await this.#open(draft.chat);
    if (normalize(await this.#driver.boxText()) !== normalize(draft.text)) {
      draft.state = "discarded";
      return `The message box in "${draft.chat}" changed since the draft, so it was left as it is`;
    }
    await this.#driver.clearBox();
    // WhatsApp's editor can ignore a clear, so look again. The draft stays open, so the same id can be discarded later.
    if (await this.#driver.boxText()) throw new UserError(`Couldn't clear the draft in "${draft.chat}"; clear it in the window`);
    draft.state = "discarded";
    return `The draft in "${draft.chat}" was removed`;
  }

  #openDraft(id: string): Draft {
    const draft = this.#drafts.get(id);
    if (!draft) throw new UserError("No draft with that id");
    if (draft.state === "sent") throw new UserError("That draft was already sent");
    if (draft.state === "discarded") throw new UserError("That draft was discarded");
    return draft;
  }

  #openDraftIn(chat: string, box: string): Draft | undefined {
    return [...this.#drafts.values()].find((draft) => draft.state === "open" && draft.chat === chat && normalize(draft.text) === box);
  }

  /** Opens the chat and checks it really is the one showing, so we never touch another chat's box. */
  async #open(chat: string): Promise<string> {
    const name = await this.#driver.openChat(chat);
    if ((await this.#driver.currentChat()) !== name) throw new UserError(`Couldn't open "${name}", so nothing was changed`);
    return name;
  }
}
