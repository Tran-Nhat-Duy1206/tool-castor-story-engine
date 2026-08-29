import { useEffect, useState } from "react";
import type { SSEMessage } from "../../hooks/use-sse";
import { Loader2, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { tr } from "../../lib/app-language";
import { SidebarCard } from "./SidebarCard";

// Each step's `key` is also the match key against backend SSE log messages
// (the backend currently emits Chinese messages). Display picks vi/en by the
// current language; matching accepts both vi and en keys, so localizing the
// backend messages later won't require changes here.
interface ProgressStep {
  /** Raw backend log message used for matching (currently Chinese). */
  readonly key: string;
  readonly vi: string;
  readonly en: string;
}

const INIT_BOOK_STEPS: ReadonlyArray<ProgressStep> = [
  { key: "生成基础设定", vi: "Tạo cài đặt nền tảng", en: "Generate foundation" },
  { key: "保存书籍配置", vi: "Lưu cấu hình sách", en: "Save book config" },
  { key: "写入基础设定文件", vi: "Ghi tệp nền tảng", en: "Write foundation files" },
  { key: "初始化控制文档", vi: "Khởi tạo tài liệu điều khiển", en: "Initialize control docs" },
  { key: "创建初始快照", vi: "Tạo snapshot ban đầu", en: "Create initial snapshot" },
];

const WRITE_CHAPTER_STEPS: ReadonlyArray<ProgressStep> = [
  { key: "准备章节输入", vi: "Chuẩn bị đầu vào chương", en: "Prepare chapter input" },
  { key: "撰写章节草稿", vi: "Soạn bản nháp chương", en: "Draft the chapter" },
  { key: "落盘最终章节", vi: "Lưu chương cuối cùng", en: "Save final chapter" },
  { key: "生成最终真相文件", vi: "Tạo tệp sự thật cuối cùng", en: "Generate final truth files" },
  { key: "校验真相文件变更", vi: "Xác thực thay đổi tệp sự thật", en: "Validate truth file changes" },
  { key: "同步记忆索引", vi: "Đồng bộ chỉ mục ký ức", en: "Sync memory index" },
  { key: "更新章节索引与快照", vi: "Cập nhật chỉ mục và snapshot chương", en: "Update chapter index and snapshot" },
];

type StepStatus = "pending" | "active" | "done";

interface ProgressSectionProps {
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

export function ProgressSection({ sse }: ProgressSectionProps) {
  const [operation, setOperation] = useState<"idle" | "init" | "write">("idle");
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [activeStep, setActiveStep] = useState<string | null>(null);

  useEffect(() => {
    const latest = sse.messages;
    if (latest.length === 0) return;
    const last = latest[latest.length - 1];

    if (last.event === "book:creating") {
      setOperation("init");
      setCompletedSteps(new Set());
      setActiveStep(null);
    } else if (last.event === "write:start") {
      setOperation("write");
      setCompletedSteps(new Set());
      setActiveStep(null);
    } else if (last.event === "book:created" || last.event === "write:complete") {
      // Mark all steps done (the set stores step keys / raw backend messages)
      const steps = operation === "init" ? INIT_BOOK_STEPS : WRITE_CHAPTER_STEPS;
      setCompletedSteps(new Set(steps.map((s) => s.key)));
      setActiveStep(null);
    } else if (last.event === "log") {
      const data = last.data as { message?: string } | null;
      const message = data?.message;
      if (message && operation !== "idle") {
        // Mark previous active step as done, set new active
        setCompletedSteps((prev) => {
          if (activeStep) {
            const next = new Set(prev);
            next.add(activeStep);
            return next;
          }
          return prev;
        });
        setActiveStep(message);
      }
    }
  }, [sse.messages]);

  const steps = operation === "init" ? INIT_BOOK_STEPS
    : operation === "write" ? WRITE_CHAPTER_STEPS
    : null;

  if (!steps) return null;

  return (
    <SidebarCard title={tr("Tiến độ", "Progress")}>
      <ul className="space-y-2">
        {steps.map((step, i) => {
          const status: StepStatus =
            completedSteps.has(step.key) || completedSteps.has(step.en) ? "done"
            : activeStep === step.key || activeStep === step.en ? "active"
            : "pending";
          return (
            <li key={step.key} className="flex items-center gap-2.5">
              <StepIndicator index={i + 1} status={status} />
              <span className={cn(
                "text-xs",
                status === "done" && "text-muted-foreground",
                status === "active" && "text-foreground font-medium",
                status === "pending" && "text-muted-foreground/50",
              )}>
                {tr(step.vi, step.en)}
              </span>
            </li>
          );
        })}
      </ul>
    </SidebarCard>
  );
}

function StepIndicator({ index, status }: { readonly index: number; readonly status: StepStatus }) {
  if (status === "done") {
    return (
      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
        <Check size={12} className="text-primary-foreground" strokeWidth={2.5} />
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center shrink-0">
        <Loader2 size={10} className="text-primary animate-spin" />
      </div>
    );
  }
  return (
    <div className="w-5 h-5 rounded-full border border-border/60 flex items-center justify-center shrink-0">
      <span className="text-[10px] text-muted-foreground/50">{index}</span>
    </div>
  );
}
