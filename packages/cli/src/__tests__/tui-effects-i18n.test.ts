import { describe, expect, it } from "vitest";
import { stripAnsi } from "../tui/ansi.js";
import { buildStyledHelpSections, formatStyledStatusLines, intentToBadge } from "../tui/effects.js";

describe("tui effects i18n", () => {
  it("builds localized help sections", () => {
    const viSections = buildStyledHelpSections("vi-VN");
    const enSections = buildStyledHelpSections("en");

    expect(viSections[0]?.title).toBe("Viết");
    expect(viSections[1]?.commands[0]?.[1]).toContain("liệt kê");
    expect(enSections[0]?.title).toBe("Writing");
  });

  it("localizes intent badges and status labels", () => {
    expect(stripAnsi(intentToBadge("write_next", "vi-VN"))).toContain("VIẾT");

    const viLines = formatStyledStatusLines("vi-VN", {
      mode: "semi",
      bookId: "harbor",
      status: "writing",
      events: [{ kind: "task.started", detail: "Preparing chapter 3.", status: "running" }],
    });

    expect(viLines.join("\n")).toContain("Chế độ");
    expect(viLines.join("\n")).toContain("bán tự động");
    expect(viLines.join("\n")).toContain("Tác phẩm");
  });
});
