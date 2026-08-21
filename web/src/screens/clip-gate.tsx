import { useEffect, useRef, useState } from "react";
import type { AdoptRequest } from "@shortsrator/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GateDiamond } from "@/components/parts/gate-diamond";
import { StatusChip } from "@/components/parts/status-chip";
import { clipAssets, episodeFixture, shotTags } from "@/fixtures/data";
import { msToSec, msToSecNum, secToMs100 } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 0.1초 단위 반올림 */
function round1(sec: number): number {
  return Math.round(sec * 10) / 10;
}

/**
 * 화면 4 — GATE3 클립 발췌 (목업에 없던 신설 화면).
 * 생성된 8초 클립에서 채택 구간을 0.1초 단위로 지정한다 — 숫자 입력 + 현재 위치 캡처.
 * 타임라인 드래그 위젯 없음 (이슈 #7 명세).
 */
export function ClipGateScreen() {
  const ep = episodeFixture;
  const shotsWithClips = ep.shots.filter((s) => (clipAssets[s.id] ?? []).length > 0);
  const [shotId, setShotId] = useState(shotsWithClips[0]?.id ?? ep.shots[0].id);
  const shot = ep.shots.find((s) => s.id === shotId) ?? ep.shots[0];
  const takes = clipAssets[shot.id] ?? [];
  const [assetId, setAssetId] = useState(takes[0]?.assetId ?? "");
  const asset = takes.find((t) => t.assetId === assetId) ?? takes[0] ?? null;

  // 플레이어 상태
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [mediaOk, setMediaOk] = useState(true);

  // 발췌 구간 (초, 0.1 단위)
  const clipSec = asset ? asset.duration_ms / 1000 : 8;
  const [inSec, setInSec] = useState(0);
  const [outSec, setOutSec] = useState(() => round1(msToSecNum(shot.duration_ms)));

  // 채택 결과: shotId → AdoptRequest (shared DTO — POST /api/shots/:id/adopt 바디 그대로)
  const [adopted, setAdopted] = useState<Record<string, AdoptRequest>>({});

  // 샷 전환 시 초기화
  function selectShot(id: string) {
    const s = ep.shots.find((x) => x.id === id);
    if (!s) return;
    const first = (clipAssets[id] ?? [])[0];
    setShotId(id);
    setAssetId(first?.assetId ?? "");
    setInSec(0);
    setOutSec(round1(msToSecNum(s.duration_ms)));
    setPlaying(false);
    setNow(0);
    setMediaOk(true);
  }

  function selectTake(id: string) {
    setAssetId(id);
    setPlaying(false);
    setNow(0);
    setMediaOk(true);
  }

  // 소스 교체 시 로드
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.load();
      setNow(0);
    }
  }, [asset?.url]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => setMediaOk(false));
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function seek(sec: number) {
    const v = videoRef.current;
    const t = Math.min(Math.max(sec, 0), clipSec);
    if (v) v.currentTime = t;
    setNow(t);
  }

  const inMs = secToMs100(inSec);
  const outMs = secToMs100(outSec);
  const excerptMs = outMs - inMs;
  const rangeInvalid = excerptMs <= 0;
  const tooShort = !rangeInvalid && excerptMs < shot.duration_ms;
  const outOfClip = inMs < 0 || outMs > (asset?.duration_ms ?? 8000);
  const canAdopt = asset != null && !rangeInvalid && !tooShort && !outOfClip;

  const adoptedHere = adopted[shot.id];

  function adopt() {
    if (!asset || !canAdopt) return;
    // AdoptRequest — 0.1초=100ms 단위 정수 (shared/src/dto.ts)
    const body: AdoptRequest = { assetId: asset.assetId, inMs, outMs };
    setAdopted((prev) => ({ ...prev, [shot.id]: body }));
  }

  return (
    <section aria-label="클립 발췌 게이트">
      <p className="mb-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">
        {ep.id} · Gate 3 / 4
      </p>
      <h1 className="text-[22px] font-bold tracking-tight">클립 발췌 게이트</h1>
      <p className="mb-6 text-[13.5px] text-muted-foreground">
        생성된 8초 클립에서 실제로 쓸 구간만 0.1초 단위로 발췌합니다. 발췌 길이는 컷의 TTS 실측
        길이보다 짧을 수 없습니다.
      </p>

      {/* 게이트 헤더 */}
      <Card className="mb-5 flex-row items-center gap-3.5 rounded-[10px] border-gold/30 bg-[linear-gradient(120deg,rgba(227,179,76,0.07),transparent_55%)] px-5 py-4 shadow-none">
        <GateDiamond className="size-3.5" />
        <div>
          <b className="text-sm">게이트 3 — 클립 선별 · 발췌</b>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {ep.topicTitle} · 샷당 2~3회 생성 · 폐기 전제(채택률 목표 ≥30%)
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="font-mono text-lg font-semibold text-gold" data-testid="adopted-count">
            {Object.keys(adopted).length} / {ep.shots.length}
          </div>
          <div className="text-[11px] text-faint">채택된 컷</div>
        </div>
      </Card>

      {/* 샷 선택 */}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="컷 선택">
        {ep.shots.map((s) => {
          const has = (clipAssets[s.id] ?? []).length > 0;
          const on = s.id === shotId;
          return (
            <Button
              key={s.id}
              variant={on ? "default" : "outline"}
              size="sm"
              disabled={!has}
              onClick={() => selectShot(s.id)}
              className={cn(!on && "bg-transparent")}
            >
              C{s.idx + 1}
              {shotTags[s.id] ? ` · ${shotTags[s.id]}` : ""}
              {!has && " (생성 전)"}
              {adopted[s.id] && " ✓"}
            </Button>
          );
        })}
      </div>

      <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
        <span className="text-[15px] font-bold">컷 {shot.idx + 1}</span>
        <span className="text-[13px] text-muted-foreground">
          "{shot.narration}" — {shot.camera_moves[0]}
        </span>
        <span className="ml-auto font-mono text-xs text-faint">
          컷 길이(TTS 실측) {msToSec(shot.duration_ms)}s · 클립 {takes.length}개
        </span>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(260px,340px)_1fr]">
        {/* 비디오 플레이어 */}
        <Card className="gap-0 rounded-[10px] p-4 shadow-none">
          <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
            클립 미리보기 — {asset ? asset.label : "클립 없음"}
          </h3>
          <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[14px] border bg-black">
            {asset && mediaOk ? (
              <video
                ref={videoRef}
                data-testid="clip-video"
                className="size-full object-cover"
                src={asset.url}
                muted
                playsInline
                preload="auto"
                loop
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                onError={() => setMediaOk(false)}
                onEnded={() => setPlaying(false)}
              />
            ) : (
              <div className="g-phone flex size-full items-center justify-center text-[11.5px] text-faint">
                클립 파일을 불러오지 못했습니다
              </div>
            )}
            {/* 발췌 구간 표시 바 (표시 전용 — 드래그 위젯 아님) */}
            <div className="absolute right-2 bottom-2 left-2 h-1 rounded bg-white/20" aria-hidden>
              <div
                className="absolute inset-y-0 rounded bg-gold"
                style={{
                  left: `${Math.min((inSec / clipSec) * 100, 100)}%`,
                  width: `${Math.max(Math.min(((outSec - inSec) / clipSec) * 100, 100), 0)}%`,
                }}
              />
              <div
                className="absolute inset-y-[-2px] w-[2px] bg-white"
                style={{ left: `${Math.min((now / clipSec) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* 트랜스포트 */}
          <div className="mt-3 flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={togglePlay}
              disabled={!asset || !mediaOk}
              data-testid="play-toggle"
              className="bg-transparent"
            >
              {playing ? "일시정지" : "재생"}
            </Button>
            <span className="font-mono text-[13px]" data-testid="current-time">
              {round1(now).toFixed(1)}
              <span className="text-[11px] text-faint">s</span>
            </span>
            <span className="font-mono text-[11px] text-faint">/ {clipSec.toFixed(1)}s</span>
          </div>
          <input
            type="range"
            aria-label="재생 위치"
            className="mt-2 w-full accent-[var(--gold)]"
            min={0}
            max={clipSec}
            step={0.1}
            value={round1(now)}
            onChange={(e) => seek(e.currentTarget.valueAsNumber)}
            disabled={!asset || !mediaOk}
          />

          {/* 생성 회차(테이크) 선택 */}
          <div className="mt-3 flex flex-col gap-1.5" role="group" aria-label="클립 회차 선택">
            {takes.map((t) => (
              <button
                key={t.assetId}
                type="button"
                aria-pressed={t.assetId === assetId}
                onClick={() => selectTake(t.assetId)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:border-faint",
                  t.assetId === assetId && "border-gold bg-gold-dim",
                )}
              >
                <span className="font-mono text-[10.5px] text-faint">{t.assetId}</span>
                <span className="font-semibold">{t.label}</span>
                <span className="ml-auto font-mono text-[10.5px] text-faint">
                  {msToSec(t.duration_ms)}s
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* 발췌 컨트롤 */}
        <div className="flex flex-col gap-4">
          <Card className="gap-0 rounded-[10px] px-4.5 py-4 shadow-none">
            <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
              발췌 구간 — 0.1초 단위 (100ms)
            </h3>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label htmlFor="in-sec" className="mb-1.5 block font-mono text-[11px] text-faint">
                  IN (s)
                </label>
                <div className="flex gap-2">
                  <Input
                    id="in-sec"
                    data-testid="in-input"
                    type="number"
                    inputMode="decimal"
                    step={0.1}
                    min={0}
                    max={clipSec}
                    value={inSec}
                    onChange={(e) => {
                      const v = e.currentTarget.valueAsNumber;
                      if (!Number.isNaN(v)) setInSec(round1(v));
                    }}
                    className="w-28 font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent"
                    data-testid="capture-in"
                    disabled={!asset || !mediaOk}
                    onClick={() => setInSec(round1(now))}
                  >
                    현재 위치를 IN으로
                  </Button>
                </div>
              </div>
              <div>
                <label htmlFor="out-sec" className="mb-1.5 block font-mono text-[11px] text-faint">
                  OUT (s)
                </label>
                <div className="flex gap-2">
                  <Input
                    id="out-sec"
                    data-testid="out-input"
                    type="number"
                    inputMode="decimal"
                    step={0.1}
                    min={0}
                    max={clipSec}
                    value={outSec}
                    onChange={(e) => {
                      const v = e.currentTarget.valueAsNumber;
                      if (!Number.isNaN(v)) setOutSec(round1(v));
                    }}
                    className="w-28 font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent"
                    data-testid="capture-out"
                    disabled={!asset || !mediaOk}
                    onClick={() => setOutSec(round1(now))}
                  >
                    현재 위치를 OUT으로
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line-soft pt-3.5 font-mono text-xs">
              <span>
                발췌 길이{" "}
                <strong
                  className={cn(
                    "font-semibold",
                    rangeInvalid || tooShort ? "text-destructive" : "text-ok",
                  )}
                  data-testid="excerpt-len"
                >
                  {rangeInvalid ? "—" : `${msToSec(excerptMs)}s`}
                </strong>
              </span>
              <span className="text-muted-foreground">
                컷 길이(TTS) <strong className="font-semibold">{msToSec(shot.duration_ms)}s</strong>
              </span>
              <span className="text-faint">in {inMs}ms · out {outMs}ms</span>
            </div>

            {(rangeInvalid || tooShort || outOfClip) && (
              <p className="mt-2 text-[12.5px] text-destructive" data-testid="range-warning">
                {rangeInvalid
                  ? "OUT은 IN보다 커야 합니다."
                  : outOfClip
                    ? "발췌 구간이 클립 범위를 벗어났습니다."
                    : `발췌 길이가 컷 길이(${msToSec(shot.duration_ms)}s)보다 짧습니다 — 조립 시 이 컷을 채울 수 없습니다.`}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <Button onClick={adopt} disabled={!canAdopt} data-testid="adopt-clip">
                이 구간 채택
              </Button>
              {adoptedHere && (
                <StatusChip tone="ok" className="ml-1">
                  채택됨 — {adoptedHere.assetId} · {msToSec(adoptedHere.inMs)}–
                  {msToSec(adoptedHere.outMs)}s
                </StatusChip>
              )}
            </div>

            {adoptedHere && (
              <p
                className="mt-3 rounded-md border border-dashed bg-surface-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
                data-testid="adopt-payload"
              >
                POST /api/shots/{shot.id}/adopt · {JSON.stringify(adoptedHere)}
                <span className="mt-0.5 block text-faint">
                  서버 연동 전 — fixture 모드에서는 전송하지 않습니다 (#9 api-server 범위)
                </span>
              </p>
            )}
          </Card>

          <p className="flex items-center gap-2 text-[12.5px] text-locked">
            <GateDiamond state="locked" />
            조립(ffmpeg) 단계는 {ep.shots.length}컷 모두 채택될 때까지 잠겨 있습니다 — 컷 길이는
            항상 TTS 실측을 따릅니다.
          </p>
        </div>
      </div>
    </section>
  );
}
