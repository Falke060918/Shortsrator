import { describe, expect, it } from "vitest";
import { probeDurationMs } from "./ffprobe.js";

describe("probeDurationMs (ffprobe 실측)", () => {
  it("ffprobe JSON 출력의 초 단위 duration 을 ms 정수로 반올림한다", async () => {
    const seenArgs: string[][] = [];
    const runner = async (args: string[]) => {
      seenArgs.push(args);
      return JSON.stringify({ format: { duration: "2.8734" } });
    };

    const ms = await probeDurationMs("/tmp/a.mp3", runner);

    expect(ms).toBe(2873);
    expect(seenArgs).toHaveLength(1);
    expect(seenArgs[0]).toContain("/tmp/a.mp3");
    expect(seenArgs[0]).toContain("format=duration");
  });

  it("duration 이 없으면 파일 경로가 담긴 오류를 던진다", async () => {
    const runner = async () => JSON.stringify({ format: {} });
    await expect(probeDurationMs("/tmp/b.mp3", runner)).rejects.toThrow(
      "/tmp/b.mp3",
    );
  });

  it("JSON 이 아닌 출력이면 오류를 던진다", async () => {
    const runner = async () => "not json";
    await expect(probeDurationMs("/tmp/c.mp3", runner)).rejects.toThrow(
      "JSON",
    );
  });
});
