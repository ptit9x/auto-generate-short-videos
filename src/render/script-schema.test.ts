import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ScriptSchema, LongScriptSchema, parseScript } from "./script-schema.js";

const load = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/${name}`, "utf8"));

describe("ScriptSchema", () => {
  it("accepts sample-script-with-image.json", () => {
    expect(() => ScriptSchema.parse(load("sample-script-with-image.json"))).not.toThrow();
  });

  it("accepts sample-script-no-image.json", () => {
    expect(() => ScriptSchema.parse(load("sample-script-no-image.json"))).not.toThrow();
  });

  it("rejects invalid-bad-enum.json", () => {
    expect(() => ScriptSchema.parse(load("invalid-bad-enum.json"))).toThrow(/kenBurns/);
  });

  it("rejects invalid-too-many-scenes.json", () => {
    expect(() => ScriptSchema.parse(load("invalid-too-many-scenes.json"))).toThrow(/scenes/);
  });

  it("rejects invalid-line-too-long.json", () => {
    // headline is over 40 chars — Zod error references the max value
    expect(() => ScriptSchema.parse(load("invalid-line-too-long.json"))).toThrow(/40/);
  });

  it("requires hook + outro present", () => {
    const data = load("sample-script-with-image.json");
    data.scenes = data.scenes.filter((s: any) => s.type !== "outro");
    expect(() => ScriptSchema.parse(data)).toThrow(/outro/);
  });

  it("defaults format to short for legacy scripts", () => {
    const parsed = ScriptSchema.parse(load("sample-script-with-image.json"));
    expect(parsed.format).toBe("short");
  });

  it("still rejects a 9+ scene script as short (too-many fixture)", () => {
    // The too-many fixture has no format field → short rules apply.
    expect(() => parseScript(load("invalid-too-many-scenes.json"))).toThrow(/scenes/);
  });
});

describe("LongScriptSchema / parseScript (format: long)", () => {
  it("accepts the long TanStack sample fixture (18 scenes)", () => {
    const parsed = parseScript(load("sample-script-long.json"));
    expect(parsed.format).toBe("long");
    expect(parsed.scenes.length).toBe(18);
  });

  it("routes by format field even without env", () => {
    expect(() => LongScriptSchema.parse(load("sample-script-long.json"))).not.toThrow();
    expect(parseScript(load("sample-script-long.json")).format).toBe("long");
  });

  it("routes to long via env fallback when the script omits format", () => {
    const data = load("sample-script-long.json");
    delete data.format;
    // Without the field the dispatcher needs the env hint to pick long…
    expect(parseScript(data, "long").format).toBe("long");
    // …and with no hint it is treated as a (too long) short script.
    expect(() => parseScript(data)).toThrow();
  });

  it("rejects a long script with more than 60 scenes", () => {
    expect(() => parseScript(load("invalid-long-too-many-scenes.json"))).toThrow(/60/);
  });

  it("rejects a long script whose last scene is not outro", () => {
    const data = load("sample-script-long.json");
    data.scenes = data.scenes.filter((s: any) => s.type !== "outro");
    expect(() => parseScript(data)).toThrow(/outro/);
  });

  it("rejects the long sample under the SHORT schema (chapter/code-demo + scene count)", () => {
    expect(() => ScriptSchema.parse(load("sample-script-long.json"))).toThrow();
  });

  it("long limits: hook headline up to 90 chars is fine, 91 is not", () => {
    const ok = load("sample-script-long.json");
    ok.scenes[0].templateData.headline = "x".repeat(90);
    expect(() => parseScript(ok)).not.toThrow();
    const bad = load("sample-script-long.json");
    bad.scenes[0].templateData.headline = "x".repeat(91);
    expect(() => parseScript(bad)).toThrow(/90/);
  });

  it("code-demo requires a filename and at least one code line", () => {
    const bad = load("sample-script-long.json");
    const scene = bad.scenes.find((s: any) => s.templateData.template === "code-demo");
    delete scene.templateData.filename;
    expect(() => parseScript(bad)).toThrow(/filename/);
  });
});
