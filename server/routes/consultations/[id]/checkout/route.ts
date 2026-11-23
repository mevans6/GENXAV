// A payment link is prepared only after the verified Calendly booking webhook.
// Existing paid tickets and their Stripe webhook remain supported.
export async function POST() {
  return Response.json({error: "Reserve a time through your private consultation invitation. Your separate payment link will arrive after scheduling."}, {status:410});
}
