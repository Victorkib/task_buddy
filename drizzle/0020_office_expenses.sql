CREATE TABLE "office_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"spent_on" date,
	"voucher_no" text,
	"description" text DEFAULT '' NOT NULL,
	"paid_to" text,
	"category" text,
	"amount_cents" integer,
	"payment_method" text,
	"receipt_no" text,
	"approved_by" text,
	"remarks" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_expenses" ADD CONSTRAINT "office_expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_expenses" ADD CONSTRAINT "office_expenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_expenses_spent_on_idx" ON "office_expenses" USING btree ("company_id","spent_on");
