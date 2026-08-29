import { Command } from "commander";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { listAvailableGenres, readGenreProfile, getBuiltinGenresDir } from "@actalk/castor-core";
import { findProjectRoot, log, logError } from "../utils.js";
import { resolveCliLanguage, type CliLanguage } from "../localization.js";

export function buildGenreTemplate(
  params: {
    readonly id: string;
    readonly name: string;
    readonly numerical: boolean;
    readonly power: boolean;
    readonly era: boolean;
  },
  language: CliLanguage = "vi",
): string {
  if (language === "en") {
    return `---
name: ${params.name}
id: ${params.id}
chapterTypes: ["progression", "setup", "transition", "payoff"]
fatigueWords: ["shocked", "unbelievable", "incredible"]
numericalSystem: ${params.numerical}
powerScaling: ${params.power}
eraResearch: ${params.era}
pacingRule: "A clear advance or payoff every 2-3 chapters"
satisfactionTypes: ["goal achieved", "obstacle overcome", "truth revealed"]
auditDimensions: [1,2,3,6,7,8,9,10,13,14,15,16,17,18,19]
---

## Genre Taboos

- (add taboos for this genre)

## Narrative Guidance

(describe the narrative focus and style requirements for this genre)
`;
  }

  return `---
name: ${params.name}
id: ${params.id}
chapterTypes: ["chương tiến triển", "chương dựng nền", "chương chuyển tiếp", "chương thu hoạch"]
fatigueWords: ["chấn động", "không thể tin nổi", "khó tin"]
numericalSystem: ${params.numerical}
powerScaling: ${params.power}
eraResearch: ${params.era}
pacingRule: "Mỗi 2-3 chương có một bước tiến triển hoặc thu hoạch rõ ràng"
satisfactionTypes: ["mục tiêu đạt được", "vượt qua khó khăn", "sự thật được hé lộ"]
auditDimensions: [1,2,3,6,7,8,9,10,13,14,15,16,17,18,19]
---

## Cấm kỵ thể loại

- (thêm các cấm kỵ cho thể loại này)

## Hướng dẫn tự sự

(mô tả trọng tâm tự sự và yêu cầu phong cách cho thể loại này)
`;
}

export const genreCommand = new Command("genre")
  .description("Manage genre profiles");

genreCommand
  .command("list")
  .description("List all available genre profiles (built-in + project)")
  .action(async () => {
    try {
      const root = findProjectRoot();
      const genres = await listAvailableGenres(root);

      if (genres.length === 0) {
        log("No genre profiles found.");
        return;
      }

      log("Available genres:\n");
      for (const g of genres) {
        const tag = g.source === "project" ? "[project]" : "[builtin]";
        log(`  ${g.id.padEnd(12)} ${g.name.padEnd(8)} ${tag}`);
      }
      log(`\nTotal: ${genres.length} genre(s)`);
    } catch (e) {
      logError(`Failed to list genres: ${e}`);
      process.exit(1);
    }
  });

genreCommand
  .command("show")
  .description("Display a genre profile")
  .argument("<id>", "Genre ID (e.g. xuanhuan, urban, horror)")
  .action(async (id: string) => {
    try {
      const root = findProjectRoot();
      const genres = await listAvailableGenres(root);
      const exactMatch = genres.some(g => g.id === id);
      if (!exactMatch) {
        logError(`Genre "${id}" not found. Available: ${genres.map(g => g.id).join(", ")}`);
        process.exit(1);
      }
      const { profile, body } = await readGenreProfile(root, id);

      log(`Genre: ${profile.name} (${profile.id})\n`);
      log(`  Chapter types:      ${profile.chapterTypes.join(", ")}`);
      log(`  Fatigue words:      ${profile.fatigueWords.join(", ")}`);
      log(`  Numerical system:   ${profile.numericalSystem}`);
      log(`  Power scaling:      ${profile.powerScaling}`);
      log(`  Era research:       ${profile.eraResearch}`);
      log(`  Pacing rule:        ${profile.pacingRule}`);
      log(`  Satisfaction types: ${profile.satisfactionTypes.join(", ")}`);
      log(`  Audit dimensions:   ${profile.auditDimensions.join(", ")}`);

      if (body) {
        log(`\n--- Body ---\n${body}`);
      }
    } catch (e) {
      logError(`Failed to show genre: ${e}`);
      process.exit(1);
    }
  });

genreCommand
  .command("create")
  .description("Scaffold a new genre profile in the project genres/ directory")
  .argument("<id>", "Genre ID (e.g. scifi, wuxia, romance)")
  .option("--name <name>", "Genre display name", "")
  .option("--numerical", "Enable numerical system", false)
  .option("--power", "Enable power scaling", false)
  .option("--era", "Enable era research", false)
  .option("--lang <language>", "Template language: vi or en (defaults to CASTOR_LOCALE/LANG, then vi)")
  .action(async (id: string, opts) => {
    try {
      const root = findProjectRoot();
      const genresDir = join(root, "genres");
      const filePath = join(genresDir, `${id}.md`);

      // Check if already exists
      try {
        await readFile(filePath, "utf-8");
        logError(`Genre profile already exists: ${filePath}`);
        process.exit(1);
      } catch { /* file doesn't exist, good */ }

      await mkdir(genresDir, { recursive: true });

      const name = opts.name || id;
      const template = buildGenreTemplate(
        {
          id,
          name,
          numerical: opts.numerical,
          power: opts.power,
          era: opts.era,
        },
        resolveCliLanguage(opts.lang),
      );

      await writeFile(filePath, template, "utf-8");
      log(`Created genre profile: ${filePath}`);
      log(`Edit the file to customize chapter types, fatigue words, rules, etc.`);
    } catch (e) {
      logError(`Failed to create genre: ${e}`);
      process.exit(1);
    }
  });

genreCommand
  .command("copy")
  .description("Copy a built-in genre profile to project for customization")
  .argument("<id>", "Genre ID to copy (e.g. xuanhuan)")
  .action(async (id: string) => {
    try {
      const root = findProjectRoot();
      const builtinDir = getBuiltinGenresDir();
      const srcPath = join(builtinDir, `${id}.md`);
      const genresDir = join(root, "genres");
      const destPath = join(genresDir, `${id}.md`);

      // Check if project override already exists
      try {
        await readFile(destPath, "utf-8");
        logError(`Project genre profile already exists: ${destPath}`);
        process.exit(1);
      } catch { /* doesn't exist, good */ }

      let content: string;
      try {
        content = await readFile(srcPath, "utf-8");
      } catch {
        logError(`Built-in genre "${id}" not found. Use 'castor genre list' to see available genres.`);
        process.exit(1);
        return;
      }

      await mkdir(genresDir, { recursive: true });
      await writeFile(destPath, content, "utf-8");
      log(`Copied to: ${destPath}`);
      log(`This project-level copy will override the built-in profile.`);
    } catch (e) {
      logError(`Failed to copy genre: ${e}`);
      process.exit(1);
    }
  });
