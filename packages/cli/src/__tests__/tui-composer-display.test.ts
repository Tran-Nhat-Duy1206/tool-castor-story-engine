import { describe, expect, it } from "vitest";
import { renderComposerDisplay } from "../tui/composer-display.js";

describe("tui composer display", () => {
  it("renders placeholder when empty", () => {
    expect(renderComposerDisplay("", "Ask Castor", false)).toEqual({
      textBeforeCursor: "Ask Castor",
      textAfterCursor: "",
      cursor: "",
      isPlaceholder: true,
    });
  });

  it("keeps the initial caret before the placeholder text", () => {
    expect(renderComposerDisplay("", "Ask Castor", true)).toEqual({
      textBeforeCursor: "",
      textAfterCursor: "Ask Castor",
      cursor: "│",
      isPlaceholder: true,
    });
  });

  it("renders plain input text with a blinking bar cursor when active", () => {
    expect(renderComposerDisplay("continue", "Ask Castor", true)).toEqual({
      textBeforeCursor: "continue",
      textAfterCursor: "",
      cursor: "│",
      isPlaceholder: false,
    });
  });

  it("hides the cursor between blink frames", () => {
    expect(renderComposerDisplay("continue", "Ask Castor", false)).toEqual({
      textBeforeCursor: "continue",
      textAfterCursor: "",
      cursor: "",
      isPlaceholder: false,
    });
  });
});
