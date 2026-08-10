export type OnboardingNextStep = 'ready' | 'set_goal' | 'generate_plan';

export interface OnboardingStatusView {
  hasActiveGoal: boolean;
  hasActiveLearningPlan: boolean;
  hasCompletedPlacement: boolean;
  nextStep: OnboardingNextStep;
}

export interface GoalLevelView {
  id: number;
  code: string;
  name: string;
  minBand: number;
  maxBand: number;
}

export interface UserGoalView {
  id: number;
  targetLevelId: number;
  targetBand: number;
  dailyMinutes: number;
  reminderEnabled: boolean;
  reminderTime: string | null;
  startDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  targetLevel: GoalLevelView;
}

export interface LearningPlanLessonView {
  id: number;
  title: string;
  description: string | null;
  orderIndex: number;
  slug: string;
}

export interface LearningPlanItemView {
  id: number;
  orderIndex: number;
  scheduledDate: string | null;
  status: string;
  lesson: LearningPlanLessonView;
}

export interface LearningPlanView {
  id: number;
  targetLevelId: number;
  targetBand: number | null;
  generatedFromPlacementId: number | null;
  status: string;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  targetLevel: GoalLevelView;
  items: LearningPlanItemView[];
}
