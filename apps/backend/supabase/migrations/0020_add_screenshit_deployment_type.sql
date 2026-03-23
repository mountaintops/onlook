-- Add 'screenshit' to the deployment_type enum
ALTER TYPE "public"."deployment_type" ADD VALUE IF NOT EXISTS 'screenshit';
