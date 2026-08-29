import { ExternalLink } from "lucide-react";
import { tr } from "../lib/app-language";

interface ServiceQuickLink {
  readonly label: string;
  readonly href: string;
}

// Labels are resolved via tr() at call time, so pairs of vi/en are stored here instead of final strings.
const SERVICE_QUICK_LINKS: Record<string, ReadonlyArray<{ vi: string; en: string; href: string }>> = {
  kimicode: [
    { vi: "Trang chủ", en: "Website", href: "https://www.kimi.com?aff=castor" },
  ],
  kimiCodingPlan: [
    { vi: "Trang chủ", en: "Website", href: "https://www.kimi.com?aff=castor" },
  ],
  kkaiapi: [
    { vi: "Trang chủ", en: "Website", href: "https://kkaiapi.com/" },
    { vi: "Tài liệu API", en: "API docs", href: "https://kkaiapi.com/docs" },
    { vi: "Mô hình & giá", en: "Models & pricing", href: "https://kkaiapi.com/models" },
  ],
  moonshot: [
    { vi: "Nền tảng cho nhà phát triển", en: "Developer platform", href: "https://platform.kimi.com?aff=castor" },
  ],
  openrouter: [
    { vi: "API Keys", en: "API Keys", href: "https://openrouter.ai/keys" },
    { vi: "Mô hình", en: "Models", href: "https://openrouter.ai/models" },
    { vi: "Tài liệu", en: "Docs", href: "https://openrouter.ai/docs/api-reference/overview" },
  ],
};

export function getServiceQuickLinks(serviceId: string): ReadonlyArray<ServiceQuickLink> {
  return (SERVICE_QUICK_LINKS[serviceId] ?? []).map((link) => ({
    label: tr(link.vi, link.en),
    href: link.href,
  }));
}

export function ServiceQuickLinks({
  serviceId,
  variant = "detail",
  className = "",
}: {
  readonly serviceId: string;
  readonly variant?: "card" | "detail";
  readonly className?: string;
}) {
  const links = getServiceQuickLinks(serviceId);
  if (links.length === 0) return null;

  const compact = variant === "card";
  return (
    <div
      className={[
        "flex flex-wrap items-center gap-1.5 text-muted-foreground/70",
        compact ? "text-[11px]" : "text-xs",
        className,
      ].filter(Boolean).join(" ")}
    >
      {!compact && <span className="mr-0.5">{tr("Liên kết nhanh", "Quick links")}</span>}
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className={[
            "inline-flex items-center gap-1 rounded-md border border-border/40 bg-card/50 font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground",
            compact ? "px-1.5 py-0.5" : "px-2 py-1",
          ].join(" ")}
        >
          {link.label}
          <ExternalLink size={compact ? 10 : 11} />
        </a>
      ))}
    </div>
  );
}
