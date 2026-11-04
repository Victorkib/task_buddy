CREATE TABLE IF NOT EXISTS "office_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid,
  "related_client_id" uuid,
  "invoice_id" uuid,
  "document_number" text,
  "amount_cents" integer NOT NULL,
  "payer_name" text NOT NULL,
  "payer_phone" text,
  "account_name" text,
  "account_number" text,
  "paid_on" date NOT NULL,
  "paid_at_label" text,
  "mpesa_ref" text NOT NULL,
  "description" text NOT NULL,
  "source_text" text,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "office_receipts" ADD CONSTRAINT "office_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "office_receipts" ADD CONSTRAINT "office_receipts_client_id_office_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."office_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "office_receipts" ADD CONSTRAINT "office_receipts_related_client_id_office_clients_id_fk" FOREIGN KEY ("related_client_id") REFERENCES "public"."office_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "office_receipts" ADD CONSTRAINT "office_receipts_invoice_id_office_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."office_invoices"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "office_receipts" ADD CONSTRAINT "office_receipts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "office_receipts_number_idx" ON "office_receipts" USING btree ("document_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "office_receipts_ref_idx" ON "office_receipts" USING btree ("company_id","mpesa_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_receipts_client_idx" ON "office_receipts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_receipts_related_idx" ON "office_receipts" USING btree ("related_client_id");