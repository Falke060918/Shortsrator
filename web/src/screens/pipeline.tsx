import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GateDiamond } from "@/components/parts/gate-diamond";
import { StatusChip } from "@/components/parts/status-chip";
import { episodeFixture, shotTags, themeMeta } from "@/fixtures/data";
import { msToSec } from "@/lib/format";
import { DISPLAY_STAGES, gateStatuses, stageStatuses } from "@/lib/pipeline";
import { cn } from "@/lib/utils";
import type { GateStatus } from "@/lib/pipeline";
import type { ScreenId } from "@/screens/types";

const GATE_LABELS = [
  { key: "SCRIPT_GATE", label: "GATE 1 시나리오", stateText: { passed: "통과 · 08-20", waiting: "대기", locked: "잠김" } },
  { key: "FRAME_GATE", label: "GATE 2 첫 프레임", stateText: { passed: "통과", waiting: "대기 — 1/5컷", locked: "잠김" } },
  { key: "CLIP_GATE", label: "GATE 3 클립 선별", stateText: { passed: "통과", waiting: "대기", locked: "잠김" } },
  { key: "FINAL_GATE", label: "GATE 4 최종", stateText: { passed: "통과", waiting: "대기", locked: "잠김" } },
] as const;

/** 샷별 그라디언트 썸네일 (fixture) */
const shotThumb: Record<number, string | undefined> = {
  0: "g-pantheon-ext",
  1: "g-pantheon-int",
};

const clipChip: Record<number, { tone: "wait" | "run" | "locked"; text: string }> = {
  0: { tone: "wait", text: "프레임 선별 대기" },
  1: { tone: "run", text: "후보 생성 중 2/3" },
  2: { tone: "locked", text: "게이트 2 이후" },
  3: { tone: "locked", text: "게이트 2 이후" },
  4: { tone: "locked", text: "게이트 2 이후" },
};

function RuleItem({
  k,
  children,
  first,
}: {
  k: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={cn(
        "py-2 text-xs leading-relaxed text-muted-foreground",
        !first && "border-t border-line-soft",
      )}
    >
      <span className="mb-0.5 block font-mono text-[10px] font-semibold tracking-[0.08em] text-faint">
        {k}
      </span>
      {children}
    </div>
  );
}

