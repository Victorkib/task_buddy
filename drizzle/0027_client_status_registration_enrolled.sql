ALTER TYPE "public"."client_status" RENAME VALUE 'registered' TO 'registration_initiated';--> statement-breakpoint
ALTER TYPE "public"."client_status" ADD VALUE IF NOT EXISTS 'enrolled' BEFORE 'active';
