CREATE TYPE "public"."client_kind" AS ENUM('organization', 'individual', 'student', 'guardian');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('enquiry', 'registered', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."client_link_relation" AS ENUM('guardian_of', 'payer_for', 'related_to');--> statement-breakpoint
CREATE TABLE "academy_programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "academy_programme_leads" (
	"programme_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_client_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_client_id" uuid NOT NULL,
	"to_client_id" uuid NOT NULL,
	"relation" "client_link_relation" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_clients" ADD COLUMN "kind" "client_kind" DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "office_clients" ADD COLUMN "status" "client_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "office_clients" ADD COLUMN "tags" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "office_clients" ADD COLUMN "specification" text;--> statement-breakpoint
ALTER TABLE "office_clients" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "office_clients" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "office_clients" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "office_clients" ADD COLUMN "programme_id" uuid;--> statement-breakpoint
ALTER TABLE "office_clients" ADD COLUMN "self_pay" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "academy_programmes" ADD CONSTRAINT "academy_programmes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_programme_leads" ADD CONSTRAINT "academy_programme_leads_programme_id_academy_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."academy_programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_programme_leads" ADD CONSTRAINT "academy_programme_leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_client_links" ADD CONSTRAINT "office_client_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_client_links" ADD CONSTRAINT "office_client_links_from_client_id_office_clients_id_fk" FOREIGN KEY ("from_client_id") REFERENCES "public"."office_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_client_links" ADD CONSTRAINT "office_client_links_to_client_id_office_clients_id_fk" FOREIGN KEY ("to_client_id") REFERENCES "public"."office_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_clients" ADD CONSTRAINT "office_clients_programme_id_academy_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."academy_programmes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academy_programmes_company_idx" ON "academy_programmes" USING btree ("company_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "academy_programme_leads_pk" ON "academy_programme_leads" USING btree ("programme_id","user_id");--> statement-breakpoint
CREATE INDEX "academy_programme_leads_user_idx" ON "academy_programme_leads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_client_links_unique" ON "office_client_links" USING btree ("from_client_id","to_client_id","relation");--> statement-breakpoint
CREATE INDEX "office_client_links_to_idx" ON "office_client_links" USING btree ("to_client_id");--> statement-breakpoint
CREATE INDEX "office_client_links_company_idx" ON "office_client_links" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "office_clients_kind_idx" ON "office_clients" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX "office_clients_programme_idx" ON "office_clients" USING btree ("programme_id");
