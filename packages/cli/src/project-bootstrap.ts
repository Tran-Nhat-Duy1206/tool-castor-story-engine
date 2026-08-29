import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { GLOBAL_ENV_PATH, resolveGlobalEnvPath } from "./utils.js";

export interface ProjectBootstrapOptions {
  readonly language?: "zh" | "en";
  readonly overwriteSupportFiles?: boolean;
}

async function hasGlobalConfig(): Promise<boolean> {
  try {
    const content = await readFile(await resolveGlobalEnvPath(), "utf-8");
    // A migrated legacy env keeps its original castor_* key names; both count.
    const hasKey = content.includes("CASTOR_LLM_API_KEY=") || content.includes("castor_LLM_API_KEY=");
    return hasKey && !content.includes("your-api-key-here");
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeMaybe(path: string, content: string, overwrite: boolean): Promise<void> {
  if (!overwrite && await exists(path)) {
    return;
  }
  await writeFile(path, content, "utf-8");
}

const DEFAULT_GITIGNORE_ENTRIES = [".env", "node_modules/", ".DS_Store"] as const;

export async function ensureProjectGitignore(projectDir: string): Promise<void> {
  const path = join(projectDir, ".gitignore");
  let existing = "";
  if (await exists(path)) {
    existing = await readFile(path, "utf-8");
  }

  const existingEntries = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  const missing = DEFAULT_GITIGNORE_ENTRIES.filter((entry) => !existingEntries.has(entry));
  if (missing.length === 0) return;

  if (!existing) {
    await writeFile(path, `${missing.join("\n")}\n`, "utf-8");
    return;
  }

  const separator = existing.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${existing}${separator}${missing.join("\n")}\n`, "utf-8");
}

function buildProjectConfig(projectDir: string, language: "zh" | "en") {
  return {
    name: basename(projectDir),
    version: "0.1.0" as const,
    language,
    llm: {
      provider: "openai" as const,
      service: "custom",
      configSource: "studio" as const,
      baseUrl: "",
      model: "",
      apiFormat: "chat" as const,
      stream: true,
    },
    notify: [],
    daemon: {
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * * *",
      },
      maxConcurrentBooks: 3,
    },
  };
}

function buildProjectEnvTemplate(globalConfigured: boolean): string {
  if (globalConfigured) {
    return [
      "# Project-level LLM overrides (optional)",
      "# Global config at ~/.castor/.env will be used by default.",
      "# Switch Studio to 'Use Studio config' (dùng cấu hình Studio) if you want per-project service settings.",
      "# Uncomment below to override for this project only:",
      "# CASTOR_LLM_PROVIDER=openai",
      "# CASTOR_LLM_BASE_URL=",
      "# CASTOR_LLM_API_KEY=",
      "# CASTOR_LLM_MODEL=",
      "",
      "# Web search (optional):",
      "# TAVILY_API_KEY=tvly-xxxxx",
      "",
    ].join("\n");
  }

  return [
    "# Optional project-level LLM overrides",
    "# Studio can manage provider / model / key without editing this file.",
    "# Uncomment only if you want this directory to force env-based config:",
    "# CASTOR_LLM_PROVIDER=openai",
    "# CASTOR_LLM_BASE_URL=",
    "# CASTOR_LLM_API_KEY=",
    "# CASTOR_LLM_MODEL=",
    "# CASTOR_LLM_API_FORMAT=chat",
    "# CASTOR_LLM_STREAM=true",
    "",
    "# Web search (optional):",
    "# TAVILY_API_KEY=tvly-xxxxx",
    "",
  ].join("\n");
}

export async function initializeProjectDirectory(
  projectDir: string,
  options: ProjectBootstrapOptions = {},
): Promise<void> {
  const language = options.language ?? "zh";
  const overwriteSupportFiles = options.overwriteSupportFiles ?? true;
  const configPath = join(projectDir, "castor.json");

  if (await exists(configPath)) {
    throw new Error(`castor.json already exists in ${projectDir}. Use a different directory or delete the existing project.`);
  }
  // A legacy-only project must not be silently shadowed by a fresh default
  // config: migrating through the normal load path is the supported route.
  if (await exists(join(projectDir, "castor.json"))) {
    throw new Error(`Legacy castor.json found in ${projectDir}. Run any castor command once to migrate it to castor.json, or delete the legacy file first.`);
  }

  await mkdir(projectDir, { recursive: true });
  await mkdir(join(projectDir, "books"), { recursive: true });
  await mkdir(join(projectDir, "radar"), { recursive: true });

  await writeFile(
    configPath,
    JSON.stringify(buildProjectConfig(projectDir, language), null, 2),
    "utf-8",
  );

  const globalConfigured = await hasGlobalConfig();

  await Promise.all([
    writeMaybe(join(projectDir, ".env"), buildProjectEnvTemplate(globalConfigured), overwriteSupportFiles),
    ensureProjectGitignore(projectDir),
    writeMaybe(join(projectDir, ".nvmrc"), "22\n", overwriteSupportFiles),
    writeMaybe(join(projectDir, ".node-version"), "22\n", overwriteSupportFiles),
  ]);
}

export async function ensureProjectDirectoryInitialized(
  projectDir: string,
  options: Omit<ProjectBootstrapOptions, "overwriteSupportFiles"> = {},
): Promise<boolean> {
  const { hasProjectConfigFile } = await import("@actalk/castor-core");
  if (await hasProjectConfigFile(projectDir)) {
    return false;
  }

  await initializeProjectDirectory(projectDir, {
    language: options.language,
    overwriteSupportFiles: false,
  });
  return true;
}
