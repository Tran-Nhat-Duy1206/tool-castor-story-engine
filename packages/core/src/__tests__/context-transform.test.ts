import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createBookContextTransform,
  createInteractiveFilmContextTransform,
} from "../agent/context-transform.js";
import { saveStoryGraph } from "../interactive-film/graph-store.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";

describe("createBookContextTransform", () => {
  let projectRoot: string;
  const bookId = "test-book";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "ctx-test-"));
    const storyDir = join(projectRoot, "books", bookId, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "story_bible.md"), "# Story Bible\nA hero's journey.");
    await writeFile(join(storyDir, "current_focus.md"), "Focus on chapter 3.");
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("returns messages unchanged when bookId is null", async () => {
    const transform = createBookContextTransform(null, projectRoot);
    const messages = [
      { role: "user" as const, content: "hello", timestamp: Date.now() },
    ];
    const result = await transform(messages);
    expect(result).toBe(messages);
  });

  it("prepends a user message with truth file contents", async () => {
    const transform = createBookContextTransform(bookId, projectRoot);
    const original = [
      { role: "user" as const, content: "mock_text", timestamp: Date.now() },
    ];
    const result = await transform(original);

    expect(original).toHaveLength(1);
    expect(result).toHaveLength(2);
    const injected = result[0] as { role: string; content: string };
    expect(injected.role).toBe("user");
    expect(injected.content).toContain("story_bible.md");
    expect(injected.content).toContain("A hero's journey.");
    expect(injected.content).toContain("current_focus.md");
    expect(injected.content).toContain("Focus on chapter 3.");
    expect(result[1]).toBe(original[0]);
  });

  it("indexes large truth files structurally instead of selecting semantic keyword rows", async () => {
    const storyDir = join(projectRoot, "books", bookId, "story");
    await writeFile(
      join(storyDir, "story_bible.md"),
      [
        "# Story Bible",
        "## mock_text",
        "| mock_text | mock_text |",
        "| active | mock_text |",
        "UNBOUNDED_BODY_SHOULD_NOT_BE_INJECTED ".repeat(500),
      ].join("\n"),
    );

    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "mock_text", timestamp: Date.now() },
    ]);
    const content = (result[0] as { content: string }).content;

    expect(content).toContain("mock_text");
    expect(content).toContain("story_bible.md");
    expect(content).toContain("## mock_text");
    expect(content).toContain("Markdown mock_text");
    expect(content).not.toContain("| active | mock_text |");
    expect(content).toContain("mock_text");
    expect(content).not.toContain("UNBOUNDED_BODY_SHOULD_NOT_BE_INJECTED");
  });

  it("emits session context compression lifecycle events when compacting truth files", async () => {
    const storyDir = join(projectRoot, "books", bookId, "story");
    await writeFile(
      join(storyDir, "story_bible.md"),
      [
        "# Story Bible",
        "## mock_text",
        "mock_text：mock_text。",
        "UNBOUNDED_BODY_SHOULD_NOT_BE_INJECTED ".repeat(500),
      ].join("\n"),
    );
    const events: Array<{ readonly category: string; readonly phase: string; readonly sources?: readonly string[] }> = [];

    const transform = createBookContextTransform(bookId, projectRoot, {
      onContextCompression: (event) => events.push(event),
    });
    await transform([
      { role: "user" as const, content: "mock_text", timestamp: Date.now() },
    ]);

    expect(events.map((event) => [event.category, event.phase])).toEqual([
      ["session_context", "start"],
      ["session_context", "end"],
    ]);
    expect(events[0].sources).toContain("story_bible.md");
  });

  it("sorts truth files in priority order", async () => {
    const storyDir = join(projectRoot, "books", bookId, "story");
    await writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline");
    await writeFile(join(storyDir, "book_rules.md"), "# Book Rules");
    await writeFile(join(storyDir, "extra_notes.md"), "# Extra");

    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "test", timestamp: Date.now() },
    ]);
    const content = (result[0] as { content: string }).content;

    const bibleIdx = content.indexOf("story_bible.md");
    const outlineIdx = content.indexOf("volume_outline.md");
    const rulesIdx = content.indexOf("book_rules.md");
    const focusIdx = content.indexOf("current_focus.md");
    const extraIdx = content.indexOf("extra_notes.md");

    expect(bibleIdx).toBeLessThan(outlineIdx);
    expect(outlineIdx).toBeLessThan(rulesIdx);
    expect(rulesIdx).toBeLessThan(focusIdx);
    expect(focusIdx).toBeLessThan(extraIdx);
  });

  it("returns original messages when story/ directory does not exist", async () => {
    const transform = createBookContextTransform("nonexistent-book", projectRoot);
    const original = [
      { role: "user" as const, content: "test", timestamp: Date.now() },
    ];
    const result = await transform(original);
    expect(result).toBe(original);
  });

  it("injects upgrade hint when book is legacy layout (no outline/story_frame.md)", async () => {
    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "mock_text", timestamp: Date.now() },
    ]);

    const injected = result[0] as { role: string; content: string };
    expect(injected.content).toContain("mock_text");
    expect(injected.content).toContain("sub_agent(architect, { revise: true");
  });

  it("does NOT inject upgrade hint when book is Phase 5 layout", async () => {
    const outlineDir = join(projectRoot, "books", bookId, "story", "outline");
    await mkdir(outlineDir, { recursive: true });
    await writeFile(join(outlineDir, "story_frame.md"), "## mock_text\nmock_text");

    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "mock_text", timestamp: Date.now() },
    ]);

    const injected = result[0] as { role: string; content: string };
    expect(injected.content).not.toContain("mock_text");
    expect(injected.content).not.toContain("revise: true");
  });

  it("injects authoritative new-layout outline files into active-book chat context", async () => {
    const outlineDir = join(projectRoot, "books", bookId, "story", "outline");
    await mkdir(outlineDir, { recursive: true });
    await writeFile(join(outlineDir, "story_frame.md"), "## mock_text\nmock_textChương mock_text。");
    await writeFile(join(outlineDir, "volume_map.md"), "## Chương mock_text\nmock_text。");

    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "mock_textChương mock_text", timestamp: Date.now() },
    ]);

    const injected = result[0] as { role: string; content: string };
    expect(injected.content).toContain("outline/story_frame.md");
    expect(injected.content).toContain("mock_textChương mock_text。");
    expect(injected.content).toContain("outline/volume_map.md");
    expect(injected.content).toContain("mock_text。");
  });
});

