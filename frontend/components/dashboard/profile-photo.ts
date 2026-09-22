"use client";

import { useCallback, useSyncExternalStore } from "react";

// The backend has no photo fields, so photos live in this browser only, keyed per user.
const CHANGE_EVENT = "eca-profile-photo-change";

/** "profile" is the avatar in Account Details; "idCard" is the passport photo printed on the ID card. */
export type PhotoKind = "profile" | "idCard";

const STORAGE_PREFIX: Record<PhotoKind, string> = {
  profile: "eca_profile_photo",
  idCard: "eca_id_card_photo",
};

const storageKey = (kind: PhotoKind, userId: string) => `${STORAGE_PREFIX[kind]}:${userId}`;

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readPhoto(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns the stored photo (a data URL) and a setter; the setter returns false if storage is unavailable or full. */
export function useStoredPhoto(kind: PhotoKind, userId: string) {
  const key = storageKey(kind, userId);
  const photo = useSyncExternalStore(
    subscribe,
    () => readPhoto(key),
    () => null,
  );

  const setPhoto = useCallback(
    (dataUrl: string | null) => {
      try {
        if (dataUrl) localStorage.setItem(key, dataUrl);
        else localStorage.removeItem(key);
      } catch {
        return false;
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    },
    [key],
  );

  return [photo, setPhoto] as const;
}

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Validates a chosen file, returning an error message or null. */
export function photoFileError(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Please choose an image file (JPG, PNG or WebP).";
  if (file.size > MAX_PHOTO_BYTES) return "Please choose a photo smaller than 5 MB.";
  return null;
}

/** Centre-crops an image file to width × height and returns a JPEG data URL small enough for localStorage. */
export async function fileToPhotoDataUrl(file: File, width = 320, height = width): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const targetRatio = width / height;
  const sw = Math.min(bitmap.width, bitmap.height * targetRatio);
  const sh = sw / targetRatio;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
