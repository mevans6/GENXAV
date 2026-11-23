import sharp from "sharp";
import { checked, db, HttpError } from "./server";

export const PHOTO_BUCKET = "support-attachments";
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const MAX_PHOTOS = 6;

export async function normalizePhoto(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES)
    throw new HttpError(400, "Each uploaded photo must be smaller than 3 MB.");
  try {
    const image = sharp(bytes, { limitInputPixels: 24000000, animated: false });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages || 1) > 1)
      throw new Error("Unsupported image");
    // Re-encoding verifies the file and strips embedded metadata, including GPS.
    const { data, info } = await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_PHOTO_BYTES) throw new Error("Image too large");
    return { data, width: info.width, height: info.height };
  } catch {
    throw new HttpError(400, "Choose a valid, non-animated JPEG, PNG, or WebP photo.");
  }
}

export async function casePhotos(caseId: string) {
  return checked(await db().from("support_photos").select("id,width,height").eq("case_id", caseId).gt("expires_at", new Date().toISOString()).order("created_at"));
}

export async function photoResponse(photoId: string, caseId?: string) {
  let query = db().from("support_photos").select("storage_path").eq("id", photoId).gt("expires_at", new Date().toISOString());
  if (caseId) query = query.eq("case_id", caseId);
  const photo = checked(await query.maybeSingle());
  if (!photo) throw new HttpError(404, "Photo not found.");
  const file = checked(await db().storage.from(PHOTO_BUCKET).download(photo.storage_path));
  return new Response(file, { headers: {
    "Content-Type": "image/jpeg", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "Content-Disposition": 'inline; filename="equipment-photo.jpg"',
  } });
}

export async function removeCasePhotos(caseId: string) {
  const photos = checked(await db().from("support_photos").select("id,storage_path").eq("case_id", caseId));
  if (!photos.length) return;
  checked(await db().storage.from(PHOTO_BUCKET).remove(photos.map((p) => p.storage_path)));
  checked(await db().from("support_photos").delete().in("id", photos.map((p) => p.id)));
}

export async function purgeExpiredPhotos() {
  let removed = 0;
  for (let batch = 0; batch < 5; batch++) {
    const photos = checked(await db().from("support_photos").select("id,storage_path").lt("expires_at", new Date().toISOString()).limit(100));
    if (!photos.length) break;
    checked(await db().storage.from(PHOTO_BUCKET).remove(photos.map((p) => p.storage_path)));
    checked(await db().from("support_photos").delete().in("id", photos.map((p) => p.id)));
    removed += photos.length;
  }
  return removed;
}
