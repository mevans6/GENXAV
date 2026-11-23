import { z } from "zod";
import { admin, checked, db, fail, HttpError } from "@lib/server";
import { CONSULTING_BUCKET } from "@lib/consulting";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await admin(request);
    const { id } = await params;
    z.uuid().parse(id);
    const file = checked(
      await db()
        .from("consulting_attachments")
        .select("storage_path,filename,mime")
        .eq("id", id)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle(),
    );
    if (!file) throw new HttpError(404, "Attachment unavailable.");
    const bytes = checked(
      await db().storage.from(CONSULTING_BUCKET).download(file.storage_path),
    );
    return new Response(bytes, {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="${file.filename.replace(/[^a-zA-Z0-9 ._()-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
