export type StoryContentBlock = {
  type: 'text';
  value: string;
};

export class StoryItemDto {
  id!: number;
  levelId!: number;
  title!: string;
  content!: StoryContentBlock[];
  slug!: string;
}
