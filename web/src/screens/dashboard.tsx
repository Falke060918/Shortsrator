import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GateDiamond } from "@/components/parts/gate-diamond";
import { StatusChip } from "@/components/parts/status-chip";
import { qualityStats, stateFixture } from "@/fixtures/data";
import { stageStatuses } from "@/lib/pipeline";
import { cn } from "@/lib/utils";
import type { ScreenId } from "@/screens/types";

const MINI_LABELS = ["대본", "TTS", "첫 프레임", "클립", "조립"];

/** 화면 1 — 에피소드 대시보드 */
export function DashboardScreen({ goto }: { goto: (s: ScreenId) => void }) {
  const featured = stateFixture.episodes[0];
  const done = stateFixture.episodes.filter((e) => e.state === "PUBLISHED");
  const mini = stageStatuses(featured.state);

  return (
    <section aria-label="에피소드 대시보드">
      <p className="mb-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">
        Episodes
      </p>
      <h1 className="text-[22px] font-bold tracking-tight">에피소드 대시보드</h1>
      <p className="mb-6 text-[13.5px] text-muted-foreground">
        진행 중인 에피소드와 대기 주제 큐. 게이트에서 멈춘 에피소드가 가장 먼저 보입니다.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          {/* 진행 중 에피소드 (featured) */}
          <Card className="gap-0 rounded-[10px] border-gold/30 bg-[linear-gradient(140deg,rgba(227,179,76,0.05),transparent_45%)] p-5 shadow-none">
            <div className="mb-3.5 flex items-start gap-3">
              <div>
                <div className="text-[16.5px] font-bold">{featured.topicTitle}</div>
                <div className="mt-1 text-xs text-faint">
                  에피소드 <span className="font-mono text-[11.5px]">{featured.id}</span> · 15초 ·
                  5컷 · 시작 2026-08-20
                </div>
              </div>
              <StatusChip tone="wait" className="ml-auto">
                게이트 2 대기 — 첫 프레임 컨펌
              </StatusChip>
            </div>

            {/* 미니 파이프라인 */}
            <div className="my-2 flex items-center gap-[5px]" aria-label="파이프라인 진행 상태">
              {mini.map((st, i) => (
                <div key={MINI_LABELS[i]} className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      "h-1 w-full rounded-sm bg-border",
                      st === "done" && "bg-ok",
                      st === "now" && "bg-gold",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[11px] text-faint",
                      st === "done" && "text-muted-foreground",
                      st === "now" && "font-semibold text-gold",
                    )}
                  >
                    {MINI_LABELS[i]}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <GateDiamond />
              <span className="text-[12.5px] text-muted-foreground">
                컷 1의 후보 프레임 4장이 생성됨 — 선별을 기다리는 중
              </span>
              <Button className="ml-auto" onClick={() => goto("pipeline")}>
                진행 화면 열기
              </Button>
            </div>
          </Card>

          {/* 지난 에피소드 */}
          <Card className="gap-0 rounded-[10px] py-0 shadow-none">
            <h3 className="px-4.5 pt-3.5 text-xs font-semibold text-muted-foreground">
              지난 에피소드
            </h3>
            {done.map((e, i) => (
              <div
                key={e.id}
                className={cn(
                  "flex items-center gap-3 px-4.5 py-3.5",
                  i > 0 && "border-t border-line-soft",
                )}
              >
                <div>
                  <div className="text-[13.5px] font-semibold">{e.topicTitle}</div>
                  <div className="font-mono text-xs text-faint">
                    {e.id} · 15s · 최종 mp4 · {e.updatedAt.slice(0, 10)}
                  </div>
                </div>
                <StatusChip tone="ok" className="ml-auto">
                  완주
                </StatusChip>
              </div>
            ))}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {/* 테마 품질 지표 */}
          <Card className="gap-0 rounded-[10px] px-4.5 py-4 shadow-none">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
              테마 품질 지표 (최근 10회 생성)
            </h3>
            {qualityStats.map((s, i) => (
              <div
                key={s.label}
                className={cn(
                  "flex items-baseline justify-between py-1.5",
                  i > 0 && "border-t border-line-soft",
                )}
              >
                <span className="text-[12.5px] text-muted-foreground">{s.label}</span>
                <span
                  className={cn(
                    "font-mono text-[13px]",
                    s.tone === "ok" && "text-ok",
                    s.tone === "warn" && "text-gold",
                  )}
                >
                  {s.value} <span className="text-[11px] text-faint">{s.goal}</span>
                </span>
              </div>
            ))}
          </Card>

          {/* 대기 주제 큐 */}
          <Card className="gap-0 rounded-[10px] px-4.5 py-4 shadow-none">
            <h3 className="text-xs font-semibold text-muted-foreground">
              대기 주제 큐{" "}
              <span className="font-mono text-faint">{stateFixture.topicQueue.length}</span>
            </h3>
            <ul className="mt-2">
              {stateFixture.topicQueue.map((t, i) => (
                <li
                  key={t.id}
                  className={cn(
                    "flex items-center gap-2.5 py-2.5",
                    i > 0 && "border-t border-line-soft",
                  )}
                >
                  <span className="w-[22px] flex-none font-mono text-[11px] text-faint">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[13px]">{t.title}</span>
                  <span className="ml-auto text-[11px] whitespace-nowrap text-faint">
                    {t.status}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Button variant="ghost" size="sm">
                + 큐에서 새 에피소드 시작
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
