import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PlayActionInterpreterAgent,
  PlaySceneReconcilerAgent,
  PlaySceneRendererAgent,
  PlayWorldMutatorAgent,
  buildSceneRendererSystemPrompt,
} from "../play/play-agents.js";
import { PlayMutationSchema } from "../models/play.js";

const ctx = {
  client: { provider: "openai" } as never,
  model: "test-model",
  projectRoot: "/tmp/castor-play-test",
};

describe("play agents", () => {
  it("interprets free user text into a bounded play action", async () => {
    const agent = new PlayActionInterpreterAgent(ctx);
    vi.spyOn(agent as unknown as { chat: PlayActionInterpreterAgent["chat"] }, "chat").mockResolvedValue({
      content: JSON.stringify({
        actionKind: "look",
        targetEntityLabel: "mock_text",
        intent: "mock_text",
        manner: "mock_text",
      }),
    } as never);

    await expect(agent.interpret({
      input: "mock_text，mock_text",
      sceneBrief: "mock_text，mock_text。",
    })).resolves.toMatchObject({
      actionKind: "look",
      targetEntityLabel: "mock_text",
      intent: "mock_text",
    });
  });

  it("keeps host-owned turn metadata authoritative when mutator output drifts", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockResolvedValue({});

    const mutation = await agent.proposeMutation({
      turn: 1,
      input: "mock_text",
      action: { actionKind: "look", intent: "mock_text" },
      context: "mock_text。",
    });
    expect(mutation.actionKind).toBe("look");
    expect(mutation.eventId).toBe("evt-1");
    expect(mutation.turn).toBe(1);
    expect(mutation.entities.upsert).toEqual([]);
  });

  it("repairs an empty mutator response instead of treating it as a completed state transition", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured")
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        summary: "mock_text。",
        entities: [{
          id: "actor_child",
          type: "actor",
          label: "mock_text",
          summary: "mock_text，mock_text。",
        }],
      });

    const mutation = await agent.proposeMutation({
      turn: 4,
      input: "mock_text",
      action: { actionKind: "say", intent: "mock_text" },
      context: "actor_mother mock_text actor_child mock_text；mock_text。",
      language: "vi",
    });

    expect(submit).toHaveBeenCalledTimes(2);
    expect(mutation).toMatchObject({
      eventId: "evt-4",
      turn: 4,
      actionKind: "say",
      blocked: false,
    });
    expect(mutation.entities.upsert[0]?.label).toBe("mock_text");
  });

  it("returns a visible blocked no-op when mutator repair still has no state result", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({});

    const mutation = await agent.proposeMutation({
      turn: 3,
      input: "mock_text",
      action: { actionKind: "say", intent: "mock_text" },
      context: "mock_text。",
      language: "vi",
    });

    expect(submit).toHaveBeenCalledTimes(2);
    expect(mutation).toMatchObject({
      eventId: "evt-3",
      turn: 3,
      actionKind: "say",
      blocked: true,
    });
    expect(mutation.blockedReason).toContain("mock_text");
  });

  it("uses the structured result schema without embedding example story data", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "Test" });

    await agent.proposeMutation({
      turn: 1,
      input: "mock_text",
      action: { actionKind: "say", intent: "mock_text" },
      context: "mock_text：actor_afu [actor]: mock_text",
      language: "vi",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).not.toContain("Zhou Ye");
    expect(system).not.toContain("Phong so sachmock_text");
    expect(system).not.toContain("mock_text");
    expect(system).not.toContain("mock_text");
    expect(system).not.toContain("actor_counterpart");
    expect(system).toContain("submit_world_mutation");
  });

  it("treats actor_player as the reserved player id in the Chinese mutator prompt", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "Test" });

    await agent.proposeMutation({
      turn: 1,
      input: "mock_text",
      action: { actionKind: "look", intent: "mock_text" },
      context: "mock_text：actor_player [actor]: mock_text",
      language: "vi",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("actor_player");
    expect(system).toContain("mock_text từ");
    expect(system).toContain("mock_text");
  });

  it("treats actor_player as the reserved player id in the English mutator prompt", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "test" });

    await agent.proposeMutation({
      turn: 1,
      input: "I check the ticket in my bag.",
      action: { actionKind: "look", intent: "check the ticket" },
      context: "Entity roster: actor_player [actor]: night mechanic",
      language: "en",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("The player entity id is fixed");
    expect(system).toContain("actor_player");
    expect(system).toContain("Never rename this id");
  });

  it("does not default to numeric meters when the world contract rejects panels or stats", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "Test" });

    await agent.proposeMutation({
      turn: 1,
      input: "mock_text，mock_text。",
      action: { actionKind: "wait", intent: "mock_text" },
      context: [
        "mock_text（mock_text，mock_text）：",
        "mock_text RPG、mock_text、mock_text。mock_text，mock_text。",
      ].join("\n"),
      language: "vi",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("mock_text");
    expect(system).toContain("mock_text stateSlots");
    expect(system).toContain("mock_text");
  });

  it("loads project Play prompt-pack overrides into the mutator system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-prompt-"));
    try {
      await mkdir(join(root, "prompt", "play"), { recursive: true });
      await writeFile(join(root, "prompt", "play", "mutator.md"), "PROJECT MUTATOR OVERRIDE: honor lantern rarity by atmosphere.");
      const agent = new PlayWorldMutatorAgent({ ...ctx, projectRoot: root });
      const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "Test" });

      await agent.proposeMutation({
        turn: 1,
        input: "mock_text",
        action: { actionKind: "look", intent: "mock_text" },
        context: "mock_text：mock_text。",
        language: "vi",
      });

      const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
      const system = messages.find((message) => message.role === "system")?.content ?? "";
      expect(system).toContain("Prompt Pack Guidance");
      expect(system).toContain("PROJECT MUTATOR OVERRIDE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps beat-writing methodology out of the mutator protocol prompt", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "Test" });

    await agent.proposeMutation({
      turn: 1,
      input: "mock_text",
      action: { actionKind: "do", intent: "mock_text" },
      context: "mock_text：mock_text，mock_text。",
      language: "vi",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).not.toContain("mock_text");
    expect(system).not.toContain("mock_text");
    expect(system).toContain("submit_world_mutation");
  });

  it("renderer treats player negation and applied time as canonical", async () => {
    const prompt = buildSceneRendererSystemPrompt("open", "vi");
    expect(prompt).toContain("elapsed mock_text anchor mock_text");
    expect(prompt).toContain("mock_text");
  });

  it("leaves scene-writing methodology to the Play Skill", () => {
    const prompt = buildSceneRendererSystemPrompt("open", "vi");
    expect(prompt).not.toContain("mock_text");
    expect(prompt).not.toContain("mock_text");
    expect(prompt).toContain("suggestedActions");
  });

  it("renders from the authoritative pre-action context plus applied state", async () => {
    const agent = new PlaySceneRendererAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({
      sceneText: "mock_text，mock_text từ。",
      suggestedActions: ["mock_text", "mock_textXu Jinanmock_text"],
    });

    await expect(agent.render({
      input: "mock_text",
      action: { actionKind: "look", intent: "mock_text" },
      mutationSummary: "mock_text 187 mock_text。",
      stateBrief: "mock_text：mock_text=seen。",
      context: "mock_text：actor_husband [actor]: mock_text。\nmock_text：mock_text。",
    })).resolves.toMatchObject({
      sceneText: expect.stringContaining("mock_text"),
      suggestedActions: ["mock_text", "mock_textXu Jinanmock_text"],
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    expect(user).toContain("mock_text");
    expect(user).toContain("actor_husband [actor]: mock_text");
    expect(submit.mock.calls[0]?.[1]).toMatchObject({ name: "submit_play_scene" });
  });

  it("loads project Play prompt-pack overrides into the renderer system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "castor-play-renderer-prompt-"));
    try {
      await mkdir(join(root, "prompt", "play"), { recursive: true });
      await writeFile(join(root, "prompt", "play", "renderer.md"), "PROJECT RENDERER OVERRIDE: render romance props through distance and touch.");
      const agent = new PlaySceneRendererAgent({ ...ctx, projectRoot: root });
      const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({
        sceneText: "mock_text。",
        suggestedActions: [],
      });

      await agent.render({
        input: "mock_text",
        action: { actionKind: "look", intent: "mock_text" },
        mutationSummary: "mock_text。",
        stateBrief: "mock_text：mock_text。",
      });

      const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
      const system = messages.find((message) => message.role === "system")?.content ?? "";
      expect(system).toContain("Prompt Pack Guidance");
      expect(system).toContain("PROJECT RENDERER OVERRIDE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renderer rejects missing structured scene output instead of inventing a placeholder", async () => {
    const agent = new PlaySceneRendererAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockRejectedValue(new Error("Model did not submit_play_scene"));
    await expect(agent.render({
      input: "mock_text",
      action: { actionKind: "look", intent: "mock_text" },
      mutationSummary: "",
      stateBrief: "",
    })).rejects.toThrow("submit_play_scene");
  });

  it("renderer rejects an empty structured scene instead of committing fake prose", async () => {
    const agent = new PlaySceneRendererAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ sceneText: "", suggestedActions: [] });
    await expect(agent.render({
      input: "mock_text",
      action: { actionKind: "move", intent: "mock_text" },
      mutationSummary: "",
      stateBrief: "",
    })).rejects.toThrow();
  });

  it("reconciler extracts supplemental graph facts from rendered prose", async () => {
    const agent = new PlaySceneReconcilerAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockResolvedValue({
      summary: "mock_textUmock_text。",
      entities: [{ id: "item_black_usb", type: "item", label: "mock_textUmock_text", status: "mock_text" }],
    });

    const mutation = PlayMutationSchema.parse(await agent.reconcile({
      turn: 2,
      input: "mock_text",
      action: { actionKind: "look", intent: "mock_text" },
      mutation: { eventId: "evt-2", turn: 2, actionKind: "look", summary: "mock_text。" },
      sceneText: "mock_textUmock_text。",
      context: "mock_text：actor_player [actor]: mock_text",
      stateBrief: "# Play State\n- summary: mock_text。\n",
      language: "vi",
    }));

    expect(mutation.entities.upsert[0]?.label).toBe("mock_textUmock_text");
  });

  it("keeps reconciler event metadata host-owned", async () => {
    const agent = new PlaySceneReconcilerAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ summary: "mock_text。" });

    const mutation = PlayMutationSchema.parse(await agent.reconcile({
      turn: 4,
      input: "mock_text",
      action: { actionKind: "say", intent: "mock_text" },
      mutation: { eventId: "evt-4", turn: 4, actionKind: "say", summary: "mock_text。" },
      sceneText: "mock_text。",
      context: "actor_mother mock_text actor_child mock_text。",
      stateBrief: "# Play State\n- summary: mock_text。\n",
      language: "vi",
    }));

    expect(mutation).toMatchObject({ eventId: "evt-4", turn: 4, actionKind: "say" });
  });

  it("reconciler fails open to an empty supplement on malformed output", async () => {
    const agent = new PlaySceneReconcilerAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockRejectedValue(new Error("model did not submit tool"));

    const mutation = PlayMutationSchema.parse(await agent.reconcile({
      turn: 2,
      input: "mock_text",
      action: { actionKind: "look", intent: "mock_text" },
      mutation: { eventId: "evt-2", turn: 2, actionKind: "look", summary: "mock_text。" },
      sceneText: "mock_text。",
      context: "mock_text：actor_player [actor]: mock_text",
      stateBrief: "# Play State\n- summary: mock_text。\n",
      language: "vi",
    }));

    expect(mutation.entities.upsert).toEqual([]);
    expect(mutation.edges.upsert).toEqual([]);
  });
});

