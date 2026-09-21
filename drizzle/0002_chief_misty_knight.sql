CREATE TABLE `waiver_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`version` integer NOT NULL,
	`text` text NOT NULL,
	`author` text NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_season_waiver_version` ON `waiver_versions` (`season_id`,`version`);