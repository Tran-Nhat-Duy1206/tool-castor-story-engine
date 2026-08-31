import { useEffect, useState } from "react";
import { Users, ChevronDown } from "lucide-react";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";
import { cn } from "../../lib/utils";
import { tr } from "../../lib/app-language";
import { roleFromPath, type RoleRef } from "../../lib/truth-display";

interface CharacterInfo {
  name: string;
  fields: Record<string, string>;
}

function parseCharacterMatrix(md: string): CharacterInfo[] {
  const characters: CharacterInfo[] = [];
  // Split by ## headings (level 2 only)
  const sections = md.split(/^## /m).slice(1);
  for (const section of sections) {
    const lines = section.split("\n");
    const name = lines[0].trim();
    if (!name) continue;
    const fields: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const match = lines[i].match(/^-\s+\*\*(.+?)\*\*:\s*(.+)/);
      if (match) {
        fields[match[1]] = match[2].trim();
      }
    }
    characters.push({ name, fields });
  }
  return characters;
}

const ROLE_COLORS: Record<string, string> = {
  "": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "": "bg-red-500/15 text-red-600 dark:text-red-400",
  "": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "": "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  "protagonist": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "antagonist": "bg-red-500/15 text-red-600 dark:text-red-400",
  "ally": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "minor": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "mentioned": "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

function getRoleColor(role: string): string {
  const lower = role.toLowerCase().trim();
  for (const [key, color] of Object.entries(ROLE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400";
}

// The label is resolved via tr() at render time; it must not be frozen to a
// single language at module load.
const TIER_BADGE: Record<RoleRef["tier"], { vi: string; en: string; color: string }> = {
  major: { vi: "Chính", en: "Major", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  minor: { vi: "Phụ", en: "Minor", color: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
};

// Phase 5 layout: one file per character under roles/. Each entry opens the
// full (humanized) character sheet — no raw matrix parsing needed.
function RoleEntry({ role }: { readonly role: RoleRef }) {
  const openArtifact = useChatStore((s) => s.openArtifact);
  const badge = TIER_BADGE[role.tier];
  return (
    <button
      onClick={() => openArtifact(role.path)}
      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
    >
      <Users size={16} className="shrink-0 text-muted-foreground/60" />
      <span className="text-[15px] leading-6 font-medium text-foreground font-['SimSun','Songti_SC','STSong',serif] flex-1 truncate">
        {role.name}
      </span>
      <span className={cn("text-[12px] px-1.5 py-0.5 rounded-full shrink-0", badge.color)}>
        {tr(badge.vi, badge.en)}
      </span>
    </button>
  );
}

function CharacterCard({ char }: { readonly char: CharacterInfo }) {
  const [expanded, setExpanded] = useState(false);
  const role = char.fields[""] ?? char.fields["Role"] ?? "";
  const tags = char.fields[""] ?? char.fields["Tags"] ?? "";
  const current = char.fields[""] ?? char.fields["Current"] ?? "";

  return (
    <div className="rounded-lg bg-secondary/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <Users size={16} className="shrink-0 text-muted-foreground/60" />
        <span className="text-[15px] leading-6 font-medium text-foreground font-['SimSun','Songti_SC','STSong',serif] flex-1 truncate">
          {char.name}
        </span>
        {role && (
          <span className={cn("text-[12px] px-1.5 py-0.5 rounded-full shrink-0", getRoleColor(role))}>
            {role.split("/")[0].trim()}
          </span>
        )}
        <ChevronDown size={14} className={cn("text-muted-foreground/50 transition-transform shrink-0", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1">
          {tags && (
            <p className="text-[14px] leading-6 text-muted-foreground"><span className="text-muted-foreground/60">{tr("Nhãn", "Tags")}</span> {tags}</p>
          )}
          {current && (
            <p className="text-[14px] leading-6 text-muted-foreground"><span className="text-muted-foreground/60">{tr("Hiện tại", "Current")}</span> {current}</p>
          )}
          {Object.entries(char.fields)
            .filter(([k]) => !["", "Role", "", "Tags", "", "Current"].includes(k))
            .map(([key, val]) => (
              <p key={key} className="text-[14px] leading-6 text-muted-foreground">
                <span className="text-muted-foreground/60">{key}</span> {val}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

interface CharacterSectionProps {
  readonly bookId: string;
}

export function CharacterSection({ bookId }: CharacterSectionProps) {
  const [roles, setRoles] = useState<ReadonlyArray<RoleRef>>([]);
  const [legacyChars, setLegacyChars] = useState<CharacterInfo[]>([]);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    let cancelled = false;
    setRoles([]);
    setLegacyChars([]);

    fetchJson<{ files: ReadonlyArray<{ name: string }> }>(`/books/${bookId}/truth`)
      .then(async (data) => {
        if (cancelled) return;
        const roleRefs = data.files
          .map((f) => roleFromPath(f.name))
          .filter((r): r is RoleRef => r !== null)
          .sort((a, b) =>
            a.tier === b.tier ? a.name.localeCompare(b.name) : a.tier === "major" ? -1 : 1,
          );

        // Phase 5 books expose one file per character under roles/.
        if (roleRefs.length > 0) {
          setRoles(roleRefs);
          return;
        }

        // Pre-Phase-5 books only have the flat character_matrix.md table.
        const matrix = await fetchJson<{ content: string | null }>(
          `/books/${bookId}/truth/character_matrix.md`,
        ).catch(() => ({ content: null }));
        if (!cancelled && matrix.content) {
          setLegacyChars(parseCharacterMatrix(matrix.content));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRoles([]);
          setLegacyChars([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, bookDataVersion]);

  if (roles.length === 0 && legacyChars.length === 0) return null;

  return (
    <SidebarCard title={tr("Nhân vật", "Characters")}>
      <div className="space-y-1.5">
        {roles.length > 0
          ? roles.map((role) => <RoleEntry key={role.path} role={role} />)
          : legacyChars.map((char) => <CharacterCard key={char.name} char={char} />)}
      </div>
    </SidebarCard>
  );
}
