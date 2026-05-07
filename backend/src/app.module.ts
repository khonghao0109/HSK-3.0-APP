import { Module } from '@nestjs/common';
import { DictionaryModule } from './modules/dictionary/dictionary.module';

@Module({
  imports: [DictionaryModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
