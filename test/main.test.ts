import { join } from "node:path";
import { expect, test } from "bun:test";

test("node src/main.ts answers initialize and lists six tools over stdio, with nothing else on stdout", async () => {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ];
  const proc = Bun.spawn(["node", join(import.meta.dir, "..", "src", "main.ts")], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(requests.map((request) => JSON.stringify(request) + "\n").join(""));
  proc.stdin.end();
  const lines = (await new Response(proc.stdout).text()).trim().split("\n");
  await proc.exited;
  const replies = lines.map((line) => JSON.parse(line));
  expect(replies).toHaveLength(2);
  expect(replies[0].result.serverInfo.name).toBe("whatsapp");
  expect(replies[0].result.capabilities.tools).toBeDefined();
  expect(replies[1].result.tools).toHaveLength(6);
});
