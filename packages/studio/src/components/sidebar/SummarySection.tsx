import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";
import { FrontmatterCards } from "./FrontmatterCards";
import { tr } from "../../lib/app-language";
import {
  firstParagraph,
  frontmatterToCards,
  type TruthFrontmatter,
} from "../../lib/truth-display";

const streamdownPlugins = { cjk, code, math, mermaid };

const SIDEBAR_MD_CLASS =
  "text-[15px] text-muted-foreground leading-7 " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "[&>p+p]:mt-2 [&_strong]:text-foreground [&_strong]:font-medium " +
  "[&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 " +
  "[&_h1]:hidden [&_h2]:text-[15px] [&_h2]:font-medium [&_h2]:text-foreground [&_h2]:mt-2 [&_h2]:mb-1 " +
  "[&_h3]:text-[15px] [&_h3]:font-medium [&_h3]:text-foreground [&_h3]:mt-2 [&_h3]:mb-1 " +
  "[&_code]:text-[12px] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-secondary/60";

interface LegacySummary {
  world: string;
  protagonist: string;
  cast: string;
}

// Pre-Phase-5 books only have story_bible.md (prose with ## sections).
function parseStoryBible(content: string): LegacySummary {
  const sections = content.split(/^##\s+/m);
  let world = "";
  let protagonist = "";
  let cast = "";

  for (const section of sections) {
    if (/^0?1[_\s]|世界观|world/i.test(section)) {
      world = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    } else if (/^0?2[_\s]|主角|protagonist/i.test(section)) {
      protagonist = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    } else if (/^0?3[_\s]|配角|supporting|cast/i.test(section)) {
      cast = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    }
  }

  return { world, protagonist, cast };
}

interface SummarySectionProps {
  readonly bookId: string;
}

export function SummarySection({ bookId }: SummarySectionProps) {
  // Phase 5 layout: structured frontmatter + prose, sourced from story_frame.md.
  const [frontmatter, setFrontmatter] = useState<TruthFrontmatter | null>(null);
  const [worldOverview, setWorldOverview] = useState("");
  // Pre-Phase-5 fallback.
  const [legacy, setLegacy] = useState<LegacySummary | null>(null);
  const openArtifact = useChatStore((s) => s.openArtifact);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    let cancelled = false;
    setFrontmatter(null);
    setWorldOverview("");
    setLegacy(null);

    fetchJson<{ content: string | null; frontmatter?: TruthFrontmatter; body?: string }>(
      `/books/${bookId}/truth/outline/story_frame.md`,
    )
      .then(async (data) => {
        if (cancelled) return;
        if (data.content) {
          setFrontmatter(data.frontmatter ?? null);
          setWorldOverview(firstParagraph(data.body ?? data.content));
          return;
        }
        // Old book — no outline/story_frame.md. Fall back to story_bible.md.
        const bible = await fetchJson<{ content: string | null }>(
          `/books/${bookId}/truth/story_bible.md`,
        ).catch(() => ({ content: null }));
        if (!cancelled && bible.content) setLegacy(parseStoryBible(bible.content));
      })
      .catch(() => {
        if (!cancelled) setLegacy(null);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, bookDataVersion]);

  const cards = frontmatterToCards(frontmatter);

  if (cards.length === 0 && !worldOverview && !legacy) return null;

  if (legacy) {
    return (
      <>
        {legacy.world && (
          <SidebarCard title={tr("Thế giới quan", "World")}>
            <Streamdown className={SIDEBAR_MD_CLASS} plugins={streamdownPlugins}>
              {legacy.world}
            </Streamdown>
          </SidebarCard>
        )}
        {(legacy.protagonist || legacy.cast) && (
          <SidebarCard title={tr("Nhân vật", "Characters")}>
            {legacy.protagonist && (
              <Streamdown className={SIDEBAR_MD_CLASS} plugins={streamdownPlugins}>
                {legacy.protagonist}
              </Streamdown>
            )}
            {legacy.cast && (
              <div className={legacy.protagonist ? "mt-2" : undefined}>
                <Streamdown className={SIDEBAR_MD_CLASS} plugins={streamdownPlugins}>
                  {legacy.cast}
                </Streamdown>
              </div>
            )}
          </SidebarCard>
        )}
      </>
    );
  }

  // Worldview etc. is a section inside story_frame.md ("Nền tảng truyện"); these
  // summary cards are a glance, so offer a button to open the full file.
  const openFull = (
    <button
      onClick={() => openArtifact("outline/story_frame.md")}
      className="mt-2 text-[15px] leading-6 text-primary hover:underline font-['SimSun','Songti_SC','STSong',serif]"
    >
      {tr("Xem toàn bộ nền tảng →", "View full foundation →")}
    </button>
  );

  return (
    <>
      {cards.length > 0 && (
        <SidebarCard title={tr("Nền tảng truyện", "Story Foundation")}>
          <FrontmatterCards cards={cards} />
          {!worldOverview && openFull}
        </SidebarCard>
      )}
      {worldOverview && (
        <SidebarCard title={tr("Thế giới quan", "World")}>
          <Streamdown className={SIDEBAR_MD_CLASS} plugins={streamdownPlugins}>
            {worldOverview}
          </Streamdown>
          {openFull}
        </SidebarCard>
      )}
    </>
  );
}
