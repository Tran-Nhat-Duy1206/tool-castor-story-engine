import { describe, expect, it } from "vitest";
import { runResearchReport } from "../agents/researcher.js";

describe("ResearcherAgent", () => {
  it("builds a traceable research report without mutating story state", async () => {
    const report = await runResearchReport(
      {
        topic: "mock_text",
        purpose: "worldbuilding",
        depth: "quick",
      },
      {
        search: async (query, maxResults) => {
          expect(query).toContain("mock_text");
          expect(maxResults).toBeGreaterThan(0);
          return [
            {
              title: "mock_text",
              url: "https://example.com/song-policing",
              snippet: "mock_text、mock_text，mock_text。",
            },
          ];
        },
        fetch: async (url) => {
          expect(url).toBe("https://example.com/song-policing");
          return "mock_text，mock_text、mock_text、mock_text。";
        },
      },
    );

    expect(report.summary).toContain("mock_text");
    expect(report.sources).toEqual([
      expect.objectContaining({ id: "S1", url: "https://example.com/song-policing" }),
    ]);
    expect(report.claims[0]).toMatchObject({
      sourceIds: ["S1"],
      confidence: "medium",
    });
    expect(report.queryLog[0]).toContain("mock_text");
    expect(report.markdown).toContain("## Claims");
    expect(report.markdown).toContain("[S1]");
    expect(report.markdown).toContain("## Creative implications");
  });
});
