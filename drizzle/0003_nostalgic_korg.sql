CREATE TABLE "board_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"career_id" uuid NOT NULL,
	"season" smallint NOT NULL,
	"round" smallint NOT NULL,
	"type" text NOT NULL,
	"player_id" integer,
	"amount_eur" bigint,
	"outcome" text NOT NULL,
	"granted_eur" bigint,
	"response" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_division" (
	"career_id" uuid NOT NULL,
	"season" smallint NOT NULL,
	"club_id" integer NOT NULL,
	"promoted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "career_division_career_id_season_club_id_pk" PRIMARY KEY("career_id","season","club_id")
);
--> statement-breakpoint
CREATE TABLE "career_honours" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"career_id" uuid NOT NULL,
	"season" smallint NOT NULL,
	"type" text NOT NULL,
	"club_id" integer NOT NULL,
	"player_id" integer,
	"value" real,
	"is_user" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_offers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"career_id" uuid NOT NULL,
	"club_id" integer NOT NULL,
	"season" smallint NOT NULL,
	"expected_position" smallint NOT NULL,
	"pitch" text NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_development" (
	"career_id" uuid NOT NULL,
	"player_id" integer NOT NULL,
	"season" smallint NOT NULL,
	"overall" smallint NOT NULL,
	"age" smallint NOT NULL,
	"club_id" integer NOT NULL,
	CONSTRAINT "player_development_career_id_player_id_season_pk" PRIMARY KEY("career_id","player_id","season")
);
--> statement-breakpoint
CREATE TABLE "season_history" (
	"career_id" uuid NOT NULL,
	"season" smallint NOT NULL,
	"club_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"played" smallint NOT NULL,
	"won" smallint NOT NULL,
	"drawn" smallint NOT NULL,
	"lost" smallint NOT NULL,
	"goals_for" smallint NOT NULL,
	"goals_against" smallint NOT NULL,
	"points" smallint NOT NULL,
	"outcome" text,
	CONSTRAINT "season_history_career_id_season_club_id_pk" PRIMARY KEY("career_id","season","club_id")
);
--> statement-breakpoint
ALTER TABLE "fixtures" DROP CONSTRAINT "fixtures_career_round_home_unique";--> statement-breakpoint
ALTER TABLE "careers" ADD COLUMN "expected_position" smallint DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "careers" ADD COLUMN "board_confidence" real DEFAULT 65 NOT NULL;--> statement-breakpoint
ALTER TABLE "careers" ADD COLUMN "rounds_in_danger" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "careers" ADD COLUMN "under_pressure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fixtures" ADD COLUMN "cup_round" smallint;--> statement-breakpoint
ALTER TABLE "fixtures" ADD COLUMN "winner_club_id" integer;--> statement-breakpoint
ALTER TABLE "fixtures" ADD COLUMN "penalty_shootout" jsonb;--> statement-breakpoint
ALTER TABLE "board_requests" ADD CONSTRAINT "board_requests_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_requests" ADD CONSTRAINT "board_requests_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_division" ADD CONSTRAINT "career_division_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_division" ADD CONSTRAINT "career_division_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_honours" ADD CONSTRAINT "career_honours_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_honours" ADD CONSTRAINT "career_honours_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_honours" ADD CONSTRAINT "career_honours_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_development" ADD CONSTRAINT "player_development_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_development" ADD CONSTRAINT "player_development_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_development" ADD CONSTRAINT "player_development_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_history" ADD CONSTRAINT "season_history_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_history" ADD CONSTRAINT "season_history_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_requests_career_idx" ON "board_requests" USING btree ("career_id","season");--> statement-breakpoint
CREATE INDEX "career_division_season_idx" ON "career_division" USING btree ("career_id","season");--> statement-breakpoint
CREATE INDEX "career_honours_career_idx" ON "career_honours" USING btree ("career_id","season");--> statement-breakpoint
CREATE INDEX "job_offers_career_idx" ON "job_offers" USING btree ("career_id");--> statement-breakpoint
CREATE INDEX "player_development_player_idx" ON "player_development" USING btree ("career_id","player_id");--> statement-breakpoint
CREATE INDEX "season_history_season_idx" ON "season_history" USING btree ("career_id","season");--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_winner_club_id_clubs_id_fk" FOREIGN KEY ("winner_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_career_round_home_unique" UNIQUE("career_id","round","competition","home_club_id");