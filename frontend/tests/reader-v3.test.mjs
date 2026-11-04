import test from "node:test";
import assert from "node:assert/strict";
import { searchParagraphs } from "../src/lib/reader-utils.ts";
import { createUploadQueue } from "../src/lib/upload-queue.ts";

test("full paper search counts English and translated Chinese occurrences", () => {
  const paragraphs = [
    { id: "p1", page: 1, text: "World models predict future states.", translation: "世界模型预测未来状态。" },
    { id: "p2", page: 2, text: "Future states can guide action.", translation: "未来状态可以指导行动。" },
    { id: "p3", page: 3, text: "No translation yet.", translation: null },
  ];
  assert.deepEqual(searchParagraphs(paragraphs, "FUTURE").map(hit => [hit.page, hit.source]), [[1, "en"], [2, "en"]]);
  assert.deepEqual(searchParagraphs(paragraphs, "未来状态").map(hit => [hit.paragraphId, hit.source]), [["p1", "zh"], ["p2", "zh"]]);
  assert.equal(searchParagraphs(paragraphs, "未翻译").length, 0);
  assert.deepEqual(searchParagraphs([{ id: "repeat", page: 4, text: "model and model", translation: null }], "model")
    .map(hit => hit.occurrence), [0, 1]);
});

test("two consecutive drop batches upload once each even after first failure", async () => {
  const uploaded = [];
  const queue = createUploadQueue(async files => {
    for (const file of files) {
      uploaded.push(file);
      if (file === "broken.pdf") throw new Error("invalid PDF");
    }
  });
  const first = queue.enqueue(["broken.pdf"]);
  const second = queue.enqueue(["second.pdf", "third.pdf"]);
  await assert.rejects(first, /invalid PDF/);
  await second;
  assert.deepEqual(uploaded, ["broken.pdf", "second.pdf", "third.pdf"]);
});
