CREATE TABLE IF NOT EXISTS "office_receipt_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receipt_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "subject_client_id" uuid,
  "person_name" text NOT NULL,
  "invoice_number" text,
  "amount_cents" integer NOT NULL,
  "description" text NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "office_receipt_allocations" ADD CONSTRAINT "office_receipt_allocations_receipt_id_office_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."office_receipts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "office_receipt_allocations" ADD CONSTRAINT "office_receipt_allocations_invoice_id_office_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."office_invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "office_receipt_allocations" ADD CONSTRAINT "office_receipt_allocations_subject_client_id_office_clients_id_fk" FOREIGN KEY ("subject_client_id") REFERENCES "public"."office_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "office_receipt_alloc_invoice_idx" ON "office_receipt_allocations" USING btree ("receipt_id","invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_receipt_alloc_invoice_lookup_idx" ON "office_receipt_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_receipt_alloc_subject_idx" ON "office_receipt_allocations" USING btree ("subject_client_id");--> statement-breakpoint
INSERT INTO "office_receipt_allocations" ("receipt_id", "invoice_id", "subject_client_id", "person_name", "invoice_number", "amount_cents", "description")
SELECT
  r.id,
  r.invoice_id,
  COALESCE(
    (SELECT l.subject_client_id FROM office_invoice_lines l WHERE l.invoice_id = r.invoice_id AND l.subject_client_id IS NOT NULL ORDER BY l.position LIMIT 1),
    i.client_id
  ),
  COALESCE(
    (SELECT c.name FROM office_invoice_lines l JOIN office_clients c ON c.id = l.subject_client_id WHERE l.invoice_id = r.invoice_id AND l.subject_client_id IS NOT NULL ORDER BY l.position LIMIT 1),
    i.client_name,
    r.payer_name
  ),
  i.document_number,
  r.amount_cents,
  r.description
FROM office_receipts r
JOIN office_invoices i ON i.id = r.invoice_id
WHERE r.invoice_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM office_receipt_allocations a WHERE a.receipt_id = r.id AND a.invoice_id = r.invoice_id
  );