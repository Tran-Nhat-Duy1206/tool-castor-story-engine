import { ChevronRight } from "lucide-react";
import type { HoldingRow } from "./types";
import { KIND_LABEL_VI, KIND_LABEL_EN } from "./types";

export function HoldingSlot(props: {
  readonly row: HoldingRow;
  readonly isVi: boolean;
  readonly generating?: boolean;
  readonly onOpen: () => void;
}) {
  const { row, isVi, generating, onOpen } = props;
  const kind = (isVi ? KIND_LABEL_VI : KIND_LABEL_EN)[row.kind] ?? row.kind;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-lg border border-border/30 bg-secondary/30 px-2.5 py-2 text-left hover:border-border/60"
    >
      {row.imageUrl ? (
        <img src={row.imageUrl} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-secondary/60 text-sm">
          {generating ? "⏳" : row.glyph}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] leading-6 font-semibold text-foreground">{row.label}</span>
          {row.isFresh ? (
            <span className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 text-[12px] leading-5 font-medium text-emerald-300">
              {isVi ? "MỚI" : "NEW"}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[14px] leading-6 text-muted-foreground">
          <span className="shrink-0">{kind}</span>
          {row.preview ? <span className="truncate">· {row.preview}</span> : null}
        </span>
      </span>
      <ChevronRight size={13} className="shrink-0 text-muted-foreground/50" />
    </button>
  );
}
