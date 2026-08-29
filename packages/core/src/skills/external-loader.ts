import { readFile, readdir, stat } from "node:fs/promises";
import { castorEnv } from "../utils/llm-env.js";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import yaml from "js-yaml";
import {
  AgentSkillSchema,
  type AgentSkill,
} from "./types.js";

const MAX_SKILL_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_NAME_CHARS = 64;
const MAX_SKILL_DESCRIPTION_CHARS = 1024;

export interface LoadExternalAgentSkillsInput {
  readonly externalDirs: ReadonlyArray<string>;
  readonly source?: AgentSkill["source"];
}

export interface ExternalSkillDiagnostic {
  readonly path: string;
  readonly message: string;
}

export interface LoadExternalAgentSkillsResult {
  readonly skills: ReadonlyArray<AgentSkill>;
  readonly diagnostics: ReadonlyArray<ExternalSkillDiagnostic>;
}

export interface LoadConfiguredAgentSkillsInput {
  readonly projectRoot: string;
  readonly env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  readonly homeDir?: string;
}

export interface ParseAgentSkillDocumentOptions {
  readonly skillPath: string;
  readonly source?: AgentSkill["source"];
}

export async function loadExternalAgentSkills(
  input: LoadExternalAgentSkillsInput,
): Promise<LoadExternalAgentSkillsResult> {
  const skillDirs = await discoverSkillDirs(input.externalDirs);
  const skills: AgentSkill[] = [];
  const diagnostics: ExternalSkillDiagnostic[] = [];

  for (const dir of skillDirs) {
    const skillPath = join(dir, "SKILL.md");
    try {
      skills.push(await loadSkillManifest(skillPath, input.source));
    } catch (error) {
      diagnostics.push({
        path: skillPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { skills, diagnostics };
}

export async function loadConfiguredAgentSkills(
  input: LoadConfiguredAgentSkillsInput,
): Promise<LoadExternalAgentSkillsResult> {
  const candidates = configuredSkillDirs(input);
  const skills: AgentSkill[] = [];
  const diagnostics: ExternalSkillDiagnostic[] = [];

  for (const candidate of candidates) {
    try {
      const result = await loadExternalAgentSkills({
        externalDirs: [candidate.path],
        source: candidate.source,
      });
      skills.push(...result.skills);
      diagnostics.push(...result.diagnostics);
    } catch (error) {
      if (!candidate.explicit && isMissingPathError(error)) continue;
      diagnostics.push({
        path: candidate.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { skills, diagnostics };
}

interface ConfiguredSkillDir {
  readonly path: string;
  readonly explicit: boolean;
  readonly source: AgentSkill["source"];
}

function configuredSkillDirs(input: LoadConfiguredAgentSkillsInput): ConfiguredSkillDir[] {
  const env = input.env ?? process.env;
  const envDirs = (castorEnv("CASTOR_SKILL_DIRS", env) ?? "")
    .split(delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const homeDir = input.homeDir ?? homedir();
  return [
    ...envDirs.map((path) => ({ path, explicit: true, source: "external" as const })),
    { path: join(homeDir, ".openclaw", "skills"), explicit: false, source: "user" },
    { path: join(homeDir, ".agents", "skills"), explicit: false, source: "user" },
    { path: join(input.projectRoot, ".agents", "skills"), explicit: false, source: "project" },
    { path: join(input.projectRoot, "skills"), explicit: false, source: "project" },
  ];
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

async function discoverSkillDirs(externalDirs: ReadonlyArray<string>): Promise<string[]> {
  const dirs: string[] = [];
  for (const dir of externalDirs) {
    if (!isAbsolute(dir)) {
      throw new Error(`External skill directory must be absolute: ${dir}`);
    }
    const info = await stat(dir);
    if (!info.isDirectory()) {
      throw new Error(`External skill path is not a directory: ${dir}`);
    }
    if (await hasSkillManifest(dir)) {
      dirs.push(dir);
      continue;
    }
    dirs.push(...await discoverSkillDirsBelow(dir, 2));
  }
  return [...new Set(dirs)].sort();
}

async function discoverSkillDirsBelow(root: string, remainingDepth: number): Promise<string[]> {
  if (remainingDepth <= 0) return [];
  const dirs: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = join(root, entry.name);
    if (await hasSkillManifest(child)) {
      dirs.push(child);
      continue;
    }
    dirs.push(...await discoverSkillDirsBelow(child, remainingDepth - 1));
  }
  return dirs;
}

async function hasSkillManifest(dir: string): Promise<boolean> {
  try {
    const info = await stat(join(dir, "SKILL.md"));
    return info.isFile();
  } catch {
    return false;
  }
}

async function loadSkillManifest(
  skillPath: string,
  source: AgentSkill["source"] = "external",
): Promise<AgentSkill> {
  const info = await stat(skillPath);
  if (info.size > MAX_SKILL_MANIFEST_BYTES) {
    throw new Error(`SKILL.md exceeds ${MAX_SKILL_MANIFEST_BYTES} bytes.`);
  }
  const raw = await readFile(skillPath, "utf-8");
  return parseAgentSkillDocument(raw, { skillPath, source });
}

export function parseAgentSkillDocument(
  raw: string,
  options: ParseAgentSkillDocumentOptions,
): AgentSkill {
  const parsed = parseFrontmatter(raw);
  if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    throw new Error("SKILL.md frontmatter must be a YAML object.");
  }
  const data = parsed.data as Record<string, unknown>;
  const fallbackId = basename(dirname(options.skillPath));
  const name = requiredText(data.name, "name", MAX_SKILL_NAME_CHARS);
  const description = requiredText(
    data.description,
    "description",
    MAX_SKILL_DESCRIPTION_CHARS,
  );
  const id = normalizeExternalSkillId(name, fallbackId);
  return AgentSkillSchema.parse({
    id,
    name,
    description,
    body: parsed.body.trim(),
    source: options.source ?? "external",
    baseDir: dirname(options.skillPath),
  });
}

function parseFrontmatter(raw: string): { readonly data: unknown; readonly body: string } {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("SKILL.md must start with YAML frontmatter delimiters.");
  }
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) {
    throw new Error("SKILL.md is missing closing YAML frontmatter delimiter.");
  }
  const frontmatter = normalized.slice(4, end).trim();
  const body = normalized.slice(end + "\n---".length).replace(/^\r?\n/, "");
  return {
    data: yaml.load(frontmatter),
    body,
  };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredText(value: unknown, field: string, maxChars?: number): string {
  const text = optionalText(value);
  if (!text) throw new Error(`SKILL.md frontmatter requires ${field}.`);
  if (maxChars !== undefined && text.length > maxChars) {
    throw new Error(`SKILL.md frontmatter ${field} must be at most ${maxChars} characters.`);
  }
  return text;
}

function normalizeExternalSkillId(value: string, fallback: string): string {
  const normalize = (candidate: string): string => candidate
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const id = normalize(value) || normalize(fallback);
  if (!id) throw new Error("SKILL.md requires a name that can be used as a skill id.");
  const normalized = /^[a-z]/.test(id) ? id : `skill-${id}`;
  if (normalized.length > MAX_SKILL_NAME_CHARS) {
    throw new Error(`SKILL.md skill id must be at most ${MAX_SKILL_NAME_CHARS} characters.`);
  }
  return normalized;
}
