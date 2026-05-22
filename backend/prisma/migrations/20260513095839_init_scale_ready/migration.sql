-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('audio', 'image', 'pdf', 'video');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('mcq', 'listening', 'reading', 'writing', 'speaking');

-- CreateEnum
CREATE TYPE "Skill" AS ENUM ('listening', 'reading', 'writing', 'speaking');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('not_started', 'learning', 'done');

-- CreateEnum
CREATE TYPE "WordProgressStatus" AS ENUM ('learning', 'done');

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('mcq', 'fill_blank', 'listening_choice', 'arrange_sentence', 'speaking_repeat');

-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('word', 'sentence');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'user',
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" SERIAL NOT NULL,
    "levelId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "coverImageId" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Story" (
    "id" SERIAL NOT NULL,
    "levelId" INTEGER NOT NULL,
    "lessonId" INTEGER,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "slug" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Word" (
    "id" SERIAL NOT NULL,
    "hanzi" TEXT NOT NULL,
    "traditional" TEXT,
    "pinyin" TEXT NOT NULL,
    "pinyinTone" TEXT,
    "example" TEXT,
    "isPure" BOOLEAN NOT NULL DEFAULT true,
    "audioId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Word_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordMeaning" (
    "id" SERIAL NOT NULL,
    "wordId" INTEGER NOT NULL,
    "meaningEn" TEXT NOT NULL,
    "meaningVi" TEXT,

    CONSTRAINT "WordMeaning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordLevel" (
    "id" SERIAL NOT NULL,
    "wordId" INTEGER NOT NULL,
    "levelId" INTEGER NOT NULL,

    CONSTRAINT "WordLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonWord" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LessonWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sentence" (
    "id" SERIAL NOT NULL,
    "hanzi" TEXT NOT NULL,
    "pinyin" TEXT,
    "meaningEn" TEXT,
    "meaningVi" TEXT,
    "audioId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sentence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonSentence" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "sentenceId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LessonSentence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonExercise" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "type" "ExerciseType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "answer" JSONB NOT NULL,
    "explanation" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonExerciseAttempt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "exerciseId" INTEGER NOT NULL,
    "answer" JSONB NOT NULL,
    "isCorrect" BOOLEAN,
    "score" INTEGER,
    "detailJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonExerciseAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PronunciationPractice" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "targetType" "TargetType" NOT NULL,
    "targetText" TEXT NOT NULL,
    "pinyin" TEXT,
    "audioId" INTEGER,
    "orderIndex" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PronunciationPractice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PronunciationAttempt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "practiceId" INTEGER NOT NULL,
    "audioId" INTEGER,
    "score" DOUBLE PRECISION,
    "detailJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PronunciationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "skill" "Skill" NOT NULL,
    "audioId" INTEGER,
    "imageId" INTEGER,
    "answers" JSONB NOT NULL,
    "correctAnswer" JSONB NOT NULL,
    "explanation" TEXT,
    "levelId" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" SERIAL NOT NULL,
    "levelId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestQuestion" (
    "id" SERIAL NOT NULL,
    "testId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "TestQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Result" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "testId" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "detailJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultSkillScore" (
    "id" SERIAL NOT NULL,
    "resultId" INTEGER NOT NULL,
    "skill" "Skill" NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "ResultSkillScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWord" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Progress" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'not_started',
    "score" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWordProgress" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "status" "WordProgressStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWordProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Media_type_idx" ON "Media"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Level_name_key" ON "Level"("name");

-- CreateIndex
CREATE INDEX "Level_orderIndex_idx" ON "Level"("orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_slug_key" ON "Lesson"("slug");

-- CreateIndex
CREATE INDEX "Lesson_levelId_idx" ON "Lesson"("levelId");

-- CreateIndex
CREATE INDEX "Lesson_orderIndex_idx" ON "Lesson"("orderIndex");

-- CreateIndex
CREATE INDEX "Lesson_status_idx" ON "Lesson"("status");

-- CreateIndex
CREATE INDEX "Lesson_deletedAt_idx" ON "Lesson"("deletedAt");

-- CreateIndex
CREATE INDEX "Topic_lessonId_idx" ON "Topic"("lessonId");

-- CreateIndex
CREATE INDEX "Topic_orderIndex_idx" ON "Topic"("orderIndex");

-- CreateIndex
CREATE INDEX "Topic_status_idx" ON "Topic"("status");

-- CreateIndex
CREATE INDEX "Topic_deletedAt_idx" ON "Topic"("deletedAt");

-- CreateIndex
CREATE INDEX "Topic_lessonId_orderIndex_idx" ON "Topic"("lessonId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Story_slug_key" ON "Story"("slug");

-- CreateIndex
CREATE INDEX "Story_levelId_idx" ON "Story"("levelId");

-- CreateIndex
CREATE INDEX "Story_lessonId_idx" ON "Story"("lessonId");

-- CreateIndex
CREATE INDEX "Story_orderIndex_idx" ON "Story"("orderIndex");

-- CreateIndex
CREATE INDEX "Story_status_idx" ON "Story"("status");

-- CreateIndex
CREATE INDEX "Story_deletedAt_idx" ON "Story"("deletedAt");

-- CreateIndex
CREATE INDEX "Story_levelId_orderIndex_idx" ON "Story"("levelId", "orderIndex");

-- CreateIndex
CREATE INDEX "Word_hanzi_idx" ON "Word"("hanzi");

-- CreateIndex
CREATE INDEX "Word_pinyin_idx" ON "Word"("pinyin");

-- CreateIndex
CREATE INDEX "Word_isPure_idx" ON "Word"("isPure");

-- CreateIndex
CREATE INDEX "Word_audioId_idx" ON "Word"("audioId");

-- CreateIndex
CREATE UNIQUE INDEX "Word_hanzi_pinyin_key" ON "Word"("hanzi", "pinyin");

-- CreateIndex
CREATE INDEX "WordMeaning_wordId_idx" ON "WordMeaning"("wordId");

-- CreateIndex
CREATE INDEX "WordLevel_wordId_idx" ON "WordLevel"("wordId");

-- CreateIndex
CREATE INDEX "WordLevel_levelId_idx" ON "WordLevel"("levelId");

-- CreateIndex
CREATE UNIQUE INDEX "WordLevel_wordId_levelId_key" ON "WordLevel"("wordId", "levelId");

-- CreateIndex
CREATE INDEX "LessonWord_lessonId_idx" ON "LessonWord"("lessonId");

-- CreateIndex
CREATE INDEX "LessonWord_wordId_idx" ON "LessonWord"("wordId");

-- CreateIndex
CREATE INDEX "LessonWord_lessonId_orderIndex_idx" ON "LessonWord"("lessonId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LessonWord_lessonId_wordId_key" ON "LessonWord"("lessonId", "wordId");

-- CreateIndex
CREATE INDEX "Sentence_hanzi_idx" ON "Sentence"("hanzi");

-- CreateIndex
CREATE INDEX "Sentence_pinyin_idx" ON "Sentence"("pinyin");

-- CreateIndex
CREATE INDEX "Sentence_audioId_idx" ON "Sentence"("audioId");

-- CreateIndex
CREATE INDEX "LessonSentence_lessonId_idx" ON "LessonSentence"("lessonId");

-- CreateIndex
CREATE INDEX "LessonSentence_sentenceId_idx" ON "LessonSentence"("sentenceId");

-- CreateIndex
CREATE INDEX "LessonSentence_lessonId_orderIndex_idx" ON "LessonSentence"("lessonId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LessonSentence_lessonId_sentenceId_key" ON "LessonSentence"("lessonId", "sentenceId");

-- CreateIndex
CREATE INDEX "LessonExercise_lessonId_idx" ON "LessonExercise"("lessonId");

-- CreateIndex
CREATE INDEX "LessonExercise_type_idx" ON "LessonExercise"("type");

-- CreateIndex
CREATE INDEX "LessonExercise_status_idx" ON "LessonExercise"("status");

-- CreateIndex
CREATE INDEX "LessonExercise_deletedAt_idx" ON "LessonExercise"("deletedAt");

-- CreateIndex
CREATE INDEX "LessonExercise_lessonId_orderIndex_idx" ON "LessonExercise"("lessonId", "orderIndex");

-- CreateIndex
CREATE INDEX "LessonExerciseAttempt_userId_idx" ON "LessonExerciseAttempt"("userId");

-- CreateIndex
CREATE INDEX "LessonExerciseAttempt_exerciseId_idx" ON "LessonExerciseAttempt"("exerciseId");

-- CreateIndex
CREATE INDEX "LessonExerciseAttempt_createdAt_idx" ON "LessonExerciseAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "PronunciationPractice_lessonId_idx" ON "PronunciationPractice"("lessonId");

-- CreateIndex
CREATE INDEX "PronunciationPractice_targetType_idx" ON "PronunciationPractice"("targetType");

-- CreateIndex
CREATE INDEX "PronunciationPractice_status_idx" ON "PronunciationPractice"("status");

-- CreateIndex
CREATE INDEX "PronunciationPractice_deletedAt_idx" ON "PronunciationPractice"("deletedAt");

-- CreateIndex
CREATE INDEX "PronunciationPractice_lessonId_orderIndex_idx" ON "PronunciationPractice"("lessonId", "orderIndex");

-- CreateIndex
CREATE INDEX "PronunciationAttempt_userId_idx" ON "PronunciationAttempt"("userId");

-- CreateIndex
CREATE INDEX "PronunciationAttempt_practiceId_idx" ON "PronunciationAttempt"("practiceId");

-- CreateIndex
CREATE INDEX "PronunciationAttempt_createdAt_idx" ON "PronunciationAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "Question_levelId_idx" ON "Question"("levelId");

-- CreateIndex
CREATE INDEX "Question_skill_idx" ON "Question"("skill");

-- CreateIndex
CREATE INDEX "Question_type_idx" ON "Question"("type");

-- CreateIndex
CREATE INDEX "Question_status_idx" ON "Question"("status");

-- CreateIndex
CREATE INDEX "Question_deletedAt_idx" ON "Question"("deletedAt");

-- CreateIndex
CREATE INDEX "Question_levelId_skill_idx" ON "Question"("levelId", "skill");

-- CreateIndex
CREATE INDEX "Test_levelId_idx" ON "Test"("levelId");

-- CreateIndex
CREATE INDEX "Test_status_idx" ON "Test"("status");

-- CreateIndex
CREATE INDEX "Test_deletedAt_idx" ON "Test"("deletedAt");

-- CreateIndex
CREATE INDEX "TestQuestion_testId_idx" ON "TestQuestion"("testId");

-- CreateIndex
CREATE INDEX "TestQuestion_questionId_idx" ON "TestQuestion"("questionId");

-- CreateIndex
CREATE INDEX "TestQuestion_testId_orderIndex_idx" ON "TestQuestion"("testId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TestQuestion_testId_questionId_key" ON "TestQuestion"("testId", "questionId");

-- CreateIndex
CREATE INDEX "Result_userId_idx" ON "Result"("userId");

-- CreateIndex
CREATE INDEX "Result_testId_idx" ON "Result"("testId");

-- CreateIndex
CREATE INDEX "Result_createdAt_idx" ON "Result"("createdAt");

-- CreateIndex
CREATE INDEX "ResultSkillScore_resultId_idx" ON "ResultSkillScore"("resultId");

-- CreateIndex
CREATE INDEX "ResultSkillScore_skill_idx" ON "ResultSkillScore"("skill");

-- CreateIndex
CREATE UNIQUE INDEX "ResultSkillScore_resultId_skill_key" ON "ResultSkillScore"("resultId", "skill");

-- CreateIndex
CREATE INDEX "UserWord_userId_idx" ON "UserWord"("userId");

-- CreateIndex
CREATE INDEX "UserWord_wordId_idx" ON "UserWord"("wordId");

-- CreateIndex
CREATE UNIQUE INDEX "UserWord_userId_wordId_key" ON "UserWord"("userId", "wordId");

-- CreateIndex
CREATE INDEX "Progress_userId_idx" ON "Progress"("userId");

-- CreateIndex
CREATE INDEX "Progress_lessonId_idx" ON "Progress"("lessonId");

-- CreateIndex
CREATE INDEX "Progress_status_idx" ON "Progress"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Progress_userId_lessonId_key" ON "Progress"("userId", "lessonId");

-- CreateIndex
CREATE INDEX "UserWordProgress_userId_idx" ON "UserWordProgress"("userId");

-- CreateIndex
CREATE INDEX "UserWordProgress_wordId_idx" ON "UserWordProgress"("wordId");

-- CreateIndex
CREATE INDEX "UserWordProgress_status_idx" ON "UserWordProgress"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserWordProgress_userId_wordId_key" ON "UserWordProgress"("userId", "wordId");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Word" ADD CONSTRAINT "Word_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordMeaning" ADD CONSTRAINT "WordMeaning_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordLevel" ADD CONSTRAINT "WordLevel_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordLevel" ADD CONSTRAINT "WordLevel_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonWord" ADD CONSTRAINT "LessonWord_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonWord" ADD CONSTRAINT "LessonWord_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSentence" ADD CONSTRAINT "LessonSentence_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSentence" ADD CONSTRAINT "LessonSentence_sentenceId_fkey" FOREIGN KEY ("sentenceId") REFERENCES "Sentence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonExercise" ADD CONSTRAINT "LessonExercise_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonExerciseAttempt" ADD CONSTRAINT "LessonExerciseAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonExerciseAttempt" ADD CONSTRAINT "LessonExerciseAttempt_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "LessonExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationPractice" ADD CONSTRAINT "PronunciationPractice_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationPractice" ADD CONSTRAINT "PronunciationPractice_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationAttempt" ADD CONSTRAINT "PronunciationAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationAttempt" ADD CONSTRAINT "PronunciationAttempt_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "PronunciationPractice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationAttempt" ADD CONSTRAINT "PronunciationAttempt_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSkillScore" ADD CONSTRAINT "ResultSkillScore_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "Result"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWord" ADD CONSTRAINT "UserWord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWord" ADD CONSTRAINT "UserWord_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Progress" ADD CONSTRAINT "Progress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Progress" ADD CONSTRAINT "Progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWordProgress" ADD CONSTRAINT "UserWordProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWordProgress" ADD CONSTRAINT "UserWordProgress_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
