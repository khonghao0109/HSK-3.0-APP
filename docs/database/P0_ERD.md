# P0 ERD — HSK 3.0 APP

> ERD logic phiên bản `2.1.0-p0-hardening`, chốt ngày `2026-08-10`.
> File `docs/erd.png` là sơ đồ legacy và đã bị tài liệu này thay thế. Prisma schema/migration vẫn là nguồn kỹ thuật chuẩn khi có khác biệt.

ERD được tách theo bounded context để review được. Các cột dưới đây chỉ hiển thị PK/FK và trường nhận diện chính; data dictionary chứa đầy đủ semantics và invariant.

## 1. Identity, onboarding và privacy

```mermaid
erDiagram
  User ||--o| UserProfile : has
  User ||--o{ UserSession : opens
  User ||--o{ PasswordResetToken : requests
  User ||--o{ EmailVerificationToken : verifies
  User ||--o{ UserGoal : sets
  User ||--o{ PlacementAttempt : takes
  User ||--o{ LearningPlan : owns
  User ||--o{ Consent : grants
  User ||--o{ DataExportJob : requests
  User ||--o{ AccountDeletionRequest : requests
  Level ||--o{ UserGoal : targets
  Level ||--o{ PlacementAttempt : recommends
  Level ||--o{ LearningPlan : targets
  PlacementAttempt o|--o{ LearningPlan : generates
  LearningPlan ||--o{ LearningPlanItem : contains
  Lesson ||--o{ LearningPlanItem : schedules

  User {
    int id PK
    string email UK
    Role role
    AccountStatus status
    datetime deletedAt
  }
  UserProfile {
    int id PK
    int userId FK
    string locale
    string timezone
  }
  UserSession {
    int id PK
    int userId FK
    string tokenHash UK
    datetime expiresAt
    datetime revokedAt
  }
  PasswordResetToken {
    int id PK
    int userId FK
    string tokenHash UK
    datetime expiresAt
  }
  EmailVerificationToken {
    int id PK
    int userId FK
    string tokenHash UK
    datetime expiresAt
  }
  UserGoal {
    int id PK
    int userId FK
    int targetLevelId FK
    int targetBand
  }
  PlacementAttempt {
    int id PK
    int userId FK
    int recommendedLevelId FK
    int recommendedBand
    PlacementAttemptStatus status
  }
  LearningPlan {
    int id PK
    int userId FK
    int targetLevelId FK
    int generatedFromPlacementId FK
    LearningPlanStatus status
  }
  LearningPlanItem {
    int id PK
    int learningPlanId FK
    int lessonId FK
    int orderIndex
  }
  Consent {
    int id PK
    int userId FK
    ConsentType type
    string consentVersion
  }
  DataExportJob {
    int id PK
    int userId FK
    PrivacyRequestStatus status
  }
  AccountDeletionRequest {
    int id PK
    int userId FK
    PrivacyRequestStatus status
  }
```

## 2. Curriculum, dictionary, provenance và media

```mermaid
erDiagram
  DataSource ||--o{ Level : sources
  DataSource ||--o{ Lesson : sources
  DataSource ||--o{ Topic : sources
  DataSource ||--o{ Story : sources
  DataSource ||--o{ WordSource : declares
  DataSource ||--o{ WordMeaning : sources
  DataSource ||--o{ WordLevel : sources
  DataSource ||--o{ Sentence : sources
  DataSource ||--o{ Media : sources
  Level ||--o{ Lesson : contains
  Level ||--o{ Story : classifies
  Level ||--o{ WordLevel : classifies
  Lesson ||--o{ Topic : contains
  Lesson o|--o{ Story : hosts
  Lesson ||--o{ LessonWord : teaches
  Topic o|--o{ LessonWord : groups
  Word ||--o{ WordSource : traces
  Word ||--o{ WordMeaning : means
  Word ||--o{ WordLevel : belongs
  Word ||--o{ LessonWord : taught_as
  LessonWord ||--o{ LessonWordExample : illustrates
  Sentence ||--o{ LessonWordExample : reused_by
  Lesson ||--o{ LessonSentence : includes
  Sentence ||--o{ LessonSentence : reused_by
  Lesson ||--o{ LessonExercise : exercises
  Topic o|--o{ LessonExercise : scopes
  Lesson ||--o{ PronunciationPractice : practices
  Topic o|--o{ PronunciationPractice : scopes
  Word o|--o{ PronunciationPractice : target_word
  Sentence o|--o{ PronunciationPractice : target_sentence

  DataSource {
    int id PK
    string code UK
    string version
    string license
    string contentHash
  }
  Media {
    int id PK
    string url UK
    MediaType type
    MediaProcessingStatus processingStatus
    int dataSourceId FK
  }
  Level {
    int id PK
    string code UK
    int minBand
    int maxBand
    ContentStatus status
    int dataSourceId FK
  }
  Lesson {
    int id PK
    int levelId FK
    string slug UK
    int orderIndex
    ContentStatus status
  }
  Topic {
    int id PK
    int lessonId FK
    TopicType type
    int orderIndex
    json content
  }
  Story {
    int id PK
    int levelId FK
    int lessonId FK
    string slug UK
    json content
  }
  Word {
    int id PK
    string hanzi
    string pinyin
    string pinyinNormalized
    ContentStatus status
  }
  WordSource {
    int id PK
    int wordId FK
    int dataSourceId FK
    boolean isPrimary
  }
  WordMeaning {
    int id PK
    int wordId FK
    int meaningOrder
    string meaningEn
    string meaningVi
    int dataSourceId FK
  }
  WordLevel {
    int id PK
    int wordId FK
    int levelId FK
    int dataSourceId FK
  }
  LessonWord {
    int id PK
    int lessonId FK
    int topicId FK
    int wordId FK
    int orderIndex
  }
  Sentence {
    int id PK
    string hanzi
    string pinyin
    int dataSourceId FK
  }
  LessonWordExample {
    int id PK
    int lessonWordId FK
    int sentenceId FK
    int orderIndex
  }
  LessonSentence {
    int id PK
    int lessonId FK
    int sentenceId FK
    int orderIndex
  }
  LessonExercise {
    int id PK
    int lessonId FK
    int topicId FK
    ExerciseType type
    int version
  }
  PronunciationPractice {
    int id PK
    int lessonId FK
    int topicId FK
    int wordId FK
    int sentenceId FK
    TargetType targetType
  }
```

