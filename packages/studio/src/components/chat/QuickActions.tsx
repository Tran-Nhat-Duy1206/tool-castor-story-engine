import {
  Zap,
  Search,
  FileOutput,
  TrendingUp,
} from "lucide-react";

export interface QuickActionsProps {
  readonly onAction: (command: string, requestedIntent?: "write_next") => void;
  readonly disabled: boolean;
  readonly isVi: boolean;
}

interface ChipDef {
  readonly icon: React.ReactNode;
  readonly labelVi: string;
  readonly labelEn: string;
  readonly commandVi: string;
  readonly commandEn: string;
  readonly requestedIntent?: "write_next";
}

const CHIPS: ReadonlyArray<ChipDef> = [
  {
    icon: <Zap size={12} />,
    labelVi: "Viết chương tiếp theo",
    labelEn: "Write next",
    commandVi: "Viết chương tiếp theo",
    commandEn: "write next",
    requestedIntent: "write_next",
  },
  {
    icon: <Search size={12} />,
    labelVi: "Kiểm tra",
    labelEn: "Audit",
    commandVi: "Kiểm tra",
    commandEn: "audit",
  },
  {
    icon: <FileOutput size={12} />,
    labelVi: "Xuất",
    labelEn: "Export",
    commandVi: "Xuất toàn bộ sách",
    commandEn: "export book",
  },
  {
    icon: <TrendingUp size={12} />,
    labelVi: "Radar thị trường",
    labelEn: "Market radar",
    commandVi: "Quét xu hướng thị trường",
    commandEn: "scan market trends",
  },
];

export function QuickActions({ onAction, disabled, isVi }: QuickActionsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto px-1 py-1">
      {CHIPS.map((chip) => {
        const label = isVi ? chip.labelVi : chip.labelEn;
        const command = isVi ? chip.commandVi : chip.commandEn;
        return (
          <button
            key={label}
            onClick={() => onAction(command, chip.requestedIntent)}
            disabled={disabled}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/30 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-40 disabled:pointer-events-none group"
          >
            <span className="group-hover:scale-110 transition-transform">{chip.icon}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
