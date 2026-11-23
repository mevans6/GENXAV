import { checked, db, fail, HttpError, rateLimit, visitor } from "@lib/server";
import { safeOrigin } from "@lib/security";
import { normalizePhoto, MAX_PHOTO_BYTES } from "@lib/photos";
import { CONSULTING_BUCKET } from "@lib/consulting";
export async function POST(request: Request) {
  try {
    if (!safeOrigin(request))
      throw new HttpError(403, "Upload files from this site.");
    await rateLimit(request, "intake-attachments", 18);
    if (Number(request.headers.get("content-length")) > MAX_PHOTO_BYTES + 65536)
      throw new HttpError(
        413,
        "Each file must be smaller than 3 MB after preparation.",
      );
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "Choose a file.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PHOTO_BYTES + 65536) {
        await reader.cancel();
        throw new HttpError(413, "This file is too large.");
      }
      chunks.push(value);
    }
    let form: FormData;
    try {
      form = await new Request(request.url, {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") || "" },
        body: Buffer.concat(chunks),
      }).formData();
    } catch {
      throw new HttpError(400, "Choose a valid upload.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a file.");
    let bytes = Buffer.from(await file.arrayBuffer());
    let mime = "image/jpeg";
    const pdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    if (pdf) {
      if (
        !bytes.length ||
        bytes.length > MAX_PHOTO_BYTES ||
        !bytes.subarray(-2048).toString("latin1").includes("%%EOF")
      )
        throw new HttpError(400, "Choose a valid PDF smaller than 3 MB.");
      mime = "application/pdf";
    } else bytes = (await normalizePhoto(bytes)).data;
    const filename =
      file.name.replace(/[^a-zA-Z0-9 ._()-]/g, "_").slice(0, 140) ||
      "attachment";
    const owner = await visitor();
    const id = crypto.randomUUID();
    const reserved = await db().rpc("reserve_consulting_attachment", {
      p_id: id,
      p_owner: owner,
      p_filename: filename,
      p_mime: mime,
      p_bytes: bytes.length,
    });
    if (reserved.error?.message.includes("Attachment limit"))
      throw new HttpError(
        429,
        "Your upload limit has been reached. Please try again later.",
      );
    checked(reserved);
    const upload = await db()
      .storage.from(CONSULTING_BUCKET)
      .upload(`${owner}/${id}`, bytes, {
        contentType: mime,
        cacheControl: "0",
        upsert: false,
      });
    if (upload.error) {
      await db()
        .from("consulting_attachments")
        .update({ expires_at: new Date().toISOString() })
        .eq("id", id);
      throw new HttpError(503, "Upload did not finish. Please try again.");
    }
    return Response.json({ id });
  } catch (e) {
    return fail(e);
  }
}
