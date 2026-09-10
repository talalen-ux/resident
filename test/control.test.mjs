/**
 * Who may tell the desk what to do.
 *
 * Every assertion here is a refusal. The interesting cases are all attempts to
 * get authority without the wallet: a replayed challenge, an expired one, a
 * valid signature from the wrong address, a token that outlived its session.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { verifyMessage } from "ethers";

import { Control, challenge, parseOrder } from "../src/lib/keeper/control.ts";

const OWNER = new Wallet(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const STRANGER = new Wallet(
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
);

let counter = 0;
const control = (over = {}) =>
  new Control({
    wallet: OWNER.address,
    verify: verifyMessage,
    random: () => `r${++counter}`,
    now: () => 1_000_000,
    ...over,
  });

test("a signature from the named wallet opens a session", async () => {
  const c = control();
  const { nonce, message } = c.begin();
  const { token } = c.authenticate(nonce, await OWNER.signMessage(message));
  assert.ok(c.authorised(token));
});

test("a valid signature from any other wallet is refused", async () => {
  const c = control();
  const { nonce, message } = c.begin();
  await assert.rejects(
    async () => c.authenticate(nonce, await STRANGER.signMessage(message)),
    (error) => {
      assert.equal(error.name, "BadOrder");
      // The message must not name the wallet it wanted. Whoever is probing
      // either holds it already or should not be told what to look for.
      assert.ok(
        !error.message.toLowerCase().includes(OWNER.address.toLowerCase()),
        "the refusal leaked the expected address",
      );
      return true;
    },
  );
});

test("a challenge cannot be used twice, even by the right wallet", async () => {
  const c = control();
  const { nonce, message } = c.begin();
  const signature = await OWNER.signMessage(message);
  c.authenticate(nonce, signature);
  await assert.rejects(
    async () => c.authenticate(nonce, signature),
    /already used/,
  );
});

test("a failed attempt still burns the challenge", async () => {
  const c = control();
  const { nonce, message } = c.begin();
  try {
    c.authenticate(nonce, await STRANGER.signMessage(message));
  } catch {
    // expected
  }
  // If a bad attempt left the nonce live, it could be ground against.
  await assert.rejects(
    async () => c.authenticate(nonce, await OWNER.signMessage(message)),
    /already used/,
  );
});

test("an expired challenge is refused", async () => {
  let now = 1_000_000;
  const c = control({ now: () => now, nonceTtlMs: 1_000 });
  const { nonce, message } = c.begin();
  const signature = await OWNER.signMessage(message);
  now += 2_000;
  assert.throws(() => c.authenticate(nonce, signature), /expired/);
});

test("a session expires and the token stops working", async () => {
  let now = 1_000_000;
  const c = control({ now: () => now, sessionTtlMs: 10_000 });
  const { nonce, message } = c.begin();
  const { token } = c.authenticate(nonce, await OWNER.signMessage(message));
  assert.ok(c.authorised(token));
  now += 11_000;
  assert.equal(c.authorised(token), false);
});

test("an unknown or absent token is not authorised", () => {
  const c = control();
  assert.equal(c.authorised("made-up"), false);
  assert.equal(c.authorised(null), false);
  assert.equal(c.authorised(undefined), false);
  assert.equal(c.authorised(""), false);
});

test("garbage in the signature field is a refusal, not a crash", () => {
  const c = control();
  const { nonce } = c.begin();
  assert.throws(() => c.authenticate(nonce, "not a signature"), /could not be read/);
});

test("the challenge says what it does and does not authorise", () => {
  const text = challenge("abc", 1_700_000_000_000);
  assert.match(text, /Nonce: abc/);
  assert.match(text, /moves no funds/);
  // An expiry in the signed text is what stops an old signature being replayed
  // against a keeper that restarted.
  assert.match(text, /Expires: /);
});

test("orders are validated rather than coerced", () => {
  assert.deepEqual(parseOrder({ kind: "close", positionId: "p1" }), {
    kind: "close",
    positionId: "p1",
    note: "manual order",
  });
  assert.throws(() => parseOrder({ kind: "close" }), /positionId is required/);
  assert.throws(() => parseOrder({ kind: "open", pool: "AI/USDG" }), /positive number/);
  assert.throws(() => parseOrder({ kind: "open", pool: "AI/USDG", capital: -5 }), /positive/);
  assert.throws(() => parseOrder({ kind: "open", pool: "AI/USDG", capital: "lots" }), /positive/);
  assert.throws(() => parseOrder({ kind: "burn" }), /unknown order/);
  assert.throws(() => parseOrder(null), /expected an object/);
  assert.throws(() => parseOrder("close"), /expected an object/);
});

test("a note is carried but bounded", () => {
  const order = parseOrder({ kind: "pause", note: "x".repeat(500) });
  assert.equal(order.note.length, 200);
});

test("pause and resume take effect at once; the rest queue for the tick", () => {
  const c = control();
  assert.equal(c.paused, false);

  c.submit({ kind: "pause", note: "" });
  assert.equal(c.paused, true);
  // A pause must not sit in the queue waiting for a tick: it is the thing an
  // operator reaches for when the next tick is what they are afraid of.
  assert.equal(c.pending.length, 0);

  c.submit({ kind: "close", positionId: "p1", note: "" });
  assert.equal(c.pending.length, 1);

  c.submit({ kind: "resume", note: "" });
  assert.equal(c.paused, false);

  assert.deepEqual(c.drain().map((o) => o.kind), ["close"]);
  assert.equal(c.pending.length, 0);
  // Draining twice must not replay the order.
  assert.deepEqual(c.drain(), []);
});
