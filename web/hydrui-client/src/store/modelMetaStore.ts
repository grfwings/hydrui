import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  deleteSavedFiles,
  fetchModelFiles,
  fetchModelInfo,
  setupZippedTagModel,
} from "@/utils/autotag/management";
import {
  RoostAutotagWorker,
  fetchRoostModelInfo,
  normalizeRoostBaseUrl,
  serverRoostModel,
} from "@/utils/autotag/roost";
import { type WDTaggerModelInfo } from "@/utils/autotag/wd";
import {
  type AutotagWorker,
  createAutotagWorker,
} from "@/utils/autotag/worker";

import { jsonStorage } from "./storage";

export interface CommonTagModelMeta {
  // Name of the model.
  name: string;
  // URL of the info.json or metadata.json file, if the model is from the internet.
  url?: string;
}

export interface WDTaggerModelMeta extends CommonTagModelMeta {
  type: "wd";
  // Contents of the info.json file, if it has been loaded before
  info?: WDTaggerModelInfo;
  // Tag CSV path in OPFS, if the tags are cached
  tagsPath?: string;
  // Model path in OPFS, if the model is cached
  modelPath?: string;
}

export interface CamieTaggerModelMeta extends CommonTagModelMeta {
  type: "camie";
  // Metadata JSON path in OPFS, if the model is cached
  metadataPath?: string;
  // Model path in OPFS, if the metadata is cached
  modelPath?: string;
}

export interface RoostTagModelMeta extends CommonTagModelMeta {
  type: "roost";
  // Base URL of the Roost server.
  url: string;
  // Optional Bearer token for Roost authentication.
  apiKey?: string;
  // True when configured via hydrui-server in server mode.
  serverManaged?: boolean;
}

export type TagModelMeta =
  | WDTaggerModelMeta
  | CamieTaggerModelMeta
  | RoostTagModelMeta;

interface ModelMeta {
  tagModels: Record<string, TagModelMeta>;
  tagModelNames: string[];

  actions: {
    installTagModelFromUrl: (url: string) => Promise<void>;
    installTagModelFromBlob: (blob: Blob) => Promise<void>;
    installRoostTagModel: (options: {
      url: string;
      name?: string;
      apiKey?: string;
    }) => Promise<RoostTagModelMeta>;
    clearInstalledFiles: (name: string) => Promise<void>;
    downloadTagModel: (name: string) => Promise<TagModelMeta>;
    addTagModel: (meta: TagModelMeta) => void;
    uninstallTagModel: (name: string) => Promise<void>;
    resetTagModels: () => Promise<void>;
    loadTagModel: (name: string) => Promise<AutotagWorker>;
  };
}

export function withServerRoostModel(
  state: Pick<ModelMeta, "tagModels" | "tagModelNames">,
  serverModel: RoostTagModelMeta | null,
): Pick<ModelMeta, "tagModels" | "tagModelNames"> {
  const tagModels: Record<string, TagModelMeta> = {};
  for (const [name, meta] of Object.entries(state.tagModels)) {
    if (meta.type === "roost" && meta.serverManaged) {
      continue;
    }
    tagModels[name] = meta;
  }
  const tagModelNames = state.tagModelNames.filter((name) => name in tagModels);
  if (!serverModel) {
    return { tagModels, tagModelNames };
  }
  tagModels[serverModel.name] = serverModel;
  return {
    tagModels,
    tagModelNames: [
      serverModel.name,
      ...tagModelNames.filter((name) => name !== serverModel.name),
    ],
  };
}

const DEFAULT_BROWSER_STATE: Pick<ModelMeta, "tagModels" | "tagModelNames"> = {
  tagModels: {
    "WD ViT Tagger v3": {
      name: "WD ViT Tagger v3",
      url: "https://models.hydrui.dev/wd-vit-tagger-v3/info.json",
      type: "wd",
    },
  },
  tagModelNames: ["WD ViT Tagger v3"],
};

const INITIAL_STATE: Omit<ModelMeta, "actions"> = withServerRoostModel(
  DEFAULT_BROWSER_STATE,
  serverRoostModel,
);

export function isModelCached(meta: TagModelMeta) {
  switch (meta.type) {
    case "wd":
      return meta.info && meta.tagsPath && meta.modelPath;
    case "camie":
      return meta.metadataPath && meta.modelPath;
    case "roost":
      return true;
  }
}

export const useModelMetaStoreActions = () =>
  useModelMetaStore((state) => state.actions);

