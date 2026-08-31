import { describe, expect, it } from "vitest";
import { buildAutoImageRequests, buildView } from "../PlayHud";

describe("PlayHud buildView", () => {
  it("classifies held inventory from canonical graph edge roles, not status words", () => {
    const view = buildView({
      currentState: { turn: 1, mode: "guided", premise: "mock_val。" },
      graph: {
        entities: [
          { id: "loc-cabinet", type: "location", label: "F-07mock_val", status: "mock_val" },
          { id: "blood", type: "evidence", label: "mock_val", status: "mock_val，mock_val" },
          { id: "note", type: "clue", label: "mock_val", status: "mock_val" },
        ],
        edges: [
          { id: "edge-hold-note", fromId: "actor_player", type: "mock_val", toId: "note", value: { role: "holding", physical: true } },
        ],
        stateSlots: [],
        events: [],
      },
    });

    expect(view?.facing.map((row) => row.label)).toEqual([
      "F-07mock_val",
      "mock_val",
    ]);
    expect(view?.holdings.map((row) => row.label)).toEqual(["mock_val"]);
  });

  it("does not put observed intangible phenomena into the player's inventory", () => {
    const view = buildView({
      currentState: { turn: 1, mode: "open", premise: "mock_val。" },
      graph: {
        entities: [
          { id: "evidence_grass", type: "evidence", label: "mock_val", status: "mock_val" },
        ],
        edges: [
          { id: "edge-observed-grass", fromId: "actor_player", type: "mock_val", toId: "evidence_grass", value: { role: "holding" } },
        ],
        stateSlots: [],
        events: [],
      },
    });

    expect(view?.facing.map((row) => row.label)).toEqual(["mock_val"]);
    expect(view?.holdings.map((row) => row.label)).toEqual([]);
  });

  it("does not treat inventory-looking status text as authoritative", () => {
    const view = buildView({
      currentState: { turn: 1, mode: "guided", premise: "mock_val。" },
      graph: {
        entities: [
          { id: "note", type: "clue", label: "mock_val", status: "mock_val" },
        ],
        edges: [],
        stateSlots: [],
        events: [],
      },
    });

    expect(view?.facing.map((row) => row.label)).toEqual(["mock_val"]);
    expect(view?.holdings.map((row) => row.label)).toEqual([]);
  });

  it("does not infer holdings from relation wording alone", () => {
    const view = buildView({
      currentState: { turn: 1, mode: "guided", premise: "mock_val。" },
      graph: {
        entities: [
          { id: "note", type: "clue", label: "mock_val", status: "mock_val" },
        ],
        edges: [
          { id: "edge-hold-note", fromId: "actor_player", type: "mock_val", toId: "note" },
        ],
        stateSlots: [],
        events: [],
      },
    });

    expect(view?.facing.map((row) => row.label)).toEqual(["mock_val"]);
    expect(view?.holdings.map((row) => row.label)).toEqual([]);
  });

  it("only treats actor_player holding edges as the player's inventory", () => {
    const view = buildView({
      currentState: { turn: 1, mode: "guided", premise: "mock_val。" },
      graph: {
        entities: [
          { id: "actor_mechanic", type: "actor", label: "mock_val", status: "mock_val" },
          { id: "ticket", type: "item", label: "mock_val", status: "mock_val" },
          { id: "key", type: "item", label: "mock_val", status: "mock_val" },
        ],
        edges: [
          { id: "edge-wrong-holder", fromId: "actor_mechanic", type: "mock_val", toId: "ticket", value: { role: "holding" } },
          { id: "edge-player-holder", fromId: "actor_player", type: "mock_val", toId: "key", value: { role: "holding" } },
        ],
        stateSlots: [],
        events: [],
      },
    });

    expect(view?.holdings.map((row) => row.label)).toEqual(["mock_val"]);
    expect(view?.facing.map((row) => row.label)).toEqual(["mock_val", "mock_val"]);
  });

  it("uses semantic relation roles and suppresses duplicate status labels", () => {
    const view = buildView({
      currentState: { turn: 1, mode: "open", premise: "mock_val。" },
      graph: {
        entities: [
          { id: "actor_player", type: "actor", label: "mock_val", status: "mock_val" },
          { id: "actor_guard", type: "actor", label: "mock_val", status: "mock_val" },
          { id: "key", type: "item", label: "mock_val", status: "mock_val" },
        ],
        edges: [
          { id: "edge-hold-key", fromId: "actor_player", type: "mock_val", toId: "key", value: { role: "holding" } },
          { id: "edge-suspect", fromId: "actor_guard", type: "mock_val", toId: "actor_player", value: { role: "relation" } },
        ],
        stateSlots: [],
        events: [],
      },
    });

    const player = view?.actors.find((row) => row.id === "actor_player");
    expect(player?.note).toBeNull();
    expect(player?.details.map((detail) => detail.text)).toEqual(["mock_val · mock_val"]);
    expect(view?.holdings.map((row) => row.label)).toEqual(["mock_val"]);
  });

  it("surfaces semantic world time as a synchronized state row", () => {
    const view = buildView({
      currentState: {
        turn: 2,
        mode: "open",
        premise: "mock_val。",
        timeAdvance: {
          elapsed: "mock_val",
          anchor: "mock_val",
          rationale: "mock_val。",
          synchronized: ["mock_val，mock_val。"],
        },
      },
      graph: {
        entities: [],
        edges: [],
        stateSlots: [],
        events: [],
      },
    });

    expect(view?.time?.label).toBe("Thời gian thế giới");
    expect(view?.time?.value).toBe("mock_val");
    expect(view?.time?.note).toContain("mock_val");
    expect(view?.time?.details[0]).toEqual({ label: "Trôi qua", text: "mock_val" });
    expect(view?.time?.details[1]?.text).toContain("mock_val");
  });

  it("auto-illustrates enabled actors, holdings, and current moment", () => {
    const view = buildView({
      currentState: { turn: 3, mode: "open", premise: "mock_val。" },
      graph: {
        entities: [
          { id: "actor_player", type: "actor", label: "mock_val" },
          { id: "actor_master", type: "actor", label: "mock_val", imageUrl: "/ready.png" },
          { id: "item_box", type: "item", label: "mock_val" },
        ],
        edges: [
          { id: "edge-hold-box", fromId: "actor_player", type: "mock_val", toId: "item_box", value: { role: "holding" } },
        ],
        stateSlots: [],
        events: [],
      },
    });

    expect(buildAutoImageRequests(view, { actors: true, moments: true, inventory: true })).toEqual([
      { key: "actor_player", body: { target: "entity", entityId: "actor_player" } },
      { key: "item_box", body: { target: "entity", entityId: "item_box" } },
      { key: "scene-turn-3", body: { target: "scene" } },
    ]);
  });

  it("does not auto-illustrate the current moment when a scene image is already ready", () => {
    const view = buildView({
      currentState: { turn: 3, mode: "open", premise: "mock_val。" },
      graph: { entities: [], edges: [], stateSlots: [], events: [] },
    });

    expect(buildAutoImageRequests(view, { actors: false, moments: true, inventory: false }, "/scene.png")).toEqual([]);
  });

  it("surfaces a holding's relationship web from its edges, excluding every player edge", () => {
    const view = buildView({
      currentState: { turn: 2, mode: "open", premise: "mock_val。" },
      graph: {
        entities: [
          { id: "evi_letter", type: "evidence", label: "mock_val", createdEventId: "evt-1" },
          { id: "actor_chen", type: "actor", label: "mock_val" },
          { id: "claim_alibi", type: "claim", label: "mock_val" },
        ],
        edges: [
          { id: "e-hold", fromId: "actor_player", type: "mock_val", toId: "evi_letter", value: { role: "holding", physical: true } },
          // A player→holding relation-role edge must also be kept out of the web.
          { id: "e-player-rel", fromId: "actor_player", type: "mock_val", toId: "evi_letter", value: { role: "relation" } },
          { id: "e-indict", fromId: "evi_letter", type: "mock_val", toId: "actor_chen", value: { role: "relation" }, strength: 0.8 },
          { id: "e-refute", fromId: "evi_letter", type: "mock_val", toId: "claim_alibi", value: { role: "relation" } },
        ],
        stateSlots: [],
        events: [{ id: "evt-1", turn: 1, outcomeSummary: "" }, { id: "evt-2", turn: 2, outcomeSummary: "" }],
      },
    });
    const letter = view?.holdings.find((h) => h.id === "evi_letter");
    expect(letter?.relations).toEqual([
      { targetLabel: "mock_val", type: "mock_val", strength: 0.8 },
      { targetLabel: "mock_val", type: "mock_val", strength: undefined },
    ]);
  });

  it("attaches owner-scoped state slots to the holding and keeps unowned slots global", () => {
    const view = buildView({
      currentState: { turn: 1, mode: "open", premise: "rpg。" },
      graph: {
        entities: [{ id: "item_sword", type: "item", label: "mock_val", createdEventId: "evt-1" }],
        edges: [{ id: "e-hold", fromId: "actor_player", type: "mock_val", toId: "item_sword", value: { role: "holding" } }],
        stateSlots: [
          { id: "s-atk", ownerEntityId: "item_sword", kind: "resource", label: "mock_val", value: 14 },
          { id: "s-dur", ownerEntityId: "item_sword", kind: "resource", label: "mock_val", value: { current: 62, max: 80 } },
          { id: "s-world", kind: "pressure", label: "mock_val", value: "mock_val" },
        ],
        events: [{ id: "evt-1", turn: 1, outcomeSummary: "" }],
      },
    });
    const sword = view?.holdings.find((h) => h.id === "item_sword");
    expect(sword?.meters.map((m) => [m.label, m.value, m.ratio])).toEqual([
      ["mock_val", "14", undefined],
      ["mock_val", "62/80", 0.775],
    ]);
    expect(view?.meters.map((m) => m.label)).toEqual(["mock_val"]);
  });

  it("carries kind and a progress ratio on world-level meters for gauge rendering", () => {
    const view = buildView({
      currentState: { turn: 1, mode: "open", premise: "x。" },
      graph: {
        entities: [],
        edges: [],
        stateSlots: [
          { id: "s-hp", kind: "resource", label: "mock_val", value: { current: 62, max: 80 } },
          { id: "s-chase", kind: "pressure", label: "mock_val", value: "mock_val" },
        ],
        events: [],
      },
    });
    expect(view?.meters.map((m) => [m.label, m.kind, m.value, m.ratio])).toEqual([
      ["mock_val", "resource", "62/80", 0.775],
      ["mock_val", "pressure", "mock_val", undefined],
    ]);
  });

  it("reads the evidence lifecycle ladder and reason from the owner-scoped evidence slot", () => {
    const view = buildView({
      currentState: { turn: 3, mode: "guided", premise: "mock_val。" },
      graph: {
        entities: [{ id: "evi_letter", type: "evidence", label: "mock_val", createdEventId: "evt-1" }],
        edges: [{ id: "e-hold", fromId: "actor_player", type: "mock_val", toId: "evi_letter", value: { role: "holding", physical: true } }],
        stateSlots: [{
          id: "evidence:evi_letter:status", ownerEntityId: "evi_letter", kind: "evidence", label: "mock_val",
          value: { previous: "seen", status: "verified", reason: "mock_val" },
        }],
        events: [{ id: "evt-1", turn: 1, outcomeSummary: "" }],
      },
    });
    const letter = view?.holdings.find((h) => h.id === "evi_letter");
    expect(letter?.lifecycle?.current).toBe("verified");
    expect(letter?.lifecycle?.reason).toBe("mock_val");
    expect(letter?.lifecycle?.stages).toContain("weaponized");
    expect(letter?.statusPill).toBeUndefined();
    expect(letter?.meters).toEqual([]); // the evidence slot is the ladder, not a meter
  });

  it("marks freshly acquired holdings and records provenance turn", () => {
    const view = buildView({
      currentState: { turn: 7, mode: "open", premise: "rpg。" },
      graph: {
        entities: [
          { id: "item_sword", type: "item", label: "mock_val", status: "mock_val", createdEventId: "evt-7", updatedEventId: "evt-7" },
          { id: "item_key", type: "item", label: "mock_val", createdEventId: "evt-2", updatedEventId: "evt-2" },
        ],
        edges: [
          { id: "e1", fromId: "actor_player", type: "mock_val", toId: "item_sword", value: { role: "holding" } },
          { id: "e2", fromId: "actor_player", type: "mock_val", toId: "item_key", value: { role: "holding" } },
        ],
        stateSlots: [],
        events: [{ id: "evt-2", turn: 2, outcomeSummary: "" }, { id: "evt-7", turn: 7, outcomeSummary: "mock_val。" }],
      },
    });
    const sword = view?.holdings.find((h) => h.id === "item_sword");
    const key = view?.holdings.find((h) => h.id === "item_key");
    expect(sword?.isFresh).toBe(true);
    expect(sword?.provenanceTurn).toBe(7);
    expect(sword?.statusPill).toBe("mock_val");
    expect(key?.isFresh).toBe(false);
    expect(key?.provenanceTurn).toBe(2);
  });
});
