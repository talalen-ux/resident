/**
 * The one JSON-RPC caller.
 *
 * There were two, and teaching one to survive a rate limit taught the other
 * nothing — the untaught one threw `RPC 429 on eth_getLogs` out of pool
 * discovery and killed the keeper before its first tick. These tests are about
 * the distinction that mattered: a busy node is worth asking again, and an
 * answer is not.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { backoffFor, isTransient, jsonRpc } from "../src/lib/desk/rpc-retry.ts";

/** A node that answers however the handler says, on a throwaway port. */
async function node(handler) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(res, JSON.parse(body)));
  });
  await new Promise((r) => server.listen(0, r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  };
}

const ok = (res, result) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
};

test("a rate limit is waited out, not thrown", async () => {
  let hits = 0;
  const n = await node((res) => {
    if (++hits <= 3) {
      res.writeHead(429);
      return res.end("{}");
    }
    ok(res, "0x1");
  });
  const rpc = jsonRpc(n.url, { backoffMs: 5 });
  assert.equal(await rpc("eth_blockNumber"), "0x1");
  assert.equal(hits, 4, "three refusals then the answer");
  n.close();
});

test("a 5xx is waited out too", async () => {
  let hits = 0;
  const n = await node((res) => {
    if (++hits === 1) {
      res.writeHead(503);
      return res.end("{}");
    }
    ok(res, "0x2");
  });
  assert.equal(await jsonRpc(n.url, { backoffMs: 5 })("eth_blockNumber"), "0x2");
  n.close();
});

test("a 4xx that is not 429 is not retried", async () => {
  // A malformed request does not become well formed by being repeated, and
  // retrying one turns an immediate error into four seconds of waiting.
  let hits = 0;
  const n = await node((res) => {
    hits++;
    res.writeHead(400);
    res.end("{}");
  });
  await assert.rejects(jsonRpc(n.url, { backoffMs: 5 })("eth_getLogs"), /RPC 400/);
  assert.equal(hits, 1, "asked once");
  n.close();
});

test("an error from the node is an answer, and is not retried away", async () => {
  // "query returned more than 10000 results" is the node telling us something
  // true about the request. Retrying hides it behind a timeout.
  let hits = 0;
  const n = await node((res) => {
    hits++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "too many results" } }));
  });
  await assert.rejects(jsonRpc(n.url, { backoffMs: 5 })("eth_getLogs"), /too many results/);
  assert.equal(hits, 1);
  n.close();
});

test("exhaustion says it was a rate limit, not a bad request", async () => {
  // The message is load-bearing: the chain verifier classifies on it to
  // separate "could not read" from "read and it was wrong".
  const n = await node((res) => {
    res.writeHead(429);
    res.end("{}");
  });
  await assert.rejects(
    jsonRpc(n.url, { retries: 1, backoffMs: 5 })("eth_getLogs"),
    /rate limiting/,
  );
  n.close();
});

test("Retry-After is honoured, and capped", async () => {
  assert.equal(backoffFor(0, 3), 3_000);
  assert.equal(backoffFor(0, 9_999), 10_000, "a node asking for three hours does not get it");
  assert.equal(backoffFor(0, null, { backoffMs: 100 }), 100);
  assert.equal(backoffFor(3, null, { backoffMs: 100 }), 800, "doubling");
});

test("only the transient statuses are transient", () => {
  assert.equal(isTransient(429), true);
  assert.equal(isTransient(500), true);
  assert.equal(isTransient(502), true);
  assert.equal(isTransient(400), false);
  assert.equal(isTransient(404), false);
});
