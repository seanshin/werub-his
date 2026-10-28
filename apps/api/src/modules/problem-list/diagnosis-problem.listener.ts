import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PROBLEM_CURRENT_STATUSES } from './problem-list.service';

/**
 * 진단(EncounterDiagnosis) → 환자 문제목록(ProblemList) 옵트인 동기화.
 * 게이트: config `clinical.diagnosisToProblem`(기본 off). RULE_OUT 제외·동일 진단코드 ACTIVE 문제 존재 시 skip(중복방지).
 * 논블로킹(실패해도 서명 흐름 무영향). 종전 진단↔문제목록 완전 미연계 갭 보완.
 */
@Injectable()
export class DiagnosisProblemListener {
  private readonly logger = new Logger(DiagnosisProblemListener.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigRuntimeService) {}

  @OnEvent('encounter.signed')
  async onEncounterSigned(payload: { encounterId: string; patientId: string }) {
    try {
      const enabled = await this.config.get('clinical.diagnosisToProblem');
      if (enabled !== true && enabled !== 'true') return; // 옵트인(기본 off)

      const enc = await this.prisma.encounter.findUnique({
        where: { id: payload.encounterId },
        select: {
          id: true, patientId: true, doctorId: true,
          diagnoses: { select: { diagnosisCodeId: true, certainty: true, notes: true, onsetDate: true, diagnosisCode: { select: { nameKo: true } } } },
        },
      });
      if (!enc || !enc.diagnoses.length) return;

      let added = 0;
      for (const d of enc.diagnoses) {
        if ((d.certainty ?? '').toUpperCase() === 'RULE_OUT') continue; // 배제진단 제외
        // 🔴 (2026-10-03) 종전 ACTIVE 만 봐서, 만성(CHRONIC)으로 정리된 같은 진단을 켜는 순간 ACTIVE 로 한 번 더 만들었다
        const dup = await this.prisma.problemList.findFirst({
          where: { patientId: enc.patientId, diagnosisCodeId: d.diagnosisCodeId, status: { in: PROBLEM_CURRENT_STATUSES } },
          select: { id: true },
        });
        if (dup) continue; // 이미 활성·만성 문제로 등록됨
        await this.prisma.problemList.create({
          data: {
            patientId: enc.patientId, diagnosisCodeId: d.diagnosisCodeId,
            description: d.diagnosisCode?.nameKo ?? d.notes ?? '진단',
            onsetDate: d.onsetDate ?? undefined,
            addedBy: enc.doctorId, addedEncounterId: enc.id, notes: d.notes ?? undefined,
          },
        });
        added++;
      }
      if (added) this.logger.log(`진단→문제목록 동기화: encounter=${enc.id} +${added}건`);
    } catch (e) {
      this.logger.warn(`진단→문제목록 동기화 실패(${payload.encounterId}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
