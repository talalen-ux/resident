/**
 * Function selectors on ResidentVault.
 *
 * Its own module because the keeper imports these and runs under Node's
 * type-stripping loader, which cannot erase the parameter properties the RPC
 * adapter's class uses. Keeping the table here lets both read it without the
 * keeper pulling in a class it has no use for.
 *
 * Derived from the ABI, not written by hand: test/selectors.test.mjs asserts
 * every entry still matches the compiled contract, so a signature change breaks
 * the build rather than the dashboard.
 */
export const SELECTORS = {
  owner: "0x8da5cb5b",
  keeper: "0xaced1661",
  payoutAsset: "0x3eac5251",
  realized: "0x306cccd6",
  holderAccrued: "0x38fa0458",
  workingCapital: "0xde25c369",
  distributed: "0xf84b903e",
  owed: "0xc87d6779",
  rateLimitRemaining: "0xf5b026f7",
} as const;
