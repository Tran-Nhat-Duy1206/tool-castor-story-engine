import { describe, expect, it } from "vitest";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { LengthSpecSchema } from "../models/length-governance.js";
import { buildWriterSystemPrompt, buildGoldenOpeningDiscipline } from "../agents/writer-prompts.js";
import { BookRulesSchema } from "../models/book-rules.js";

const BOOK: BookConfig = {
  id: "prompt-book",
  title: "Prompt Book",
  platform: "tomato",
  genre: "other",
  status: "active",
  targetChapters: 20,
  chapterWordCount: 3000,
  createdAt: "2026-03-22T00:00:00.000Z",
  updatedAt: "2026-03-22T00:00:00.000Z",
};

const GENRE: GenreProfile = {
  id: "other",
  name: "mock_text",
  language: "vi",
  chapterTypes: ["setup", "conflict"],
  fatigueWords: [],
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  satisfactionTypes: [],
  auditDimensions: [],
};

describe("buildWriterSystemPrompt", () => {
  it("keeps governed inputs and leaves reusable craft to the activated Skill", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "vi",
      "governed",
    );

    expect(prompt).toContain("## mock_text");
    expect(prompt).toContain("mock_text");
    expect(prompt).not.toContain("## mock_text");
    expect(prompt).not.toContain("## mock_text");
    expect(prompt).not.toContain("## mock_text");
  });

  it("enforces narrative person only when the user explicitly set one (#290)", () => {
    const firstPerson = BookRulesSchema.parse({ narrativePerson: "first" });
    const promptFirst = buildWriterSystemPrompt(
      BOOK, GENRE, firstPerson, "# Book Rules", "# Genre Body", "# Style Guide",
      undefined, 3, "creative", undefined, "vi", "governed",
    );
    expect(promptFirst).toContain("mock_text（mock_text）");
    expect(promptFirst).toContain("Chương mock_text");

    // Unset → no narrative-person section is imposed (the genre default applies).
    const noPerson = BookRulesSchema.parse({});
    const promptNone = buildWriterSystemPrompt(
      BOOK, GENRE, noPerson, "# Book Rules", "# Genre Body", "# Style Guide",
      undefined, 3, "creative", undefined, "vi", "governed",
    );
    expect(promptNone).not.toContain("mock_text（mock_text）");
  });

  it("tolerates a stray narrativePerson value (degrades to no constraint, fail-open)", () => {
    const rules = BookRulesSchema.parse({ narrativePerson: "(mock_text)" });
    expect(rules.narrativePerson).toBeUndefined();
  });

  it("uses target-range wording when a length spec is provided", () => {
    const lengthSpec = LengthSpecSchema.parse({
      target: 2200,
      softMin: 1900,
      softMax: 2500,
      hardMin: 1600,
      hardMax: 2800,
      countingMode: "zh_chars",
    });

    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "vi",
      "governed",
      lengthSpec,
    );

    expect(prompt).toContain("mock_text từmock_text：2200");
    expect(prompt).toContain("mock_text：1900-2500");
    expect(prompt).not.toContain("mock_text2200 từ");
  });

  it("keeps hard guardrails and book/style constraints in governed mode", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules\n\n- Do not reveal the mastermind.",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "vi",
      "governed",
    );

    expect(prompt).toContain("Do not reveal the mastermind");
    expect(prompt).toContain("Keep the prose restrained");
  });

  it("injects golden opening discipline into zh writer system prompt for ch<=3", () => {
    for (const ch of [1, 2, 3]) {
      const prompt = buildWriterSystemPrompt(
        BOOK,
        GENRE,
        null,
        "# Book Rules",
        "# Genre Body",
        "# Style Guide",
        undefined,
        ch,
        "creative",
        undefined,
        "vi",
        "governed",
      );
      expect(prompt).toContain("mock_text");
      expect(prompt).toContain(`Chương  ${ch} mock_text`);
    }
  });

  it("injects golden opening discipline into en writer system prompt for ch<=3", () => {
    for (const ch of [1, 2, 3]) {
      const prompt = buildWriterSystemPrompt(
        BOOK,
        { ...GENRE, language: "en", name: "General" },
        null,
        "# Book Rules",
        "# Genre Body",
        "# Style Guide",
        undefined,
        ch,
        "creative",
        undefined,
        "en",
        "governed",
      );
      expect(prompt).toContain("Golden Opening Discipline");
      expect(prompt).toContain(`Chapter ${ch}`);
    }
  });

  it("omits golden opening discipline for ch>=4 in both languages", () => {
    const zh = buildWriterSystemPrompt(
      BOOK, GENRE, null, "# Book Rules", "# Genre Body", "# Style Guide",
      undefined, 4, "creative", undefined, "vi", "governed",
    );
    expect(zh).not.toContain("mock_text");

    const en = buildWriterSystemPrompt(
      BOOK, { ...GENRE, language: "en", name: "General" }, null,
      "# Book Rules", "# Genre Body", "# Style Guide",
      undefined, 4, "creative", undefined, "en", "governed",
    );
    expect(en).not.toContain("Golden Opening Discipline");
  });

  it("renders golden opening discipline as cohesive prose, not a checklist", () => {
    const out = buildGoldenOpeningDiscipline(1, "vi");
    // Header line is allowed; body must not contain enumerated/bulleted lines.
    expect(out).not.toMatch(/^\s*1\.\s/m);
    expect(out).not.toMatch(/^\s*-\s/m);
    expect(out).not.toMatch(/^\s*\*\s/m);
    // Carries the load-bearing slot constraints.
    expect(out).toContain("800  từ");
    expect(out).toContain("mock_text");
    expect(out).toContain("mock_text");
    expect(out).toContain("mock_text");
  });

  it("buildGoldenOpeningDiscipline returns empty string for ch>=4 / undefined", () => {
    expect(buildGoldenOpeningDiscipline(4, "vi")).toBe("");
    expect(buildGoldenOpeningDiscipline(99, "en")).toBe("");
    expect(buildGoldenOpeningDiscipline(undefined, "vi")).toBe("");
  });

  it("tells governed English prompts to obey variance briefs and include resistance-bearing exchanges", () => {
    const prompt = buildWriterSystemPrompt(
      {
        ...BOOK,
        language: "en",
      },
      {
        ...GENRE,
        language: "en",
        name: "General",
      },
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "en",
      "governed",
    );

    expect(prompt).toContain("English Variance Brief");
    expect(prompt).toContain("resistance-bearing exchange");
  });
});
