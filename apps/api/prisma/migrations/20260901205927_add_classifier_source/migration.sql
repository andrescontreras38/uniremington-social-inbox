-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN "aiInputTokens" INTEGER;
ALTER TABLE "Interaction" ADD COLUMN "aiOutputTokens" INTEGER;
ALTER TABLE "Interaction" ADD COLUMN "classifierSource" TEXT;
