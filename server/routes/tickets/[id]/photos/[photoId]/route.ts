import { z } from "zod";
import { fail } from "@lib/server";
import { privateTicket } from "@lib/tickets";
import { photoResponse } from "@lib/photos";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const { id, photoId } = await params;
    z.uuid().parse(id); z.uuid().parse(photoId);
    await privateTicket(id);
    return await photoResponse(photoId, id);
  } catch (error) { return fail(error); }
}
