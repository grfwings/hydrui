import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchModelFiles, fetchModelInfo } from "./management";

function installOpfsMock() {
  const files = new Map<string, Blob>();
  const root = {
    getFileHandle: vi.fn(async (name: string) => ({
      createWritable: async () => ({
        write: async (data: Blob) => {
          files.set(name, data);
        },
        close: async () => {},
      }),
      getFile: async () => files.get(name) ?? new Blob(),
    })),
    removeEntry: vi.fn(async (name: string) => {
      files.delete(name);
    }),
  };
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      getDirectory: vi.fn(async () => root),
    },
  });
  return files;
}

function mockFetchResponse(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => payload,
    })),
  );
}

const harukaMetadata = {
  total_tags: 1,
  img_size: 448,
  backbone: "test",
  num_queries: 1,
  pool_mode: "test",
  idx_to_tag: { "0": "1girl" },
  tag_to_category: { "1girl": "general" },
};

const pixaiConfig = {
  img_size: 1008,
  tags: ["1girl"],
  tags_split: [["general", 1]],
  category_best_threshold: { general: 0.2 },
};

describe("fetchModelInfo", () => {
  beforeEach(() => {
    installOpfsMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("recognises Haruka metadata", async () => {
    mockFetchResponse(harukaMetadata);
    const meta = await fetchModelInfo(
      "https://example.com/haruka-tagger_metadata.json",
    );
    expect(meta.type).toBe("haruka");
    if (meta.type !== "haruka") {
      throw new Error("Expected Haruka model metadata");
    }
    expect(meta.name).toBe("Haruka Tagger");
    expect(meta.metadataPath).toMatch(
      /^tagModels-[0-9a-f]{16}-metadata\.json$/,
    );
  });

  it("still recognises Camie metadata", async () => {
    mockFetchResponse({ model_info: { architecture: "tagger" } });
    const meta = await fetchModelInfo("https://example.com/metadata.json");
    expect(meta.type).toBe("camie");
  });

  it("still recognises WD info", async () => {
    mockFetchResponse({ modelname: "WD Tagger" });
    const meta = await fetchModelInfo("https://example.com/info.json");
    expect(meta.type).toBe("wd");
  });

  it("recognises PixAI config", async () => {
    mockFetchResponse(pixaiConfig);
    const meta = await fetchModelInfo("https://example.com/config.json");
    expect(meta.type).toBe("pixai");
    if (meta.type !== "pixai") {
      throw new Error("Expected PixAI model metadata");
    }
    expect(meta.name).toBe("PixAI Tagger v1.0");
    expect(meta.configPath).toMatch(/^tagModels-[0-9a-f]{16}-config\.json$/);
  });

  it("rejects unknown metadata", async () => {
    mockFetchResponse({ foo: "bar" });
    await expect(
      fetchModelInfo("https://example.com/unknown.json"),
    ).rejects.toThrow("Unrecognized model info format.");
  });
});

describe("fetchModelFiles", () => {
  beforeEach(() => {
    installOpfsMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the exact .onnx file for Haruka without an .ort rewrite", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(String(input));
        return {
          json: async () => harukaMetadata,
          blob: async () => new Blob(["model"]),
        };
      }),
    );
    const meta = await fetchModelFiles({
      name: "Haruka Tagger",
      type: "haruka",
      url: "https://example.com/haruka-tagger_metadata.json",
    });
    expect(requestedUrls).toEqual([
      "https://example.com/haruka-tagger_metadata.json",
      "https://example.com/haruka-tagger.onnx",
    ]);
    expect(meta.modelPath).toMatch(/^tagModels-[0-9a-f]{16}-model\.onnx$/);
  });

  it("fetches PixAI's sibling model.onnx without an .ort rewrite", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(String(input));
        return {
          json: async () => pixaiConfig,
          blob: async () => new Blob(["model"]),
        };
      }),
    );
    const meta = await fetchModelFiles({
      name: "PixAI Tagger v1.0",
      type: "pixai",
      url: "https://example.com/pixai/config.json",
    });
    expect(requestedUrls).toEqual([
      "https://example.com/pixai/config.json",
      "https://example.com/pixai/model.onnx",
    ]);
    expect(meta.modelPath).toMatch(/^tagModels-[0-9a-f]{16}-model\.onnx$/);
  });
});
