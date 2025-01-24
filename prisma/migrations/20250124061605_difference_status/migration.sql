-- CreateEnum
CREATE TYPE "DifferenceStatus" AS ENUM ('surplus', 'deficit');

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "differenceStatus" "DifferenceStatus",
ADD COLUMN     "differenceValue" DOUBLE PRECISION;
