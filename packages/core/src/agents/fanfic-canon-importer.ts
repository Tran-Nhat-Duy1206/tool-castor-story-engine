import { BaseAgent } from "./base.js";
import type { FanficMode } from "../models/book.js";

export interface FanficCanonOutput {
  readonly worldRules: string;
  readonly characterProfiles: string;
  readonly keyEvents: string;
  readonly powerSystem: string;
  readonly writingStyle: string;
  readonly fullDocument: string;
}

const MODE_LABELS: Record<FanficMode, string> = {
  canon: "原作向（严格遵守原作设定）",
  au: "AU/平行世界（世界规则可改，角色保留）",
  ooc: "OOC（角色性格可偏离原作）",
  cp: "CP（以配对关系为核心）",
};

const SOURCE_CHUNK_CHARS = 50_000;

export class FanficCanonImporter extends BaseAgent {
  get name(): string {
    return "fanfic-canon-importer";
  }

  async importFromText(
    sourceText: string,
    sourceName: string,
    fanficMode: FanficMode,
  ): Promise<FanficCanonOutput> {
    const source = await this.prepareSourceText(sourceText, sourceName);

    const modeLabel = MODE_LABELS[fanficMode];

    const systemPrompt = `你是一个专业的同人创作素材分析师。你的任务是从用户提供的原作素材中提取结构化正典信息，供同人写作系统使用。

同人模式：${modeLabel}

你需要从原作素材中提取以下内容，每个部分用 === SECTION: <name> === 分隔：

=== SECTION: world_rules ===
世界规则（地理、物理法则、魔法/力量体系、阵营组织、社会结构）。
如果原作素材不包含明确的世界规则，从已有信息合理推断。

=== SECTION: character_profiles ===
角色档案表格，每个重要角色一行：

| 角色 | 身份 | 性格底色 | 语癖/口头禅 | 说话风格 | 行为模式 | 关键关系 | 信息边界 |
|------|------|----------|-------------|----------|----------|----------|----------|

要求：
- 语癖/口头禅必须从原文中精确提取，如有的话
- 说话风格描述该角色的语气、用词偏好、句式特征
- 行为模式描述该角色在特定情境下的典型反应
- 信息边界标注该角色知道什么、不知道什么
- 至少提取 3 个角色，不超过 15 个

=== SECTION: key_events ===
关键事件时间线：

| 序号 | 事件 | 涉及角色 | 对同人写作的约束 |
|------|------|----------|------------------|

按时间/出现顺序排列，标注每个事件对同人创作的约束程度。

=== SECTION: power_system ===
力量/能力体系（如果适用）。包括等级划分、核心规则、已知限制。
如果原作没有明确的力量体系，输出"（原作无明确力量体系）"。

=== SECTION: writing_style ===
原作写作风格特征（供同人写作模仿）：

1. 叙事人称与视角（第一人称/第三人称有限/全知，是否频繁切换）
2. 句式节奏（长短句交替模式、段落平均长度感受、对话占比）
3. 场景描写手法（五感偏好、意象选择、环境描写密度）
4. 对话标记习惯（说/道/笑道 等用法，对话前后是否有动作/表情补充）
5. 情绪表达方式（直白内心独白 vs 动作外化 vs 环境映射）
6. 比喻/修辞倾向（常用比喻类型、修辞频率）
7. 节奏转换（紧张→舒缓的过渡方式、章节结尾习惯）

每项用1-2个原文例句佐证。只提取原文实际存在的特征，不要泛泛描述。

提取原则：
- 忠实于原作素材，不捏造原作中没有的信息
- 信息不足时标注"（素材未提及）"而非编造
- 角色语癖是最重要的字段——同人读者最在意角色"像不像"
- 写作风格提取必须基于实际文本特征，附原文例句
${source.compiled ? "\n注意：原作素材较长。下面输入是逐段读取完整素材后生成的语义资料包，不是截断文本；请以资料包中的片段编号和证据为准。" : ""}`;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `以下是原作《${sourceName}》的素材：\n\n${source.text}` },
      ],
      { temperature: 0.3 },
    );

    const content = response.content;
    const extract = (tag: string): string => {
      const regex = new RegExp(
        `=== SECTION: ${tag} ===\\s*([\\s\\S]*?)(?==== SECTION:|$)`,
      );
      const match = content.match(regex);
      return match?.[1]?.trim() ?? "";
    };

    const worldRules = extract("world_rules");
    const characterProfiles = extract("character_profiles");
    const keyEvents = extract("key_events");
    const powerSystem = extract("power_system");
    const writingStyle = extract("writing_style");

    const meta = [
      "---",
      "meta:",
      `  sourceFile: "${sourceName}"`,
      `  fanficMode: "${fanficMode}"`,
      `  generatedAt: "${new Date().toISOString()}"`,
    ].join("\n");

    const fullDocument = [
      `# 同人正典（《${sourceName}》）`,
      "",
      "## 世界规则",
      worldRules || "（素材中未提取到明确世界规则）",
      "",
      "## 角色档案",
      characterProfiles || "（素材中未提取到角色信息）",
      "",
      "## 关键事件时间线",
      keyEvents || "（素材中未提取到关键事件）",
      "",
      "## 力量体系",
      powerSystem || "（原作无明确力量体系）",
      "",
      "## 原作写作风格",
      writingStyle || "（素材不足以提取风格特征）",
      "",
      meta,
    ].join("\n");

    return { worldRules, characterProfiles, keyEvents, powerSystem, writingStyle, fullDocument };
  }

  private async prepareSourceText(sourceText: string, sourceName: string): Promise<{ readonly text: string; readonly compiled: boolean }> {
    if (sourceText.length <= SOURCE_CHUNK_CHARS) {
      return { text: sourceText, compiled: false };
    }

    const chunks = splitIntoChunks(sourceText, SOURCE_CHUNK_CHARS);
    const notes: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
      const response = await this.chat(
        [
          {
            role: "system",
            content: [
              "你是同人正典资料编译器。任务是把一个原作片段压成后续抽取可用的 Markdown 资料包。",
              "不要续写、不要创作、不要补不存在的信息。只保留片段里实际出现的世界规则、人物、关系、关键事件、能力体系、口头禅、说话风格和原文证据。",
              "如果片段没有某类信息，直接省略该类。保留片段编号，方便后续追溯。",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `原作：《${sourceName}》`,
              `片段：${index + 1}/${chunks.length}`,
              "",
              chunks[index],
            ].join("\n"),
          },
        ],
        { temperature: 0.2 },
      );
      const content = response.content.trim();
      if (content) {
        notes.push([`## 片段 ${index + 1}/${chunks.length}`, content].join("\n\n"));
      }
    }

    return {
      compiled: true,
      text: [
        `# 《${sourceName}》语义资料包`,
        "",
        "以下内容由 Castor 逐段读取完整原作素材后压缩生成，用于后续正典抽取。它不是原文截断。",
        "",
        ...notes,
      ].join("\n"),
    };
  }
}

function splitIntoChunks(text: string, chunkChars: number): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += chunkChars) {
    chunks.push(text.slice(offset, offset + chunkChars));
  }
  return chunks;
}
