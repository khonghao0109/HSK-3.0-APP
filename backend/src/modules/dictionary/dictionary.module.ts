import { Module } from '@nestjs/common';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';

@Module({
  controllers: [DictionaryController],
  providers: [DictionaryService],
})
export class DictionaryModule {}
