import { Module } from '@nestjs/common';
import { ProblemListController } from './problem-list.controller';
import { ProblemListService } from './problem-list.service';
import { DiagnosisProblemListener } from './diagnosis-problem.listener';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule],
  controllers: [ProblemListController],
  providers: [ProblemListService, DiagnosisProblemListener],
  exports: [ProblemListService],
})
export class ProblemListModule {}