describe("scene renderer prompt by mode", () => {
  it("guided mock_text，mock_text", () => {
    const prompt = buildSceneRendererSystemPrompt("guided");
    expect(prompt).toContain("0-3");
    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text");
    expect(prompt).not.toMatch(/mock_text 2-4|mock_text/);
  });

  it("keeps runtime time authority while leaving world-progression craft to the Skill", () => {
    const prompt = buildSceneRendererSystemPrompt("guided");
    expect(prompt).not.toContain("mock_text");
    expect(prompt).toContain("mock_text");
  });

  it("renderer treats applied typed state as the source of concrete facts", () => {
    const prompt = buildSceneRendererSystemPrompt("guided");
    expect(prompt).toContain("mock_text");
    expect(prompt).toContain("mock_text mutator mock_text");
    expect(prompt).toContain("mock_text");
  });

  it("open mock_text", () => {
    const prompt = buildSceneRendererSystemPrompt("open");
    expect(prompt).not.toContain("mock_text 2-4");
  });

  it("renders the scene prompt in English when language is en", () => {
    const prompt = buildSceneRendererSystemPrompt("guided", "en");
    expect(prompt).toContain("interactive-fiction scene-response author");
    expect(prompt).toContain("suggestedActions");
    expect(prompt).not.toMatch(/\u4e00-\u9fff/); // no CJK leaks into the English prompt
  });
});
