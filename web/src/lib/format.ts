/** ms 정수 → "3.1" 초 문자열 (0.1초 단위 표시) */
export function msToSec(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/** 초(number) → 0.1초 단위로 반올림한 ms 정수 (AdoptRequest의 inMs/outMs 단위) */
export function secToMs100(sec: number): number {
  return Math.round(sec * 10) * 100;
}

/** ms 정수 → 0.1초 단위 초 number (input value용) */
export function msToSecNum(ms: number): number {
  return Math.round(ms / 100) / 10;
}
