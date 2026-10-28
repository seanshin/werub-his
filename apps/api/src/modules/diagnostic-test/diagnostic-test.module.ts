import { Module } from '@nestjs/common';
import { DiagnosticTestController } from './diagnostic-test.controller';
import { DiagnosticTestService } from './diagnostic-test.service';

@Module({
  
  controllers: [DiagnosticTestController],
  providers: [DiagnosticTestService],
  exports: [DiagnosticTestService], // 워크스테이션이 기초검사 자리 큐를 위임한다(정본을 둘로 만들지 않는다)
})
export class DiagnosticTestModule {}
