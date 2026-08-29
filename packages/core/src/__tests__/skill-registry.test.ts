import { describe, expect, it } from "vitest";
import { createSkillRegistry } from "../skills/index.js";

const externalSkill = {
  id: "writer-distillation",
  name: "Writer Distillation",
  description: "Distill transferable writing craft.",
  body: "Separate craft from surface wording.",
  source: "external",
} as const;

describe("AgentSkills registry", () => {
  it("does not inject implicit Castor built-in skills", () => {
    const registry = createSkillRegistry();

    expect(registry.listSkills()).toEqual([]);
  });

  it("resolves user-forced skills", () => {
    const registry = createSkillRegistry({ skills: [externalSkill] });

    const result = registry.resolveSkills({
      requestedSkills: ["writer-distillation"],
    });

    expect(result.usedSkills.map((skill) => skill.id)).toEqual(["writer-distillation"]);
    expect(result.forcedSkillIds).toEqual(["writer-distillation"]);
    expect(result.missingSkillIds).toEqual([]);
  });

  it("reports unknown forced skills instead of silently dropping them", () => {
    const registry = createSkillRegistry({ skills: [externalSkill] });

    const result = registry.resolveSkills({
      requestedSkills: ["not-a-skill", "writer-distillation"],
    });

    expect(result.usedSkills.map((skill) => skill.id)).toEqual(["writer-distillation"]);
    expect(result.missingSkillIds).toEqual(["not-a-skill"]);
  });

  it("excludes disabled skills from forced selection", () => {
    const registry = createSkillRegistry({ skills: [externalSkill] });

    const result = registry.resolveSkills({
      disabledSkills: ["writer-distillation"],
      requestedSkills: ["writer-distillation"],
    });

    expect(result.usedSkills).toEqual([]);
    expect(result.disabledSkillIds).toEqual(["writer-distillation"]);
  });

  it("does not auto-load skills without an explicit request", () => {
    const registry = createSkillRegistry();

    expect(registry.resolveSkills({}).usedSkills.map((skill) => skill.id)).toEqual([]);
  });
});
