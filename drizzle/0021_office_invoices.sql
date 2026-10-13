CREATE TABLE "office_invoice_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"vat_enabled" boolean DEFAULT true NOT NULL,
	"vat_rate_bps" integer DEFAULT 1600 NOT NULL,
	"company_pin" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"pin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"client_id" uuid,
	"document_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"client_name" text NOT NULL,
	"client_email" text,
	"client_phone" text,
	"client_address" text,
	"client_pin" text,
	"vat_enabled" boolean DEFAULT true NOT NULL,
	"vat_rate_bps" integer DEFAULT 0 NOT NULL,
	"company_pin" text,
	"payment_snapshot" text DEFAULT '[]' NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity_hundredths" integer NOT NULL,
	"rate_cents" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_invoice_settings" ADD CONSTRAINT "office_invoice_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_payment_accounts" ADD CONSTRAINT "office_payment_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_clients" ADD CONSTRAINT "office_clients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_invoices" ADD CONSTRAINT "office_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_invoices" ADD CONSTRAINT "office_invoices_client_id_office_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."office_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_invoices" ADD CONSTRAINT "office_invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_invoice_lines" ADD CONSTRAINT "office_invoice_lines_invoice_id_office_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."office_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_payment_accounts_company_idx" ON "office_payment_accounts" USING btree ("company_id","sort_order");--> statement-breakpoint
CREATE INDEX "office_clients_company_idx" ON "office_clients" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "office_invoices_number_idx" ON "office_invoices" USING btree ("document_number");--> statement-breakpoint
CREATE INDEX "office_invoices_company_idx" ON "office_invoices" USING btree ("company_id","issue_date");--> statement-breakpoint
CREATE INDEX "office_invoice_lines_invoice_idx" ON "office_invoice_lines" USING btree ("invoice_id","position");