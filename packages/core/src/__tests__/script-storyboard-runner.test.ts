import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runInteractiveFilmCreation,
  runScriptCreation,
  runStoryboardCreation,
  type StoryboardAssetsManifest,
} from "../pipeline/script-storyboard-runner.js";
import type { AgentContext } from "../agents/base.js";
import { loadStoryGraph } from "../interactive-film/graph-store.js";
import { PartialResponseError } from "../llm/provider.js";

const chatCompletionMock = vi.hoisted(() => vi.fn());
const generateStoryGraphMock = vi.hoisted(() => vi.fn());

vi.mock("../llm/provider.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../llm/provider.js")>(),
  chatCompletion: chatCompletionMock,
}));

vi.mock("../interactive-film/generate.js", () => ({
  generateStoryGraph: generateStoryGraphMock,
}));

describe("storyboard creation runner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-storyboard-assets-"));
    chatCompletionMock.mockReset();
    generateStoryGraphMock.mockReset();
    generateStoryGraphMock.mockImplementation((
      _client: unknown,
      _model: string,
      input: { projectId: string; title: string },
      options?: { language?: "vi" | "en" },
    ) => {
      const en = options?.language === "en";
      return Promise.resolve({
        schemaVersion: 1,
        projectId: input.projectId,
        title: input.title,
        variables: [],
        nodes: [
          {
            id: "start",
            title: en ? "Opening" : "Mo dau",
            type: "start",
            sceneDesc: en ? "The choice begins." : "Quyet dinhmock_text。",
            dialogue: [],
            choices: [{ id: "c1", text: en ? "Proceed" : "mock_text", targetNodeId: "branch-1", effects: [] }],
          },
          {
            id: "branch-1",
            title: en ? "First Choice" : "Chương mock_text",
            type: "branch",
            sceneDesc: en ? "Evidence surfaces." : "mock_text。",
            dialogue: [],
            choices: [
              { id: "c2", text: en ? "Reveal" : "Cong khai", targetNodeId: "branch-2", effects: [] },
              { id: "c3", text: en ? "Hide" : "Giau giem", targetNodeId: "ending-secret", effects: [] },
            ],
          },
          {
            id: "branch-2",
            title: en ? "Final Choice" : "mock_text",
            type: "branch",
            sceneDesc: en ? "The truth demands a cost." : "Su thatmock_text。",
            dialogue: [],
            choices: [{ id: "c4", text: en ? "Publish" : "mock_text", targetNodeId: "ending-good", effects: [] }],
          },
          { id: "ending-good", title: en ? "Truth" : "Su that", type: "ending", sceneDesc: "", dialogue: [], choices: [] },
          { id: "ending-secret", title: en ? "Silence" : "mock_text", type: "ending", sceneDesc: "", dialogue: [], choices: [] },
        ],
        endings: [
          { id: "good", nodeId: "ending-good", title: en ? "Truth" : "Su that", type: "good", description: "" },
          { id: "secret", nodeId: "ending-secret", title: en ? "Silence" : "mock_text", type: "secret", description: "" },
        ],
      });
    });
    chatCompletionMock.mockResolvedValue({
      content: [
        "# mock_text mock_text",
        "",
        "## mock_text",
        "mock_text 1：mock_text。",
        "mock_text 2：mock_text。",
        "",
        "## mock_text",
        "1. Prompt: mock_text，mock_text，mock_text，9:16",
        "2. Prompt: mock_text，mock_text",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a first-class image asset manifest and asset directories", async () => {
    const result = await runStoryboardCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "mock_text",
      instruction: "mock_text。",
      projectId: "cold-ledger",
      visualStyle: "mock_text",
      aspectRatio: "9:16",
    });

    expect(result.assetsManifestPath).toBe("storyboards/cold-ledger/assets.json");
    expect(result.assetsDir).toBe("storyboards/cold-ledger/assets");
    expect((await stat(join(root, "storyboards/cold-ledger/assets/source"))).isDirectory()).toBe(true);
    expect((await stat(join(root, "storyboards/cold-ledger/assets/generated"))).isDirectory()).toBe(true);
    expect((await stat(join(root, "storyboards/cold-ledger/assets/selected"))).isDirectory()).toBe(true);

    const manifest = JSON.parse(
      await readFile(join(root, result.assetsManifestPath), "utf-8"),
    ) as StoryboardAssetsManifest;
    expect(manifest.kind).toBe("storyboard_assets");
    expect(manifest.storyboardPath).toBe(result.storyboardPath);
    expect(manifest.imagePromptsPath).toBe(result.imagePromptsPath);
    expect(manifest.assets.map((asset) => [asset.shotId, asset.prompt])).toEqual([
      ["shot-001", "mock_text，mock_text，mock_text，9:16"],
      ["shot-002", "mock_text，mock_text"],
    ]);
  });

  it("applies storyboard-specific Skill guidance without reusing the long-writing Skill", async () => {
    const runtime = makeRuntime(root, [{
      skill: {
        id: "castor-storyboard",
        name: "Storyboard creation",
        description: "Visual shot design.",
        body: "Translate narrative beats into visible shots.",
        source: "builtin",
      },
      resources: [],
    }]);

    await runStoryboardCreation({
      projectRoot: root,
      runtime,
      title: "mock_text",
      instruction: "mock_text。",
      projectId: "cold-ledger-skilled",
    });

    const messages = chatCompletionMock.mock.calls[0]?.[2] as ReadonlyArray<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("castor-storyboard");
    expect(messages[0]?.content).toContain("Translate narrative beats into visible shots.");
    expect(messages[0]?.content).not.toContain("castor-long-writing");
  });

  it("continues a script after a confirmed model output limit before committing it", async () => {
    chatCompletionMock.mockReset();
    chatCompletionMock.mockRejectedValueOnce(new PartialResponseError(
      "# mock_text\n\n## mock_text\n\nmock_text。mock_text。\nmock_text。",
      new Error("model reached the output limit (length)"),
      "output-limit",
    ));
    chatCompletionMock.mockResolvedValueOnce({
      content: "mock_text。\nmock_text。\n\n【mock_text】",
      usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# mock_text",
        "",
        "## mock_text",
        "- mock_text",
        "- mock_text",
        "",
        "## mock_text",
        "mock_text。mock_text。",
        "mock_text。",
        "mock_text。",
        "",
        "【mock_text】",
      ].join("\n"),
      usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 },
    });

    const result = await runScriptCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "mock_text",
      instruction: "mock_text。",
      projectId: "missing-on-camera",
      episodeCount: 1,
    });

    expect(chatCompletionMock).toHaveBeenCalledTimes(3);
    const continuationMessages = chatCompletionMock.mock.calls[1]?.[2] as ReadonlyArray<{
      role: string;
      content: string;
    }>;
    expect(continuationMessages.at(-2)).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("mock_text。mock_text。"),
    });
    expect(continuationMessages.at(-1)?.content).toContain("mock_text");
    const recoveryMessages = chatCompletionMock.mock.calls[2]?.[2] as ReadonlyArray<{
      role: string;
      content: string;
    }>;
    expect(recoveryMessages[0]?.content).toContain("mock_text");

    const script = await readFile(join(root, result.scriptPath), "utf-8");
    expect(script).toContain("mock_text。mock_text。");
    expect(script).toContain("mock_text");
    expect(script.match(/mock_text。/gu)).toHaveLength(1);
    const status = JSON.parse(await readFile(join(root, "dramas/missing-on-camera/status.json"), "utf-8"));
    expect(status.status).toBe("complete");
  });

  it("does not commit a script with repeated deliverable sections", async () => {
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# mock_text",
        "## mock_text",
        "mock_text",
        "## mock_text",
        "Chương mock_text。",
        "# mock_text",
        "## mock_text",
        "mock_text",
        "## mock_text",
        "Chương mock_text。",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await expect(runScriptCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "mock_text",
      instruction: "mock_text。",
      projectId: "duplicate-script",
    })).rejects.toThrow("mock_text");
    await expect(access(join(root, "dramas/duplicate-script/status.json"))).rejects.toThrow();
  });

  it("does not publish a completed run when the model returns another confirmation instead of a script", async () => {
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# mock_textChương mock_text",
        "",
        "mock_text：",
        "- A. mock_text",
        "- B. mock_text",
        "",
        "mock_text từmock_text，mock_text。",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await expect(runScriptCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "mock_textChương mock_text",
      instruction: "mock_text。",
      projectId: "third-knock",
    })).rejects.toThrow("mock_text `## mock_text`");

    await expect(stat(join(root, "dramas/third-knock/script.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(root, "dramas/third-knock/status.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("generates large episodic storyboards in complete structural segments", async () => {
    chatCompletionMock.mockReset();
    for (const episode of [1, 2, 3]) {
      chatCompletionMock.mockResolvedValueOnce({
        content: [
          `# mock_text Chương ${episode}mock_text`,
          "",
          "## mock_text",
          `mock_text ${episode}：Chương ${episode}mock_text。`,
          "",
          "## mock_text",
          `Prompt: Chương ${episode}mock_text，9:16`,
        ].join("\n"),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    }

    const result = await runStoryboardCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "mock_text",
      instruction: "mock_text 81 mock_text；Chương 1mock_text 28 mock_text、Chương 2mock_text 27 mock_text、Chương 3mock_text 26 mock_text。",
      requirements: "mock_text。",
      sourceText: [
        "# mock_text",
        "",
        "### Chương 1mock_text《mock_text》",
        "Chương mock_text。",
        "",
        "### Chương 2mock_text《mock_text》",
        "Chương mock_text。",
        "",
        "### Chương 3mock_text《mock_text》",
        "Chương mock_text。",
      ].join("\n"),
      maxShots: 81,
      projectId: "storm-eye-storyboard",
    });

    expect(chatCompletionMock).toHaveBeenCalledTimes(3);
    for (const [index, call] of chatCompletionMock.mock.calls.entries()) {
      const messages = call[2] as ReadonlyArray<{ role: string; content: string }>;
      const prompt = messages[1]!.content;
      expect(prompt).toContain(`Chương ${index + 1}mock_text`);
      expect(prompt).toContain("mock_text 81 mock_text");
      expect(prompt).toContain(`（${index + 1}/3）`);
      if (index > 0) expect(prompt).not.toContain("Chương mock_text");
      if (index < 2) expect(prompt).not.toContain("Chương mock_text");
    }

    const storyboard = await readFile(join(root, result.storyboardPath), "utf-8");
    expect(storyboard).toContain("Chương 1mock_text");
    expect(storyboard).toContain("Chương 2mock_text");
    expect(storyboard).toContain("Chương 3mock_text");
    const manifest = JSON.parse(
      await readFile(join(root, result.assetsManifestPath), "utf-8"),
    ) as StoryboardAssetsManifest;
    expect(manifest.assets).toHaveLength(3);
  });

  it("subdivides oversized episodes by explicit Markdown scene structure without dropping source", async () => {
    chatCompletionMock.mockReset();
    for (const segment of ["mock_text", "mock_text", "mock_text", "mock_text", "mock_text", "mock_text"]) {
      chatCompletionMock.mockResolvedValueOnce({
        content: `## mock_text\n${segment}\n\n## mock_text\nPrompt: ${segment}mock_text`,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    }
    const sourceText = [
      "# mock_text",
      "### Chương 1mock_text《mock_text》",
      "**mock_text1：mock_text／mock_text／mock_text**",
      "Chương mock_text。",
      "**mock_text2：mock_text／mock_text／mock_text**",
      "Chương mock_text。",
      "**mock_text**",
      "Chương mock_text。",
      "### Chương 2mock_text《mock_text》",
      "**mock_text1：mock_text／mock_text／mock_text**",
      "Chương mock_text。",
      "**mock_text2：mock_text／mock_text／mock_text**",
      "Chương mock_text。",
      "**mock_text**",
      "Chương mock_text。",
    ].join("\n");

    await runStoryboardCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "mock_text",
      instruction: "mock_text 60 mock_text，mock_text。",
      sourceText,
      maxShots: 60,
      projectId: "storm-eye-scenes",
    });

    expect(chatCompletionMock).toHaveBeenCalledTimes(6);
    const prompts = chatCompletionMock.mock.calls.map((call) =>
      (call[2] as ReadonlyArray<{ content: string }>)[1]!.content);
    expect(prompts[0]).toContain("Chương mock_text");
    expect(prompts[0]).not.toContain("Chương mock_text");
    expect(prompts[2]).toContain("Chương mock_text");
    expect(prompts[3]).toContain("Chương mock_text");
    expect(prompts[5]).toContain("Chương mock_text");
    expect(prompts.join("\n")).toContain("mock_text");
    for (const call of chatCompletionMock.mock.calls) {
      expect(call[3]).toMatchObject({ maxTokens: 18_000 });
    }
  });

  it("writes interactive-film story tree, flags, script, storyboard, prompts, and image assets", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# mock_text mock_text",
        "",
        "## mock_text（mock_text+mock_text）",
        "- N1 mock_textKiem tra so sach -> mock_text A Cong khaimock_text / mock_text B mock_text",
        "",
        "## mock_text",
        "| mock_text | mock_text | mock_text |",
        "| --- | --- | --- |",
        "| trust_guard | mock_text | mock_text |",
        "",
        "## mock_text",
        "- Su thatCong khaimock_text：trust_guard + ledger_public",
        "",
        "## mock_text（Chương 1mock_text）",
        "### mock_text N1",
        "mock_text：Cong khaimock_text / mock_text",
        "",
        "## mock_text（mock_text）",
        "mock_text 1：mock_text。",
        "**Prompt for C01**: mock_text，mock_text，mock_text，mock_text，16:9",
        "mock_text 2：mock_textCong dien。",
        "Prompt: mock_text，mock_text，mock_text，mock_text，16:9",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: JSON.stringify({
        schemaVersion: 1,
        projectId: "shengshi-ledger",
        title: "mock_text",
        variables: [
          { name: "trust_guard", type: "relationship", default: 0, desc: "mock_text" },
        ],
        nodes: [
          {
            id: "start",
            title: "mock_textKiem tra so sach",
            type: "start",
            sceneDesc: "mock_text。",
            dialogue: [],
            choices: [{ id: "c1", text: "Cong khaimock_text", targetNodeId: "branch-1", effects: [] }],
          },
          {
            id: "branch-1",
            title: "mock_text",
            type: "branch",
            sceneDesc: "mock_textCong dien。",
            dialogue: [],
            choices: [
              { id: "c2", text: "mock_text", targetNodeId: "ending-good", effects: [{ var: "trust_guard", op: "add", value: 1 }] },
              { id: "c3", text: "mock_text", targetNodeId: "ending-secret", effects: [] },
            ],
          },
          {
            id: "branch-2",
            title: "mock_text",
            type: "branch",
            sceneDesc: "mock_text。",
            dialogue: [],
            choices: [{ id: "c4", text: "mock_text", targetNodeId: "ending-good", effects: [] }],
          },
          { id: "ending-good", title: "Su thatCong khai", type: "ending", sceneDesc: "Su thatCong khai。", dialogue: [], choices: [] },
          { id: "ending-secret", title: "mock_text", type: "ending", sceneDesc: "mock_text。", dialogue: [], choices: [] },
        ],
        endings: [
          { id: "good", nodeId: "ending-good", title: "Su thatCong khai", type: "good", description: "mock_textCong khai。" },
          { id: "secret", nodeId: "ending-secret", title: "mock_text", type: "secret", description: "mock_text。" },
        ],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const result = await runInteractiveFilmCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "mock_text",
      instruction: "mock_text。",
      projectId: "shengshi-ledger",
      outDir: "interactive-films/shengshi-ledger",
      budget: "5000mock_text",
      referenceMode: "mock_text",
    });

    expect(result.baseDir).toBe("interactive-films/shengshi-ledger");
    expect(result).toMatchObject({
      storyGraphPath: "interactive-films/shengshi-ledger/story-graph.json",
    });
    await expect(readFile(join(root, result.specPath), "utf-8")).resolves.toContain("mock_text");
    await expect(readFile(join(root, result.storyTreePath), "utf-8")).resolves.toContain("N1 mock_textKiem tra so sach");
    await expect(readFile(join(root, result.flagsPath), "utf-8")).resolves.toContain("trust_guard");
    await expect(readFile(join(root, result.scriptPath), "utf-8")).resolves.toContain("mock_text N1");
    await expect(readFile(join(root, result.storyboardPath), "utf-8")).resolves.toContain("mock_text 1");
    await expect(readFile(join(root, result.imagePromptsPath), "utf-8")).resolves.toContain("mock_text");

    const manifest = JSON.parse(
      await readFile(join(root, result.assetsManifestPath), "utf-8"),
    ) as StoryboardAssetsManifest;
    expect(manifest.assets.map((asset) => asset.prompt)).toEqual([
      "mock_text，mock_text，mock_text，mock_text，16:9",
      "mock_text，mock_text，mock_text，mock_text，16:9",
    ]);

    const graph = await loadStoryGraph(root, "shengshi-ledger");
    expect(graph).not.toBeNull();
    if (!graph) throw new Error("Expected generated story graph");
    expect(graph.title).toBe("mock_text");
    expect(graph.nodes.some((node) => node.type === "start")).toBe(true);
  });

  it("runs storyboard creation in English with English prompts and parses English section headings", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Cold Ledger Storyboard",
        "",
        "## Storyboard",
        "Shot 1: The cashier pushes open the cold-storage door.",
        "Shot 2: A flashlight beam sweeps across the old ledger pages.",
        "",
        "## Image Prompts",
        "1. Prompt: cold-storage doorway, female cashier pushing the door, desaturated realism, 9:16",
        "2. Prompt: close-up of an old ledger page, flashlight beam, oppressive mood",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const result = await runStoryboardCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "Cold Ledger",
      instruction: "Break the novel excerpt into a storyboard.",
      projectId: "cold-ledger-en",
      visualStyle: "desaturated realism",
      aspectRatio: "9:16",
      language: "en",
    });

    const [, , messages] = chatCompletionMock.mock.calls[0]!;
    const system = messages[0].content as string;
    const user = messages[1].content as string;
    expect(system).toContain("storyboard-creation tool");
    expect(system).not.toMatch(/\u4e00-\u9fff/);
    expect(user).toContain("## Storyboard Spec");
    expect(user).toContain("## Image Prompts");
    expect(user).not.toMatch(/\u4e00-\u9fff/);

    await expect(readFile(join(root, result.specPath), "utf-8")).resolves.toContain(
      "# Cold Ledger Storyboard Creation Spec",
    );
    const manifest = JSON.parse(
      await readFile(join(root, result.assetsManifestPath), "utf-8"),
    ) as StoryboardAssetsManifest;
    expect(manifest.assets.map((asset) => [asset.shotId, asset.prompt])).toEqual([
      ["shot-001", "cold-storage doorway, female cashier pushing the door, desaturated realism, 9:16"],
      ["shot-002", "close-up of an old ledger page, flashlight beam, oppressive mood"],
    ]);
  });

  it("runs interactive-film creation in English and splits the package by English headings", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Crown Feast Interactive Film Package",
        "",
        "## Story Tree",
        "- N1 The banquet hall -> choice A reveal the letter / choice B hide the letter",
        "",
        "## Variables and Flags",
        "| Variable | Meaning | Trigger |",
        "| --- | --- | --- |",
        "| trust_guard | Guard's trust | Hand over the evidence |",
        "",
        "## Ending Paths",
        "- Truth ending: trust_guard + letter_public",
        "",
        "## Interactive Script",
        "### Node N1",
        "Player choice: reveal the letter / hide the letter",
        "",
        "## Storyboard and Image Prompts",
        "Shot 1: The envoy unfolds the letter by candlelight.",
        "Prompt: medieval banquet hall, envoy holding a letter, candlelight, cinematic, 16:9",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: "I cannot produce JSON, but I can summarize the plot.",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const result = await runInteractiveFilmCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "Crown Feast",
      instruction: "Build a multi-ending interactive film.",
      projectId: "crown-feast",
      language: "en",
    });

    const [, , messages] = chatCompletionMock.mock.calls[0]!;
    const system = messages[0].content as string;
    const user = messages[1].content as string;
    expect(system).toContain("interactive-film creation tool");
    expect(system).not.toMatch(/\u4e00-\u9fff/);
    expect(user).toContain("## Story Tree");
    expect(user).toContain("## Variables and Flags");
    expect(user).toContain("## Interactive Script");
    expect(user).toContain("## Storyboard and Image Prompts");
    expect(user).not.toMatch(/\u4e00-\u9fff/);

    await expect(readFile(join(root, result.specPath), "utf-8")).resolves.toContain(
      "Interactive Film Creation Spec",
    );
    const storyTree = await readFile(join(root, result.storyTreePath), "utf-8");
    expect(storyTree).toContain("N1 The banquet hall");
    expect(storyTree).not.toContain("trust_guard");
    await expect(readFile(join(root, result.flagsPath), "utf-8")).resolves.toContain("trust_guard");
    await expect(readFile(join(root, result.scriptPath), "utf-8")).resolves.toContain("Node N1");
    await expect(readFile(join(root, result.storyboardPath), "utf-8")).resolves.toContain("Shot 1");
    await expect(readFile(join(root, result.imagePromptsPath), "utf-8")).resolves.toContain(
      "medieval banquet hall",
    );

    const graph = await loadStoryGraph(root, "crown-feast");
    expect(graph).not.toBeNull();
    if (!graph) throw new Error("Expected fallback story graph");
    expect(graph.title).toBe("Crown Feast");
    expect(JSON.stringify(graph)).not.toMatch(/\u4e00-\u9fff/);
    expect(graph.nodes.find((node) => node.id === "start")?.title).toBe("Opening");
  });

  it("fails clearly when the structured story graph worker cannot submit a graph", async () => {
    generateStoryGraphMock.mockRejectedValueOnce(new Error("model did not submit a graph"));
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# mock_text mock_text",
        "",
        "## mock_text",
        "- Mo dau：mock_text。",
        "- mock_text：mock_text / mock_text。",
        "",
        "## mock_text",
        "- echo_trust：mock_text",
        "",
        "## mock_text",
        "### Mo dau",
        "mock_text：mock_text / mock_text",
        "",
        "## mock_text",
        "Prompt: mock_text，mock_text，mock_text，16:9",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: "mock_text JSON，mock_text。",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await expect(runInteractiveFilmCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "mock_text",
      instruction: "mock_text。",
      projectId: "echo-theater",
      episodeCount: 3,
    })).rejects.toThrow("model did not submit a graph");
    await expect(loadStoryGraph(root, "echo-theater")).resolves.toBeNull();
  });
});

function makeRuntime(root: string, activatedSkills?: AgentContext["activatedSkills"]): AgentContext {
  return {
    projectRoot: root,
    model: "test-model",
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.5,
        maxTokens: 4096,
        thinkingBudget: 0,
        extra: {},
      },
    },
    activatedSkills,
  };
}
