CREATE INDEX idx_players_owner ON players(owner);
--> statement-breakpoint
CREATE INDEX idx_registrations_owner ON registrations(owner);
--> statement-breakpoint
CREATE INDEX idx_registrations_season_status ON registrations(season_id,status);
--> statement-breakpoint
CREATE INDEX idx_payments_registration ON payments(registration_id);
--> statement-breakpoint
CREATE INDEX idx_notes_registration ON admin_notes(registration_id);
--> statement-breakpoint
CREATE INDEX idx_refunds_payment ON refunds(payment_id);
--> statement-breakpoint
CREATE TRIGGER signed_waiver_immutable BEFORE UPDATE ON signed_waivers BEGIN SELECT RAISE(ABORT, 'Signed waivers are immutable'); END;
