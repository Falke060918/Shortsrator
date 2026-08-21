import { useCallback, useEffect, useState } from "react";
import {
  API_KEY_NAMES,
  type AdapterMode,
  type ApiKeyName,
  type HiggsfieldTier,
  type SettingsDTO,
  type SettingsKeysUpdate,
  type TTSVendor,
} from "@shortsrator/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** 화면 5 — 설정 (issue #11): 어댑터 모드·TTS 벤더·예산·Higgsfield 티어 + API 키 기록 */

const ADAPTER_ROWS: { kind: keyof SettingsDTO["adapterModes"]; label: string; desc: string }[] = [
  { kind: "llm", label: "대본 LLM", desc: "대본·샷리스트 생성 (Claude)" },
  { kind: "tts", label: "음성 TTS", desc: "내레이션 음성 합성" },
  { kind: "image", label: "이미지", desc: "첫 프레임·마스터 애셋 (Higgsfield)" },
  { kind: "video", label: "영상", desc: "컷 클립 I2V (Higgsfield)" },
];

const KEY_ROWS: { name: ApiKeyName; label: string }[] = [
  { name: "HF_API_KEY_ID", label: "Higgsfield 키 ID" },
  { name: "HF_API_SECRET", label: "Higgsfield 시크릿" },
  { name: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)" },
  { name: "ELEVENLABS_API_KEY", label: "ElevenLabs" },
  { name: "TYPECAST_API_KEY", label: "Typecast" },
];

