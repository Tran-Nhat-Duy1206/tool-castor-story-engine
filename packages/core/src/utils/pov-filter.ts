/**
 * POV-aware context filtering.
 *
 * Filters truth file content based on the current POV character's
 * information boundaries. Characters should only "see" information
 * they've actually witnessed or been told about.
 *
 * Works with markdown-based truth files (no DB dependency).
 * When MemoryDB is available, can do more precise queries.
 */

// Core narrative engine processing.
export function extractPOVFromOutline(volumeOutline: string, chapterNumber: number): string | null {
  // Find the section for this chapter
  const lines = volumeOutline.split("\n");

  // Look for chapter reference near the chapter number
  const chapterPatterns = [
    new RegExp(`(?:Chương|Chapter)\\s*${chapterNumber}\\b`, "i"),
    new RegExp(`^#{1,3}\\s*${chapterNumber}\\b`),
  ];

  let inChapterSection = false;
  for (const line of lines) {
    // Check if we're in the right chapter section
    if (chapterPatterns.some((p) => p.test(line))) {
      inChapterSection = true;
    } else if (inChapterSection && /^[#-]/.test(line) && !line.includes(String(chapterNumber))) {
      // Left the chapter section
      break;
    }

    if (inChapterSection) {
      // Look for POV declaration
      const povMatch = line.match(/(?:POV|Góc nhìn|Goc nhin|pov)[：:\s]+([^\s,;]+)/i);
      if (povMatch) return povMatch[1]!;
    }
  }

  return null;
}

/**
 * Filter character_matrix information boundaries for the POV character.
 * Returns only what the POV character knows — strips other characters' "known info".
 */
export function filterMatrixByPOV(characterMatrix: string, povCharacter: string): string {
  if (!characterMatrix || characterMatrix.includes("not created yet") || characterMatrix.includes("chưa tạo")) return characterMatrix;
  if (!povCharacter) return characterMatrix;

  // Find the Ranh giới thông tin / Information Boundaries section
  const sections = characterMatrix.split(/(?=^###)/m);
  const filtered = sections.map((section) => {
    const isInfoBoundary = /Ranh giới thông tin|Information\s+Boundar|Info\s+Boundary/i.test(section);
    if (!isInfoBoundary) return section;

    // In the info boundary table, keep only the POV character's row
    // and add a note about what other characters know
    const lines = section.split("\n");
    const headerLines = lines.filter((l) =>
      l.startsWith("|") && (l.includes("---") || l.includes("Nhân vật") || l.includes("Character") || l.includes("Đã biết") || l.includes("Known")),
    );
    const dataLines = lines.filter((l) =>
      l.startsWith("|") && !l.includes("---") && !l.includes("Nhân vật") && !l.includes("Character") && !l.includes("Đã biết") && !l.includes("Known"),
    );

    // Keep POV character's row + a summary note
    const povRows = dataLines.filter((l) => l.includes(povCharacter));
    const otherCharCount = dataLines.length - povRows.length;

    const sectionHeader = lines.find((l) => l.startsWith("###"));
    const result = [
      sectionHeader ?? "### Information Boundaries",
      `([POV: ${povCharacter} - ${otherCharCount} other character info boundaries hidden])`,
      ...headerLines,
      ...povRows,
    ];

    return result.join("\n");
  });

  return filtered.join("\n");
}

/**
 * Filter pending_hooks by POV character's knowledge.
 * Hooks planted in scenes where the POV character was NOT present are hidden.
 *
 * This is a heuristic: if the hook's chapter summary mentions the POV character,
 * they likely know about it.
 */
export function filterHooksByPOV(
  hooks: string,
  povCharacter: string,
  chapterSummaries: string,
): string {
  if (!hooks || hooks === "(file not created yet)") return hooks;
  if (!povCharacter) return hooks;

  const lines = hooks.split("\n");
  const headerLines = lines.filter((l) =>
    l.startsWith("|") && (l.includes("hook_id") || l.includes("---")),
  );
  const dataLines = lines.filter((l) =>
    l.startsWith("|") && !l.includes("hook_id") && !l.includes("---"),
  );

  // Parse summary rows to find which chapters the POV character appeared in
  const povChapters = new Set<number>();
  if (chapterSummaries) {
    for (const line of chapterSummaries.split("\n")) {
      if (line.includes(povCharacter)) {
        const match = line.match(/\|\s*(\d+)\s*\|/);
        if (match) povChapters.add(parseInt(match[1]!, 10));
      }
    }
  }

  // Keep hooks where:
  // 1. The POV character was present in the source chapter, OR
  // 2. The hook mentions the POV character directly, OR
  // 3. We can't determine (keep to be safe)
  const filtered = dataLines.filter((row) => {
    // If hook directly mentions POV character, keep it
    if (row.includes(povCharacter)) return true;

    // Extract source chapter from hook row
    const chapterMatch = row.match(/\|\s*(\d+)\s*\|/);
    if (!chapterMatch) return true; // can't determine, keep

    const sourceChapter = parseInt(chapterMatch[1]!, 10);
    // If POV was in that chapter, they know about the hook
    if (povChapters.has(sourceChapter)) return true;

    // POV wasn't in that chapter — hide this hook
    return false;
  });

  // Fallback: if filtering removes everything, return original
  if (filtered.length === 0 && dataLines.length > 0) return hooks;

  const nonTableLines = lines.filter((l) => !l.startsWith("|"));
  return [...nonTableLines, ...headerLines, ...filtered].join("\n");
}
