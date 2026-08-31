import { describe, expect, it } from "vitest";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "../agents/settler-prompts.js";

const BOOK: BookConfig = {
  id: "settler-prompt-book",
  title: "mock_text",
  platform: "other",
  genre: "mystery",
  status: "active",
  targetChapters: 20,
  chapterWordCount: 2500,
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
};

const GENRE: GenreProfile = {
  id: "mystery",
  name: "mock_text",
  language: "vi",
  chapterTypes: ["mock_text"],
  fatigueWords: [],
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  satisfactionTypes: [],
  auditDimensions: [],
};

describe("settler hook identity contract", () => {
  it("assigns semantic identity to the settler and keeps host admission structural", () => {
    const prompt = buildSettlerSystemPrompt(BOOK, GENRE, null, "vi");

    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text hookId");
    expect(prompt).toContain("mock_text");
    expect(prompt).not.toContain("mock_text hook");
  });

  it("labels supplied hooks as active or semantically relevant dormant canon", () => {
    const prompt = buildSettlerUserPrompt({
      chapterNumber: 1,
      title: "mock_text",
      content: "mock_text。",
      currentState: "# mock_text",
      ledger: "",
      hooks: "| H012 | deferred | mock_text |",
      chapterSummaries: "(mock_text)",
      subplotBoard: "(mock_text)",
      emotionalArcs: "(mock_text)",
      characterMatrix: "(mock_text)",
      volumeOutline: "# Chương mock_text",
    });

    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("H012");
  });
});
