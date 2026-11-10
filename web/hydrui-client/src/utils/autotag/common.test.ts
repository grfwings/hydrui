import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInferenceSession, getExecutionProviders } from "./common";

const { createSession } = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock("onnxruntime-web", () => ({
  InferenceSession: { create: createSession },
}));

beforeEach(() => {
  createSession.mockReset();
});

describe("getExecutionProviders", () => {
  it("tries WebGPU with a CPU fallback when preferred and available", () => {
    expect(getExecutionProviders(true, true)).toEqual(["webgpu", "wasm"]);
  });

  it("uses the CPU when WebGPU is not preferred", () => {
    expect(getExecutionProviders(false, true)).toEqual(["wasm"]);
  });

  it("uses the CPU when WebGPU is unavailable", () => {
    expect(getExecutionProviders(true, false)).toEqual(["wasm"]);
    expect(getExecutionProviders(false, false)).toEqual(["wasm"]);
  });
});

describe("createInferenceSession", () => {
  it("adds actionable guidance when the wasm session aborts", async () => {
    createSession.mockRejectedValueOnce(new Error("Aborted()"));
    await expect(
      createInferenceSession(new ArrayBuffer(1), false),
    ).rejects.toThrow(
      /Aborted\(\)\. The model could not be loaded in this browser\. It may use an unsupported format \(for example float16 weights\) or be too large; try the INT8 export or turn off WebGPU in Settings\./,
    );
  });

  it("does not wrap other errors", async () => {
    createSession.mockRejectedValueOnce(new Error("some other failure"));
    try {
      await createInferenceSession(new ArrayBuffer(1), false);
      throw new Error("Expected createInferenceSession to reject");
    } catch (error) {
      expect(String(error)).toBe("Error: some other failure");
    }
  });

  it("returns the session on success", async () => {
    const session = { release: vi.fn() };
    createSession.mockResolvedValueOnce(session);
    await expect(
      createInferenceSession(new ArrayBuffer(1), false),
    ).resolves.toEqual({ session, backend: "wasm" });
  });
});
