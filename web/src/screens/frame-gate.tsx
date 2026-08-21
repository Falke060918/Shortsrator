import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GateDiamond } from "@/components/parts/gate-diamond";
import {
  episodeFixture,
  frameCandidates,
  generationRound,
  shotTags,
  themeMeta,
} from "@/fixtures/data";
import { msToSec } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 화면 3 — 컨펌 게이트 (GATE2 · 첫 프레임 선별) */
export function FrameGateScreen() {
  const ep = episodeFixture;
  // 후보가 있는 첫 샷부터 시작
  const [shotIdx, setShotIdx] = useState(0);
  const [pickedId, setPickedId] = useState<string | null>("CAND-B");
  const [approved, setApproved] = useState<Record<string, string>>({}); // shotId → candId
  const [round, setRound] = useState<Record<string, number>>(generationRound);

  const shot = ep.shots[shotIdx];
  const candidates = frameCandidates[shot.id] ?? [];
  const picked = candidates.find((c) => c.id === pickedId) ?? null;
  const approvedCount = Object.keys(approved).length;

  function approve() {
    if (!picked) return;
    setApproved((prev) => ({ ...prev, [shot.id]: picked.id }));
    // 다음 컷으로 이동 — 후보 없으면 화면이 "후보 생성 대기"를 보여준다
    if (shotIdx < ep.shots.length - 1) {
      setShotIdx(shotIdx + 1);
      const next = frameCandidates[ep.shots[shotIdx + 1].id] ?? [];
      setPickedId(next[0]?.id ?? null);
    }
  }

  function rejectAll() {
    setRound((prev) => ({ ...prev, [shot.id]: (prev[shot.id] ?? 1) + 1 }));
    setPickedId(null);
  }

  return (
    <section aria-label="첫 프레임 컨펌 게이트">
      <p className="mb-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">
        {ep.id} · Gate 2 / 4
      </p>
      <h1 className="text-[22px] font-bold tracking-tight">첫 프레임 컨펌 게이트</h1>
      <p className="mb-6 text-[13.5px] text-muted-foreground">
        컷마다 후보 중 1장을 승인해야 클립(I2V) 단계가 열립니다. 마음에 드는 후보가 없으면 전체 반려
        후 재생성합니다.
      </p>

      {/* 게이트 헤더 */}
      <Card className="mb-5 flex-row items-center gap-3.5 rounded-[10px] border-gold/30 bg-[linear-gradient(120deg,rgba(227,179,76,0.07),transparent_55%)] px-5 py-4 shadow-none">
        <GateDiamond className="size-3.5" />
        <div>
          <b className="text-sm">게이트 2 — 첫 프레임 선별</b>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {ep.topicTitle} · 마스터 애셋 4장 기준으로 생성됨
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="font-mono text-lg font-semibold text-gold" data-testid="approved-count">
            {approvedCount} / {ep.shots.length}
          </div>
          <div className="text-[11px] text-faint">승인된 컷</div>
        </div>
      </Card>

      {/* 컷 정보 */}
      <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
        <span className="text-[15px] font-bold">
          컷 {shot.idx + 1}
          {shotTags[shot.id] ? ` · ${shotTags[shot.id]}` : ""}
        </span>
        <span className="text-[13px] text-muted-foreground">
          "{shot.narration}" — {shot.camera_moves[0]}
        </span>
        <span className="ml-auto font-mono text-xs text-faint">
          TTS {msToSec(shot.duration_ms)}s · 후보 {candidates.length}장 · 생성{" "}
          {round[shot.id] ?? 1}회차
        </span>
      </div>

      {/* 후보 그리드 */}
      {candidates.length > 0 ? (
        <div
          className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="cand-grid"
        >
          {candidates.map((cand) => {
            const on = cand.id === pickedId;
            return (
              <Card
                key={cand.id}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                onClick={() => setPickedId(cand.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPickedId(cand.id);
                  }
                }}
                className={cn(
                  "cursor-pointer gap-0 overflow-hidden rounded-[10px] py-0 shadow-none transition-[border-color,transform] hover:-translate-y-0.5 hover:border-faint",
                  on &&
                    "border-gold shadow-[0_0_0_1px_var(--gold),0_6px_22px_rgba(227,179,76,0.16)]",
                )}
              >
                <div className={cn("relative aspect-[9/16]", cand.gradientClass)}>
                  <span className="absolute top-2 left-2 rounded bg-black/45 px-1.5 py-0.5 font-mono text-[10px] text-white/75">
                    {cand.id}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-2 right-2 flex size-5 items-center justify-center rounded-full border-[1.5px] border-white/55 bg-black/30 text-[11px] text-transparent",
                      on && "border-gold bg-gold font-bold text-[#17130a]",
                    )}
                  >
                    ✓
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="text-xs font-semibold">{cand.label}</span>
                  <span className="ml-auto font-mono text-[10.5px] text-faint">
                    seed {cand.seed}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="items-center gap-1 rounded-[10px] border-dashed px-5 py-10 text-center shadow-none">
          <p className="text-[13.5px] font-semibold">이 컷의 후보가 아직 없습니다</p>
          <p className="text-[12.5px] text-muted-foreground">
            후보 프레임 생성이 끝나면 여기에서 선별할 수 있습니다 — 재생성 {round[shot.id] ?? 1}
            회차 대기 중.
          </p>
        </Card>
      )}

      {/* 이미지 생성 규칙 3분할 */}
      <div className="mt-4.5 grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr_1fr]">
        <div className="rounded-md border border-dashed bg-surface-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <b className="font-semibold tracking-[0.06em] text-faint">STYLE LOCK</b> — 모든 후보에
          동일 부착됨
          <br />
          {themeMeta.styleLock}
        </div>
        <div className="rounded-md border border-dashed bg-surface-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <b className="font-semibold tracking-[0.06em] text-faint">MASTER ASSET</b> — 주제당 기준
          4장 재사용
          {themeMeta.masterAssets.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <b className="min-w-[108px] font-semibold text-faint">{k}</b> {v}
            </div>
          ))}
        </div>
        <div className="rounded-md border border-dashed bg-surface-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <b className="font-semibold tracking-[0.06em] text-faint">AI 생성 금지</b> — 편집
          오버레이로만
          <br />
          <span className="font-semibold text-destructive">
            화살표(→↓) · X 표시 · 원 · 라인 · 수치 · 그래프
          </span>
          <br />
          영상은 피사체·카메라·구조 변화만 생성.
          <br />
          반려율 60%는 정상 — 승인률 목표 ≥40%.
        </div>
      </div>

      {/* 액션 바 */}
      <Card className="mt-4.5 flex-row flex-wrap items-center gap-2.5 rounded-[10px] px-4.5 py-4 shadow-none">
        <span className="text-[13px] text-muted-foreground" data-testid="picked-info">
          {picked ? (
            <>
              선택됨:{" "}
              <strong className="font-semibold text-gold">
                {picked.id} · {picked.label}
              </strong>
            </>
          ) : (
            "선택된 후보가 없습니다"
          )}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" onClick={rejectAll} disabled={candidates.length === 0}>
          전체 반려 · 재생성 ({(round[shot.id] ?? 1) + 1}회차)
        </Button>
        <Button onClick={approve} disabled={!picked} data-testid="approve-frame">
          이 프레임 승인 → 다음 컷
        </Button>
      </Card>

      <p className="mt-3.5 flex items-center gap-2 text-[12.5px] text-locked">
        <GateDiamond state="locked" />
        클립(I2V) 단계는 {ep.shots.length}컷 모두 승인될 때까지 잠겨 있습니다 — 승인된 프레임만 영상
        생성에 사용됩니다.
      </p>
    </section>
  );
}
