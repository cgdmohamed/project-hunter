CREATE TABLE `analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`score` real NOT NULL,
	`category` text,
	`summary` text,
	`business_problem` text,
	`technical_suitability` text,
	`suitability_reasons` text,
	`financial_viability` text,
	`risks` text,
	`missing_requirements` text,
	`clarification_questions` text,
	`recommended_approach` text,
	`estimated_duration` text,
	`recommended_price` text,
	`confidence` real,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`estimated_cost` real,
	`content_hash` text,
	`analyzed_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analyses_project_id_idx` ON `analyses` (`project_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`channel` text DEFAULT 'telegram' NOT NULL,
	`notification_type` text DEFAULT 'opportunity' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`telegram_message_id` integer,
	`dedup_key` text NOT NULL,
	`sent_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedup_key_uq` ON `notifications` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `notifications_project_id_idx` ON `notifications` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text,
	`description` text,
	`category` text,
	`skills` text,
	`original_currency` text,
	`budget_min` real,
	`budget_max` real,
	`budget_min_usd` real,
	`budget_max_usd` real,
	`published_at` text,
	`expected_duration` text,
	`project_status` text,
	`proposal_count` integer,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`listing_fingerprint` text,
	`detail_fetched_at` text,
	`status` text DEFAULT 'discovered' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_source_external_id_uq` ON `projects` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `projects_canonical_url_idx` ON `projects` (`canonical_url`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`language` text DEFAULT 'ar' NOT NULL,
	`proposal_text` text NOT NULL,
	`recommended_price` text,
	`estimated_duration` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposals_project_id_idx` ON `proposals` (`project_id`);--> statement-breakpoint
CREATE TABLE `scan_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`duration_ms` integer,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`analyzed_count` integer DEFAULT 0 NOT NULL,
	`qualified_count` integer DEFAULT 0 NOT NULL,
	`budget_rejected_count` integer DEFAULT 0 NOT NULL,
	`needs_review_count` integer DEFAULT 0 NOT NULL,
	`notified_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `scan_logs_started_at_idx` ON `scan_logs` (`started_at`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