export const useModelMetaStore = create<ModelMeta>()(
  persist(
    (set, get) => ({
      // Initial state
      ...INITIAL_STATE,

      // Actions
      actions: {
        async installTagModelFromUrl(url: string): Promise<void> {
          get().actions.addTagModel(await fetchModelInfo(url));
        },
        async installTagModelFromBlob(blob: Blob): Promise<void> {
          get().actions.addTagModel(await setupZippedTagModel(blob));
        },
        async installRoostTagModel(options: {
          url: string;
          name?: string;
          apiKey?: string;
        }): Promise<RoostTagModelMeta> {
          const url = normalizeRoostBaseUrl(options.url);
          const apiKey = options.apiKey?.trim() || undefined;
          const info = await fetchRoostModelInfo(url, apiKey);
          const name = options.name?.trim() || info.id;
          const meta: RoostTagModelMeta = {
            type: "roost",
            name,
            url,
            ...(apiKey ? { apiKey } : {}),
          };
          get().actions.addTagModel(meta);
          return meta;
        },
        async clearInstalledFiles(name: string): Promise<void> {
          const prevModel = get().tagModels[name];
          if (!prevModel || prevModel.type === "roost") {
            return;
          }
          const model: TagModelMeta = { ...prevModel };
          await deleteSavedFiles(model);
          delete model.modelPath;
          if (model.type === "wd") delete model.tagsPath;
          if (model.type === "camie") delete model.metadataPath;
          set((state) => ({
            ...state,
            tagModels: {
              ...state.tagModels,
              [name]: model,
            },
          }));
        },
        async downloadTagModel(name: string): Promise<TagModelMeta> {
          const prevModel = get().tagModels[name];
          if (!prevModel) {
            throw new Error(`Model ${name} not found.`);
          }
          if (prevModel.type === "roost") {
            return prevModel;
          }
          const model = { ...prevModel };
          const newModel = await fetchModelFiles(model);
          set((state) => ({
            ...state,
            tagModels: {
              ...state.tagModels,
              [name]: newModel,
            },
          }));
          return newModel;
        },
        addTagModel(meta: TagModelMeta): void {
          set((state) => ({
            ...state,
            tagModels: {
              ...state.tagModels,
              [meta.name]: meta,
            },
            tagModelNames:
              state.tagModelNames.indexOf(meta.name) === -1
                ? [...state.tagModelNames, meta.name]
                : state.tagModelNames,
          }));
        },
        async uninstallTagModel(name: string): Promise<void> {
          const model = get().tagModels[name];
          if (!model || (model.type === "roost" && model.serverManaged)) {
            return;
          }
          await deleteSavedFiles(model);
          set((state) => {
            const newTagModels = { ...state.tagModels };
            delete newTagModels[name];
            return {
              ...state,
              tagModels: newTagModels,
              tagModelNames: state.tagModelNames.filter((n) => n !== name),
            };
          });
        },
        async resetTagModels(): Promise<void> {
          const state = get();
          for (const model of Object.values(state.tagModels)) {
            await deleteSavedFiles(model);
          }
          set({ ...INITIAL_STATE });
        },
        async loadTagModel(name: string): Promise<AutotagWorker> {
          let model = get().tagModels[name];
          if (!model) {
            throw new Error(`Model ${name} not found`);
          }
          if (model.type === "roost") {
            return new RoostAutotagWorker(model);
          }
          if (!isModelCached(model)) {
            model = await get().actions.downloadTagModel(name);
          }
          const worker = await createAutotagWorker();
          await worker.loadModel(model);
          return worker;
        },
      },
    }),
    {
      name: "hydrui-model-meta",
      version: 1,
      storage: jsonStorage,
      // Only persist non-server-managed models
      partialize: ({ tagModels, tagModelNames }) =>
        withServerRoostModel({ tagModels, tagModelNames }, null),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<
          Pick<ModelMeta, "tagModels" | "tagModelNames">
        >;
        return {
          ...currentState,
          ...withServerRoostModel(
            {
              tagModels: persisted.tagModels ?? currentState.tagModels,
              tagModelNames:
                persisted.tagModelNames ?? currentState.tagModelNames,
            },
            serverRoostModel,
          ),
        };
      },
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0) {
          // v0 did not contain the type field.
          // Populate it based on whether or not metadataPath is set.
          const stateV0 = persistedState as {
            tagModels?: Record<
              string,
              { metadataPath?: string; type?: string }
            >;
          };
          if (stateV0.tagModels) {
            for (const meta of Object.values(stateV0.tagModels)) {
              if (meta.metadataPath) {
                meta.type = "camie";
              } else {
                meta.type = "wd";
              }
            }
          }
        }
        return persistedState;
      },
    },
  ),
);
