import { describe, expect, it } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";

const keys = (obj: unknown, prefix = ""): string[] =>
  obj && typeof obj === "object" && !Array.isArray(obj)
    ? Object.entries(obj).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
    : [prefix.slice(0, -1)];

describe("translations", () => {
  it("German has exactly the same keys as English", () => {
    expect(keys(de).sort()).toEqual(keys(en).sort());
  });

  it("has no empty strings", () => {
    const values = JSON.stringify([en, de]);
    expect(values).not.toMatch(/:\s*""/);
  });
});
