import { supportConfig } from "@lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(supportConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}
