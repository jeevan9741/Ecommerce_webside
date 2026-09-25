"use client";

import { put } from "@vercel/blob/client";
import { videoService } from "@/services/videoService";

/**
 * Browser → private Blob store uploads for the course video library. The backend only hands out
 * a scoped token (one path, one content type, size cap); the bytes never pass through our servers.
 * Anything over a few MB goes up in parallel parts, which Blob retries individually — that's
 * what makes 2 GB uploads practical over flaky connections.
 */
const MULTIPART_OVER_BYTES = 20 * 1024 ** 2;

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export async function uploadToStore(
  kind: "video" | "thumbnail",
  body: Blob,
  filename: string,
  contentType: string,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {}
): Promise<string> {
  const { pathname, clientToken } = await videoService.uploadToken({ kind, filename, contentType, sizeBytes: body.size });
  await put(pathname, body, {
    access: "private",
    token: clientToken,
    contentType,
    multipart: body.size > MULTIPART_OVER_BYTES,
    abortSignal: opts.signal,
    onUploadProgress: opts.onProgress,
  });
  return pathname;
}

/** Duration (and a frame grabber) from a local video file, without uploading anything. */
export function readVideoFile(file: File): Promise<{ durationSeconds: number | null; captureFrame: (at?: number) => Promise<Blob | null>; release: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    // "auto" so frames are decodable for the thumbnail grab, not just the duration.
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const release = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    /** Seeks and resolves once the frame at `t` is actually decoded (a bare "seeked" can still paint black). */
    const seekTo = (t: number) =>
      new Promise<boolean>((done) => {
        const ready = () => {
          if (video.readyState >= 2) return done(true);
          video.addEventListener("loadeddata", () => done(true), { once: true });
        };
        video.addEventListener("seeked", ready, { once: true });
        video.addEventListener("error", () => done(false), { once: true });
        video.currentTime = t;
      });

    const drawFrame = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, 1280 / w);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Sample the frame: an all-black grab means a fade-in (or an undecoded frame) — try later.
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4 * 97) sum += px[i] + px[i + 1] + px[i + 2];
      const dark = sum / (px.length / (4 * 97)) / 3 < 12;
      return { canvas, dark };
    };

    const captureFrame = async (at?: number): Promise<Blob | null> => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const candidates = at !== undefined ? [at] : [Math.min(3, duration * 0.1), duration * 0.25, duration * 0.5];
      let fallback: HTMLCanvasElement | null = null;
      for (const t of candidates) {
        if (!(await seekTo(Math.max(0, Math.min(t, Math.max(0, duration - 0.1)))))) break;
        // Give the compositor one frame to present the decoded image.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const frame = drawFrame();
        if (!frame) break;
        fallback ??= frame.canvas;
        if (!frame.dark) {
          fallback = frame.canvas;
          break;
        }
      }
      return fallback ? new Promise((done) => fallback!.toBlob((b) => done(b), "image/jpeg", 0.85)) : null;
    };

    video.addEventListener(
      "loadedmetadata",
      () => resolve({ durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration) : null, captureFrame, release }),
      { once: true }
    );
    video.addEventListener(
      "error",
      () => {
        release();
        reject(new Error("This browser can't read that video. Make sure it's a valid MP4 (H.264)."));
      },
      { once: true }
    );
  });
}
