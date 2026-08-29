import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";
import { tr } from "../../lib/app-language";
import { foundationFileLabel, FOUNDATION_FILE_ORDER } from "../../lib/truth-display";

interface TruthFileInfo {
  name: string;
  size: number;
  // Pre-Phase-5 compat shims (story_bible.md / book_rules.md) on a new-layout
  // book are tagged legacy by the API; those are deprecated pointers, not real
  // content, so they are hidden from the foundation list.
  legacy?: boolean;
}

interface FoundationSectionProps {
  readonly bookId: string;
}

export function FoundationSection({ bookId }: FoundationSectionProps) {
  const [files, setFiles] = useState<ReadonlyArray<TruthFileInfo>>([]);
  const openArtifact = useChatStore((s) => s.openArtifact);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    fetchJson<{ files: TruthFileInfo[] }>(`/books/${bookId}/truth`)
      .then((data) => setFiles(data.files))
      .catch(() => setFiles([]));
  }, [bookId, bookDataVersion]);

  const available = files
    .filter((f) => !f.legacy && foundationFileLabel(f.name) !== undefined)
    .sort((a, b) => FOUNDATION_FILE_ORDER.indexOf(a.name) - FOUNDATION_FILE_ORDER.indexOf(b.name));

  if (available.length === 0) return null;

  return (
    <SidebarCard title={tr("Tệp lõi", "Core Files")}>
      <ul className="space-y-1">
        {available.map((item) => (
          <li key={item.name}>
            <button
              onClick={() => openArtifact(item.name)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-[15px] leading-6 font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors font-['SimSun','Songti_SC','STSong',serif]"
            >
              <FileText size={16} className="shrink-0 text-muted-foreground/60" />
              <span className="truncate">{foundationFileLabel(item.name)}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidebarCard>
  );
}
