import { type InferenceSession } from "onnxruntime-web";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type PixAIModelConfig,
  type PixAITaggerSession,
  buildTagCategories,
  fetchModelFilesPixAI,
  isPixAIConfig,
  parseModelInfoPixAI,
  processResultsPixAI,
  shouldApplySigmoid,
} from "./pixai";

const config: PixAIModelConfig = {
  img_size: 1008,
  tags: [
    "1girl",
    "some_tag",
    "0_0",
    "low_general",
    "hatsune_miku",
    "vocaloid",
    "some_style",
    "meta_tag",
    "rating:s",
    "rating:e",
  ],
  tags_split: [
    ["general", 4],
    ["character", 1],
    ["copyright", 1],
    ["style", 1],
    ["meta", 1],
    ["rating", 2],
  ],
  category_best_threshold: {
    general: 0.17,
    character: 0.27,
    copyright: 0.24,
    style: 0.15,
    meta: 0.17,
    rating: 0.41,
  },
};

const probabilities = new Float32Array([
  0.5, 0.4, 0.35, 0.1, 0.45, 0.3, 0.2, 0.2, 0.5, 0.6,
]);

function createSession(
  applySigmoid: boolean,
  modelConfig: PixAIModelConfig = config,
): PixAITaggerSession {
  return {
    modelType: "pixai",
    targetSize: modelConfig.img_size ?? 1008,
    modelSession: {} as InferenceSession,
    backend: "wasm",
    config: modelConfig,
    tagCategories: buildTagCategories(modelConfig),
    applySigmoid,
  };
}

function installOpfsMock() {
  const files = new Map<string, BlobPart>();
  const root = {
    getFileHandle: vi.fn(async (name: string) => ({
      createWritable: async () => ({
        write: async (data: Blob) => {
          files.set(name, data);
        },
        close: async () => {},
      }),
    })),
  };
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      getDirectory: vi.fn(async () => root),
    },
  });
  return files;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isPixAIConfig", () => {
  it("accepts a descriptor with tags, tags_split and category thresholds", () => {
    expect(isPixAIConfig(config)).toBe(true);
  });

  it("accepts a minimal descriptor without img_size", () => {
    expect(
      isPixAIConfig({
        tags: ["1girl"],
        tags_split: [["general", 1]],
        category_best_threshold: { general: 0.2 },
      }),
    ).toBe(true);
  });

  it("rejects descriptors that miss any required field", () => {
    expect(
      isPixAIConfig({
        tags: ["1girl"],
        tags_split: [["general", 1]],
      }),
    ).toBe(false);
    expect(
      isPixAIConfig({
        tags: ["1girl"],
        category_best_threshold: { general: 0.2 },
      }),
    ).toBe(false);
    expect(
      isPixAIConfig({
        tags_split: [["general", 1]],
        category_best_threshold: { general: 0.2 },
      }),
    ).toBe(false);
    expect(
      isPixAIConfig({
        tags: ["1girl"],
        tags_split: [["general", 1]],
        category_best_threshold: [],
      }),
    ).toBe(false);
  });
});

describe("parseModelInfoPixAI", () => {
  it("caches the config and returns a PixAI model entry", async () => {
    const files = installOpfsMock();
    const meta = await parseModelInfoPixAI(
      "https://example.com/config.json",
      config,
    );
    expect(meta.type).toBe("pixai");
    expect(meta.name).toBe("PixAI Tagger v1.0");
    if (meta.type !== "pixai") {
      throw new Error("Expected a PixAI model");
    }
    expect(meta.configPath).toMatch(/^tagModels-[0-9a-f]{16}-config\.json$/);
    expect(meta.configPath && files.has(meta.configPath)).toBe(true);
  });
});

describe("fetchModelFilesPixAI", () => {
  it("fetches the sibling model.onnx exactly", async () => {
    await expect(
      fetchModelFilesPixAI({
        name: "PixAI Tagger v1.0",
        type: "pixai",
        url: "https://example.com/pixai/config.json",
      }),
    ).resolves.toBe("model.onnx");
  });
});

