CREATE TABLE `executive_records` (
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`kind`, `id`),
	CONSTRAINT "record_json" CHECK(json_valid(data))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_demo_loan` ON `executive_records` (json_extract(data,'$.asset')) WHERE kind='loan' AND json_extract(data,'$.returned')='';