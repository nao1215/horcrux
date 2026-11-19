# Testing

`npm test` runs every Jest suite in `test/`. This page lists what each technique checks, where it lives and which CI job runs it.

| Technique | Files | CI |
|---|---|---|
| Examples and integration tests | `test/integration.test.ts`, `test/image-split-bind.test.ts`, `test/horcrux.test.ts`, `test/shamir.test.ts`, `test/crypto.test.ts`, `test/react-native-adapter.test.ts` | `ci.yml` Test (Linux, macOS, Windows; Node 18 to 24) |
| Property-based, metamorphic, differential and boundary tests | `test/properties.test.ts` | `ci.yml` at 100 runs, `nightly-property.yml` at 10,000 runs |
| Package smoke test | `scripts/package_smoke.mjs` (`npm run test:package`) | `ci.yml` Package |
| Mutation testing | Stryker, run by hand (below) | none |

## Examples and integration tests

Split and bind through the public functions on real files and buffers: both layouts (`threshold < total` copies the cipher text into every horcrux, `threshold === total` cuts it into one chunk per horcrux), file sizes around the chunk boundaries, binary data, auto-bind of a directory, and the errors for too few, mixed or duplicated horcruxes.

## Property-based tests

`test/properties.test.ts` uses [fast-check](https://fast-check.dev/). `HORCRUX_PROPERTY_RUNS` sets the number of runs (100 by default). A failure prints the seed, the path and the shrunk input; replay it with `fc.assert(property, { seed, path })` and keep the input as an example test.

- Any subset of at least `threshold` Shamir shares, in any order, restores the secret; every share has a distinct x-coordinate in 1..255.
- Any `threshold` horcruxes of a `splitBuffer` run, in any order, restore the data, for both layouts.
- Each replicated horcrux holds as many bytes as the data; the distributed horcruxes together hold exactly as many.
- A header survives `serializeHeader` and `deserializeHeader`, and a horcrux survives `saveHorcruxes` and `loadHorcrux`, with filenames and bodies that contain the `-- HEADER --` and `-- BODY --` markers, quotes, backslashes, newlines and non-ASCII text. This property found that a filename containing `-- BODY --` could not be loaded.
- `loadHorcrux` rejects arbitrary bytes (built from fragments of the format) with an `Error`.

## Metamorphic relations

- The same bytes split from a file (`splitFile`) and from a buffer (`splitBuffer`) give horcruxes of the same sizes, and the file's horcruxes restore the bytes. This relation fails on the code before the fix in which `splitFile` interleaved the cipher text in 100-byte slices that `bind` could not put back.
- Restoring does not depend on which horcruxes are chosen or on their order.

## Differential oracle

`combine` interpolates with log and exp tables over GF(2^8). The test compares it with Lagrange interpolation written from the definition, using bit-by-bit multiplication modulo the AES polynomial x^8 + x^4 + x^3 + x + 1, for arbitrary points with distinct x-coordinates, not only for shares that `split` produced.

## Boundary values

`total` and `threshold` at 2 and 99 are accepted; 1, 100, 2.5 and a threshold above the total are rejected with their messages; one horcrux fewer than the threshold is rejected and exactly the threshold is accepted.

## Package smoke test

`npm run test:package` builds, packs the library, installs the tarball into an empty project and runs split, save and bind through `require()` and through `import`, including the `@nao1215/horcrux/core/split`, `@nao1215/horcrux/core/bind` and `@nao1215/horcrux/adapters/react-native` subpaths. It also fails when the tarball ships `test/`, `src/`, `doc/` or `.github/`. The published 0.0.3 could not be loaded by Node at all; this is the check that would have caught it.

## Mutation testing

Stryker is not a dependency of this repository and does not run in CI. Run it by hand with a config like this one (the JSON report goes outside the repository):

```json
{
  "testRunner": "jest",
  "coverageAnalysis": "perTest",
  "mutate": ["src/**/*.ts", "!src/index.ts", "!src/core/shamir/tables.ts", "!src/interfaces/**"],
  "reporters": ["clear-text"],
  "concurrency": 3,
  "jest": { "configFile": "jest.config.js" }
}
```

```bash
npm install --prefix /tmp/stryker @stryker-mutator/core@9 @stryker-mutator/jest-runner@9 typescript@5.9.3
/tmp/stryker/node_modules/.bin/stryker run stryker.config.json
```

Results (score = (killed + timeout) / all mutants, Stryker's "total"; "covered" leaves out the mutants no test reaches):

| Date | Tests | Mutants | Killed + timeout | Survived | No coverage | Total | Covered | `src/core` total |
|---|---|---|---|---|---|---|---|---|
| 2026-11-19, first run | before `test/horcrux.test.ts` | 524 | 346 | 60 | 118 | 66.03% | 85.22% | 75.83% |
| 2026-11-19 | with `test/horcrux.test.ts` | 524 | 390 | 48 | 86 | 74.43% | 89.04% | 86.26% |

`test/horcrux.test.ts` was written for the survivors of the first run: the mismatch checks of `validateHorcruxSet` (different files, totals, thresholds, duplicate indexes), the 1-based header index, the not-a-file error, the Windows path separator and the filename helpers. Most of what is left is in the adapters (the React Native adapter needs a device library, and the Node adapter's stream helpers have no caller), the error messages of `throw` branches and equivalent mutants in `shamir.ts`: a coefficient loop that runs one index past the end of a `Uint8Array` writes nothing, and `threshold > 255` cannot be reached once `parts > 255` is rejected. There is no CI gate; rerun after a change to `src/core/` and add a row.
