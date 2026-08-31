import type { LLMClient } from "../llm/provider.js";
import { runWorkerAgentTool } from "../agent/worker-agent.js";
import { appendActivatedSkillGuidance } from "../agents/base.js";
import type { ActivatedSkillGuidance } from "../agent/skill-tool.js";
import { StoryGraphSchema, type StoryGraph } from "./graph-schema.js";
import { StoryGraphContentToolSchema } from "./tool-schemas.js";
import { validateStoryGraph } from "./validation.js";

const SYSTEM_PROMPT_VI = `Bạn là biên kịch phim tương tác. Dựa trên tiền đề câu chuyện được cung cấp, hãy tạo đồ thị phân nhánh hoàn chỉnh, có thể chơi được.
Yêu cầu: đúng 1 nút bắt đầu (type=start); ít nhất 2 nút phân nhánh (type=branch); ít nhất 2 kết thúc khác biệt (type=ending); mọi nhánh rẽ đều dẫn đến kết thúc; dùng biến số, điều kiện và hiệu ứng để thể hiện lựa chọn có ý nghĩa của người chơi. Khi hoàn thành, gọi submit_story_graph.`;

const SYSTEM_PROMPT_EN = `You are an interactive film scriptwriter. From the user's story premise, generate a small but complete playable branching graph.
Requirements: exactly 1 node with type=start; at least 2 branch nodes; at least 2 clearly differentiated endings; every path must reach some ending; use variables, conditions, and effects for choices that genuinely change later scenes. Finish by calling submit_story_graph.`;

export interface GenerateStoryGraphInput {
  readonly projectId: string;
  readonly title: string;
  readonly premise: string;
}

export async function generateStoryGraph(
  client: LLMClient,
  model: string,
  input: GenerateStoryGraphInput,
  options?: {
    readonly maxTokens?: number;
    readonly language?: "vi" | "en";
    readonly activatedSkills?: ReadonlyArray<ActivatedSkillGuidance>;
    readonly signal?: AbortSignal;
  },
): Promise<StoryGraph> {
  const language = options?.language ?? "vi";
  const systemPrompt = language === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_VI;
  const userPrompt = language === "en"
    ? `Title: ${input.title}\nPremise: ${input.premise}`
    : `Tiêu đề: ${input.title}\nTiền đề: ${input.premise}`;
  const submitted = await runWorkerAgentTool(client, model, appendActivatedSkillGuidance([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], options?.activatedSkills), {
    name: "submit_story_graph",
    label: language === "en" ? "Submit Story Graph" : "Nộp đồ thị câu chuyện",
    description: language === "en"
      ? "Submit the complete playable branching graph. The host owns the project id, schema version, and title."
      : "Nộp đồ thị phân nhánh hoàn chỉnh. Mã dự án, phiên bản lược đồ và tiêu đề do hệ thống quản lý.",
    parameters: StoryGraphContentToolSchema,
  }, {
    temperature: 0.5,
    maxTokens: options?.maxTokens ?? 8000,
    signal: options?.signal,
  });
  const graph = StoryGraphSchema.parse({
    ...submitted,
    schemaVersion: 1,
    projectId: input.projectId,
    title: input.title,
  });
  const startCount = graph.nodes.filter((node) => node.type === "start").length;
  const branchCount = graph.nodes.filter((node) => node.type === "branch").length;
  const report = validateStoryGraph(graph);
  if (startCount !== 1 || branchCount < 2 || graph.endings.length < 2 || !report.ok) {
    const reasons = [
      ...(startCount !== 1 ? [`expected exactly one start node, received ${startCount}`] : []),
      ...(branchCount < 2 ? [`expected at least two branch nodes, received ${branchCount}`] : []),
      ...(graph.endings.length < 2 ? [`expected at least two endings, received ${graph.endings.length}`] : []),
      ...report.issues.filter((issue) => issue.level === "error").map((issue) => issue.message),
    ];
    throw new Error(`Generated story graph is not playable: ${reasons.join("; ")}`);
  }
  return graph;
}
