-- CreateTable
CREATE TABLE "ProgramTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "faculty" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'PREGRADO',
    "modality" TEXT NOT NULL DEFAULT 'PRESENCIAL',
    "campuses" TEXT NOT NULL DEFAULT 'NACIONAL',
    "semesterValue" INTEGER,
    "enrollmentFee" INTEGER,
    "otherFeesNote" TEXT,
    "discountNote" TEXT,
    "durationSemesters" INTEGER,
    "credits" INTEGER,
    "requirements" TEXT,
    "officialUrl" TEXT,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "costIsPublic" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ProgramTemplate_faculty_idx" ON "ProgramTemplate"("faculty");

-- CreateIndex
CREATE INDEX "ProgramTemplate_isActive_idx" ON "ProgramTemplate"("isActive");

-- CreateIndex
CREATE INDEX "ProgramTemplate_level_idx" ON "ProgramTemplate"("level");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramTemplate_name_modality_key" ON "ProgramTemplate"("name", "modality");
