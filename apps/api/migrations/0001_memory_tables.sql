CREATE TABLE "episodic_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid,
	"run_id" uuid,
	"project_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text,
	"source_event_ids" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedural_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procedure_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dag_template" jsonb,
	"constraints" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_episodic_memories_chat_id" ON "episodic_memories" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "idx_episodic_memories_run_id" ON "episodic_memories" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_episodic_memories_project_id" ON "episodic_memories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_procedural_memories_procedure_type" ON "procedural_memories" USING btree ("procedure_type");
