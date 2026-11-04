import test from "node:test";
import assert from "node:assert/strict";
import { groupParagraphsByPage, isPageMarker, nearestParagraph, normalizeTerm } from "../src/lib/reader-utils.ts";

test("translation paragraphs group under one heading per physical page", () => {
  const items = [{ id: "a", page: 1 }, { id: "b", page: 1 }, { id: "c", page: 2 }];
  const groups = groupParagraphsByPage(items);
  assert.deepEqual(groups.map(([page, paragraphs]) => [page, paragraphs.map(p => p.id)]),
    [[1, ["a", "b"]], [2, ["c"]]]);
});

test("PDF click maps to the correct paragraph on the current page", () => {
  const items = [
    { id: "left", page: 2, bbox: [70, 100, 250, 135] },
    { id: "right", page: 2, bbox: [330, 100, 550, 135] },
    { id: "other", page: 1, bbox: [70, 100, 250, 135] },
  ];
  assert.equal(nearestParagraph(items, 2, 360, 115)?.id, "right");
  assert.equal(nearestParagraph(items, 2, 90, 115)?.id, "left");
  assert.equal(nearestParagraph(items, 2, 600, 400), null);
});

test("academic phrases and hyphenated terms retain their full text", () => {
  assert.equal(normalizeTerm("  structure  from\n motion  "), "structure from motion");
  assert.equal(normalizeTerm("feed-forward neural network"), "feed-forward neural network");
});

test("page numbers are hidden from translation reading", () => {
  assert.equal(isPageMarker("Page 2"), true);
  assert.equal(isPageMarker("12"), true);
  assert.equal(isPageMarker("Section 2"), false);
});