## 3. Learning progress, SRS và pronunciation attempt

```mermaid
erDiagram
  User ||--o{ Progress : learns
  Lesson ||--o{ Progress : tracked_by
  Topic o|--o{ Progress : current_topic
  LessonExercise o|--o{ Progress : current_exercise
  User ||--o{ UserTopicProgress : learns
  Topic ||--o{ UserTopicProgress : tracked_by
  User ||--o{ LessonExerciseAttempt : submits
  LessonExercise ||--o{ LessonExerciseAttempt : attempted_as
  User ||--o{ LearningEvent : emits
  User ||--o{ UserWord : saves
  Word ||--o{ UserWord : saved_by
  User ||--o{ UserWordProgress : legacy_tracks
  Word ||--o{ UserWordProgress : legacy_tracked_by
  User ||--o{ ReviewCard : reviews
  Word ||--o{ ReviewCard : scheduled_for
  User ||--o{ ReviewSession : starts
  ReviewCard ||--o{ ReviewEvent : changes
  ReviewSession o|--o{ ReviewEvent : groups
  User ||--o{ PronunciationAttempt : records
  PronunciationPractice ||--o{ PronunciationAttempt : attempted_as

  Progress {
    int id PK
    int userId FK
    int lessonId FK
    ProgressStatus status
    int completionPercent
  }
  UserTopicProgress {
    int id PK
    int userId FK
    int topicId FK
    ProgressStatus status
    int completionPercent
  }
  LessonExerciseAttempt {
    int id PK
    int userId FK
    int exerciseId FK
    int attemptNumber
    json contentSnapshot
    string idempotencyKey
  }
  LearningEvent {
    bigint id PK
    int userId FK
    LearningEventType type
    string idempotencyKey
    datetime occurredAt
  }
  UserWord {
    int id PK
    int userId FK
    int wordId FK
  }
  UserWordProgress {
    int id PK
    int userId FK
    int wordId FK
    WordProgressStatus status
  }
  ReviewCard {
    int id PK
    int userId FK
    int wordId FK
    ReviewCardState state
    datetime dueAt
    string schedulerVersion
  }
  ReviewSession {
    int id PK
    int userId FK
    ReviewSessionStatus status
    string idempotencyKey
  }
  ReviewEvent {
    bigint id PK
    int cardId FK
    int sessionId FK
    ReviewGrade grade
    string idempotencyKey
    datetime reviewedAt
  }
  PronunciationAttempt {
    int id PK
    int userId FK
    int practiceId FK
    int audioId FK
    float score
  }
```

## 4. CMS workflow, import và audit

```mermaid
erDiagram
  User o|--o{ DataSource : creates
  User o|--o{ ContentRevision : authors
  ContentRevision ||--o{ ContentReview : reviewed_by
  User o|--o{ ContentReview : performs
  User o|--o{ AuditLog : acts
  User o|--o{ ImportJob : creates
  DataSource o|--o{ ImportJob : feeds
  ImportJob ||--o{ ImportRowError : reports

  ContentRevision {
    int id PK
    ContentEntityType entityType
    int entityId
    int revision
    json snapshot
    string contentHash
  }
  ContentReview {
    int id PK
    int revisionId FK
    int reviewerId FK
    ContentReviewDecision decision
  }
  AuditLog {
    bigint id PK
    int actorId FK
    string action
    string targetType
    string targetId
    string correlationId
  }
  ImportJob {
    int id PK
    int dataSourceId FK
    int createdById FK
    ContentEntityType entityType
    ImportJobStatus status
    string idempotencyKey UK
  }
  ImportRowError {
    bigint id PK
    int importJobId FK
    int rowNumber
    string errorCode
    json normalizedPayload
  }
```

