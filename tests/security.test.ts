import { describe, it, expect, afterEach } from "vitest";
import {
  digest,
  matchesHash,
  newToken,
  paidCheckout,
  safeOrigin,
  ticketToken,
} from "../server/lib/security";
const original = process.env.NEXT_PUBLIC_SITE_URL;
afterEach(() => {
  if (original) process.env.NEXT_PUBLIC_SITE_URL = original;
  else delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.ACCESS_TOKEN_SECRET;
});
describe("payment authorization", () => {
  const valid = {
    payment_status: "paid",
    amount_total: 2900,
    currency: "usd",
    metadata: { case_id: "case-1", plan: "expert" },
  };
  it("accepts only the exact verified plan, amount, currency and case", () => {
    expect(paidCheckout(valid, "expert", "case-1")).toBe(true);
    for (const change of [
      { payment_status: "unpaid" },
      { amount_total: 1 },
      { currency: "eur" },
      { metadata: { case_id: "other", plan: "expert" } },
      { metadata: { case_id: "case-1", plan: "video" } },
      { metadata: null },
    ])
      expect(paidCheckout({ ...valid, ...change }, "expert", "case-1")).toBe(
        false,
      );
  });
  it("does not authorize a video consultation using the expert amount", () =>
    expect(paidCheckout(valid, "video", "case-1")).toBe(false));
});
describe("private ticket capabilities", () => {
  it("generates independent high entropy values and stores only hashes", () => {
    const a = newToken(),
      b = newToken();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(matchesHash(a, digest(a))).toBe(true);
    expect(matchesHash(b, digest(a))).toBe(false);
    expect(matchesHash(a, "bad")).toBe(false);
  });
  it("binds each access token to its case and deployment secret", () => {
    process.env.ACCESS_TOKEN_SECRET = "a".repeat(64);
    const a = ticketToken("case-a");
    expect(a).not.toBe(ticketToken("case-b"));
    process.env.ACCESS_TOKEN_SECRET = "b".repeat(64);
    expect(a).not.toBe(ticketToken("case-a"));
  });
  it("refuses missing or short access secrets", () => {
    expect(() => ticketToken("x")).toThrow();
    process.env.ACCESS_TOKEN_SECRET = "short";
    expect(() => ticketToken("x")).toThrow();
  });
});
describe("request integrity", () => {
  it("rejects missing and foreign origins", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://home.example";
    expect(safeOrigin(new Request("https://home.example/api/consulting/intake"))).toBe(
      false,
    );
    expect(
      safeOrigin(
        new Request("https://home.example/api/consulting/intake", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
    expect(
      safeOrigin(
        new Request("https://home.example/api/consulting/intake", {
          headers: { origin: "https://home.example" },
        }),
      ),
    ).toBe(true);
  });
});
