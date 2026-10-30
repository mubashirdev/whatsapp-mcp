# whatsapp-mcp

An MCP server for your own use. It opens WhatsApp Web in its own Chromium window and gives Codex six tools:

- `list_chats`: the chats at the top of your chat list.
- `read_messages`: the newest loaded messages of one chat. Opening a chat marks it read.
- `search_messages`: WhatsApp's own search over all chats.
- `draft_message`: types a message into a chat's message box, where you can see it. It does not send.
- `send_draft`: sends that draft, once, after you say send.
- `discard_draft`: clears the draft from the box.

## The dedicated browser

The tool starts its own Chromium through Playwright, with its own profile folder at `~/.whatsapp-mcp/profile`. Your normal Chrome is never opened or read. The profile keeps your WhatsApp login, so you scan the QR code once. Only you can read the folder (mode 0700). Set `WHATSAPP_MCP_HOME` to keep it somewhere else.

After your first login, you can set `WHATSAPP_HEADLESS=1` (in the `env` of the MCP entry) to hide the window. You then can't see drafts in the window, and a logged-out profile answers "Not logged in: start once without WHATSAPP_HEADLESS to scan the QR code".

The window opens on the first tool call, not when Codex starts. If you close it, the next call opens it again. Only one copy can use the profile at a time, so a second one says "The WhatsApp window is already open from another session". If the window gets stuck and won't close, the tool never kills it. It says "The WhatsApp window didn't close. Quit it and try again", and you quit Chromium yourself.

## Install

You need Node 24 or later (it runs the TypeScript files directly) and Bun for the install and tests.

```sh
cd /path/to/whatsapp-mcp
bun install
bun test && bunx tsc --noEmit
```

It uses `playwright-core` 1.64.0-alpha-1790635538000, the same version Agent Chat uses. It uses the Chromium in `~/Library/Caches/ms-playwright/chromium-1247`. If that folder is missing, run `bunx playwright-core install chromium` once.

## Add it to Codex

Add this to `~/.codex/config.toml`, with `/path/to/whatsapp-mcp` replaced by where you cloned the repo, then restart Codex:

```toml
[mcp_servers.whatsapp]
command = "/usr/local/bin/node"
args = ["/path/to/whatsapp-mcp/src/main.ts"]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "approve"
```

`"approve"` lets Codex call the tools without asking each time. That is needed inside Agent Chat, which turns down Codex's tool prompts. The send rule below is the gate instead.

## First login

1. Ask Codex something like "list my WhatsApp chats".
2. A Chromium window opens on WhatsApp Web with a QR code. The tool answers "Not logged in: scan the QR code in the WhatsApp window".
3. On your phone, open WhatsApp, go to Linked devices, and scan the code.
4. Ask again. Until the chats load, it answers "WhatsApp is still loading, try again in a moment".

## Sending: drafts are sent only after you say send

- `draft_message` only types into the box. You see the text in the WhatsApp window, unsent.
- Codex must show you the draft and wait. `send_draft` is for after you say send for that draft.
- `send_draft` sends only if the box still holds exactly that draft. If you edited it, nothing is sent.
- A draft sends once. A second `send_draft` is refused.
- A draft never types over text you started in the box yourself.
- Drafts live in memory. After a restart, an old draft id is refused, and the text stays in the box for you to send or clear.

## Staying under WhatsApp's radar

WhatsApp bans accounts that act like bots. The tool keeps every call to what one person could do by hand:

- **No automation marks.** The window starts without Playwright's automation flag, so `navigator.webdriver` is false and there is no "controlled by automated software" bar.
- **Human typing.** Drafts are typed key by key, 40 to 100 ms a key, not pasted in an instant.
- **Paced calls.** Each tool call waits 1.5 to 4 seconds (random) after the last one ended, so a burst of calls doesn't click through chats at machine speed.
- **Send limits.** At least 30 seconds between sends, at most 8 sends an hour and 30 a day. Send times are kept in `~/.whatsapp-mcp/sends.json`, so a restart doesn't reset them. A refused send leaves the draft in the box to send later.
- **Replies only.** A draft is refused in a chat where the other side hasn't written in the loaded messages. Messaging people who never wrote to you is what gets reported. Start those chats yourself on your phone. Your own chat is always allowed.

Limits live in `SAFE_SENDING` in `src/drafts.ts`. Raising them raises the ban risk.

Also keep in mind: keep WhatsApp Web open on this one machine (not many places), keep your phone online, and don't log in and out often.

## Risks

- This drives WhatsApp Web like a person would, but WhatsApp's terms don't allow automated or unofficial clients. Your account could be limited or banned. Use it lightly, for your own chats, and don't use it to message many people.
- Anyone who can read `~/.whatsapp-mcp/profile` can use your WhatsApp login. Don't copy or share that folder. To log out, remove the linked device on your phone.
- Codex sees every message the tools read.

## When WhatsApp changes its page

All selectors are in `src/selectors.ts`. To fix them, close the WhatsApp window, then run:

```sh
node src/dump-dom.ts > outline.txt                   # the page as it loads, with the chat list
node src/dump-dom.ts --open-first > outline.txt      # after opening your top chat, which marks it read
node src/dump-dom.ts --open-self > outline.txt       # after opening your own chat, so no contact's chat is marked read
node src/dump-dom.ts --search <word> > outline.txt   # after a search; the word itself is never printed
```

It prints the page structure with all text and labels replaced by their length, so the file holds no messages or names. Only fixed UI labels from `src/selectors.ts`, like "Chat list", show as they are. Update the selectors and `test/fixtures/whatsapp.html` to match.

## Tests

```sh
bun test                                # all tests, against a fake WhatsApp page
bun run test:browser                    # node --test test/browser.node-test.ts: opens a real Chromium window on the fake page
```

The browser tests run with Node, like the tool itself, because Playwright supports Node and not Bun. They need a normal terminal. They can't start Chromium inside a sandbox.
