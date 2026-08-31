import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPlayEntityImagePrompt,
  buildPlaySceneImagePrompt,
  readPlayImageManifest,
  setPlayImageEntry,
  playImageFileName,
  readPlayImageSettings,
  writePlayImageSettings,
  DEFAULT_PLAY_IMAGE_SETTINGS,
} from "../play/play-image.js";

describe("play image prompts", () => {
  it("frames an actor as an entity image and anchors it to the world premise without forcing a style", () => {
    const prompt = buildPlayEntityImagePrompt(
      { type: "actor", label: "Lin Shen", summary: "mock_text，mock_text" },
      "mock_text：mock_text，mock_text。",
    );
    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("Lin Shen");
    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text");
    expect(prompt).not.toContain("mock_text");
    expect(prompt).not.toContain("mock_text từ");
    expect(prompt).not.toContain("mock_text");
    expect(prompt).not.toContain("mock_text");
  });

  it("frames an item without assuming a neutral-background still", () => {
    const prompt = buildPlayEntityImagePrompt({ type: "item", label: "mock_text" });
    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text");
    expect(prompt).not.toContain("mock_text");
  });

  it("falls back to a generic concept frame for unknown entity types", () => {
    const prompt = buildPlayEntityImagePrompt({ type: "rule", label: "mock_text" });
    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text");
  });

  it("builds a moment prompt from scene prose without forcing cinematic wide framing", () => {
    const prompt = buildPlaySceneImagePrompt("mock_text，mock_text，mock_text。", "mock_text");
    expect(prompt).toContain("mock_text");
    expect(prompt).not.toContain("mock_text");
    expect(prompt).not.toContain("mock_text");
  });

  it("includes user-defined world and visual contracts without assuming RPG tiers", () => {
    const prompt = buildPlayEntityImagePrompt(
      { type: "item", label: "mock_text", summary: "mock_text。" },
      {
        premise: "mock_text。",
        worldContract: "mock_text，mock_text、mock_text RPG mock_text。",
        visualContract: "mock_text、mock_text、mock_text，mock_text。",
      } as any,
    );

    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text");
  });

  it("clamps overly long premises/summaries so prompts stay bounded", () => {
    const long = "mock_text".repeat(2000);
    const prompt = buildPlayEntityImagePrompt({ type: "actor", label: "X", summary: long }, long);
    expect(prompt.length).toBeLessThan(1600);
    expect(prompt).toContain("…");
  });
});

describe("play image manifest", () => {
  let runDir: string;
  beforeEach(async () => { runDir = await mkdtemp(join(tmpdir(), "castor-playimg-")); });
  afterEach(async () => { await rm(runDir, { recursive: true, force: true }); });

  it("returns {} for a run with no manifest yet", async () => {
    expect(await readPlayImageManifest(runDir)).toEqual({});
  });

  it("round-trips an entry and merges without dropping existing keys", async () => {
    await setPlayImageEntry(runDir, "actor-1", { status: "ready", file: "actor-1.png" });
    await setPlayImageEntry(runDir, "item-2", { status: "failed", error: "503" });
    const manifest = await readPlayImageManifest(runDir);
    expect(manifest["actor-1"]).toEqual({ status: "ready", file: "actor-1.png" });
    expect(manifest["item-2"]).toEqual({ status: "failed", error: "503" });
    // persisted to disk as JSON
    const raw = JSON.parse(await readFile(join(runDir, "images", "manifest.json"), "utf-8"));
    expect(Object.keys(raw)).toHaveLength(2);
  });
});

describe("play image settings", () => {
  let runDir: string;
  beforeEach(async () => { runDir = await mkdtemp(join(tmpdir(), "castor-playset-")); });
  afterEach(async () => { await rm(runDir, { recursive: true, force: true }); });

  it("defaults to all-off when no settings file exists", async () => {
    expect(await readPlayImageSettings(runDir)).toEqual(DEFAULT_PLAY_IMAGE_SETTINGS);
    expect(DEFAULT_PLAY_IMAGE_SETTINGS).toEqual({ actors: false, moments: false, inventory: false });
  });

  it("round-trips toggles and coerces to booleans", async () => {
    await writePlayImageSettings(runDir, { actors: true, moments: false, inventory: true });
    expect(await readPlayImageSettings(runDir)).toEqual({ actors: true, moments: false, inventory: true });
  });
});

describe("playImageFileName", () => {
  it("sanitizes ids into safe leaf names with the right extension", () => {
    expect(playImageFileName("actor-1", "png")).toBe("actor-1.png");
    expect(playImageFileName("scene/turn:3 mock_text", "jpg")).toBe("scene_turn_3___.jpg");
  });

  it("never produces an empty name", () => {
    expect(playImageFileName("！！！", "png")).toBe("___.png");
  });
});
