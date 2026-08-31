import { describe, expect, it } from "vitest";
import { ConsolidatorAgent } from "../agents/consolidator.js";

describe("ConsolidatorAgent", () => {
  it("parses Chinese volume boundaries with full-width parentheses and chapter ranges", () => {
    const agent = new ConsolidatorAgent({
      client: {} as ConstructorParameters<typeof ConsolidatorAgent>[0]["client"],
      model: "test-model",
      projectRoot: "/tmp",
    });

    const outline = [
      "# Volume Outline",
      "",
      "### Chương mock_text：mock_text（1-20mock_text）",
      "- mock_text，mock_textChương mock_text",
      "",
      "### Chương mock_text：mock_text（21-60mock_text）",
      "- mock_text",
      "",
    ].join("\n");

    const boundaries = (agent as unknown as {
      parseVolumeBoundaries: (input: string) => Array<{ name: string; startCh: number; endCh: number }>;
    }).parseVolumeBoundaries(outline);

    expect(boundaries).toEqual([
      { name: "Chương mock_text：mock_text", startCh: 1, endCh: 20 },
      { name: "Chương mock_text：mock_text", startCh: 21, endCh: 60 },
    ]);
  });
});
