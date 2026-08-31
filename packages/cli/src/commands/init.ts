import { Command } from "commander";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { log, logError } from "../utils.js";
import { initializeProjectDirectory } from "../project-bootstrap.js";

export const initCommand = new Command("init")
  .description("Initialize a Castor project (current directory by default)")
  .argument("[name]", "Project name (creates subdirectory). Omit to init current directory.")
  .option("--lang <language>", "Default writing language: vi (Vietnamese) or en (English)", "vi")
  .action(async (name: string | undefined, opts: { lang?: string }) => {
    const projectDir = name ? resolve(process.cwd(), name) : process.cwd();

    try {
      await mkdir(projectDir, { recursive: true });
      await initializeProjectDirectory(projectDir, {
        language: (opts.lang === "en" ? "en" : "vi"),
        overwriteSupportFiles: true,
      });

      log(`Project initialized at ${projectDir}`);
      log("");
      const isEnglish = (opts.lang ?? "vi") === "en";
      const exampleCreateLines = isEnglish
        ? ["  castor book create --title 'My Novel' --genre progression --platform royalroad --lang en"]
        : [
          "  castor book create --title 'Tiểu thuyết của tôi' --genre xuanhuan --platform tomato",
          "  # English project? Re-run with: castor init --lang en",
        ];
      if (global) {
        log("Global LLM config detected. Ready to go!");
        log("");
        log("Next steps:");
        if (name) log(`  cd ${name}`);
        for (const line of exampleCreateLines) log(line);
      } else {
        log("Next steps:");
        if (name) log(`  cd ${name}`);
        log("  # Option 1: Set global config (recommended, one-time):");
        log("  castor config set-global --provider openai --base-url <your-api-url> --api-key <your-key> --model <your-model>");
        log("  # Option 2: Edit .env for this project only");
        log("");
        for (const line of exampleCreateLines) log(line);
      }
      log("  castor write next <book-id>");
    } catch (e) {
      logError(`Failed to initialize project: ${e}`);
      process.exit(1);
    }
  });
