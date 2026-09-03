import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [manifest, lockfile] = await Promise.all(
  ["package.json", "package-lock.json"].map(async (filename) =>
    JSON.parse(await readFile(new URL(`../${filename}`, import.meta.url), "utf8")),
  ),
);

test("better-sqlite3 remains an optional fallback", () => {
  const version = manifest.optionalDependencies?.["better-sqlite3"];

  assert.equal(manifest.dependencies?.["better-sqlite3"], undefined);
  assert.match(version ?? "", /^\^12\./);
  assert.equal(lockfile.packages[""].optionalDependencies["better-sqlite3"], version);
  assert.equal(lockfile.packages["node_modules/better-sqlite3"].optional, true);
});
