export interface SplitChapter {
  readonly title: string;
  readonly content: string;
}

/**
 * Tách một tệp văn bản thành các chương dựa trên dòng tiêu đề.
 *
 * Mẫu mặc định khớp:
 * - "Chương 1 xxxx" / "Chương I xxxx"
 * - "# Chương 1 xxxx" / "## Chương 23 xxxx"
 * - "Chapter 1" / "CHAPTER I." / "CHAPTER II."
 *
 * Mỗi lần khớp đánh dấu đầu một chương mới. Nội dung giữa các lần khớp
 * thuộc về chương trước đó.
 */
export function splitChapters(
  text: string,
  pattern?: string,
): ReadonlyArray<SplitChapter> {
  const defaultPattern = /^#{0,2}\s*(?:Chương\s+(?:\d+|[IVXLCDM]+)(?:\.|:|\s+)?\s*(.*)|Chapter\s+(?:\d+|[IVXLCDM]+)(?:\.|:|\s+)?\s*(.*))/i;
  const regex = pattern ? new RegExp(pattern, "m") : defaultPattern;

  const lines = text.split("\n");
  const chapters: Array<{ title: string; startLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(regex);
    if (match) {
      chapters.push({
        title: (match[1] ?? match[2] ?? "").trim(),
        startLine: i,
      });
    }
  }

  if (chapters.length === 0) {
    return [];
  }

  const result: SplitChapter[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]!;
    const nextStart = i + 1 < chapters.length ? chapters[i + 1]!.startLine : lines.length;

    // Content starts after the title line
    const contentLines = lines.slice(chapter.startLine + 1, nextStart);
    const content = stripTrailingLicense(contentLines.join("\n")).trim();

    result.push({
      title: chapter.title || inferFallbackTitle(lines[chapter.startLine] ?? "", i + 1),
      content,
    });
  }

  return result;
}

function stripTrailingLicense(content: string): string {
  const trailerMatch = content.match(/^\s*Project Gutenberg(?:™|\(TM\))?.*$/im);
  if (!trailerMatch || trailerMatch.index === undefined) {
    return content;
  }

  return content.slice(0, trailerMatch.index).trimEnd();
}

function inferFallbackTitle(headingLine: string, chapterNumber: number): string {
  if (/chapter\s+(?:\d+|[ivxlcdm]+)/i.test(headingLine)) {
    return `Chapter ${chapterNumber}`;
  }

  if (/Chương\s+(?:\d+|[ivxlcdm]+)/i.test(headingLine)) {
    return `Chương ${chapterNumber}`;
  }

  return `Chương ${chapterNumber}`;
}