`ContentRevision.entityId` và `AuditLog.targetId` là polymorphic reference có chủ đích; service phải kiểm tra entity tồn tại và ghi `entityType/targetType` đúng allow-list. Không tạo FK polymorphic giả trong database.

## 5. Exam engine và result

```mermaid
erDiagram
  Level ||--o{ Question : classifies
  Level ||--o{ Test : classifies
  Question ||--o{ QuestionTag : tagged
  Tag ||--o{ QuestionTag : labels
  Test ||--o{ TestSection : contains
  TestSection ||--o{ QuestionGroup : groups
  Test ||--o{ TestQuestion : selects
  Question ||--o{ TestQuestion : reused_as
  TestQuestion ||--o| TestQuestionPlacement : placed
  TestSection ||--o{ TestQuestionPlacement : contains
  QuestionGroup o|--o{ TestQuestionPlacement : groups
  User ||--o{ ExamAttempt : takes
  Test ||--o{ ExamAttempt : attempted_as
  ExamAttempt ||--o| ExamAttemptSnapshot : freezes
  ExamAttempt ||--o{ ExamAnswer : answers
  Question o|--o{ ExamAnswer : traces
  ExamAttempt ||--o{ ExamAttemptEvent : emits
  ExamAttempt ||--o| Result : produces
  User ||--o{ Result : receives
  Test ||--o{ Result : reports
  Result ||--o{ ResultSkillScore : breaks_down

  Question {
    int id PK
    int levelId FK
    QuestionType type
    Skill skill
    int version
    string contentHash
    ContentStatus status
  }
  Tag {
    int id PK
    string name UK
    string slug UK
  }
  QuestionTag {
    int questionId PK
    int tagId PK
  }
  Test {
    int id PK
    int levelId FK
    string slug UK
    int version
    string scoringVersion
    ContentStatus status
  }
  TestSection {
    int id PK
    int testId FK
    Skill skill
    int orderIndex
  }
  QuestionGroup {
    int id PK
    int testId FK
    int sectionId FK
    int orderIndex
  }
  TestQuestion {
    int id PK
    int testId FK
    int questionId FK
    int orderIndex
  }
  TestQuestionPlacement {
    int id PK
    int testQuestionId FK
    int testId FK
    int sectionId FK
    int groupId FK
    int orderIndex
  }
  ExamAttempt {
    int id PK
    int userId FK
    int testId FK
    ExamAttemptStatus status
    string idempotencyKey
    string scoringVersion
  }
  ExamAttemptSnapshot {
    int id PK
    int attemptId FK
    int testVersion
    string contentHash
    json payload
  }
  ExamAnswer {
    int id PK
    int attemptId FK
    string snapshotQuestionKey
    int questionId FK
    json answer
    string saveIdempotencyKey
  }
  ExamAttemptEvent {
    bigint id PK
    int attemptId FK
    ExamAttemptEventType type
    string idempotencyKey
    datetime occurredAt
  }
  Result {
    int id PK
    int userId FK
    int testId FK
    int attemptId FK
    int score
    int awardedBand
    string scoringVersion
  }
  ResultSkillScore {
    int id PK
    int resultId FK
    Skill skill
    int score
    int maxScore
  }
```

Điểm then chốt của mô hình placement là chuỗi composite FK:

```text
TestQuestionPlacement(testQuestionId, testId)
  -> TestQuestion(id, testId)

TestQuestionPlacement(sectionId, testId)
  -> TestSection(id, testId)

TestQuestionPlacement(groupId, sectionId, testId)
  -> QuestionGroup(id, sectionId, testId)
```

Nhờ đó question bank vẫn tái sử dụng được, nhưng một placement không thể vô tình trỏ sang section/group của đề khác.

## 6. Quan hệ cross-context quan trọng

```mermaid
flowchart LR
  I["Identity / User"] --> L["Learning progress + SRS"]
  I --> E["Exam attempts + results"]
  C["Curriculum + Dictionary"] --> L
  C --> E
  P["DataSource + Import"] --> C
  A["CMS revision + Audit"] --> C
  M["Media metadata"] --> C
  M --> E
```

- Identity cung cấp actor/owner, nhưng content và lịch sử thi không được phụ thuộc vào raw PII.
- Curriculum publish tạo input cho Learning/Exam; attempt luôn snapshot trước khi learner tương tác.
- Import chỉ tạo/đổi content qua provenance và audit; không ghi đè lịch sử attempt.
- Trigger SQL bổ sung các invariant mà Prisma không biểu đạt được: append-only, child cùng lesson, result cùng attempt và placement cùng test.
- Hardening trigger còn đối chiếu band theo Level và ReviewEvent card/session cùng user; FK `RESTRICT` giữ parent của immutable fact để deletion workflow dùng anonymization thay vì hard-delete.
