import type { Selectors } from "./selectors.ts";

// Each function here is passed to page.evaluate, which sends only its source text to the page.
// So each one must be self-contained: no imports, no outside helpers, only types from outside.

export type LoginState = "ready" | "qr" | "loading";
export type ChatRow = { name: string; last: string; time: string; unread: number };
export type MessageRow = { fromMe: boolean; sender: string; time: string; text: string };
export type SearchRow = { chat: string; sender?: string; time: string; text: string };
export type ExtractOptions = { limit: number; sel: Selectors };

/** Tells whether the page shows the chat list, the QR code, or neither yet. */
export function loginState(root: Element, sel: Selectors): LoginState {
  if (root.querySelector(sel.qr)) return "qr";
  if (root.querySelector(sel.chatList)) return "ready";
  return "loading";
}

/** Your own name, as the title of your own chat's row, or "" when that row isn't loaded. */
export function selfTitle(root: Element, sel: Selectors): string {
  return root.querySelector(sel.chatList)?.querySelector(sel.selfRow)?.querySelector(sel.chatName)?.getAttribute("title") ?? "";
}

/**
 * The DOM position of each chat row in a list, skipping heading rows the same way chatRows and searchRows do.
 * Hit i of those readers is DOM row positions[i], which is the row to click.
 */
export function chatRowPositions(root: Element, { container, sel }: { container: string; sel: Selectors }): number[] {
  const rows = [...(root.querySelector(container)?.querySelectorAll(sel.chatRow) ?? [])];
  return rows.flatMap((row, position) => (row.querySelector(sel.chatName) ? [position] : []));
}

/** The DOM position of your own chat's row in a list, or -1. Only this row is ever clicked as your own chat. */
export function selfRowPosition(root: Element, { container, sel }: { container: string; sel: Selectors }): number {
  return [...(root.querySelector(container)?.querySelectorAll(sel.chatRow) ?? [])].findIndex((row) => row.querySelector(sel.selfRow));
}

/** The open chat's header name, without the you-label, and whether that label is there. Null when no chat is open. */
export function headerName(root: Element, sel: Selectors): { name: string; youLabel: boolean } | null {
  const title = root.querySelector(sel.chatTitle);
  if (!title) return null;
  const label = (title.closest("header") ?? title.parentElement)?.querySelector(sel.youLabel);
  let name = title.textContent ?? "";
  if (label && title.contains(label)) name = name.replace(label.textContent ?? "", "");
  return { name: name.trim(), youLabel: Boolean(label) };
}

/** Reads the first chats in the chat list. */
export function chatRows(root: Element, { limit, sel }: ExtractOptions): ChatRow[] {
  const list = root.querySelector(sel.chatList);
  if (!list) return [];
  const rows = [...list.querySelectorAll(sel.chatRow)].filter((row) => row.querySelector(sel.chatName));
  return rows.slice(0, limit).map((row) => ({
    name: row.querySelector(sel.selfRow) ? sel.selfChatName : (row.querySelector(sel.chatName)?.getAttribute("title") ?? ""),
    last: row.querySelector(sel.chatLastText)?.textContent?.trim() || (row.querySelector(sel.chatLast)?.getAttribute("title") ?? ""),
    time: row.querySelector(sel.chatTime)?.textContent?.trim() ?? "",
    unread: Number(row.querySelector(sel.unread)?.textContent?.trim() || 0),
  }));
}

