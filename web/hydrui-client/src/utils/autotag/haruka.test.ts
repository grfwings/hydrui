import { type InferenceSession } from "onnxruntime-web";
import { describe, expect, it } from "vitest";

import { modelUsesCategoryThresholds } from "@/store/modelMetaStore";

import {
  type HarukaMetadata,
  type HarukaTaggerSession,
  computeLetterboxRect,
  fetchModelFilesHaruka,
  processResultsHaruka,
} from "./haruka";

const metadata: HarukaMetadata = {
  total_tags: 9,
  img_size: 448,
  idx_to_tag: {
    "0": "1girl",
    "1": "hatsune_miku",
    "2": "vocaloid",
    "3": "some_artist",
    "4": "2007",
    "5": "rating_s",
    "6": "rating_e",
    "7": "rating_g",
    "8": "low_general",
  },
  tag_to_category: {
    "1girl": "general",
    hatsune_miku: "character",
    vocaloid: "copyright",
    some_artist: "artist",
    "2007": "year",
    rating_s: "rating",
    rating_e: "rating",
    rating_g: "rating",
    low_general: "general",
  },
};

function createSession(): HarukaTaggerSession {
  return {
    modelType: "haruka",
    targetSize: metadata.img_size,
    metadata,
    modelSession: {} as InferenceSession,
    backend: "wasm",
  };
}

// 1girl, hatsune_miku and vocaloid are above their thresholds; the artist and
// year tags sit between their 0.25 threshold and the general 0.35 threshold;
// low_general is below the general threshold. rating_s is exactly at the 0.5
// rating threshold, so it is excluded, while rating_e is the highest rating
// above it.
const logits = new Float32Array([
  1.0, 1.0, 1.0, -1.0, -1.0, 0.0, 0.5, 0.4, -1.0,
]);

describe("fetchModelFilesHaruka", () => {
  it("derives the model name from a _metadata.json URL", async () => {
    const modelFile = await fetchModelFilesHaruka({
      name: "Haruka Tagger",
      type: "haruka",
      url: "https://huggingface.co/KaraKaraWitch/haruka-tagger/resolve/main/haruka-tagger_metadata.json",
    });
    expect(modelFile).toBe("haruka-tagger.onnx");
  });

  it("falls back to model.onnx for other URLs", async () => {
    const modelFile = await fetchModelFilesHaruka({
      name: "Haruka Tagger",
      type: "haruka",
      url: "https://example.com/models/config.json",
    });
    expect(modelFile).toBe("model.onnx");
  });
});

describe("computeLetterboxRect", () => {
  it("letterboxes a wide image into the top and bottom", () => {
    expect(computeLetterboxRect(896, 448, 448)).toEqual({
      x: 0,
      y: 112,
      width: 448,
      height: 224,
    });
  });

  it("letterboxes a tall image into the left and right", () => {
    expect(computeLetterboxRect(448, 896, 448)).toEqual({
      x: 112,
      y: 0,
      width: 224,
      height: 448,
    });
  });

  it("fills a square image without padding", () => {
    expect(computeLetterboxRect(448, 448, 448)).toEqual({
      x: 0,
      y: 0,
      width: 448,
      height: 448,
    });
  });

  it("keeps the aspect ratio within a pixel", () => {
    const rect = computeLetterboxRect(3, 2, 448);
    expect(rect.width).toBe(448);
    expect(Math.abs(rect.width / rect.height - 3 / 2)).toBeLessThan(0.02);
    expect(rect.y).toBe(Math.floor((448 - rect.height) / 2));
  });
});

describe("processResultsHaruka", () => {
  it("uses per-category thresholds rather than the UI threshold", () => {
    const session = createSession();
    const result = processResultsHaruka(session, logits, 0.99);
    const names = result.tagResults.map((tag) => tag.name);

    expect(names).toEqual([
      "1girl",
      "character:hatsune miku",
      "series:vocaloid",
      "rating:e",
      "creator:some artist",
      "year:2007",
    ]);
    expect(names).not.toContain("low_general");

    // The UI threshold is ignored, so even a zero threshold does not admit the
    // tags that are below their category's own threshold.
    const lowThresholdResult = processResultsHaruka(session, logits, 0.0);
    expect(lowThresholdResult.tagResults.map((tag) => tag.name)).toEqual(names);
  });

  it("applies sigmoid to the pre-sigmoid logits", () => {
    const result = processResultsHaruka(createSession(), logits, 0.5);
    const byName = new Map(
      result.tagResults.map((tag) => [tag.name, tag.confidence]),
    );
    expect(byName.get("1girl")).toBeCloseTo(0.7310585786300049, 10);
    expect(byName.get("creator:some artist")).toBeCloseTo(
      0.2689414213699951,
      10,
    );
  });

  it("keeps only the highest rating above the rating threshold", () => {
    const result = processResultsHaruka(createSession(), logits, 0.0);
    const ratings = result.tagResults.filter((tag) =>
      tag.name.startsWith("rating:"),
    );
    expect(ratings).toHaveLength(1);
    expect(ratings[0]?.name).toBe("rating:e");
    expect(ratings[0]?.confidence).toBeCloseTo(0.6224593312018546, 10);
  });

  it("sorts results by confidence descending", () => {
    const confidences = processResultsHaruka(
      createSession(),
      logits,
      0.5,
    ).tagResults.map((tag) => tag.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
  });
});

describe("modelUsesCategoryThresholds", () => {
  it("is true for models with published per-category thresholds", () => {
    expect(
      modelUsesCategoryThresholds({ name: "Haruka Tagger", type: "haruka" }),
    ).toBe(true);
    expect(
      modelUsesCategoryThresholds({ name: "PixAI Tagger v1.0", type: "pixai" }),
    ).toBe(true);
    expect(
      modelUsesCategoryThresholds({ name: "Camie Tagger v2", type: "camie" }),
    ).toBe(false);
    expect(modelUsesCategoryThresholds({ name: "WD", type: "wd" })).toBe(false);
  });
});
