import { cn } from "@/lib/utils";

/** 금색 마름모 — 사람이 개입하는 게이트의 시그니처 마커 */
export function GateDiamond({
  state = "waiting",
  className,
}: {
  state?: "waiting" | "passed" | "locked";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[9px] flex-none rotate-45 rounded-[2px] border-[1.5px] border-gold bg-transparent",
        state === "passed" && "bg-gold shadow-[0_0_8px_rgba(227,179,76,0.5)]",
        state === "locked" && "border-locked opacity-55",
        className,
      )}
    />
  );
}
