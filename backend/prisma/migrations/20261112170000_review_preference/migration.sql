-- M3.3c (Q279–Q282): review settings, one row per learner; no row means the defaults.
-- CreateTable
CREATE TABLE "ReviewPreference" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dailyCardLimit" INTEGER NOT NULL DEFAULT 20,
    "levelCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewPreference_userId_key" ON "ReviewPreference"("userId");

-- AddForeignKey
ALTER TABLE "ReviewPreference" ADD CONSTRAINT "ReviewPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Q280: "Số thẻ mỗi ngày" only offers 10, 20 or 30.
ALTER TABLE "ReviewPreference" ADD CONSTRAINT "ReviewPreference_dailyCardLimit_check" CHECK ("dailyCardLimit" IN (10, 20, 30));
