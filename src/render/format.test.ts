import { describe, it, expect } from "vitest";
import { dimensionsForFormat, resolveFormat, DEFAULT_BRAND_TAG_BY_FORMAT } from "./format.js";

describe("dimensionsForFormat", () => {
  it("short is 1080x1920 (9:16)", () => {
    expect(dimensionsForFormat("short")).toEqual({ width: 1080, height: 1920 });
  });
  it("long is 1920x1080 (16:9)", () => {
    expect(dimensionsForFormat("long")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("resolveFormat", () => {
  it("script format field wins over env", () => {
    expect(resolveFormat({ format: "long" }, "short")).toBe("long");
    expect(resolveFormat({ format: "short" }, "long")).toBe("short");
  });
  it("falls back to env when the script has no format", () => {
    expect(resolveFormat({}, "long")).toBe("long");
    expect(resolveFormat(null, "long")).toBe("long");
  });
  it("defaults to short", () => {
    expect(resolveFormat({})).toBe("short");
    expect(resolveFormat(null)).toBe("short");
  });
});

describe("DEFAULT_BRAND_TAG_BY_FORMAT", () => {
  it("short keeps IT NEWS, long is CODE TIPS (Henry, 2026-11-19)", () => {
    expect(DEFAULT_BRAND_TAG_BY_FORMAT.short).toBe("IT NEWS");
    expect(DEFAULT_BRAND_TAG_BY_FORMAT.long).toBe("CODE TIPS");
  });
});
