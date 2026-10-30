import { UserError } from "../src/errors.ts";
import type { LoginState } from "../src/extract.ts";
import { pickChat, type Driver } from "../src/whatsapp.ts";

/** A fake WhatsApp page: chats with their own message box, and a log of what was sent. */
export function fakeDriver(chats = ["Ali Khan", "Ali R", "Mom", "Message yourself"]) {
  const boxes = new Map(chats.map((name) => [name, ""]));
  const fake = {
    login: "ready" as LoginState,
    current: "",
    /** When set, openChat claims success but this chat stays showing, like a click that missed. */
    stuckOn: "",
    sent: [] as { chat: string; text: string }[],
    sendClicks: 0,
    limits: [] as number[],
    boxes,
  };
  const box = () => {
    if (!fake.current) throw new UserError("No chat is open");
    return boxes.get(fake.current) ?? "";
  };
  const driver: Driver = {
    state: async () => fake.login,
    listChats: async (limit) => {
      fake.limits.push(limit);
      return chats.slice(0, limit).map((name) => ({ name, last: "", time: "", unread: 0 }));
    },
    openChat: async (name) => {
      const index = pickChat(chats, name);
      if (index === undefined) throw new UserError(`No chat named "${name}"`);
      const match = chats[index];
      fake.current = fake.stuckOn || match;
      return match;
    },
    readMessages: async (limit) => {
      fake.limits.push(limit);
      return [{ fromMe: false, sender: fake.current, time: "10:00", text: "hi" }];
    },
    search: async (query, limit) => {
      fake.limits.push(limit);
      return [{ chat: chats[0], time: "10:00", text: query }];
    },
    currentChat: async () => fake.current,
    boxText: async () => box(),
    typeIntoBox: async (text) => {
      boxes.set(fake.current, box() + text);
    },
    clickSend: async () => {
      fake.sendClicks++;
      fake.sent.push({ chat: fake.current, text: box() });
      boxes.set(fake.current, "");
    },
    clearBox: async () => {
      boxes.set(fake.current, "");
    },
  };
  return { driver, fake };
}
