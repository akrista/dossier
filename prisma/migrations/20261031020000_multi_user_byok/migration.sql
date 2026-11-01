-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "KeyPreference" AS ENUM ('USER_FIRST', 'GLOBAL_FIRST');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "allowGlobalKeys" BOOLEAN NOT NULL DEFAULT false,
    "keyPreference" "KeyPreference",
    "disabledAt" TIMESTAMP(3),
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteTokenHash_key" ON "User"("inviteTokenHash");

-- AlterTable ProfileField
ALTER TABLE "ProfileField" DROP CONSTRAINT "ProfileField_pkey",
ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "ProfileField_pkey" PRIMARY KEY ("userId", "key");

-- AlterTable Skill
DROP INDEX "Skill_name_key";
ALTER TABLE "Skill" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "Skill_userId_name_key" ON "Skill"("userId", "name");

-- AlterTable Language
DROP INDEX "Language_name_key";
ALTER TABLE "Language" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "Language_userId_name_key" ON "Language"("userId", "name");

-- AlterTable Experience
ALTER TABLE "Experience" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Experience_userId_idx" ON "Experience"("userId");

-- AlterTable Project
ALTER TABLE "Project" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- AlterTable Education
ALTER TABLE "Education" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Education_userId_idx" ON "Education"("userId");

-- AlterTable Publication
ALTER TABLE "Publication" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Publication_userId_idx" ON "Publication"("userId");

-- AlterTable Reference
ALTER TABLE "Reference" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Reference_userId_idx" ON "Reference"("userId");

-- AlterTable Fact
ALTER TABLE "Fact" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Fact_userId_applicationId_sort_idx" ON "Fact"("userId", "applicationId", "sort");

-- AlterTable Theme
ALTER TABLE "Theme" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Theme_userId_idx" ON "Theme"("userId");

-- AlterTable Setting
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey",
ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("userId", "key");

-- AlterTable Application
ALTER TABLE "Application" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Application_userId_status_idx" ON "Application"("userId", "status");
CREATE INDEX "Application_userId_updatedAt_idx" ON "Application"("userId", "updatedAt");

-- AlterTable Posting
DROP INDEX "Posting_source_externalId_key";
ALTER TABLE "Posting" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "Posting_userId_source_externalId_key" ON "Posting"("userId", "source", "externalId");
CREATE INDEX "Posting_userId_savedAt_idx" ON "Posting"("userId", "savedAt");
CREATE INDEX "Posting_userId_dismissedAt_idx" ON "Posting"("userId", "dismissedAt");

-- AlterTable ClaudePaste
ALTER TABLE "ClaudePaste" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "ClaudePaste_userId_idx" ON "ClaudePaste"("userId");

-- AlterTable AgentCandidate
DROP INDEX "AgentCandidate_dedupeKey_key";
DROP INDEX "AgentCandidate_source_externalId_key";
ALTER TABLE "AgentCandidate" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "AgentCandidate_userId_source_externalId_key" ON "AgentCandidate"("userId", "source", "externalId");
CREATE UNIQUE INDEX "AgentCandidate_userId_dedupeKey_key" ON "AgentCandidate"("userId", "dedupeKey");
CREATE INDEX "AgentCandidate_userId_status_score_idx" ON "AgentCandidate"("userId", "status", "score");

-- AlterTable PostingScore
ALTER TABLE "PostingScore" DROP CONSTRAINT "PostingScore_pkey",
ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "PostingScore_pkey" PRIMARY KEY ("userId", "source", "externalId");

-- AlterTable PostingSearch
ALTER TABLE "PostingSearch" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "PostingSearch_userId_createdAt_idx" ON "PostingSearch"("userId", "createdAt");

-- AlterTable Startup
DROP INDEX "Startup_source_externalId_key";
ALTER TABLE "Startup" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "Startup_userId_source_externalId_key" ON "Startup"("userId", "source", "externalId");
CREATE INDEX "Startup_userId_status_score_idx" ON "Startup"("userId", "status", "score");

-- AlterTable StartupBlock
ALTER TABLE "StartupBlock" DROP CONSTRAINT "StartupBlock_pkey",
ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "StartupBlock_pkey" PRIMARY KEY ("userId", "hash");

-- AlterTable EmailMessage
DROP INDEX "EmailMessage_gmailId_key";
ALTER TABLE "EmailMessage" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "EmailMessage_userId_gmailId_key" ON "EmailMessage"("userId", "gmailId");
CREATE INDEX "EmailMessage_userId_threadId_idx" ON "EmailMessage"("userId", "threadId");

-- AlterTable Job
ALTER TABLE "Job" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Job_userId_key_createdAt_idx" ON "Job"("userId", "key", "createdAt");
