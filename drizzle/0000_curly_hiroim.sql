CREATE TABLE "career_player_state" (
	"career_id" uuid NOT NULL,
	"player_id" integer NOT NULL,
	"fitness" real DEFAULT 100 NOT NULL,
	"form" real DEFAULT 6.5 NOT NULL,
	"injury_type" text,
	"injured_until_round" smallint,
	"suspended_until_round" smallint,
	"season_yellows" smallint DEFAULT 0 NOT NULL,
	"apps" integer DEFAULT 0 NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"yellows" integer DEFAULT 0 NOT NULL,
	"reds" integer DEFAULT 0 NOT NULL,
	"rating_sum" real DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "career_player_state_career_id_player_id_pk" PRIMARY KEY("career_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "career_tactics" (
	"career_id" uuid PRIMARY KEY NOT NULL,
	"formation" text DEFAULT '4-3-3' NOT NULL,
	"mentality" smallint DEFAULT 3 NOT NULL,
	"pressing" smallint DEFAULT 3 NOT NULL,
	"tempo" smallint DEFAULT 3 NOT NULL,
	"width" smallint DEFAULT 3 NOT NULL,
	"directness" smallint DEFAULT 3 NOT NULL,
	"lineup" jsonb NOT NULL,
	"bench" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "careers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"club_id" integer NOT NULL,
	"season" smallint DEFAULT 1 NOT NULL,
	"current_round" smallint DEFAULT 1 NOT NULL,
	"phase" text DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "careers_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"primary_color" text NOT NULL,
	"secondary_color" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"career_id" uuid NOT NULL,
	"round" smallint NOT NULL,
	"competition" text DEFAULT 'league' NOT NULL,
	"home_club_id" integer NOT NULL,
	"away_club_id" integer NOT NULL,
	"kickoff_date" date,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"seed" integer NOT NULL,
	"home_goals" smallint,
	"away_goals" smallint,
	"home_stats" jsonb,
	"away_stats" jsonb,
	CONSTRAINT "fixtures_career_round_home_unique" UNIQUE("career_id","round","home_club_id")
);
--> statement-breakpoint
CREATE TABLE "live_match_state" (
	"fixture_id" uuid PRIMARY KEY NOT NULL,
	"career_id" uuid NOT NULL,
	"current_minute" smallint DEFAULT 0 NOT NULL,
	"state_json" jsonb NOT NULL,
	"segment_start_json" jsonb NOT NULL,
	"segment_start_seq" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fixture_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"minute" smallint NOT NULL,
	"added_time" smallint DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"club_id" integer,
	"player_id" integer,
	"second_player_id" integer,
	"commentary" text NOT NULL,
	"data" jsonb,
	CONSTRAINT "match_events_fixture_seq_unique" UNIQUE("fixture_id","seq")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" integer PRIMARY KEY NOT NULL,
	"club_id" integer NOT NULL,
	"short_name" text NOT NULL,
	"long_name" text NOT NULL,
	"positions" text[] NOT NULL,
	"is_gk" boolean NOT NULL,
	"overall" smallint NOT NULL,
	"potential" smallint NOT NULL,
	"age" smallint NOT NULL,
	"value_eur" bigint,
	"wage_eur" bigint,
	"jersey" smallint,
	"preferred_foot" text,
	"weak_foot" smallint,
	"skill_moves" smallint,
	"nationality" text,
	"height_cm" smallint,
	"weight_kg" smallint,
	"club_position" text,
	"crossing" smallint NOT NULL,
	"finishing" smallint NOT NULL,
	"heading_accuracy" smallint NOT NULL,
	"short_passing" smallint NOT NULL,
	"volleys" smallint NOT NULL,
	"dribbling" smallint NOT NULL,
	"curve" smallint NOT NULL,
	"fk_accuracy" smallint NOT NULL,
	"long_passing" smallint NOT NULL,
	"ball_control" smallint NOT NULL,
	"acceleration" smallint NOT NULL,
	"sprint_speed" smallint NOT NULL,
	"agility" smallint NOT NULL,
	"reactions" smallint NOT NULL,
	"balance" smallint NOT NULL,
	"jumping" smallint NOT NULL,
	"stamina" smallint NOT NULL,
	"strength" smallint NOT NULL,
	"shot_power" smallint NOT NULL,
	"long_shots" smallint NOT NULL,
	"aggression" smallint NOT NULL,
	"interceptions" smallint NOT NULL,
	"positioning" smallint NOT NULL,
	"vision" smallint NOT NULL,
	"penalties" smallint NOT NULL,
	"composure" smallint NOT NULL,
	"marking" smallint NOT NULL,
	"standing_tackle" smallint NOT NULL,
	"sliding_tackle" smallint NOT NULL,
	"gk_diving" smallint NOT NULL,
	"gk_handling" smallint NOT NULL,
	"gk_kicking" smallint NOT NULL,
	"gk_positioning" smallint NOT NULL,
	"gk_reflexes" smallint NOT NULL,
	"gk_speed" smallint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "career_player_state" ADD CONSTRAINT "career_player_state_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_player_state" ADD CONSTRAINT "career_player_state_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_tactics" ADD CONSTRAINT "career_tactics_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "careers" ADD CONSTRAINT "careers_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_club_id_clubs_id_fk" FOREIGN KEY ("home_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_club_id_clubs_id_fk" FOREIGN KEY ("away_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_match_state" ADD CONSTRAINT "live_match_state_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_match_state" ADD CONSTRAINT "live_match_state_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "career_player_state_career_idx" ON "career_player_state" USING btree ("career_id");--> statement-breakpoint
CREATE INDEX "fixtures_career_round_idx" ON "fixtures" USING btree ("career_id","round");--> statement-breakpoint
CREATE INDEX "match_events_fixture_seq_idx" ON "match_events" USING btree ("fixture_id","seq");--> statement-breakpoint
CREATE INDEX "players_club_idx" ON "players" USING btree ("club_id");