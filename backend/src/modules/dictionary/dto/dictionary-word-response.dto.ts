// Response models of the /dictionary/words/:id routes (M2.6a, Q62).

export class DictionaryWordMeaningDto {
  order!: number;
  en!: string | null;
  vi!: string | null;
  partOfSpeech!: string | null;
  usage!: string | null;
  note!: string | null;
}

export class DictionaryWordLevelDto {
  code!: string;
  name!: string;
}

export class DictionaryWordSourceDto {
  name!: string;
  version!: string;
  license!: string | null;
  attribution!: string | null;
}

export class DictionaryWordDetailDto {
  id!: number;
  hanzi!: string;
  traditional!: string | null;
  pinyin!: string;
  pinyinTone!: string | null;
  example!: string | null;
  /** Ordered by `meaningOrder`. */
  meanings!: DictionaryWordMeaningDto[];
  /** Published, not deleted Levels ordered by `orderIndex`. */
  levels!: DictionaryWordLevelDto[];
  /** The primary source first, then by data source id. */
  sources!: DictionaryWordSourceDto[];
}

/** Not served yet: always `null` until learner media grants cover words (Q304). */
export class DictionaryWordAudioDto {
  mediaId!: number;
  mimeType!: string | null;
  duration!: number | null;
}

export class DictionaryWordExampleDto {
  hanzi!: string;
  pinyin!: string | null;
  vi!: string | null;
  en!: string | null;
  source!: DictionaryWordSourceDto;
  audio!: DictionaryWordAudioDto | null;
}

/** A search-style summary of a word sharing characters with the detail word. */
export class DictionaryRelatedWordMeaningDto {
  en!: string | null;
  vi!: string | null;
}

export class DictionaryRelatedWordDto {
  id!: number;
  hanzi!: string;
  pinyin!: string;
  pinyinTone!: string | null;
  meanings!: DictionaryRelatedWordMeaningDto[];
  /** Name of the lowest public Level. */
  level!: string | null;
}

/** `GET /dictionary/words/:id` (M3.4b); review keeps `DictionaryWordDetailDto`. */
export class DictionaryWordFullDetailDto extends DictionaryWordDetailDto {
  audio!: DictionaryWordAudioDto | null;
  /** Published, not deleted examples ordered by `orderIndex`. */
  examples!: DictionaryWordExampleDto[];
  /** At most 4 public HSK words sharing a character (Q307). */
  related!: DictionaryRelatedWordDto[];
}

export class DictionaryWordSavedDto {
  wordId!: number;
  saved!: boolean;
}

export class DictionaryWordSaveResultDto {
  wordId!: number;
  saved!: boolean;
  /** `null` when the word was already saved and no event was written. */
  eventId!: string | null;
  occurredAt!: Date | null;
}
