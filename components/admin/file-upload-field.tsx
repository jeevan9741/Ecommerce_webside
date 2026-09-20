"use client";

import { useState } from "react";
import { Loader2, UploadCloud, CheckCircle2 } from "lucide-react";

function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload to storage failed (${xhr.status} ${xhr.statusText || ""}).`.replace(/\s+\./, ".")));
    };
    xhr.onerror = () => reject(new Error("Upload to storage failed — network error."));
    xhr.send(file);
  });
}

export function FileUploadField({
  prefix,
  accept,
  onUploaded,
}: {
  prefix: "course-content" | "demo-videos" | "certificates";
  accept?: string;
  onUploaded: (key: string, filename: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setProgress(0);
    setError(null);
    try {
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          prefix,
        }),
      });
      const presign = await presignRes.json().catch(() => ({}));
      if (!presignRes.ok || !presign.uploadUrl) {
        throw new Error(presign.error ?? "Failed to get an upload URL from the server.");
      }

      await uploadWithProgress(presign.uploadUrl, file, setProgress);

      setUploadedName(file.name);
      onUploaded(presign.key, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <label className="input-field flex cursor-pointer flex-col items-center justify-center gap-2 !py-6 text-center text-parchment-muted hover:border-gold-500">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : uploadedName ? (
          <CheckCircle2 className="h-4 w-4 text-emerald" />
        ) : (
          <UploadCloud className="h-4 w-4" />
        )}
        <span>{busy ? `Uploading… ${progress}%` : uploadedName ? `Uploaded: ${uploadedName}` : "Click to upload a file"}</span>
        {busy && (
          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-border-soft">
            <div className="h-full rounded-full bg-gold-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        <input type="file" accept={accept} className="hidden" onChange={handleChange} disabled={busy} />
      </label>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
