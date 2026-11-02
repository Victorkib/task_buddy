ALTER TABLE "office_invoice_lines" ADD COLUMN IF NOT EXISTS "subject_client_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "office_invoice_lines" ADD CONSTRAINT "office_invoice_lines_subject_client_id_office_clients_id_fk" FOREIGN KEY ("subject_client_id") REFERENCES "public"."office_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_invoice_lines_subject_idx" ON "office_invoice_lines" USING btree ("subject_client_id");--> statement-breakpoint
-- Parent/payer links saved from the student's record were stored backwards (student -> parent).
-- Drop any that already exist the right way round, then flip the rest so the payer is always "from".
DELETE FROM "office_client_links" AS l
USING "office_clients" AS f, "office_clients" AS t
WHERE l."from_client_id" = f."id"
  AND l."to_client_id" = t."id"
  AND l."relation" IN ('guardian_of', 'payer_for')
  AND f."kind" = 'student'
  AND t."kind" <> 'student'
  AND EXISTS (
    SELECT 1 FROM "office_client_links" AS c
    WHERE c."from_client_id" = l."to_client_id"
      AND c."to_client_id" = l."from_client_id"
      AND c."relation" = l."relation"
  );--> statement-breakpoint
UPDATE "office_client_links" AS l
SET "from_client_id" = l."to_client_id", "to_client_id" = l."from_client_id"
FROM "office_clients" AS f, "office_clients" AS t
WHERE l."from_client_id" = f."id"
  AND l."to_client_id" = t."id"
  AND l."relation" IN ('guardian_of', 'payer_for')
  AND f."kind" = 'student'
  AND t."kind" <> 'student';
