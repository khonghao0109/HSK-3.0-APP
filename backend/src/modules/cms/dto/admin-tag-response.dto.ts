// Response model of GET /admin/cms/tags (TL-93).
export class AdminTagDto {
  slug!: string;
  name!: string;

  /** Questions tagged with this tag that are not archived (TL-93). */
  questionCount!: number;
}