/** Reads the newest messages of the open chat, oldest first. */
export function messageRows(root: Element, { limit, sel }: ExtractOptions): MessageRow[] {
  const pane = root.querySelector(sel.chatPane);
  if (!pane) return [];
  // WhatsApp shows emoji as <img alt> and line breaks as <br>, so textContent alone loses them.
  const textOf = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (node.nodeName === "BR") return "\n";
    if (node.nodeName === "IMG") return (node as Element).getAttribute("alt") ?? "";
    return [...node.childNodes].map(textOf).join("");
  };
  const chatName = root.querySelector(sel.chatTitle)?.textContent?.trim() ?? "";
  const drawn = [...pane.querySelectorAll(sel.message)].filter((row) => row.querySelector(sel.messageContainer));
  return drawn.slice(-limit).map((row) => {
    // Only your own messages show a delivery status icon. A tail, when the message has one, settles it.
    const hasStatusIcon = [...row.querySelectorAll(sel.messageStatus)].some((label) => label.querySelector("svg"));
    const fromMe = !row.querySelector(sel.tailIn) && (Boolean(row.querySelector(sel.tailOut)) || hasStatusIcon);
    // data-pre-plain-text looks like "[10:30, 30/10/2026] Ali Khan: ".
    const meta = row.querySelector(sel.messageMeta)?.getAttribute("data-pre-plain-text") ?? "";
    const match = /^\[(.*?)\]\s*(.*?):\s*$/.exec(meta);
    const time = match ? match[1] : row.querySelector(sel.messageTime)?.textContent?.trim() ?? "";
    const sender = fromMe ? "You" : match ? match[2] : chatName;
    const body = row.querySelector(sel.messageText);
    const text = body ? textOf(body).trim() : "";
    const kinds = Object.keys(sel.media) as (keyof Selectors["media"])[];
    const kind = kinds.find((key) => row.querySelector(sel.media[key]));
    const fileName = kind === "file" ? row.querySelector(sel.fileName)?.textContent?.trim() ?? "" : "";
    const label = kind ? [`[${kind}]`, fileName, text].filter(Boolean).join(" ") : text;
    return { fromMe, sender, time, text: label };
  });
}

/** Reads the message hits shown after a search. */
export function searchRows(root: Element, { limit, sel }: ExtractOptions): SearchRow[] {
  const results = root.querySelector(sel.searchResults);
  if (!results) return [];
  // Search results also hold heading rows ("Chats", "Messages") with no chat in them.
  const rows = [...results.querySelectorAll(sel.chatRow)].filter((row) => row.querySelector(sel.chatName));
  return rows.slice(0, limit).map((row) => {
    const sender = row.querySelector(sel.searchSender)?.textContent?.trim();
    return {
      chat: row.querySelector(sel.selfRow) ? sel.selfChatName : (row.querySelector(sel.chatName)?.getAttribute("title") ?? ""),
      ...(sender ? { sender } : {}),
      time: row.querySelector(sel.chatTime)?.textContent?.trim() ?? "",
      text: row.querySelector(sel.chatLastText)?.textContent?.trim() || (row.querySelector(sel.chatLast)?.getAttribute("title") ?? ""),
    };
  });
}

/**
 * Outlines the page as tag, id, role, data-testid and data-icon, for fixing selectors without seeing anyone's messages.
 * Every other attribute and all text show only as their length, unless the value is one of the known UI labels.
 */
export function domOutline(root: Element, known: string[]): string {
  const shown = ["id", "role", "data-testid", "data-icon", "contenteditable", "dir"];
  // Even shown attributes can hold ids or numbers (like message ids), so only plain words pass.
  const plain = /^[a-z][a-z-]*$/i;
  const lines: string[] = [];
  const walk = (node: Element, depth: number) => {
    const attributes = Array.from(node.attributes).map((attribute) => {
      // trim, because WhatsApp pads some fixed labels, like " Read ".
      const visible = (shown.includes(attribute.name) && plain.test(attribute.value)) || known.includes(attribute.value.trim());
      return visible ? `${attribute.name}=${JSON.stringify(attribute.value)}` : `${attribute.name}=<${attribute.value.length}>`;
    });
    const texts = Array.from(node.childNodes)
      .filter((child) => child.nodeType === 3 && (child.textContent ?? "").trim())
      .map((child) => `#text<${(child.textContent ?? "").trim().length}>`);
    lines.push("  ".repeat(depth) + [node.tagName.toLowerCase(), ...attributes, ...texts].join(" "));
    if (["script", "style", "svg"].includes(node.tagName.toLowerCase())) return;
    for (const child of Array.from(node.children)) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines.join("\n");
}
