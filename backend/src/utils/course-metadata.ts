import type { CourseType, Prisma } from "@prisma/client";
import { centreMetadataSchema } from "./validation.js";
import { HttpError } from "./http.js";

type JsonObject = Record<string, Prisma.InputJsonValue>;

/**
 * Applies a metadata patch onto what a course already stores, so saving one field never erases
 * the others: keys in the patch replace stored ones, null or "" removes a key, keys not in the
 * patch are kept. CENTRE packages only accept their known detail fields.
 */
export function mergeCourseMetadata(stored: Prisma.JsonValue | null, patch: Record<string, unknown>, type: CourseType): JsonObject {
  let values = patch;
  if (type === "CENTRE") {
    const parsed = centreMetadataSchema.safeParse(patch);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid centre details");
    values = parsed.data;
  }

  const merged: JsonObject = stored && typeof stored === "object" && !Array.isArray(stored) ? { ...(stored as JsonObject) } : {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value === null || value === "") delete merged[key];
    else merged[key] = value as Prisma.InputJsonValue;
  }
  return merged;
}
