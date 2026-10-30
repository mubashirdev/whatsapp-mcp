/** Every WhatsApp Web selector, in one place. Fix them here when WhatsApp changes its page. */
export const SELECTORS = {
  qr: "canvas[aria-label*='QR'], div[data-ref] canvas",
  // The login, chat list and search box selectors are checked against a redacted outline of the real page.
  // The unread badge, open chat and search results are not checked yet: run dump-dom with --open-first or --search.
  chatList: "[role='grid'][aria-label='Chat list']",
  chatRow: "[role='row']",
  chatName: "[data-testid='cell-frame-title'] span[title]",
  // Your own chat's row. It is titled with your name, so it is listed under selfChatName instead.
  selfRow: "[data-testid='message-yourself-row']",
  selfChatName: "Message yourself",
  youLabel: "[data-testid='you-label']",
  chatLast: "span[data-testid='last-msg-status'][title]",
  // The preview's shown text. Its title can carry hidden direction marks.
  chatLastText: "span[data-testid='last-msg-status'] span[dir]",
  chatTime: "[data-testid='chat-list-timestamp']",
  unread: "[aria-label*='unread message']",
  chatPane: "#main",
  chatTitle: "header [data-testid='conversation-info-header-chat-title']",
  message: "[data-id]",
  // A message WhatsApp has drawn. Rows without it are placeholders for messages not drawn yet.
  messageContainer: "[data-testid='msg-container']",
  // From the real page: your own messages carry a delivery status icon (a labelled span with an svg) in msg-meta,
  // and the first message of a run has a tail-out or tail-in. Message ids carry no direction.
  messageStatus: "[data-testid='msg-meta'] span[aria-label]",
  tailOut: "[data-icon='tail-out']",
  tailIn: "[data-icon='tail-in']",
  messageMeta: "[data-pre-plain-text]",
  messageText: "span.selectable-text",
  messageTime: "[data-testid='msg-meta']",
  searchResults: "[aria-label='Search results.']",
  searchSender: "[data-testid='msg-sender']",
  // No tag in these: on the real page image-thumb is a div button, not an img.
  // image and file are seen on the real page. voice, video and sticker are not checked yet.
  media: {
    image: "[data-testid='image-thumb']",
    voice: "[data-icon='audio-play']",
    video: "[data-icon='media-play']",
    file: "[data-testid='document-thumb']",
    sticker: "[data-testid='sticker']",
  },
  fileName: "[data-testid='document-name']",
  searchBox: "[data-testid='chat-list-search-container'] input[role='textbox']",
  messageBox: "footer [contenteditable='true'][role='textbox']",
  sendButton: "footer button[aria-label='Send']",
};

export type Selectors = typeof SELECTORS;

/** The fixed UI labels quoted in the selectors above, like 'Chat list' and 'Send'. dump-dom may show these as they are. */
export const KNOWN_VALUES = [...JSON.stringify(SELECTORS).matchAll(/'([^']*)'/g)].map((match) => match[1]);

/** For dump-dom: the fixed UI labels, plus WhatsApp's delivery status words, so the outline can show which status a message has. */
export const DUMP_KNOWN_VALUES = [...KNOWN_VALUES, "Read", "Delivered", "Sent", "Pending"];
