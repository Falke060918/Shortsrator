/**
 * 빈 셸 — 화면 구현은 web-ui 단위 범위 (docs/03-architecture.md 병렬 구현 단위).
 * 여기서는 폰트·토큰 세팅이 살아 있는지 확인하는 자리만 둔다.
 */
export default function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Shortsrator</h1>
      <p className="text-sm text-muted-foreground">
        테마 기반 유튜브 숏츠 반자동 제작 — UI 셸
      </p>
      <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
        GET /api/health
      </code>
    </main>
  );
}
