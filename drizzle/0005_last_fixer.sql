ALTER TABLE "fixtures" DROP CONSTRAINT "fixtures_career_round_home_unique";--> statement-breakpoint
DROP INDEX "fixtures_career_round_idx";--> statement-breakpoint
ALTER TABLE "fixtures" ADD COLUMN "season" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "fixtures_career_round_idx" ON "fixtures" USING btree ("career_id","season","round");--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_career_round_home_unique" UNIQUE("career_id","season","round","competition","home_club_id");