/**
 * Can this tree actually run the keeper?
 *
 *   node --experimental-strip-types scripts/selftest.mjs
 *
 * Loads every module the keeper loads and stops there. It opens no socket,
 * reads no key and writes no file, so it is safe to run inside a build.
 *
 * The failure it exists to catch is a dependency that is present when the
 * tests run and absent in the deployed image — the lockfile disagreeing with
 * package.json, a package left in devDependencies, a native build that does
 * not exist for the image's platform. Without this the container builds
 * clean, deploys, and only then discovers it cannot import ethers; with it
 * the build fails on the line that says which module is missing.
 *
 * It is deliberately not a test of behaviour. Behaviour is tested by npm test
 * against the full tree; this asks the one question that tree cannot answer.
 */

const modules = [
  "ethers",
  "../src/lib/chain.ts",
  "../src/lib/keeper/journal-file.ts",
  "../src/lib/keeper/signer.ts",
  "../src/lib/keeper/signer-local.ts",
  "../src/lib/keeper/executor-dryrun.ts",
  "../src/lib/keeper/executor-v4.ts",
  "../src/lib/keeper/reconcile-v4.ts",
  "../src/lib/keeper/tx.ts",
  "../src/lib/keeper/loop.ts",
  "../src/lib/keeper/registry.ts",
  "../src/lib/keeper/ledger.ts",
  "../src/lib/keeper/decide.ts",
  "../src/lib/keeper/control.ts",
  "../src/lib/keeper/observer.ts",
  "../src/lib/keeper/position-reader.ts",
  "../src/lib/keeper/vault-reader.ts",
  "../src/lib/keeper/volume.ts",
  "../src/lib/keeper/marks.ts",
  "../src/lib/sim/v4.ts",
  "../src/lib/sim/scanner.ts",
  "../src/lib/sim/strategy.ts",
  "../src/lib/sim/opportunity.ts",
  "../src/lib/sim/capture.ts",
  "../src/lib/sim/ladder.ts",
  "../src/lib/sim/rotate.ts",
  "../src/lib/desk/rpc-pools-source.ts",
];

const failures = [];
for (const specifier of modules) {
  try {
    await import(specifier.startsWith(".") ? new URL(specifier, import.meta.url) : specifier);
  } catch (error) {
    failures.push(`  ${specifier}\n    ${error.message.split("\n")[0]}`);
  }
}

if (failures.length > 0) {
  console.error(
    `selftest: ${failures.length} of ${modules.length} modules would not load.\n` +
      failures.join("\n") +
      "\n\nIf this is a production image, the usual cause is a package that is " +
      "installed for the tests but not for the deploy. Check that it sits in " +
      "dependencies, then run npm install --package-lock-only.",
  );
  process.exit(1);
}

console.log(`selftest: ${modules.length} modules load, ethers included.`);
