import { closeBrowser, whatsappPage } from "./browser.ts";
import { runDump } from "./dump.ts";

// Prints the WhatsApp page's outline so selectors can be fixed. Text and labels show only as lengths.
//   node src/dump-dom.ts                  the page as it loads
//   node src/dump-dom.ts --open-first     after opening the top chat, which marks it read
//   node src/dump-dom.ts --open-self      after opening your own chat, so no contact's chat is marked read
//   node src/dump-dom.ts --search <word>  after searching for the word, which is never printed
process.exitCode = await runDump(process.argv.slice(2), {
  open: () => whatsappPage(),
  close: closeBrowser,
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
