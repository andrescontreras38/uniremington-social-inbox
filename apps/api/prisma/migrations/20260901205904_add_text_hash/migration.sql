-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN "textHash" TEXT;

-- CreateIndex
CREATE INDEX "Interaction_textHash_idx" ON "Interaction"("textHash");
