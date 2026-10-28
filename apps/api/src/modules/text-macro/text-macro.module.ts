import { Module } from '@nestjs/common';
import { TextMacroController } from './text-macro.controller';
import { TextMacroService } from './text-macro.service';

@Module({
  
  controllers: [TextMacroController],
  providers: [TextMacroService],
  exports: [TextMacroService],
})
export class TextMacroModule {}
