/**
 * POST /api/manual/:jobId/files — MANUAL 드롭 업로드(multipart).
 *
 * 확장자 화이트리스트: 03-architecture 보안 경계(png/jpg/webp/mp4/mov)에
 * MANUAL 어댑터 정합을 위해 jpeg(이미지)·txt/md/json(LLM)·mp3/wav(TTS)를
 * 추가한다 — server/src/adapters/manual/manual-adapters.ts 헤더 주석 참조.
 * 저장 위치: {workspace}/manual/{jobId}/{파일명(basename)}.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";

export const MANUAL_UPLOAD_EXTENSIONS = new Set([
  // 이미지 (03-architecture + manual-adapters jpeg)
  "png",
  "jpg",
  "jpeg",
  "webp",
  // 영상
  "mp4",
  "mov",
  // LLM 산출물
  "txt",
  "md",
  "json",
  // TTS 산출물
  "mp3",
  "wav",
]);

/** 파일명은 basename만 인정 — 경로 구분자·상위 참조가 남아 있으면 거부한다. */
function safeFileName(rawName: string): string | undefined {
  const name = path.basename(rawName);
  if (!name || name !== rawName || name.includes("..")) return undefined;
  return name;
}

export function registerManualRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { dao, pipeline, workspaceDir } = ctx;

  app.post("/api/manual/:jobId/files", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = dao.jobs.get(jobId);
    if (!job) {
      return reply.code(404).send({ error: `잡 없음: ${jobId}` });
    }
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "multipart/form-data 필요" });
    }

    const dropDir = path.join(workspaceDir, "manual", jobId);
    const savedAbsPaths: string[] = [];

    const rejectAndCleanup = async (message: string) => {
      // 이미 저장한 조각을 남기지 않는다 — 요청 단위 원자성.
      await rm(dropDir, { recursive: true, force: true });
      return reply.code(400).send({ error: message });
    };

    for await (const part of request.files()) {
      const name = safeFileName(part.filename ?? "");
      if (!name) {
        part.file.resume();
        return rejectAndCleanup(`잘못된 파일명: ${part.filename ?? "(없음)"}`);
      }
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!MANUAL_UPLOAD_EXTENSIONS.has(ext)) {
        part.file.resume();
        return rejectAndCleanup(
          `허용되지 않는 확장자: .${ext} (허용: ${[...MANUAL_UPLOAD_EXTENSIONS].join("/")})`,
        );
      }
      await mkdir(dropDir, { recursive: true });
      const dest = path.join(dropDir, name);
      await streamPipeline(part.file, createWriteStream(dest));
      savedAbsPaths.push(dest);
    }

    if (savedAbsPaths.length === 0) {
      return reply.code(400).send({ error: "업로드된 파일이 없다" });
    }

    await pipeline.onManualFiles(jobId, savedAbsPaths);
    return {
      jobId,
      saved: savedAbsPaths.map((p) =>
        path.relative(workspaceDir, p).split(path.sep).join("/"),
      ),
    };
  });
}
