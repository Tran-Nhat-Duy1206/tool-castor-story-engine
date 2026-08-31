import type { StoryGraph, StoryNode } from "./graph-schema.js";
import { enumerateRuntimePaths } from "./paths.js";

// Maps emotion words (Vietnamese and English) to a valence in [-1, 1].
const EMOTION_LEXICON: Record<string, number> = {
  // Vietnamese
  "vui": 0.8, "vui vẻ": 0.9, "hạnh phúc": 0.8, "hy vọng": 0.6, "kiên định": 0.5,
  "ấm áp": 0.6, "xúc động": 0.6, "nhẹ nhõm": 0.4, "bình tĩnh": 0.0, "trung tính": 0.0,
  "căng thẳng": -0.4, "lo âu": -0.5, "lo lắng": -0.5, "tức giận": -0.6, "phẫn nộ": -0.6,
  "sợ hãi": -0.7, "kinh hoàng": -0.85, "đau buồn": -0.8, "buồn": -0.6, "tuyệt vọng": -0.95,
  "đau khổ": -0.8, "thất vọng": -0.5, "do dự": -0.2, "lạnh lùng": -0.3,

  // English
  "joy": 0.9, "happy": 0.8, "hope": 0.6, "determined": 0.5, "warm": 0.6,
  "moved": 0.6, "relieved": 0.4, "calm": 0.0, "neutral": 0.0,
  "tense": -0.4, "anxious": -0.5, "angry": -0.6, "fear": -0.7, "horror": -0.85,
  "sad": -0.8, "grief": -0.8, "despair": -0.95, "suffering": -0.8, "disappointed": -0.5,
  "hesitant": -0.2, "cold": -0.3
};

const NEGATION_WORDS = ["không", "chẳng", "chưa", "not", "un", "no"];

export function emotionScore(word: string): number {
  const w = word.trim().toLowerCase();
  if (!w) return 0;
  if (w in EMOTION_LEXICON) return EMOTION_LEXICON[w];

  for (const key of Object.keys(EMOTION_LEXICON)) {
    if (w.includes(key)) {
      const isNegated = NEGATION_WORDS.some(neg => {
        const regex = new RegExp(`\\b${neg}\\s+${key}`, "i");
        return regex.test(w) || w.startsWith(neg + key);
      });
      return isNegated ? -EMOTION_LEXICON[key] : EMOTION_LEXICON[key];
    }
  }
  return 0;
}

export function nodeEmotion(node: StoryNode): number {
  const lines = node.dialogue ?? [];
  if (lines.length === 0) return 0;
  const sum = lines.reduce((acc, l) => acc + emotionScore(l.emotion), 0);
  return sum / lines.length;
}

export function analyzeEmotionalArcs(graph: StoryGraph): {
  arcs: { endingId: string | null; points: { nodeId: string; score: number }[] }[];
  truncated: boolean;
} {
  const { paths, truncated } = enumerateRuntimePaths(graph);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const arcs = paths.map((p) => ({
    endingId: p.endingId,
    points: p.nodeIds.map((id) => {
      const node = nodeById.get(id);
      return { nodeId: id, score: node ? nodeEmotion(node) : 0 };
    }),
  }));
  return { arcs, truncated };
}

export function analyzePathDistribution(graph: StoryGraph): {
  total: number;
  truncated: boolean;
  byEnding: Record<string, number>;
  lengthHistogram: Record<number, number>;
} {
  const { paths, truncated } = enumerateRuntimePaths(graph);
  const byEnding: Record<string, number> = {};
  const lengthHistogram: Record<number, number> = {};
  for (const p of paths) {
    const key = p.endingId ?? "(dead-end)";
    byEnding[key] = (byEnding[key] ?? 0) + 1;
    lengthHistogram[p.length] = (lengthHistogram[p.length] ?? 0) + 1;
  }
  return { total: paths.length, truncated, byEnding, lengthHistogram };
}
