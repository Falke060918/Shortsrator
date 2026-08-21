import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ChipTone = "ok" | "wait" | "run" | "locked" | "queue";

const toneClass: Record<ChipTone, string> = {
  ok: "text-ok bg-ok-dim",
  wait: "text-gold bg-gold-dim",
  run: "text-info bg-info-dim",
  locked: "text-locked bg-locked/15",
  queue: "text-muted-foreground bg-muted-foreground/10",
};

/** 목업의 status-chip — shadcn Badge 확장 (앞 점 + 톤 색) */
export function StatusChip({
  tone,
  className,
  children,
}: {
  tone: ChipTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Badge
      className={cn(
        "gap-1.5 border-transparent text-[11.5px] font-semibold whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </Badge>
  );
}
