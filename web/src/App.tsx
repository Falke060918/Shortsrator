import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { themeMeta } from "@/fixtures/data";
import { cn } from "@/lib/utils";
import { ClipGateScreen } from "@/screens/clip-gate";
import { DashboardScreen } from "@/screens/dashboard";
import { FrameGateScreen } from "@/screens/frame-gate";
import { PipelineScreen } from "@/screens/pipeline";
import { SettingsScreen } from "@/screens/settings";
import type { ScreenId } from "@/screens/types";

const TABS: { id: ScreenId; num: string; label: string }[] = [
  { id: "dashboard", num: "01", label: "에피소드 대시보드" },
  { id: "pipeline", num: "02", label: "파이프라인 진행" },
  { id: "frame-gate", num: "03", label: "컨펌 게이트 · 첫 프레임" },
  { id: "clip-gate", num: "04", label: "클립 발췌 · GATE 3" },
  { id: "settings", num: "05", label: "설정" },
];

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("dashboard");

  function goto(next: ScreenId) {
    setScreen(next);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="mx-auto max-w-[1560px] px-5 pb-20 sm:px-8">
      {/* 헤더 */}
      <header className="flex items-center gap-3.5 border-b border-line-soft pt-5 pb-4">
        <div className="flex items-baseline gap-2 text-[17px] font-bold tracking-tight">
          <span
            aria-hidden
            className="size-[11px] self-center rounded-full bg-[radial-gradient(circle_at_38%_32%,#f4d68a,var(--gold)_60%,#8f6c22)] shadow-[0_0_12px_rgba(227,179,76,0.55)]"
          />
          Shortsrator{" "}
          <small className="text-xs font-normal text-faint">숏츠 반자동 제작 파이프라인</small>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">
            <span className="size-1.5 rounded-full bg-destructive" />
            채널 · {themeMeta.channel}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/35 bg-gold-dim px-2.5 py-1 text-xs text-gold">
            <span className="size-1.5 rounded-full bg-gold" />
            테마 · {themeMeta.themeName} ({themeMeta.themeStatus})
          </span>
          <span className="hidden items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">
            <span className="size-1.5 rounded-full bg-ok" />
            로컬 실행 중
          </span>
        </div>
      </header>

      {/* 화면 전환 탭 */}
      <Tabs value={screen} onValueChange={(v) => goto(v as ScreenId)}>
        <TabsList
          variant="line"
          className="mt-4 mb-6 h-auto w-full justify-start gap-1 border-b border-line-soft p-0"
          aria-label="화면 전환"
        >
          {TABS.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className={cn(
                "flex-none px-3.5 pt-2.5 pb-3 text-[13.5px] text-muted-foreground",
                "after:bottom-[-1px] after:bg-gold data-[state=active]:font-semibold data-[state=active]:text-foreground",
              )}
            >
              <span
                className={cn(
                  "mr-1 font-mono text-[11px] text-faint",
                  screen === t.id && "text-gold",
                )}
              >
                {t.num}
              </span>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardScreen goto={goto} />
        </TabsContent>
        <TabsContent value="pipeline">
          <PipelineScreen goto={goto} />
        </TabsContent>
        <TabsContent value="frame-gate">
          <FrameGateScreen />
        </TabsContent>
        <TabsContent value="clip-gate">
          <ClipGateScreen />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsScreen />
        </TabsContent>
      </Tabs>

      <footer className="mt-14 flex flex-wrap gap-3.5 border-t border-line-soft pt-4 text-[11.5px] text-faint">
        <span>Shortsrator · fixture 데이터 (서버 연동 전)</span>
        <span className="font-mono text-[11px]">{themeMeta.themeRef}</span>
        <span className="font-mono text-[11px]">{themeMeta.adapterLine}</span>
      </footer>
    </div>
  );
}
