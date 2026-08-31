import { describe, expect, it } from "vitest";

import {
  composeCurrentArcProse,
  extractCollaboratorRows,
  extractOpponentRows,
  extractProtagonistRow,
  formatRelevantThreads,
} from "../agents/planner-context.js";

// Real column layouts match the production truth-file schemas under story/.
// Keeping these literal samples in tests guards against the kind of
// off-by-one column bug that slipped past Phase 3 review.
const EMOTIONAL_ARCS_SAMPLE = `
| mock_text | mock_text | mock_text | mock_text | mock_text(1-10) | mock_text |
|------|------|----------|----------|-------------|----------|
| mock_text | 36 | mock_text | mock_text | 8 | mock_text |
| mock_text | 37 | mock_text | mock_text | 9 | mock_text |
| mock_text | 38 | mock_text | mock_text | 10 | mock_text |
`;

const CHARACTER_MATRIX_SAMPLE = `
| mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |
|------|----------|----------|----------|----------|------------|----------|----------|
| mock_text | mock_text | mock_text | mock_text、mock_text | mock_text | mock_text | mock_text | mock_text |
| mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text | mock_text |
| mock_text | mock_text | mock_text | mock_text、mock_text | mock_text | mock_text | mock_text | mock_text |
`;

const SUBPLOT_BOARD_SAMPLE = `
| S001 | mock_text | mock_text | ch1 | ch38 | 0 | mock_text | mock_text | 1mock_text |
| S007 | mock_text | mock_text | ch3 | ch4 | 34 | mock_text | mock_text | 4-6mock_text |
`;

describe("composeCurrentArcProse reads chapter from emotional_arcs column 1", () => {
  it("filters rows by chapter from column index 1 (mock_text), not column 0 (mock_text)", () => {
    // Previously the function filtered where row[0] matched /^\d+$/.
    // Since row[0] is "mock_text" here, the old predicate produced zero matches
    // and "mock_text" fell out of the composed prose entirely.
    const prose = composeCurrentArcProse(
      SUBPLOT_BOARD_SAMPLE,
      EMOTIONAL_ARCS_SAMPLE,
      39,
    );
    expect(prose).toContain("mock_text");
    expect(prose).toContain("mock_text");
    expect(prose).toContain("mock_text");
    expect(prose).toContain("mock_text");
  });

  it("excludes rows at or beyond the current chapter", () => {
    const prose = composeCurrentArcProse(
      SUBPLOT_BOARD_SAMPLE,
      EMOTIONAL_ARCS_SAMPLE,
      37,
    );
    expect(prose).toContain("mock_text");
    expect(prose).not.toContain("mock_text");
    expect(prose).not.toContain("mock_text");
  });

  it("still composes active subplots when emotional arcs are empty", () => {
    const prose = composeCurrentArcProse(SUBPLOT_BOARD_SAMPLE, "", 39);
    expect(prose).toContain("mock_text");
    expect(prose).toContain("S001");
    expect(prose).not.toContain("S007");
  });

  it("returns the empty-state sentinel only when nothing is extractable", () => {
    const prose = composeCurrentArcProse("", "", 1);
    expect(prose).toContain("Chua co arc mock_text");
  });
});

describe("extractProtagonistRow", () => {
  it("matches the real convention 'mock_text', not only the exact token 'mock_text'", () => {
    const row = extractProtagonistRow(CHARACTER_MATRIX_SAMPLE);
    expect(row).toContain("mock_text");
    expect(row).toContain("mock_text");
  });

  it("falls back to the first data row when no protagonist marker is found", () => {
    const noMarker = `
| mock_text | mock_text | mock_text |
|------|----------|------------|
| mock_text | mock_text | — |
| mock_text | mock_text | mock_text |
`;
    const row = extractProtagonistRow(noMarker);
    expect(row).toContain("mock_text");
  });

  it("returns the sentinel only when the matrix has zero data rows", () => {
    const empty = `
| mock_text | mock_text |
|------|----------|
`;
    const row = extractProtagonistRow(empty);
    expect(row).toContain("mock_text");
  });
});

describe("extractOpponentRows / extractCollaboratorRows", () => {
  it("picks opponents by mock_text semantic keywords", () => {
    const rows = extractOpponentRows(CHARACTER_MATRIX_SAMPLE, 3);
    expect(rows).toContain("mock_text");
    expect(rows).not.toContain("mock_text");
  });

  it("picks collaborators by mock_text semantic keywords", () => {
    const rows = extractCollaboratorRows(CHARACTER_MATRIX_SAMPLE, 3);
    expect(rows).toContain("mock_text");
    expect(rows).not.toContain("mock_text");
  });
});

describe("formatRelevantThreads", () => {
  it("uses the unified retrieval result for hooks and keeps active subplots", () => {
    const hooks = [
      {
        hookId: "H002",
        startChapter: 0,
        type: "mock_text",
        status: "deferred",
        lastAdvancedChapter: 0,
        expectedPayoff: "mock_text",
        notes: "mock_text",
      },
    ];
    const subplots = `
| S001 | mock_text | mock_text |
| S007 | mock_text | mock_text |
`;
    const threads = formatRelevantThreads(hooks, subplots);
    expect(threads).toContain("H002");
    expect(threads).toContain("mock_text");
    expect(threads).toContain("S001");
    expect(threads).not.toContain("S007");
  });
});