describe("createInteractiveFilmContextTransform", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "film-ctx-test-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("injects the complete authoritative graph and refreshes it from disk every turn", async () => {
    const base = StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: "storm-radio",
      title: "mock_text",
      variables: [{ name: "mock_text", type: "flag", default: false }],
      nodes: [
        {
          id: "node_1",
          type: "branch",
          title: "Cong khaimock_text",
          choices: [{ id: "choice_signal", text: "mock_text", targetNodeId: "node_6" }],
        },
        { id: "node_6", type: "ending", title: "mock_text", choices: [] },
      ],
      endings: [{ id: "ending_c", nodeId: "node_6", title: "mock_text", type: "secret" }],
    });
    await saveStoryGraph(projectRoot, "storm-radio", base);

    const transform = createInteractiveFilmContextTransform("storm-radio", projectRoot);
    const original = [{ role: "user" as const, content: "mock_text1", timestamp: Date.now() }];
    const first = await transform(original);
    const firstContext = (first[0] as { content: string }).content;

    expect(firstContext).toContain("mock_text");
    expect(firstContext).toContain('"id":"node_1"');
    expect(firstContext).toContain('"targetNodeId":"node_6"');
    expect(firstContext).toContain('"name":"mock_text"');
    expect(firstContext).not.toContain("mock_text");
    expect(first[1]).toBe(original[0]);

    await saveStoryGraph(projectRoot, "storm-radio", StoryGraphSchema.parse({
      ...base,
      nodes: base.nodes.map((node) => node.id === "node_1"
        ? { ...node, title: "mock_text" }
        : node),
    }));
    const second = await transform(original);
    expect((second[0] as { content: string }).content).toContain('"title":"mock_text"');
  });

  it("leaves messages unchanged before a graph has been created", async () => {
    const transform = createInteractiveFilmContextTransform("missing-film", projectRoot);
    const original = [{ role: "user" as const, content: "hello", timestamp: Date.now() }];
    expect(await transform(original)).toBe(original);
  });
});
