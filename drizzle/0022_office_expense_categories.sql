CREATE TABLE "office_expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_expense_categories" ADD CONSTRAINT "office_expense_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "office_expense_categories_company_name_idx" ON "office_expense_categories" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "office_expense_categories_company_idx" ON "office_expense_categories" USING btree ("company_id");