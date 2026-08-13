import assert from "node:assert/strict";
import test from "node:test";
import { detectSlop } from "../dist/lib/slop/index.js";

test("detectSlop finds the coding-agent tells from the Claude parody", () => {
  const result = detectSlop(
    "It is not just annoying, it is infuriating. " +
      "The honest evaluation: it is the precise mechanism. " +
      "It is the load-bearing root cause. " +
      "It is genuinely painful, and that matters.",
  );

  assert.deepEqual(
    result.matches.map((match) => match.tell),
    [
      "it's not X, it's Y",
      "honest take",
      "precise mechanism",
      "load-bearing",
      "genuinely",
      "and that matters",
    ],
  );
  assert.equal(result.count, 6);
});

test("detectSlop recognizes correction-loop sycophancy", () => {
  const result = detectSlop(
    "Good question — that's a good catch and a real gap. " +
      "You're right, and that was a real error in my framing.",
  );

  assert.deepEqual(
    result.matches.map((match) => match.tell),
    ["good question", "good catch", "real gap", "you're right", "error in my framing"],
  );
});

test("detectSlop does not flag ordinary engineering vocabulary", () => {
  const result = detectSlop(
    "The test harness keeps the parser robust. " +
      "The seam separates modules, and we leverage the cache during migration.",
  );

  assert.deepEqual(result, { count: 0, matches: [] });
});

test("detectSlop handles inflected stock words", () => {
  const result = detectSlop("After delving into the tapestries, this became pivotal.");

  assert.deepEqual(
    result.matches.map((match) => match.tell),
    ["delve", "tapestry", "pivotal"],
  );
});

test("detectSlop ignores fenced and inline code", () => {
  const result = detectSlop(
    "Use `load-bearing` as the fixture value.\n" +
      "```ts\nconst phrase = 'honest take';\n```\n" +
      "The parser now returns the expected node.",
  );

  assert.equal(result.count, 0);
});

test("detectSlop ignores em dashes and caps a checkmark wall at one hit", () => {
  const result = detectSlop(
    "One — two — three — four.\n\n" +
      "✅ Added tests\n" +
      "✅ Updated types\n" +
      "✅ Fixed the parser\n",
  );

  assert.deepEqual(
    result.matches.map((match) => match.tell),
    ["checkmark wall"],
  );
});

test("detectSlop prefers the longest overlapping rhetorical template", () => {
  const result = detectSlop("It's not just robust, it's genuinely seamless.");

  assert.equal(result.matches[0]?.tell, "it's not X, it's Y");
  assert.equal(
    result.matches.filter((match) => match.category === "rhetorical template").length,
    1,
  );
});
