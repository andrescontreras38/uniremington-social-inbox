-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "historicalCursor" TEXT,
ADD COLUMN     "historicalImportedAt" TIMESTAMP(3);
