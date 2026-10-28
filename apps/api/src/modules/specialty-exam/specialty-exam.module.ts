import { Module } from '@nestjs/common';
import {
  EmergencyExamController,
  FamilyMedExamController,
  PediatricExamController,
  RehabExamController,
} from './specialty-exam.controller';
import { SpecialtyExamService } from './specialty-exam.service';

// 전문과 진료기록 저장 — 기존 도메인 모듈(emergency/pediatrics/rehab)과 prefix를 공유하되
// 순환 의존 회피 위해 별도 leaf 모듈로 분리(PrismaModule은 @Global)
@Module({
  controllers: [
    EmergencyExamController,
    FamilyMedExamController,
    PediatricExamController,
    RehabExamController,
  ],
  providers: [SpecialtyExamService],
})
export class SpecialtyExamModule {}
