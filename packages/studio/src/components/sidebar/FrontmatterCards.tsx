import type { DisplayCard } from "../../lib/truth-display";

interface FrontmatterCardsProps {
  readonly cards: ReadonlyArray<DisplayCard>;
}

// Renders the structured frontmatter of a story file (protagonist / genre / hard lines...) as
// small reader-friendly cards, so authors never see raw YAML keys.
export function FrontmatterCards({ cards }: FrontmatterCardsProps) {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 mb-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg bg-secondary/30 px-3 py-2">
          <div className="text-[12px] leading-5 text-muted-foreground/60 mb-1">{card.label}</div>
          {card.values.length === 1 ? (
            <div className="text-[15px] leading-6 text-foreground font-['SimSun','Songti_SC','STSong',serif]">
              {card.values[0]}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {card.values.map((value, i) => (
                <li
                  key={i}
                  className="text-[15px] leading-6 text-foreground flex gap-1.5 font-['SimSun','Songti_SC','STSong',serif]"
                >
                  <span className="text-muted-foreground/40 shrink-0">·</span>
                  <span>{value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
