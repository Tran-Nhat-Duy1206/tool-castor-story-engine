import type { CliLanguage } from "../localization.js";

const SLASH_COMMAND_VARIANTS: ReadonlyArray<{ vi: string; en: string }> = [
  { vi: "/new mô tả ý tưởng của bạn", en: "/new describe your idea" },
  { vi: "/short mô tả hướng truyện ngắn", en: "/short describe the short" },
  { vi: "/play [open|guided] mô tả màn mở đầu thế giới tương tác", en: "/play [open|guided] describe the opening" },
  { vi: "/cover mô tả hướng bìa truyện", en: "/cover describe the cover" },
  { vi: "/write", en: "/write" },
  { vi: "/confirm", en: "/confirm" },
  { vi: "/cancel", en: "/cancel" },
  { vi: "/model <model>", en: "/model <model>" },
  { vi: "/help", en: "/help" },
  { vi: "/status", en: "/status" },
  { vi: "/clear", en: "/clear" },
  { vi: "/depth <light|normal|deep>", en: "/depth <light|normal|deep>" },
  { vi: "/quit", en: "/quit" },
  { vi: "/exit", en: "/exit" },
];

export function buildSlashCommands(language: CliLanguage = "vi"): readonly string[] {
  return SLASH_COMMAND_VARIANTS.map((variant) => (language === "en" ? variant.en : variant.vi));
}

export const SLASH_COMMANDS = buildSlashCommands("vi");

export type SlashNavigationDirection = "up" | "down";

export function getSlashSuggestions(input: string, commands: readonly string[]): string[] {
  const value = input.trim();
  if (!value.startsWith("/")) {
    return [];
  }

  return commands.filter((command) => slashCommandStem(command).startsWith(value));
}

export function getNextSlashSelection(
  currentIndex: number,
  suggestionCount: number,
  direction: SlashNavigationDirection,
): number {
  if (suggestionCount <= 0) {
    return 0;
  }

  if (direction === "down") {
    return (currentIndex + 1) % suggestionCount;
  }

  return (currentIndex - 1 + suggestionCount) % suggestionCount;
}

export function applySlashSuggestion(
  _input: string,
  suggestions: readonly string[],
  selectedIndex: number,
): string {
  const suggestion = suggestions[selectedIndex] ?? "";
  return slashSuggestionInsertion(suggestion);
}

function slashCommandStem(command: string): string {
  return command.match(/^\/\S+/)?.[0] ?? command;
}

function slashSuggestionInsertion(suggestion: string): string {
  const stem = slashCommandStem(suggestion);
  return suggestion === stem ? stem : `${stem} `;
}
