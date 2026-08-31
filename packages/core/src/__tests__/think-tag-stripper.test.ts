import { describe, expect, it } from "vitest";
import { createLeadingThinkTagStripper, stripLeadingThinkBlock } from "../llm/think-tag-stripper.js";

describe("stripLeadingThinkBlock", () => {
  it("strips a complete leading <think> block and following whitespace", () => {
    expect(stripLeadingThinkBlock("<think>mock_text</think>\n\nmock_text。")).toBe("mock_text。");
  });

  it("strips a leading block preceded by whitespace", () => {
    expect(stripLeadingThinkBlock("\n  <think>mock_text</think>mock_text")).toBe("mock_text");
  });

  it("leaves mid-text <think> occurrences untouched", () => {
    const text = "mock_text <think> mock_text。";
    expect(stripLeadingThinkBlock(text)).toBe(text);
  });

  it("leaves an unterminated leading block untouched (no data loss)", () => {
    const text = "<think>mock_text";
    expect(stripLeadingThinkBlock(text)).toBe(text);
  });

  it("returns plain text unchanged", () => {
    expect(stripLeadingThinkBlock("mock_text。")).toBe("mock_text。");
  });
});

describe("createLeadingThinkTagStripper", () => {
  function pushAll(chunks: string[]): { emitted: string[]; flushed: string } {
    const stripper = createLeadingThinkTagStripper();
    const emitted = chunks.map((chunk) => stripper.push(chunk)).filter((piece) => piece.length > 0);
    return { emitted, flushed: stripper.flush() };
  }

  it("suppresses a leading block split across chunk boundaries", () => {
    const { emitted, flushed } = pushAll(["<th", "ink>mock_textA", "mock_textB</th", "ink>\nmock_text", "mock_text"]);
    expect(emitted.join("")).toBe("mock_text");
    expect(flushed).toBe("");
  });

  it("emits buffered text once the prefix diverges from <think>", () => {
    const { emitted, flushed } = pushAll(["<th", "ree>mock_text think mock_text", "，mock_text"]);
    expect(emitted.join("")).toBe("<three>mock_text think mock_text，mock_text");
    expect(flushed).toBe("");
  });

  it("passes plain text through immediately", () => {
    const stripper = createLeadingThinkTagStripper();
    expect(stripper.push("mock_textChương mock_text")).toBe("mock_textChương mock_text");
    expect(stripper.push("<think>mock_text từmock_text")).toBe("<think>mock_text từmock_text");
    expect(stripper.flush()).toBe("");
  });

  it("returns an unterminated leading block via flush", () => {
    const { emitted, flushed } = pushAll(["<think>mock_text"]);
    expect(emitted).toEqual([]);
    expect(flushed).toBe("<think>mock_text");
  });
});
