CREATE TABLE "task_helpers" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_helpers" ADD CONSTRAINT "task_helpers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_helpers" ADD CONSTRAINT "task_helpers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_helpers_pk" ON "task_helpers" USING btree ("task_id","user_id");--> statement-breakpoint
CREATE INDEX "task_helpers_user_idx" ON "task_helpers" USING btree ("user_id");