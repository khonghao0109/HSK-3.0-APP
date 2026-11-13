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
