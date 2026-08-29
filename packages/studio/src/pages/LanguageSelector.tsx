import { useState } from "react";

export function LanguageSelector({ onSelect }: { onSelect: (lang: "vi" | "en") => void }) {
  const [hovering, setHovering] = useState<"vi" | "en" | null>(null);
  const [selected, setSelected] = useState<"vi" | "en" | null>(null);

  const handleSelect = (lang: "vi" | "en") => {
    setSelected(lang);
    // Brief pause for the selection animation before transitioning
    setTimeout(() => onSelect(lang), 400);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8">
      {/* Logo — cinematic scale */}
      <div className="mb-16 text-center">
        <div className="flex items-baseline justify-center gap-1.5 mb-4">
          <span className="font-serif text-6xl italic text-primary">Ink</span>
          <span className="text-5xl font-semibold tracking-tight text-foreground">OS</span>
        </div>
        <div className="text-base text-muted-foreground tracking-widest uppercase">Studio</div>
      </div>

      {/* Language cards — generous, distinct, immersive */}
      <div className="flex gap-8 mb-16">
        <button
          onClick={() => handleSelect("vi")}
          onMouseEnter={() => setHovering("vi")}
          onMouseLeave={() => setHovering(null)}
          className={`group w-80 border rounded-lg p-10 text-left transition-all duration-300 ${
            selected === "vi"
              ? "border-primary bg-primary/10 scale-[1.02]"
              : hovering === "vi"
                ? "border-primary/50 bg-card"
                : "border-border bg-card/50"
          }`}
        >
          <div className="font-serif text-3xl mb-4 text-foreground">Sáng tác tiếng Việt</div>
          <div className="text-base text-foreground/70 leading-relaxed mb-6">
            Tiên hiệp · Đô thị · Kinh dị · Viễn tưởng · Đại chúng
          </div>
          <div className="text-sm text-muted-foreground">
            Wattpad · Webnovel · các nền tảng truyện innen dòng
          </div>
        </button>

        <button
          onClick={() => handleSelect("en")}
          onMouseEnter={() => setHovering("en")}
          onMouseLeave={() => setHovering(null)}
          className={`group w-80 border rounded-lg p-10 text-left transition-all duration-300 ${
            selected === "en"
              ? "border-primary bg-primary/10 scale-[1.02]"
              : hovering === "en"
                ? "border-primary/50 bg-card"
                : "border-border bg-card/50"
          }`}
        >
          <div className="font-serif text-3xl italic mb-4 text-foreground">English Writing</div>
          <div className="text-base text-foreground/70 leading-relaxed mb-6">
            LitRPG · Progression · Romantasy · Sci-Fi · Isekai
          </div>
          <div className="text-sm text-muted-foreground">
            Royal Road · Kindle Unlimited · Scribble Hub
          </div>
        </button>
      </div>

      <div className="text-sm text-muted-foreground">
        Có thể thay đổi trong Cài đặt · Can be changed in Settings
      </div>
    </div>
  );
}
