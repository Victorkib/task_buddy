ALTER TABLE "office_clients" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "office_clients_external_idx" ON "office_clients" USING btree ("company_id","external_id");
