CREATE TABLE "career_club_finance" (
	"career_id" uuid NOT NULL,
	"club_id" integer NOT NULL,
	"transfer_budget" bigint NOT NULL,
	"wage_budget" bigint NOT NULL,
	"wage_spend" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "career_club_finance_career_id_club_id_pk" PRIMARY KEY("career_id","club_id")
);
--> statement-breakpoint
CREATE TABLE "career_training" (
	"career_id" uuid PRIMARY KEY NOT NULL,
	"focus" text DEFAULT 'balanced' NOT NULL,
	"intensity" smallint DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"career_id" uuid NOT NULL,
	"round" smallint NOT NULL,
	"focus" text NOT NULL,
	"intensity" smallint NOT NULL,
	"improvements" jsonb NOT NULL,
	"injuries" jsonb NOT NULL,
	CONSTRAINT "training_reports_career_round_unique" UNIQUE("career_id","round")
);
--> statement-breakpoint
CREATE TABLE "transfer_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"career_id" uuid NOT NULL,
	"player_id" integer NOT NULL,
	"from_club_id" integer NOT NULL,
	"to_club_id" integer NOT NULL,
	"fee_eur" bigint NOT NULL,
	"round" smallint NOT NULL,
	"season" smallint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"career_id" uuid NOT NULL,
	"player_id" integer NOT NULL,
	"from_club_id" integer NOT NULL,
	"to_club_id" integer NOT NULL,
	"is_user_offer" boolean DEFAULT false NOT NULL,
	"fee_eur" bigint NOT NULL,
	"wage_eur" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"counter_fee_eur" bigint,
	"response_note" text,
	"round" smallint NOT NULL,
	"resolves_on_round" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "career_player_state" ADD COLUMN "club_id" integer;--> statement-breakpoint
ALTER TABLE "career_player_state" ADD COLUMN "attribute_deltas" jsonb;--> statement-breakpoint
ALTER TABLE "career_player_state" ADD COLUMN "training_focus" text;--> statement-breakpoint
ALTER TABLE "fixtures" ADD COLUMN "report" jsonb;--> statement-breakpoint
ALTER TABLE "career_club_finance" ADD CONSTRAINT "career_club_finance_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_club_finance" ADD CONSTRAINT "career_club_finance_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_training" ADD CONSTRAINT "career_training_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_reports" ADD CONSTRAINT "training_reports_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_from_club_id_clubs_id_fk" FOREIGN KEY ("from_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_to_club_id_clubs_id_fk" FOREIGN KEY ("to_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_offers" ADD CONSTRAINT "transfer_offers_career_id_careers_id_fk" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_offers" ADD CONSTRAINT "transfer_offers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_offers" ADD CONSTRAINT "transfer_offers_from_club_id_clubs_id_fk" FOREIGN KEY ("from_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_offers" ADD CONSTRAINT "transfer_offers_to_club_id_clubs_id_fk" FOREIGN KEY ("to_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_reports_career_idx" ON "training_reports" USING btree ("career_id","round");--> statement-breakpoint
CREATE INDEX "transfer_history_career_idx" ON "transfer_history" USING btree ("career_id","round");--> statement-breakpoint
CREATE INDEX "transfer_offers_career_idx" ON "transfer_offers" USING btree ("career_id","status");--> statement-breakpoint
CREATE INDEX "transfer_offers_player_idx" ON "transfer_offers" USING btree ("career_id","player_id");--> statement-breakpoint
ALTER TABLE "career_player_state" ADD CONSTRAINT "career_player_state_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "career_player_state_club_idx" ON "career_player_state" USING btree ("career_id","club_id");