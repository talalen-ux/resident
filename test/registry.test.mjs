/**
 * Canonical token registry.
 *
 * These addresses decide where the desk's money goes, and they were typed in
 * from a docs page rather than read off the chain — so they get checked hard.
 * EIP-55 is the useful one: changing a single hex character changes the
 * required capitalisation almost every time, so a checksum that still validates
 * is strong evidence the address was transcribed exactly.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { getAddress } from "ethers";

import {
  ALL_TOKENS,
  ETF_TOKENS,
  STOCK_TOKENS,
  TOKENS,
  canonicalAddresses,
  etfAddresses,
  isCanonical,
  isTradable,
  tickerFor,
  tradableAddresses,
} from "../src/lib/chain.ts";

test("the registry holds the expected number of tokens", () => {
  assert.equal(Object.keys(STOCK_TOKENS).length, 177);
  assert.equal(Object.keys(ETF_TOKENS).length, 17);
  assert.equal(Object.keys(ALL_TOKENS).length, 194);
});

test("every address is well formed", () => {
  for (const [ticker, entry] of Object.entries(ALL_TOKENS)) {
    assert.match(entry.address, /^0x[0-9a-fA-F]{40}$/, `${ticker} is malformed`);
    assert.ok(entry.name.length > 0, `${ticker} has no name`);
  }
  for (const [name, address] of Object.entries(TOKENS)) {
    assert.match(address, /^0x[0-9a-fA-F]{40}$/, `${name} is malformed`);
  }
});

test("every checksummed address passes EIP-55", () => {
  const unchecksummed = [];
  for (const [ticker, entry] of Object.entries(ALL_TOKENS)) {
    const body = entry.address.slice(2);
    const isMixedCase =
      body !== body.toLowerCase() && body !== body.toUpperCase();

    if (!isMixedCase) {
      // All-lowercase is a legal unchecksummed form, so it carries no signal
      // either way. Recorded rather than failed.
      unchecksummed.push(ticker);
      continue;
    }
    assert.doesNotThrow(
      () => getAddress(entry.address),
      `${ticker} ${entry.address} fails its EIP-55 checksum — likely a transcription error`,
    );
  }
  // LLY is published all-lowercase on the source page.
  assert.deepEqual(unchecksummed, ["LLY"]);
});

test("no address appears twice", () => {
  const seen = new Map();
  for (const [ticker, entry] of Object.entries(ALL_TOKENS)) {
    const key = entry.address.toLowerCase();
    assert.equal(seen.get(key), undefined, `${ticker} duplicates ${seen.get(key)}`);
    seen.set(key, ticker);
  }
  assert.equal(seen.size, 194);
});

test("no stock token collides with a quote asset", () => {
  const quotes = new Set([TOKENS.usdg.toLowerCase(), TOKENS.weth.toLowerCase()]);
  for (const [ticker, entry] of Object.entries(ALL_TOKENS)) {
    assert.equal(quotes.has(entry.address.toLowerCase()), false, `${ticker} collides with a quote asset`);
  }
});

// --- what the desk is allowed to hold --------------------------------------

test("tokenized ETFs are canonical but not tradable", () => {
  for (const [ticker, entry] of Object.entries(ETF_TOKENS)) {
    assert.equal(isCanonical(entry.address), true, `${ticker} should be canonical`);
    assert.equal(
      isTradable(entry.address),
      false,
      `${ticker} is a tokenized ETF and must be excluded categorically`,
    );
  }
});

test("stock tokens are both canonical and tradable", () => {
  for (const [ticker, entry] of Object.entries(STOCK_TOKENS)) {
    assert.equal(isCanonical(entry.address), true, `${ticker} should be canonical`);
    assert.equal(isTradable(entry.address), true, `${ticker} should be tradable`);
  }
});

test("the tradable set excludes every ETF", () => {
  const tradable = tradableAddresses();
  for (const address of etfAddresses()) {
    assert.equal(tradable.has(address), false);
  }
  // stocks + USDG + WETH
  assert.equal(tradable.size, 177 + 2);
  assert.equal(canonicalAddresses().size, 194 + 2);
});

test("an unknown address is neither canonical nor tradable", () => {
  const fake = "0xdead000000000000000000000000000000000bad";
  assert.equal(isCanonical(fake), false);
  assert.equal(isTradable(fake), false);
  assert.equal(tickerFor(fake), null);
});

test("addresses resolve back to their ticker, case-insensitively", () => {
  assert.equal(tickerFor(STOCK_TOKENS.AMC.address), "AMC");
  assert.equal(tickerFor(STOCK_TOKENS.AMC.address.toLowerCase()), "AMC");
  assert.equal(tickerFor(STOCK_TOKENS.NVDA.address.toUpperCase().replace("0X", "0x")), "NVDA");
  assert.equal(tickerFor(ETF_TOKENS.SPY.address), "SPY");
});

test("a few spot-checked tickers carry the addresses from the source page", () => {
  // Sampled across the alphabet so a wholesale misalignment of rows shows up.
  assert.equal(STOCK_TOKENS.AAPL.address, "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9");
  assert.equal(STOCK_TOKENS.AMC.address, "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B");
  assert.equal(STOCK_TOKENS.GME.address, "0x1b0E319c6A659F002271B69dB8A7df2F911c153E");
  assert.equal(STOCK_TOKENS.NVDA.address, "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
  assert.equal(STOCK_TOKENS.TSLA.address, "0x322F0929c4625eD5bAd873c95208D54E1c003b2d");
  assert.equal(STOCK_TOKENS.ZS.address, "0x7dc013eB55e436f30d7ED1AFE4E36d6e45e3c3f7");
  assert.equal(ETF_TOKENS.SPY.address, "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C");
  assert.equal(TOKENS.usdg, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  assert.equal(TOKENS.weth, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
});

test("names survived the transcription", () => {
  assert.equal(STOCK_TOKENS.AMC.name, "AMC Entertainment");
  assert.equal(STOCK_TOKENS.GOOGL.name, "Alphabet Class A");
  assert.equal(ETF_TOKENS.QQQ.name, "Invesco QQQ");
  // The " • Robinhood Token" suffix is stripped from every entry.
  for (const entry of Object.values(ALL_TOKENS)) {
    assert.equal(entry.name.includes("Robinhood Token"), false);
  }
});
