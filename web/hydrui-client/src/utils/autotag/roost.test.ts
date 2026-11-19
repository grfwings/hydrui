import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useModelMetaStore,
  withServerRoostModel,
} from "@/store/modelMetaStore";

import {
  RoostAutotagWorker,
  fetchRoostModelInfo,
  normalizeRoostBaseUrl,
  readServerRoostModel,
  roostPredictionToHydrusTag,
  tagImageWithRoost,
} from "./roost";

describe("roost autotag integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes Roost server URLs and strips endpoint suffixes", () => {
    expect(normalizeRoostBaseUrl("http://127.0.0.1:21911/")).toBe(
      "http://127.0.0.1:21911",
    );
    expect(normalizeRoostBaseUrl("https://roost.example.com/sub/v1/tag/")).toBe(
      "https://roost.example.com/sub",
    );
    expect(normalizeRoostBaseUrl("http://localhost:21911/v1/model")).toBe(
      "http://localhost:21911",
    );
    expect(normalizeRoostBaseUrl("/roost/v1/tag")).toBe("/roost");
    expect(normalizeRoostBaseUrl("/roost/")).toBe("/roost");
    expect(() => normalizeRoostBaseUrl("//evil.example")).toThrow();
    expect(() => normalizeRoostBaseUrl("ftp://localhost:21911")).toThrow();
    expect(() =>
      normalizeRoostBaseUrl("http://user:pass@localhost:21911"),
    ).toThrow();
  });

  it("reads server-managed Roost configuration and merges into modelMetaStore state", () => {
    const body = document.createElement("body");
    expect(readServerRoostModel(body)).toBeNull();

    body.dataset["serverMode"] = "true";
    body.dataset["roostEnabled"] = "true";
    body.dataset["roostName"] = "pixai-tagger-v1.0";
    const serverModel = readServerRoostModel(body);
    expect(serverModel).toEqual({
      type: "roost",
      name: "pixai-tagger-v1.0",
      url: "/roost",
      serverManaged: true,
    });

    const merged = withServerRoostModel(
      {
        tagModels: {
          "WD ViT Tagger v3": {
            name: "WD ViT Tagger v3",
            type: "wd",
            url: "https://models.hydrui.dev/wd-vit-tagger-v3/info.json",
          },
          StaleServerModel: {
            name: "StaleServerModel",
            type: "roost",
            url: "/roost",
            serverManaged: true,
          },
        },
        tagModelNames: ["StaleServerModel", "WD ViT Tagger v3"],
      },
      serverModel,
    );
    expect(merged.tagModelNames).toEqual([
      "pixai-tagger-v1.0",
      "WD ViT Tagger v3",
    ]);
    expect(merged.tagModels["StaleServerModel"]).toBeUndefined();
    expect(merged.tagModels["pixai-tagger-v1.0"]).toEqual(serverModel);
  });

  it("converts Roost predictions across WD, PixAI, and Haruka formats to Hydrus tags", () => {
    expect(
      roostPredictionToHydrusTag({ label: "blue_hair", category: "general" }),
    ).toBe("blue hair");
    expect(
      roostPredictionToHydrusTag({ label: "^_^", category: "general" }),
    ).toBe("^_^");
    expect(
      roostPredictionToHydrusTag({ label: ":d", category: "general" }),
    ).toBe("::d");
    expect(
      roostPredictionToHydrusTag({
        label: "creator:some_artist",
        category: "artist",
      }),
    ).toBe("creator:some artist");
    expect(
      roostPredictionToHydrusTag({
        label: "series:touhou",
        category: "copyright",
      }),
    ).toBe("series:touhou");
    expect(
      roostPredictionToHydrusTag({
        label: "rating:general",
        category: "rating",
      }),
    ).toBe("rating:general");
    expect(
      roostPredictionToHydrusTag({
        label: "highres",
        category: "meta",
      }),
    ).toBe("highres");
  });

  it("fetches /v1/model with optional Bearer auth", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "wd-vit-tagger-v3",
          adapter: "wd",
          labels: 10861,
          thresholds: { general: 0.35, character: 0.85 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const info = await fetchRoostModelInfo(
      "http://127.0.0.1:21911/",
      "secret-token",
    );
    expect(info.id).toBe("wd-vit-tagger-v3");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:21911/v1/model", {
      headers: { Authorization: "Bearer secret-token" },
    });
  });

  it("omits thresholds by default and sends general override when specified", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            model: "wd-vit-tagger-v3",
            predictions: [
              { label: "1girl", score: 0.98, category: "general" },
              {
                label: "character:hakurei_reimu",
                score: 0.91,
                category: "character",
              },
            ],
            thresholds_used: { general: 0.35 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const blob = new Blob(["png-bytes"], { type: "image/png" });
    const defaultRes = await tagImageWithRoost({
      baseUrl: "/roost",
      blob,
      generalThreshold: null,
    });
    expect(defaultRes.tagResults).toEqual([
      { name: "1girl", confidence: 0.98 },
      { name: "character:hakurei reimu", confidence: 0.91 },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/roost/v1/tag");
    const firstForm = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(firstForm.get("thresholds")).toBeNull();

    await tagImageWithRoost({
      baseUrl: "http://127.0.0.1:21911",
      blob,
      generalThreshold: 0.42,
    });
    const secondForm = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(secondForm.get("thresholds")).toBe(
      JSON.stringify({ general: 0.42 }),
    );
  });

  it("registers a Roost model in modelMetaStore and loads a RoostAutotagWorker", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "pixai-tagger-v0.9",
          adapter: "pixai",
          labels: 13461,
          thresholds: { general: 0.17 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const meta = await useModelMetaStore
      .getState()
      .actions.installRoostTagModel({
        url: "http://127.0.0.1:21911",
      });
    expect(meta).toEqual({
      type: "roost",
      name: "pixai-tagger-v0.9",
      url: "http://127.0.0.1:21911",
    });

    const worker = await useModelMetaStore
      .getState()
      .actions.loadTagModel("pixai-tagger-v0.9");
    expect(worker).toBeInstanceOf(RoostAutotagWorker);

    await useModelMetaStore
      .getState()
      .actions.uninstallTagModel("pixai-tagger-v0.9");
  });
});