describe("shouldApplySigmoid", () => {
  it("treats a prediction output as already-sigmoided", () => {
    expect(shouldApplySigmoid(["prediction"])).toBe(false);
  });

  it("treats any other output as pre-sigmoid", () => {
    expect(shouldApplySigmoid(["logits"])).toBe(true);
    expect(shouldApplySigmoid([])).toBe(true);
  });
});

describe("buildTagCategories", () => {
  it("expands tags_split in tag order and pads any remainder", () => {
    expect(buildTagCategories(config).slice(0, 6)).toEqual([
      "general",
      "general",
      "general",
      "general",
      "character",
      "copyright",
    ]);
    expect(
      buildTagCategories({
        tags: ["a", "b"],
        tags_split: [["general", 1]],
        category_best_threshold: {},
      }),
    ).toEqual(["general", "general"]);
  });
});

describe("processResultsPixAI", () => {
  it("uses per-category thresholds rather than the UI threshold", () => {
    const session = createSession(false);
    const names = processResultsPixAI(
      session,
      probabilities,
      0.99,
    ).tagResults.map((tag) => tag.name);
    expect(names).toEqual([
      "rating:e",
      "1girl",
      "character:hatsune miku",
      "some tag",
      "0_0",
      "series:vocaloid",
      "creator:some style",
      "meta tag",
    ]);
    expect(names).not.toContain("low_general");

    expect(
      processResultsPixAI(session, probabilities, 0.0).tagResults.map(
        (tag) => tag.name,
      ),
    ).toEqual(names);
  });

  it("maps categories to Hydrus namespaces and preserves kaomoji", () => {
    const result = processResultsPixAI(createSession(false), probabilities, 0);
    const byName = new Map(
      result.tagResults.map((tag) => [tag.name, tag.confidence]),
    );
    expect(byName.get("character:hatsune miku")).toBeCloseTo(0.45, 6);
    expect(byName.get("series:vocaloid")).toBeCloseTo(0.3, 6);
    expect(byName.get("creator:some style")).toBeCloseTo(0.2, 6);
    expect(byName.get("meta tag")).toBeCloseTo(0.2, 6);
    expect(byName.get("0_0")).toBeCloseTo(0.35, 6);
    expect(byName.get("some tag")).toBeCloseTo(0.4, 6);
  });

  it("keeps only the highest rating above the rating threshold", () => {
    const ratings = processResultsPixAI(
      createSession(false),
      probabilities,
      0,
    ).tagResults.filter((tag) => tag.name.startsWith("rating:"));
    expect(ratings).toHaveLength(1);
    expect(ratings[0]?.name).toBe("rating:e");
    expect(ratings[0]?.confidence).toBeCloseTo(0.6, 6);
  });

  it("treats predictions as probabilities when the model output is sigmoided", () => {
    const byName = new Map(
      processResultsPixAI(
        createSession(false),
        probabilities,
        0,
      ).tagResults.map((tag) => [tag.name, tag.confidence]),
    );
    expect(byName.get("1girl")).toBeCloseTo(0.5, 6);
  });

  it("applies sigmoid when the model output is pre-sigmoid logits", () => {
    const modelConfig: PixAIModelConfig = {
      img_size: 1008,
      tags: ["a_tag", "b_tag"],
      tags_split: [["general", 2]],
      category_best_threshold: { general: 0.5 },
    };
    const result = processResultsPixAI(
      createSession(true, modelConfig),
      new Float32Array([0, 10]),
      0,
    );
    const byName = new Map(
      result.tagResults.map((tag) => [tag.name, tag.confidence]),
    );
    // sigmoid(0) is exactly at the threshold and is excluded; sigmoid(10) is
    // included as a probability.
    expect(byName.has("a tag")).toBe(false);
    expect(byName.get("b tag")).toBeCloseTo(1 / (1 + Math.exp(-10)), 10);
  });

  it("sorts results by confidence descending", () => {
    const confidences = processResultsPixAI(
      createSession(false),
      probabilities,
      0,
    ).tagResults.map((tag) => tag.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
  });
});
