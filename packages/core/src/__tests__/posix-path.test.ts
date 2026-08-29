import { describe, expect, it } from "vitest";
import { toPosixPath } from "../utils/posix-path.js";

describe("toPosixPath", () => {
  it("converts Windows separators", () => {
    expect(toPosixPath(".castor\\materials\\a.md")).toBe(".castor/materials/a.md");
  });

  it("keeps posix paths unchanged", () => {
    expect(toPosixPath("storyboards/cold-ledger/assets.json")).toBe("storyboards/cold-ledger/assets.json");
  });

  it("normalizes mixed separators", () => {
    expect(toPosixPath("interactive-films\\demo/story-graph.json")).toBe("interactive-films/demo/story-graph.json");
  });
});
