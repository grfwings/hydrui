import { describe, expect, it } from "vitest";

import { getExecutionProviders } from "./common";

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
