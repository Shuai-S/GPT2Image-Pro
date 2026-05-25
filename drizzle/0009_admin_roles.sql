ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'observer_admin';
--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'super_admin';
