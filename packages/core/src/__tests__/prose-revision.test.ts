import { describe, expect, it } from "vitest";
import {
  computeProseRevision,
  evidenceQuoteVerified,
  normalizeForEvidenceMatch,
} from "../utils/prose-revision.js";

describe("computeProseRevision", () => {
  it("is deterministic for the exact same string", () => {
    const content = "# Chương 1 mock_text\n\nmock_text。";
    expect(computeProseRevision(content)).toBe(computeProseRevision(content));
  });

  it("emits exactly sixteen lowercase hex characters", () => {
    expect(computeProseRevision("# Chapter 1\n\nText")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is sensitive to a trailing newline", () => {
    expect(computeProseRevision("# Chapter 1\n\nText")).not.toBe(
      computeProseRevision("# Chapter 1\n\nText\n"),
    );
  });

  it("is sensitive to internal double whitespace", () => {
    expect(computeProseRevision("a b")).not.toBe(computeProseRevision("a  b"));
  });

  it("distinguishes two distinct Chinese strings", () => {
    expect(computeProseRevision("mock_text")).not.toBe(
      computeProseRevision("mock_text"),
    );
  });

  it("distinguishes two distinct Vietnamese strings", () => {
    expect(computeProseRevision("Cô ấy mở cánh cửa")).not.toBe(
      computeProseRevision("Cô ấy đóng cánh cửa lại"),
    );
  });

  it("does NOT NFC-normalize: composed and decomposed forms hash differently", () => {
    // Revision hashes EXACT durable bytes — visually identical, byte-different.
    expect(computeProseRevision("Café")).not.toBe(computeProseRevision("Cafe\u0301"));
  });
});

describe("normalizeForEvidenceMatch", () => {
  it("collapses tabs, newlines and multiple spaces into one space", () => {
    expect(normalizeForEvidenceMatch("a\t\tb\nc\r\nd  e")).toBe("a b c d e");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeForEvidenceMatch("   padded text\t")).toBe("padded text");
  });

  it("lowercases English text", () => {
    expect(normalizeForEvidenceMatch("The Door")).toBe("the door");
  });

  it("makes NFC-composed and decomposed forms normalize identically", () => {
    // Evidence matching is tolerance-aware: NFC first so equivalent text matches.
    expect(normalizeForEvidenceMatch("Café")).toBe(normalizeForEvidenceMatch("Cafe\u0301"));
  });

  it("keeps punctuation significant", () => {
    expect(normalizeForEvidenceMatch("mock_text，mock_text。")).toBe("mock_text，mock_text。");
    expect(normalizeForEvidenceMatch("mock_text，mock_text。")).not.toBe("mock_text");
    expect(normalizeForEvidenceMatch("Stop!")).not.toBe("Stop");
  });

  it("lowercases but does not strip accents or fold beyond NFC", () => {
    expect(normalizeForEvidenceMatch("CAFÉ")).toBe("café");
  });
});

describe("evidenceQuoteVerified", () => {
  const PROSE = [
    "mock_text。",
    "mock_text，mock_text。",
    "The old door groaned open in the wind.",
  ].join("\n");

  it("verifies an exact contained CJK sentence", () => {
    expect(evidenceQuoteVerified("mock_text，mock_text。", PROSE)).toBe(true);
  });

  it("matches English despite case differences", () => {
    expect(evidenceQuoteVerified("THE OLD DOOR groaned OPEN", PROSE)).toBe(true);
  });

  it("collapses newlines and runs of whitespace between quote and prose", () => {
    expect(evidenceQuoteVerified("mock_text。\nmock_text", PROSE)).toBe(true);
    expect(evidenceQuoteVerified("door   groaned\topen", PROSE)).toBe(true);
  });

  it("does NOT invent away CJK-internal spaces", () => {
    expect(evidenceQuoteVerified("mock_text mock_text mock_text", "mock_text，mock_text。")).toBe(false);
  });

  it("verifies a true contiguous CJK substring", () => {
    expect(evidenceQuoteVerified("mock_text", PROSE)).toBe(true);
  });

  it("fails when punctuation differs materially", () => {
    expect(evidenceQuoteVerified("mock_text。", PROSE)).toBe(false);
    expect(evidenceQuoteVerified("The old door groaned open?", PROSE)).toBe(false);
  });

  it("matches NFC-decomposed prose for a composed quote", () => {
    const decomposedProse = "He ordered a Cafe\u0301 at the counter.";
    expect(evidenceQuoteVerified("Café", decomposedProse)).toBe(true);
  });

  it("fails closed for an empty quote", () => {
    expect(evidenceQuoteVerified("", PROSE)).toBe(false);
  });

  it("fails closed for a whitespace-only quote", () => {
    expect(evidenceQuoteVerified("   \n\t ", PROSE)).toBe(false);
  });

  it("returns false when the quote simply is not present", () => {
    expect(evidenceQuoteVerified("mock_text", PROSE)).toBe(false);
  });
});
