
-- DropIndex
DROP INDEX "ProgramTemplate_name_modality_key";

-- CreateTable
CREATE TABLE "CampusContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campus" TEXT NOT NULL,
    "director" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "advisor1Name" TEXT,
    "advisor1Email" TEXT,
    "advisor2Name" TEXT,
    "advisor2Email" TEXT,
    "whatsapp" TEXT,
    "isAlly" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CampusContact_campus_key" ON "CampusContact"("campus");

-- CreateIndex
CREATE INDEX "CampusContact_isActive_idx" ON "CampusContact"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramTemplate_name_modality_campuses_key" ON "ProgramTemplate"("name", "modality", "campuses");