function RulePanel({
  stageNo,
  title,
  now,
  children,
}: {
  stageNo: string;
  title: string;
  now?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open
      className={cn(
        "overflow-hidden rounded-[10px] border bg-card",
        now && "border-gold/30",
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-[12.5px] font-bold hover:bg-white/[0.02] [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "flex-none rounded border px-1.5 py-px font-mono text-[10.5px] font-semibold text-faint",
            now && "border-gold/40 text-gold",
          )}
        >
          {stageNo}
        </span>
        {title}
      </summary>
      <div className="border-t border-line-soft px-3.5 pt-0.5 pb-3">{children}</div>
    </details>
  );
}

/** 화면 2 — 파이프라인 진행 */
export function PipelineScreen({ goto }: { goto: (s: ScreenId) => void }) {
  const ep = episodeFixture;
  const stages = stageStatuses(ep.state);
  const gates = gateStatuses(ep.state, ep.gateHistory);
  const totalMs = ep.shots.reduce((a, s) => a + s.duration_ms, 0);
  const stageSubs = ["5컷 · 완료", `실측 ${msToSec(totalMs)}s`, "후보 생성 중", "—", "ffmpeg · 9:16"];

  return (
    <section aria-label="파이프라인 진행">
      <p className="mb-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">
        {ep.id} · Pipeline
      </p>
      <h1 className="text-[22px] font-bold tracking-tight">{ep.topicTitle}</h1>
      <p className="mb-6 text-[13.5px] text-muted-foreground">
        단계 사이의 <span className="text-gold">◆ 금색 마름모</span>가 사람이 개입하는 컨펌
        게이트입니다. 게이트를 통과해야 다음 단계가 열립니다.
      </p>

      {/* 스테퍼: 단계 5 + 게이트 4 인터리브 */}
      <Card
        className="flex-row items-stretch gap-0 overflow-x-auto rounded-[10px] px-5 pt-5.5 pb-4.5 shadow-none"
        aria-label="파이프라인 단계와 게이트"
      >
        {DISPLAY_STAGES.map((stage, i) => {
          const st = stages[i];
          const gate = i < GATE_LABELS.length ? GATE_LABELS[i] : null;
          const gst: GateStatus | null = gate ? gates[gate.key] : null;
          return (
            <div key={stage.no} className="contents">
              <div className="flex min-w-[86px] flex-1 flex-col items-center gap-2">
                <div
                  className={cn(
                    "flex size-[30px] items-center justify-center rounded-full border-[1.5px] bg-surface-2 font-mono text-xs font-semibold text-faint",
                    st === "done" && "border-ok bg-ok-dim text-ok",
                    st === "now" &&
                      "border-gold bg-gold-dim text-gold shadow-[0_0_14px_rgba(227,179,76,0.25)]",
                  )}
                >
                  {stage.no}
                </div>
                <div
                  className={cn(
                    "text-[12.5px] font-semibold whitespace-nowrap text-faint",
                    st === "done" && "text-foreground",
                    st === "now" && "text-gold",
                  )}
                >
                  {stage.name}
                </div>
                <div className="text-[11px] whitespace-nowrap text-faint">{stageSubs[i]}</div>
              </div>
              {gate && gst && (
                <div className="flex min-w-[74px] flex-col items-center gap-1.5 pt-2">
                  <div className="flex w-full items-center">
                    <span className={cn("h-[1.5px] flex-1 bg-border", gst === "passed" && "bg-ok")} />
                    <GateDiamond
                      state={gst === "passed" ? "passed" : gst === "waiting" ? "waiting" : "locked"}
                      className="mx-1.5 size-3"
                    />
                    <span
                      className={cn(
                        "h-[1.5px] flex-1 bg-border",
                        gst === "passed" && stages[i + 1] !== "todo" && "bg-ok",
                      )}
                    />
                  </div>
                  <div className="font-mono text-[10.5px] tracking-[0.04em] whitespace-nowrap text-faint">
                    {gate.label}
                  </div>
                  <div
                    className={cn(
                      "text-[10.5px] font-semibold whitespace-nowrap",
                      gst === "passed" && "text-ok",
                      gst === "waiting" && "text-gold",
                      gst === "locked" && "text-locked",
                    )}
                  >
                    {gate.stateText[gst]}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* 단계별 적용 규칙 */}
      <div className="mt-5.5 mb-3 flex items-baseline gap-2.5">
        <h3 className="text-[13.5px] font-bold">단계별 적용 규칙</h3>
        <span className="text-xs text-faint">
          테마가 각 단계에 강제하는 규칙 — 패널을 접고 펼 수 있습니다
        </span>
        <span className="ml-auto font-mono text-[11px] text-faint">{themeMeta.themeRef}</span>
      </div>
      <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        <RulePanel stageNo="STEP 2" title="TTS — 오디오 우선">
          <RuleItem k="VOICE LOCK" first>
            다큐/미스터리 톤의 깊고 웅장한 남성 보이스로 <span className="text-gold">고정</span> —
            채널 전체에서 절대 바꾸지 않는다. 1순위 ElevenLabs, 한국어 억양 이슈 시 Typecast.
          </RuleItem>
          <RuleItem k="실측 원칙">
            문장 단위로 TTS를 먼저 생성 —{" "}
            <span className="text-gold">오디오 실측 길이 = 컷 길이</span>. 문장별 파일 길이가 곧 컷
            길이다.
          </RuleItem>
          <RuleItem k="대본 규칙">
            한국어 · 초당 4~5음절 · 문장 1개 = 샷 1개 · 훅 → 정보 → 마무리.
          </RuleItem>
        </RulePanel>

        <RulePanel stageNo="STEP 3" title="첫 프레임 — 이미지 생성" now>
          <RuleItem k="STYLE LOCK — 모든 프롬프트 끝에 고정 부착" first>
            <span className="font-mono text-[11px] text-foreground">{themeMeta.styleLock}</span>
          </RuleItem>
          <RuleItem k="MASTER ASSET — 주제당 기준 4장 재사용">
            <span className="font-mono text-[11px] text-foreground">
              EXTERIOR · INTERIOR · CROSS-SECTION · CUTAWAY
            </span>{" "}
            — 이걸 안 쓰면 컷마다 다른 건물이 나온다.
          </RuleItem>
          <RuleItem k="AI 생성 금지">
            <span className="font-semibold text-destructive">
              화살표(→↓) · X 표시 · 원 · 라인 · 수치 · 그래프
            </span>{" "}
            — 조립 후 편집 단계에서 오버레이.
          </RuleItem>
          <RuleItem k="후보 · 반려">
            샷당 2~4장 생성 · <span className="text-gold">반려율 60%가 정상</span> — 승인 데이터가 첫
            프레임 승인률(목표 ≥40%)이 된다.
          </RuleItem>
        </RulePanel>

        <RulePanel stageNo="STEP 4" title="클립 — I2V 영상 생성">
          <RuleItem k="프롬프트 공식 — motion만 기술" first>
            <span className="font-mono text-[11px] text-foreground">
              CAMERA + PATH + REVEAL + ENV MOTION + CONTINUITY
            </span>{" "}
            — 구도·조명은 첫 프레임이 이미 정의했다.
          </RuleItem>
          <RuleItem k="동작 개수 제한">
            한 클립 카메라 동작 <span className="text-gold">1~2개</span> · 리빌 컷만 최대
            3개(A→B→C). 한꺼번에 넣으면 망가진다.
          </RuleItem>
          <RuleItem k="채택 원칙">
            샷당 2~3회 생성 · 8초 중 <span className="text-gold">1.5~3초만 발췌</span> — 폐기 전제,
            채택률 목표 ≥30%.
          </RuleItem>
        </RulePanel>

        <RulePanel stageNo="STEP 5" title="조립 — ffmpeg">
          <RuleItem k="규격" first>
            <span className="font-mono text-[11px] text-foreground">9:16 · 1080×1920 · ≤60s</span>{" "}
            Shorts 검증 — 컷 길이는 항상 TTS 실측을 따른다.
          </RuleItem>
          <RuleItem k="컷 리듬">
            초반 3컷 1.5~2초 → 중반 2.5~3초 → <span className="text-gold">리빌 컷만 4초</span>. 균등
            분할 금지.
          </RuleItem>
          <RuleItem k="BGM · SFX">
            웅장/미스터리 오케스트라 <span className="text-gold">2~3곡만 로테이션</span> · 리빌 지점
            저음 임팩트 ·{" "}
            <span className="font-semibold text-destructive">무음 0.5초 이상 금지</span>.
          </RuleItem>
        </RulePanel>
      </div>

      {/* 컷 테이블 + 9:16 미리보기 */}
      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_300px]">
        <Card className="gap-0 overflow-hidden rounded-[10px] py-0 shadow-none">
          <div className="flex items-baseline gap-2.5 border-b px-4.5 pt-4 pb-3">
            <h3 className="text-[13.5px] font-bold">컷 구성 — 15초 · 5컷</h3>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              TTS 실측 합계{" "}
              <strong className="font-semibold text-foreground">{msToSec(totalMs)}s</strong> · 컷
              길이 = 오디오 실측
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3.5 font-mono text-[11px] tracking-[0.06em] text-faint">컷</TableHead>
                <TableHead className="px-3.5 font-mono text-[11px] tracking-[0.06em] text-faint">
                  내레이션 · 카메라
                </TableHead>
                <TableHead className="px-3.5 font-mono text-[11px] tracking-[0.06em] text-faint">
                  TTS 실측
                </TableHead>
                <TableHead className="px-3.5 font-mono text-[11px] tracking-[0.06em] text-faint">
                  첫 프레임
                </TableHead>
                <TableHead className="px-3.5 font-mono text-[11px] tracking-[0.06em] text-faint">클립</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ep.shots.map((shot) => (
                <TableRow key={shot.id} className="border-line-soft hover:bg-white/[0.015]">
                  <TableCell className="px-3.5 py-3 align-middle font-mono text-xs whitespace-nowrap text-muted-foreground">
                    C{shot.idx + 1}
                    {shotTags[shot.id] && (
                      <>
                        <br />
                        <span className="text-[10px]">{shotTags[shot.id]}</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[560px] px-3.5 py-3 align-middle text-[13px] whitespace-normal">
                    "{shot.narration}"
                    <span className="mt-0.5 block font-mono text-[11px] text-faint">
                      {shot.camera_moves.join(" · ")}
                    </span>
                  </TableCell>
                  <TableCell className="px-3.5 py-3 align-middle font-mono text-[13px] whitespace-nowrap">
                    {msToSec(shot.duration_ms)}
                    <span className="text-[11px] text-faint">s</span>
                  </TableCell>
                  <TableCell className="px-3.5 py-3 align-middle">
                    {shotThumb[shot.idx] ? (
                      <div
                        role="img"
                        aria-label={`C${shot.idx + 1} 첫 프레임 (더미)`}
                        className={cn(
                          "relative h-[78px] w-11 flex-none overflow-hidden rounded-[5px] border",
                          shotThumb[shot.idx],
                        )}
                      >
                        <span className="absolute inset-x-0 bottom-[3px] text-center font-mono text-[8px] text-white/45">
                          9:16
                        </span>
                      </div>
                    ) : (
                      <div className="flex h-[78px] w-11 flex-none items-center justify-center rounded-[5px] border bg-surface-2">
                        <span className="text-[15px] leading-none text-faint">·</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="px-3.5 py-3 align-middle">
                    <StatusChip tone={clipChip[shot.idx].tone}>{clipChip[shot.idx].text}</StatusChip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center gap-2.5 border-t border-gold/25 bg-gold-dim px-4.5 py-3 text-[12.5px] text-gold">
            <GateDiamond />
            게이트 2 — 컷 1의 첫 프레임 후보 4장이 선별을 기다리고 있습니다.
            <Button size="sm" className="ml-auto" onClick={() => goto("frame-gate")}>
              선별하러 가기
            </Button>
          </div>
        </Card>

        <Card className="sticky top-4 gap-0 rounded-[10px] p-4 shadow-none">
          <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
            9:16 미리보기 — C1 승인 대기 프레임
          </h3>
          <div
            role="img"
            aria-label="세로 9:16 숏츠 미리보기 (더미)"
            className="g-phone relative aspect-[9/16] w-full overflow-hidden rounded-[14px] border"
          >
            <span className="absolute top-2.5 left-2.5 rounded bg-black/35 px-1.5 py-0.5 font-mono text-[10px] text-white/55">
              1080×1920
            </span>
            <div className="absolute right-3 bottom-8 left-3 text-center text-[12.5px] leading-snug font-bold text-[#f4d68a] [text-shadow:0_1px_4px_rgba(0,0,0,0.7)]">
              이 돔은 2000년째
              <br />
              무너지지 않고 있습니다
            </div>
            <div className="absolute right-3 bottom-3 left-3 flex gap-[3px]" aria-hidden>
              {ep.shots.map((s, i) => (
                <i
                  key={s.id}
                  className={cn("h-[3px] rounded-sm bg-white/28", i === 0 && "bg-gold")}
                  style={{ flex: s.duration_ms / 1000 }}
                />
              ))}
            </div>
          </div>
          <div className="mt-3.5" aria-label="컷 길이 타임라인 (TTS 실측 비례)">
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[3px]">
              {ep.shots.map((s, i) => (
                <i
                  key={s.id}
                  title={`C${i + 1} ${msToSec(s.duration_ms)}s`}
                  className={cn("block", i < 2 ? "bg-ok" : i === 2 ? "bg-gold" : "bg-border")}
                  style={{ flex: s.duration_ms / 1000 }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
              <span>0s</span>
              <span>{msToSec(totalMs)}s</span>
            </div>
          </div>
          <p className="mt-3 text-[11.5px] leading-normal text-faint">
            막대 폭은 TTS 실측 길이에 비례합니다. 조립 단계에서 컷 길이는 항상 오디오 실측을
            따릅니다.
          </p>
        </Card>
      </div>
    </section>
  );
}
