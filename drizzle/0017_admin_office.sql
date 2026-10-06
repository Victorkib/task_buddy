CREATE TYPE "public"."admin_request_kind" AS ENUM('leave', 'letter', 'print', 'imprest', 'purchase', 'equipment', 'training');--> statement-breakpoint
CREATE TYPE "public"."admin_request_status" AS ENUM('submitted', 'in_review', 'approved', 'rejected', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('permanent', 'contract', 'intern', 'attachee', 'volunteer', 'part_time');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'sick', 'compassionate', 'unpaid', 'study', 'half_day');--> statement-breakpoint
CREATE TYPE "public"."offer_letter_status" AS ENUM('draft', 'awaiting_md', 'issued', 'accepted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."office_asset_status" AS ENUM('in_stock', 'assigned', 'repair', 'retired');--> statement-breakpoint
CREATE TYPE "public"."office_compliance_status" AS ENUM('upcoming', 'due', 'overdue', 'done');--> statement-breakpoint
CREATE TYPE "public"."office_document_status" AS ENUM('draft', 'review', 'published', 'superseded', 'archived');--> statement-breakpoint
CREATE TYPE "public"."office_letter_type" AS ENUM('employment_confirmation', 'introduction', 'bank', 'internship', 'custom');--> statement-breakpoint
CREATE TYPE "public"."office_vendor_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TABLE "admin_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"requestor_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"kind" "admin_request_kind" NOT NULL,
	"status" "admin_request_status" DEFAULT 'submitted' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"leave_type" "leave_type",
	"start_date" date,
	"end_date" date,
	"days_hundredths" integer DEFAULT 0 NOT NULL,
	"amount_kes" integer DEFAULT 0 NOT NULL,
	"copies" integer DEFAULT 1 NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"letter_type" "office_letter_type",
	"document_number" text,
	"generated_html" text,
	"coverage_user_id" uuid,
	"coverage_task_id" uuid,
	"attachment_url" text,
	"attachment_public_id" text,
	"attachment_name" text,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_acknowledgements" (
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"approved_by_id" uuid,
	"department_id" uuid,
	"candidate_name" text NOT NULL,
	"candidate_email" text,
	"job_title" text NOT NULL,
	"salary_text" text,
	"start_date" date,
	"probation_months" integer DEFAULT 3 NOT NULL,
	"status" "offer_letter_status" DEFAULT 'draft' NOT NULL,
	"document_number" text,
	"body_html" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"assigned_user_id" uuid,
	"name" text NOT NULL,
	"asset_tag" text,
	"status" "office_asset_status" DEFAULT 'in_stock' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_compliance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" uuid,
	"title" text NOT NULL,
	"category" text DEFAULT 'statutory' NOT NULL,
	"due_date" date,
	"cadence" text DEFAULT 'once' NOT NULL,
	"status" "office_compliance_status" DEFAULT 'upcoming' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" uuid,
	"title" text NOT NULL,
	"category" text DEFAULT 'policy' NOT NULL,
	"status" "office_document_status" DEFAULT 'draft' NOT NULL,
	"body" text,
	"file_url" text,
	"document_number" text,
	"effective_date" date,
	"review_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"category" text DEFAULT 'software' NOT NULL,
	"renewal_date" date,
	"amount_kes" integer DEFAULT 0 NOT NULL,
	"status" "office_vendor_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"employment_type" "employment_type" DEFAULT 'permanent' NOT NULL,
	"start_date" date,
	"end_date" date,
	"probation_end_date" date,
	"annual_entitlement_days" integer DEFAULT 21 NOT NULL,
	"sick_entitlement_days" integer DEFAULT 7 NOT NULL,
	"annual_used_hundredths" integer DEFAULT 0 NOT NULL,
	"sick_used_hundredths" integer DEFAULT 0 NOT NULL,
	"unpaid_used_hundredths" integer DEFAULT 0 NOT NULL,
	"carry_over_hundredths" integer DEFAULT 0 NOT NULL,
	"leave_year" integer DEFAULT 2026 NOT NULL,
	"emergency_name" text,
	"emergency_phone" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_requests" ADD CONSTRAINT "admin_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_requests" ADD CONSTRAINT "admin_requests_requestor_id_users_id_fk" FOREIGN KEY ("requestor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_requests" ADD CONSTRAINT "admin_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_requests" ADD CONSTRAINT "admin_requests_coverage_user_id_users_id_fk" FOREIGN KEY ("coverage_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_requests" ADD CONSTRAINT "admin_requests_coverage_task_id_tasks_id_fk" FOREIGN KEY ("coverage_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_document_id_office_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."office_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_assets" ADD CONSTRAINT "office_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_assets" ADD CONSTRAINT "office_assets_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_compliance" ADD CONSTRAINT "office_compliance_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_compliance" ADD CONSTRAINT "office_compliance_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_documents" ADD CONSTRAINT "office_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_documents" ADD CONSTRAINT "office_documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_vendors" ADD CONSTRAINT "office_vendors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_vendors" ADD CONSTRAINT "office_vendors_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_requests_status_idx" ON "admin_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "admin_requests_requestor_idx" ON "admin_requests" USING btree ("requestor_id");--> statement-breakpoint
CREATE INDEX "admin_requests_kind_idx" ON "admin_requests" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "document_acks_pk" ON "document_acknowledgements" USING btree ("document_id","user_id");--> statement-breakpoint
CREATE INDEX "offer_letters_status_idx" ON "offer_letters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "office_assets_assignee_idx" ON "office_assets" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "office_compliance_due_idx" ON "office_compliance" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "office_documents_status_idx" ON "office_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "office_vendors_renewal_idx" ON "office_vendors" USING btree ("renewal_date");