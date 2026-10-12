CREATE TABLE "keep_current_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "weekly_keep_current" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "keep_current_sends" ADD CONSTRAINT "keep_current_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keep_current_sends_user_week_uidx" ON "keep_current_sends" USING btree ("user_id","week_key");--> statement-breakpoint
CREATE INDEX "keep_current_sends_week_idx" ON "keep_current_sends" USING btree ("week_key");