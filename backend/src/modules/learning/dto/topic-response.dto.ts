export type TopicContentBlock =
  | {
      type: 'text';
      value: string;
    }
  | {
      type: 'image';
      url: string;
      alt?: string;
    }
  | {
      type: 'audio';
      url: string;
      title?: string;
    };

export class TopicItemDto {
  id!: number;
  lessonId!: number;
  title!: string;
  content!: TopicContentBlock[];
  orderIndex!: number;
}
