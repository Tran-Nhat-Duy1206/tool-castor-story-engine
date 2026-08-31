import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateImageFromPrompt,
  resolveCoverGenerationRequest,
} from "../pipeline/short-fiction-runner.js";

/** Per-type task framing only; visual style must come from the world / visual contract. */
const SHOT_BY_TYPE: Record<string, string> = {
  actor: "Generate an illustration for this character",
  location: "Generate an illustration for this location",
  item: "Generate an illustration for this item",
  evidence: "Generate an illustration for this piece of evidence",
  clue: "Generate an illustration for this clue",
  claim: "Generate an illustration for this claim",
  proof_chain: "Generate an illustration for this proof chain",
  organization: "Generate an illustration for this organization",
};

function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export interface PlayImageWorldContext {
  readonly premise?: string;
  readonly worldContract?: string;
  readonly visualContract?: string;
}

type PlayImageWorldInput = string | PlayImageWorldContext | undefined;

function renderImageWorldContext(input: PlayImageWorldInput): string {
  if (!input) return "";
  if (typeof input === "string") {
    const premise = input.trim();
    return premise ? `World setting (determines the era, scene, and overall art style; must strictly adhere): ${clamp(premise, 600)}` : "";
  }
  const premise = input.premise?.trim();
  const worldContract = input.worldContract?.trim();
  const visualContract = input.visualContract?.trim();
  return [
    premise ? `World setting (determines the era, scene, and overall art style; must strictly adhere): ${clamp(premise, 600)}` : "",
    worldContract ? `World contract (follow only user-defined rules; do not invent RPG/numerical/level systems): ${clamp(worldContract, 700)}` : "",
    visualContract ? `Visual contract (images must convey semantics according to this rule): ${clamp(visualContract, 700)}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Build a style-consistent image prompt for a world entity. The world premise
 * anchors era / setting / art style so every illustration in one run looks like
 * it belongs to the same world.
 */
export function buildPlayEntityImagePrompt(
  entity: { readonly type: string; readonly label: string; readonly summary?: string },
  worldPremise?: PlayImageWorldInput,
): string {
  const worldContext = renderImageWorldContext(worldPremise);
  const subject = SHOT_BY_TYPE[entity.type] ?? "Generate an illustration for this entity";
  const summary = entity.summary?.trim();
  return [
    worldContext,
    subject,
    `Subject: ${entity.label}`,
    summary ? `Details: ${clamp(summary, 400)}` : "",
  ].filter(Boolean).join("\n");
}

/** Build a wide illustration prompt for the current moment from its scene prose. */
export function buildPlaySceneImagePrompt(sceneText: string, worldPremise?: PlayImageWorldInput): string {
  const worldContext = renderImageWorldContext(worldPremise);
  return [
    worldContext,
    "Generate an illustration capturing the action, atmosphere, and emotion of this moment:",
    clamp(sceneText, 900),
  ].filter(Boolean).join("\n");
}

export type PlayImageStatus = "ready" | "failed";

export interface PlayImageEntry {
  readonly status: PlayImageStatus;
  readonly file?: string;
  readonly error?: string;
}

export type PlayImageManifest = Record<string, PlayImageEntry>;

function manifestPath(runDir: string): string {
  return join(runDir, "images", "manifest.json");
}

export async function readPlayImageManifest(runDir: string): Promise<PlayImageManifest> {
  try {
    const raw = await readFile(manifestPath(runDir), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PlayImageManifest) : {};
  } catch {
    return {};
  }
}

export async function writePlayImageManifest(runDir: string, manifest: PlayImageManifest): Promise<void> {
  await mkdir(join(runDir, "images"), { recursive: true });
  await writeFile(manifestPath(runDir), JSON.stringify(manifest, null, 2), "utf-8");
}

/** Immutably set one manifest entry and persist it. Returns the new manifest. */
export async function setPlayImageEntry(
  runDir: string,
  key: string,
  entry: PlayImageEntry,
): Promise<PlayImageManifest> {
  const current = await readPlayImageManifest(runDir);
  const next = { ...current, [key]: entry };
  await writePlayImageManifest(runDir, next);
  return next;
}

/**
 * Per-run auto-illustration toggles. Default all-off: nothing is generated
 * until the user opts in (and the cover API is configured).
 */
export interface PlayImageSettings {
  readonly actors: boolean;
  readonly moments: boolean;
  readonly inventory: boolean;
}

export const DEFAULT_PLAY_IMAGE_SETTINGS: PlayImageSettings = {
  actors: false,
  moments: false,
  inventory: false,
};

function settingsPath(runDir: string): string {
  return join(runDir, "images", "settings.json");
}

export async function readPlayImageSettings(runDir: string): Promise<PlayImageSettings> {
  try {
    const raw = JSON.parse(await readFile(settingsPath(runDir), "utf-8"));
    return {
      actors: Boolean(raw?.actors),
      moments: Boolean(raw?.moments),
      inventory: Boolean(raw?.inventory),
    };
  } catch {
    return DEFAULT_PLAY_IMAGE_SETTINGS;
  }
}

export async function writePlayImageSettings(runDir: string, settings: PlayImageSettings): Promise<void> {
  await mkdir(join(runDir, "images"), { recursive: true });
  await writeFile(settingsPath(runDir), JSON.stringify(settings, null, 2), "utf-8");
}

/** Filesystem-safe leaf name derived from an entity id / scene key. */
export function playImageFileName(key: string, extension: "png" | "jpg"): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "image";
  return `${safe}.${extension}`;
}

/**
 * Generate one image for a Play key (entity id or scene key), write it under
 * run/images/, and record the result in the manifest. Never throws on a
 * generation failure — it records {status:"failed"} so the caller/UI can
 * surface it and retry. Throws only if cover generation is not configured.
 */
export async function generatePlayImage(input: {
  readonly root: string;
  readonly runDir: string;
  readonly key: string;
  readonly prompt: string;
  readonly size?: string;
}): Promise<PlayImageEntry> {
  const request = await resolveCoverGenerationRequest({ root: input.root });
  try {
    const { buffer, extension } = await generateImageFromPrompt(
      request,
      input.prompt,
      input.size ?? "1024x1024",
    );
    const file = playImageFileName(input.key, extension);
    await mkdir(join(input.runDir, "images"), { recursive: true });
    await writeFile(join(input.runDir, "images", file), buffer);
    const entry: PlayImageEntry = { status: "ready", file };
    await setPlayImageEntry(input.runDir, input.key, entry);
    return entry;
  } catch (error) {
    const entry: PlayImageEntry = {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    await setPlayImageEntry(input.runDir, input.key, entry);
    return entry;
  }
}
