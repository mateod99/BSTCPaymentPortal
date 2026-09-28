CREATE TABLE `club_waiver_versions` (
	`version` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`author` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `player_waivers` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`owner` text NOT NULL,
	`player_name` text NOT NULL,
	`dob` text NOT NULL,
	`text` text NOT NULL,
	`version` integer NOT NULL,
	`signer` text NOT NULL,
	`relationship` text NOT NULL,
	`signed` text NOT NULL,
	`date` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version`) REFERENCES `club_waiver_versions`(`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_player_club_waiver` ON `player_waivers` (`player_id`,`version`);
--> statement-breakpoint
CREATE TRIGGER player_waivers_immutable BEFORE UPDATE ON player_waivers BEGIN SELECT RAISE(ABORT, 'Signed waivers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER club_waiver_versions_immutable BEFORE UPDATE ON club_waiver_versions BEGIN SELECT RAISE(ABORT, 'Waiver versions are immutable'); END;
