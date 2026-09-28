CREATE TABLE "labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_labels" (
	"track_id" integer NOT NULL,
	"label_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "track_labels_track_id_label_id_pk" PRIMARY KEY("track_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"performer" text,
	"start_offset_ms" integer DEFAULT 0 NOT NULL,
	"latency_offset_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"peaks" jsonb NOT NULL,
	"source" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "tracks_status_check" CHECK ("tracks"."status" in ('pending', 'active')),
	CONSTRAINT "tracks_source_check" CHECK ("tracks"."source" in ('upload', 'recording'))
);
--> statement-breakpoint
ALTER TABLE "track_labels" ADD CONSTRAINT "track_labels_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_labels" ADD CONSTRAINT "track_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "labels_name_lower_idx" ON "labels" USING btree (lower("name"));