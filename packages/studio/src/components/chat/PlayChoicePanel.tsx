export function PlayChoicePanel(props: {
  readonly choices: ReadonlyArray<string>;
  readonly disabled: boolean;
  readonly isVi: boolean;
  readonly onChoose: (action: string) => void;
}) {
  if (props.choices.length === 0) {
    return (
      <div className="px-4 py-3 text-center text-xs text-muted-foreground/60">
        {props.disabled ? (props.isVi ? "Đang đẩy tiếp…" : "Advancing…") : (props.isVi ? "Đang chờ cảnh đưa ra lựa chọn…" : "Waiting for choices…")}
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2.5">
        {props.choices.map((choice, i) => (
          <button
            key={`${i}-${choice}`}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChoose(choice)}
            className="group inline-flex items-center gap-2 rounded-full border border-border/50 bg-secondary/40 px-4 py-2 text-sm leading-5 text-foreground/90 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/10 hover:text-primary hover:shadow-md hover:shadow-primary/10 active:translate-y-0 disabled:pointer-events-none disabled:opacity-40"
          >
            <span aria-hidden className="text-xs text-primary/50 transition-colors group-hover:text-primary">▸</span>
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}
