import { Module } from '@nestjs/common';
import { CheckupExplainerController } from './checkup-explainer.controller';
import { CheckupExplainerService } from './checkup-explainer.service';

@Module({
  controllers: [CheckupExplainerController],
  providers: [CheckupExplainerService],
})
export class CheckupExplainerModule {}
