/** Public business identity and offer. Final name/contact details can change here. */
export const business = {
  name: "Gen X AV",
  tagline: "Independent advice for your home technology.",
  description:
    "Independent residential technology consulting for troubleshooting, system planning, AV proposal reviews, and project advice.",
  contactEmail: "consulting@genxav.com",
  intakeUrl: "/consulting#intake",
  primaryCta: "Tell Us What You Need",
  secondaryCta: "How It Works",
  consultation: {
    name: "Home Technology Consultation",
    amount: 9900,
    minutes: 30,
    channel: "Zoom",
    eventType: process.env.CALENDLY_EVENT_TYPE || "",
  },
} as const;
export const consultationPrice = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(business.consultation.amount / 100);
export const intakeNeeds = [
  "Something isn't working",
  "Planning an upgrade or new system",
  "Reviewing an AV proposal",
  "General home technology advice",
  "Something else",
] as const;
export const reviewStatuses = [
  "new",
  "reviewing",
  "approved",
  "custom_quote_needed",
  "declined",
  "completed",
] as const;
export const reviewLabels: Record<string, string> = {
  new: "New",
  reviewing: "Reviewing",
  approved: "Approved for consultation",
  custom_quote_needed: "Custom quote needed",
  declined: "Declined",
  completed: "Completed",
};