const TIER_OPTIONS: { value: HiggsfieldTier; label: string }[] = [
  { value: "lite", label: "라이트" },
  { value: "standard", label: "표준" },
  { value: "high", label: "고품질" },
];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** 소형 세그먼트 토글 — 기존 버튼 프리미티브 조합 (선택지는 gold 강조) */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  testPrefix,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  testPrefix: string;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      {options.map((opt, i) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            data-testid={`${testPrefix}-${opt.value}`}
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1.5 text-[12.5px] transition-colors",
              i > 0 && "border-l",
              on
                ? "bg-gold-dim font-semibold text-gold"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 일반 설정 초안
  const [modes, setModes] = useState<SettingsDTO["adapterModes"] | null>(null);
  const [vendor, setVendor] = useState<TTSVendor>("elevenlabs");
  const [tier, setTier] = useState<HiggsfieldTier>("standard");
  const [budget, setBudget] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // 키 입력 초안 — 값은 저장 후 즉시 비운다 (재표시 없음)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [keysMsg, setKeysMsg] = useState<string | null>(null);

  const applyServerSettings = useCallback((next: SettingsDTO) => {
    setSettings(next);
    setModes(next.adapterModes);
    setVendor(next.ttsVendor);
    setTier(next.higgsfieldTier);
    setBudget(String(next.budgetKrwPerEpisode));
  }, []);

  useEffect(() => {
    let alive = true;
    fetchJson<SettingsDTO>("/api/settings")
      .then((data) => {
        if (alive) applyServerSettings(data);
      })
      .catch((err: Error) => {
        if (alive) setLoadError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [applyServerSettings]);

  async function saveGeneral() {
    if (!modes) return;
    setSaveMsg(null);
    const budgetNum = Number(budget);
    if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
      setSaveMsg("예산 한도는 양수(원)여야 합니다");
      return;
    }
    try {
      const next = await fetchJson<SettingsDTO>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapterModes: modes,
          ttsVendor: vendor,
          budgetKrwPerEpisode: budgetNum,
          higgsfieldTier: tier,
        }),
      });
      applyServerSettings(next);
      setSaveMsg("저장됨");
    } catch (err) {
      setSaveMsg(`저장 실패: ${(err as Error).message}`);
    }
  }

  async function putKeys(payload: SettingsKeysUpdate, okMsg: string) {
    setKeysMsg(null);
    try {
      const next = await fetchJson<SettingsDTO>("/api/settings/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSettings(next); // 배지(설정됨/누락) 갱신 — 값은 어디에도 돌아오지 않는다
      setKeyDrafts((prev) => {
        const cleared = { ...prev };
        for (const name of Object.keys(payload)) cleared[name] = "";
        return cleared;
      });
      setKeysMsg(okMsg);
    } catch (err) {
      setKeysMsg(`실패: ${(err as Error).message}`);
    }
  }

  function saveKeys() {
    const payload: SettingsKeysUpdate = {};
    for (const name of API_KEY_NAMES) {
      const value = (keyDrafts[name] ?? "").trim();
      if (value !== "") payload[name] = value;
    }
    if (Object.keys(payload).length === 0) {
      setKeysMsg("입력된 키가 없습니다");
      return;
    }
    void putKeys(payload, "키 저장됨 — 값은 다시 표시되지 않습니다");
  }

  if (loadError) {
    return (
      <section aria-label="설정">
        <h1 className="text-[22px] font-bold tracking-tight">설정</h1>
        <Card className="mt-5 items-center gap-1 rounded-[10px] border-dashed px-5 py-10 text-center shadow-none">
          <p className="text-[13.5px] font-semibold">서버에 연결할 수 없습니다</p>
          <p className="text-[12.5px] text-muted-foreground">
            로컬 서버(127.0.0.1:8787)가 실행 중인지 확인해 주세요 — {loadError}
          </p>
        </Card>
      </section>
    );
  }

  if (!settings || !modes) {
    return (
      <section aria-label="설정">
        <h1 className="text-[22px] font-bold tracking-tight">설정</h1>
        <p className="mt-4 text-[13px] text-muted-foreground">설정을 불러오는 중…</p>
      </section>
    );
  }

  return (
    <section aria-label="설정" data-testid="settings-screen">
      <p className="mb-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">
        Settings
      </p>
      <h1 className="text-[22px] font-bold tracking-tight">설정</h1>
      <p className="mb-6 text-[13.5px] text-muted-foreground">
        어댑터 모드·생성 옵션과 API 키를 관리합니다. 모든 값은 로컬 서버(127.0.0.1)에만
        저장됩니다.
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 어댑터 모드 */}
        <Card className="gap-0 rounded-[10px] px-5 py-4.5 shadow-none">
          <b className="text-sm">어댑터 모드</b>
          <p className="mt-0.5 mb-3 text-[12.5px] text-muted-foreground">
            단계별로 API 자동 생성과 수동 업로드(MANUAL) 중 선택합니다.
          </p>
          <div className="flex flex-col divide-y divide-line-soft">
            {ADAPTER_ROWS.map((row) => (
              <div key={row.kind} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{row.label}</div>
                  <div className="text-[11.5px] text-faint">{row.desc}</div>
                </div>
                <span className="ml-auto" />
                <Segmented<AdapterMode>
                  options={[
                    { value: "api", label: "API" },
                    { value: "manual", label: "수동" },
                  ]}
                  value={modes[row.kind]}
                  onChange={(next) => setModes({ ...modes, [row.kind]: next })}
                  testPrefix={`mode-${row.kind}`}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* 생성 옵션 */}
        <Card className="gap-0 rounded-[10px] px-5 py-4.5 shadow-none">
          <b className="text-sm">생성 옵션</b>
          <p className="mt-0.5 mb-3 text-[12.5px] text-muted-foreground">
            음성 벤더·영상 품질 티어·편당 예산 한도를 정합니다.
          </p>
          <div className="flex flex-col divide-y divide-line-soft">
            <div className="flex items-center gap-3 py-2.5">
              <div className="text-[13px] font-semibold">TTS 벤더</div>
              <span className="ml-auto" />
              <Segmented<TTSVendor>
                options={[
                  { value: "elevenlabs", label: "ElevenLabs" },
                  { value: "typecast", label: "Typecast" },
                ]}
                value={vendor}
                onChange={setVendor}
                testPrefix="tts-vendor"
              />
            </div>
            <div className="flex items-center gap-3 py-2.5">
              <div>
                <div className="text-[13px] font-semibold">Higgsfield 티어</div>
                <div className="text-[11.5px] text-faint">영상 생성 품질·비용 조정</div>
              </div>
              <span className="ml-auto" />
              <Segmented<HiggsfieldTier>
                options={TIER_OPTIONS}
                value={tier}
                onChange={setTier}
                testPrefix="tier"
              />
            </div>
            <div className="flex items-center gap-3 py-2.5">
              <div>
                <div className="text-[13px] font-semibold">편당 예산 한도</div>
                <div className="text-[11.5px] text-faint">원(KRW) — 초과 시 경고</div>
              </div>
              <span className="ml-auto" />
              <Input
                type="number"
                min={1}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-28 text-right font-mono"
                aria-label="편당 예산 한도(원)"
                data-testid="budget-input"
              />
            </div>
          </div>
          <div className="mt-3.5 flex items-center gap-3 border-t border-line-soft pt-3.5">
            <span
              className={cn(
                "text-[12.5px]",
                saveMsg === "저장됨" ? "text-ok" : "text-destructive",
              )}
              data-testid="settings-saved-msg"
            >
              {saveMsg}
            </span>
            <span className="flex-1" />
            <Button onClick={() => void saveGeneral()} data-testid="save-settings">
              설정 저장
            </Button>
          </div>
        </Card>
      </div>

      {/* API 키 */}
      <Card className="mt-4 gap-0 rounded-[10px] px-5 py-4.5 shadow-none">
        <b className="text-sm">API 키</b>
        <p className="mt-0.5 mb-3 text-[12.5px] text-muted-foreground">
          키는 서버의 <code className="font-mono text-[11.5px]">.env</code> 파일에 기록되며{" "}
          <code className="font-mono text-[11.5px]">.env</code> 파일로도 직접 관리할 수
          있습니다. 저장한 값은 다시 표시되지 않고 상태(설정됨/누락)만 보입니다.
        </p>
        <div className="flex flex-col divide-y divide-line-soft">
          {KEY_ROWS.map((row) => {
            const configured = settings.apiKeys[row.name] === "configured";
            return (
              <div
                key={row.name}
                className="flex flex-wrap items-center gap-3 py-2.5 sm:flex-nowrap"
              >
                <div className="min-w-[180px]">
                  <div className="text-[13px] font-semibold">{row.label}</div>
                  <div className="font-mono text-[11px] text-faint">{row.name}</div>
                </div>
                <Badge
                  variant="outline"
                  data-testid={`key-status-${row.name}`}
                  className={cn(
                    "shrink-0",
                    configured
                      ? "border-gold/40 bg-gold-dim text-gold"
                      : "text-faint",
                  )}
                >
                  {configured ? "설정됨" : "누락"}
                </Badge>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={configured ? "새 값 입력 시 교체" : "키 값 입력"}
                  value={keyDrafts[row.name] ?? ""}
                  onChange={(e) =>
                    setKeyDrafts((prev) => ({ ...prev, [row.name]: e.target.value }))
                  }
                  className="min-w-[200px] flex-1 font-mono text-[12px]"
                  aria-label={`${row.label} 키 입력`}
                  data-testid={`key-input-${row.name}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!configured}
                  onClick={() =>
                    void putKeys({ [row.name]: "" }, `${row.label} 키 삭제됨`)
                  }
                  data-testid={`key-delete-${row.name}`}
                >
                  삭제
                </Button>
              </div>
            );
          })}
        </div>
        <div className="mt-3.5 flex items-center gap-3 border-t border-line-soft pt-3.5">
          <span
            className={cn(
              "text-[12.5px]",
              keysMsg?.startsWith("실패") ? "text-destructive" : "text-ok",
            )}
            data-testid="keys-saved-msg"
          >
            {keysMsg}
          </span>
          <span className="flex-1" />
          <Button onClick={saveKeys} data-testid="save-keys">
            입력한 키 저장
          </Button>
        </div>
      </Card>
    </section>
  );
}
