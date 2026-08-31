import { BaseAgent } from "./base.js";
import type { Platform, Genre } from "../models/book.js";
import type { RadarSource, PlatformRankings } from "./radar-source.js";
import { FanqieRadarSource, QidianRadarSource } from "./radar-source.js";

export interface RadarResult {
  readonly recommendations: ReadonlyArray<RadarRecommendation>;
  readonly marketSummary: string;
  readonly timestamp: string;
}

export interface RadarRecommendation {
  readonly platform: Platform;
  readonly genre: Genre;
  readonly concept: string;
  readonly confidence: number;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
}

const DEFAULT_SOURCES: ReadonlyArray<RadarSource> = [
  new FanqieRadarSource(),
  new QidianRadarSource(),
];

function formatRankingsForPrompt(rankings: ReadonlyArray<PlatformRankings>): string {
  const sections = rankings
    .filter((r) => r.entries.length > 0)
    .map((r) => {
      const lines = r.entries.map(
        (e) => `- ${e.title}${e.author ? ` (${e.author})` : ""}${e.category ? ` [${e.category}]` : ""} ${e.extra}`,
      );
      return `### ${r.platform}\n${lines.join("\n")}`;
    });

  return sections.length > 0
    ? sections.join("\n\n")
    : "（，）";
}

export class RadarAgent extends BaseAgent {
  private readonly sources: ReadonlyArray<RadarSource>;

  constructor(
    ctx: ConstructorParameters<typeof BaseAgent>[0],
    sources?: ReadonlyArray<RadarSource>,
  ) {
    super(ctx);
    this.sources = sources ?? DEFAULT_SOURCES;
  }

  get name(): string {
    return "radar";
  }

  async scan(): Promise<RadarResult> {
    const rankings = await Promise.all(this.sources.map((s) => s.fetch()));
    const rankingsText = formatRankingsForPrompt(rankings);

    const systemPrompt = `。，。

## 

${rankingsText}

：
1. 
2. 
3. （）
4. （）

 JSON：
{
  "recommendations": [
    {
      "platform": "",
      "genre": "",
      "concept": "",
      "confidence": 0.0-1.0,
      "reasoning": "（）",
      "benchmarkTitles": ["1", "2"]
    }
  ],
  "marketSummary": "（）"
}

：3-5， confidence 。`;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `，，。`,
        },
      ],
      { temperature: 0.6 },
    );

    return this.parseResult(response.content);
  }

  private parseResult(content: string): RadarResult {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Radar output format error: no JSON found");
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        recommendations: parsed.recommendations ?? [],
        marketSummary: parsed.marketSummary ?? "",
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      throw new Error(`Radar JSON parse error: ${e}`);
    }
  }
}
