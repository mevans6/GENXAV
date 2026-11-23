import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
  );
  for (const file of [
    "001_initial.sql",
    "20261107012503_support_photos_and_notifications.sql",
    "20261107201451_consulting_intake.sql",
  ])
    await pg.exec(readFileSync(`supabase/reference-migrations/${file}`, "utf8"));
}, 30000);
afterAll(async () => {
  await pg?.close();
});
async function intake(owner = "owner", attachments: string[] = []) {
  const id = crypto.randomUUID();
  await pg.query(
    "select public.submit_consulting_request($1,$2,'Customer','customer@example.com','','Charlotte, NC','Reviewing an AV proposal','Please review the scope of my proposed home theater upgrade.',$3)",
    [id, owner, attachments],
  );
  return id;
}
async function prepare(id: string, amount = 9900) {
  return pg.query<{ id: string }>(
    "select public.prepare_consultation($1,'invited-owner',$2,'private-ticket-hash',$3) as id",
    [id, crypto.randomUUID(), amount],
  );
}
describe("consulting intake, review, and payment boundary", () => {
  it("stores a free intake and queues one owner notification without creating a payment", async () => {
    const id = await intake();
    expect(
      (await pg.query("select * from public.support_cases")).rows,
    ).toHaveLength(0);
    expect(
      (
        await pg.query(
          "select * from public.consulting_notifications where request_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
    await pg.query(
      "select public.submit_consulting_request($1,'owner','Customer','customer@example.com','','Charlotte, NC','Reviewing an AV proposal','Please review the scope of my proposed home theater upgrade.','{}')",
      [id],
    );
    expect(
      (
        await pg.query(
          "select * from public.consulting_notifications where request_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects payment preparation before explicit approval and invitation", async () => {
    const id = await intake("approval-owner");
    await expect(prepare(id)).rejects.toThrow("not been approved");
    await pg.query(
      "update public.consulting_requests set review_status='approved' where id=$1",
      [id],
    );
    await expect(prepare(id)).rejects.toThrow("not been approved");
  });
  it("prepares one approved consultation and accepts only its stored $99 amount", async () => {
    const id = await intake("payment-owner");
    await pg.query(
      "update public.consulting_requests set review_status='approved',invitation_hash='private-hash' where id=$1",
      [id],
    );
    const caseId = (await prepare(id)).rows[0].id;
    expect((await prepare(id)).rows[0].id).toBe(caseId);
    await pg.query(
      "update public.support_cases set stripe_session_id=$2 where id=$1",
      [caseId, `cs_${caseId}`],
    );
    await expect(
      pg.query("select public.fulfill_checkout($1,$2,7900,'evt_wrong')", [
        caseId,
        `cs_${caseId}`,
      ]),
    ).rejects.toThrow();
    for (let n = 0; n < 2; n++)
      await pg.query("select public.fulfill_checkout($1,$2,9900,$3)", [
        caseId,
        `cs_${caseId}`,
        `evt_${caseId}`,
      ]);
    expect(
      (
        await pg.query("select * from public.payments where case_id=$1", [
          caseId,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("does not attach another visitor’s documents", async () => {
    const file = crypto.randomUUID();
    await pg.query(
      "select public.reserve_consulting_attachment($1,'file-owner','proposal.pdf','application/pdf',100)",
      [file],
    );
    await expect(intake("wrong-owner", [file])).rejects.toThrow("ownership");
    const id = await intake("file-owner", [file]);
    expect(
      (
        await pg.query<{ request_id: string }>(
          "select request_id from public.consulting_attachments where id=$1",
          [file],
        )
      ).rows[0].request_id,
    ).toBe(id);
    await pg.query("delete from public.consulting_requests where id=$1", [id]);
    expect(
      (
        await pg.query<{ expired: boolean }>(
          "select expires_at<=now() as expired from public.consulting_attachments where id=$1",
          [file],
        )
      ).rows[0].expired,
    ).toBe(true);
  });
  it("denies browser roles direct access to requests, documents, quotes, and privileged functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      for (const table of [
        "consulting_requests",
        "consulting_attachments",
        "consulting_quotes",
        "consulting_notifications",
      ])
        await expect(
          pg.query(`select * from public.${table}`),
        ).rejects.toThrow();
      await expect(
        pg.query(
          "select public.prepare_consultation(gen_random_uuid(),'x',gen_random_uuid(),'x',1)",
        ),
      ).rejects.toThrow();
      await pg.exec("reset role");
    }
  });
  it("records a custom quote without creating a charge or changing customer approval", async () => {
    const id = await intake("quote-owner");
    await pg.query(
      "insert into public.consulting_quotes(request_id,service,scope,price_cents) values($1,'Proposal review','Compare two residential AV proposals',25000)",
      [id],
    );
    const row = (
      await pg.query<{ approval_status: string; payment_status: string }>(
        "select approval_status,payment_status from public.consulting_quotes where request_id=$1",
        [id],
      )
    ).rows[0];
    expect(row.approval_status).toBe("pending");
    expect(row.payment_status).toBe("unpaid");
  });
});
