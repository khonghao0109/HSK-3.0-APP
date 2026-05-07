import { Controller, Get, Query } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';

@Controller('dictionary')
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get()
  async search(@Query('query') query: string) {
    return this.dictionaryService.search(query);
  }
}
