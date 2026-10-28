import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 만성질환 측정 자동 미러링(P1) — 입력 경로가 어디든 만성지표를 ChronicObservation으로 수렴.
 * - lab.result.completed → LabResult 항목을 정규코드로 매핑해 미러(source=LAB, context=CHRONIC)
 * - ews.recorded → EWS 혈압을 미러(source=EWS, context=ACUTE — 입원 급성 모니터링)
 * 멱등: (source, sourceId) 유니크 upsert. 원천 SoT는 변경하지 않고 읽기 일관성만 확보.
 */

// LabResult testName → 정규코드(1차 매핑). LOINC 도입 시 LOINC 우선 키로 대체.
const LAB_CODE_MAP: { match: RegExp; code: string }[] = [
  { match: /당화혈색소|hba1c|a1c/i, code: 'HBA1C' },
  { match: /공복.?혈당|fasting.*glucose|\bfbs\b/i, code: 'FBS' },
  { match: /식후.?(2|이).?시간.?혈당|postprandial|\bpp2\b|\bppg\b/i, code: 'PPG' },
  { match: /ldl/i, code: 'LDL' },
  { match: /중성지방|triglyceride|\btg\b/i, code: 'TG' },
  { match: /크레아티닌|creatinine|\bcr\b/i, code: 'CR' },
  { match: /egfr|사구체여과/i, code: 'EGFR' },
];
// 코드별 단위·정상범위(서버 단일 정의 — FE 상수와 통일 목표)
const CODE_SPEC: Record<string, { unit: string; min: number | null; max: number | null }> = {
  HBA1C: { unit: '%', min: 4.0, max: 6.5 }, FBS: { unit: 'mg/dL', min: 70, max: 100 }, PPG: { unit: 'mg/dL', min: null, max: 140 },
  SBP: { unit: 'mmHg', min: null, max: 120 }, DBP: { unit: 'mmHg', min: null, max: 80 },
  LDL: { unit: 'mg/dL', min: null, max: 100 }, TG: { unit: 'mg/dL', min: null, max: 150 },
  CR: { unit: 'mg/dL', min: 0.5, max: 1.2 }, EGFR: { unit: 'mL/min', min: 60, max: null },
  WEIGHT: { unit: 'kg', min: null, max: null }, BMI: { unit: 'kg/m²', min: 18.5, max: 25 },
};
const mapCode = (testName: string): string | null => LAB_CODE_MAP.find((m) => m.match.test(testName))?.code ?? null;
const parseNum = (v: string): number | null => { const m = String(v).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const flagOf = (v: number, min: number | null, max: number | null): string => (max != null && v > max ? 'H' : min != null && v < min ? 'L' : 'N');

interface MirrorInput {
  patientId: string; code: string; value: number; unit: string; measuredAt: Date;
  source: string; sourceId: string; context: string;
  normalMin: number | null; normalMax: number | null; encounterId: string | null;
}

@Injectable()
export class ChronicSyncService {
  private readonly logger = new Logger(ChronicSyncService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** 검사 결과 완료 → 만성지표 미러 */
  @OnEvent('lab.result.completed')
  async onLabCompleted(p: { labResultId?: string; patientId?: string; encounterId?: string }) {
    try {
      if (!p?.patientId || !p?.labResultId) return;
      const lr = await this.prisma.labResult.findUnique({
        where: { id: p.labResultId },
        select: { completedAt: true, collectedAt: true, items: { select: { id: true, testName: true, value: true, unit: true } } },
      });
      if (!lr) return;
      const measuredAt = lr.completedAt ?? lr.collectedAt ?? new Date();
      let mirrored = 0;
      for (const it of lr.items) {
        const code = mapCode(it.testName);
        if (!code) continue; // 만성지표 아님(정상 스킵)
        const value = parseNum(it.value);
        if (value === null) continue; // 비수치(정성)·범위표기 제외
        const spec = CODE_SPEC[code] ?? { unit: it.unit || '', min: null, max: null };
        await this.upsert({
          patientId: p.patientId, code, value, unit: it.unit || spec.unit, measuredAt,
          source: 'LAB', sourceId: `LAB:${it.id}`, context: 'CHRONIC',
          normalMin: spec.min, normalMax: spec.max, encounterId: p.encounterId ?? null,
        });
        mirrored++;
      }
      if (mirrored) this.logger.debug(`lab 미러 ${mirrored}건 (labResult ${p.labResultId})`);
    } catch (e) {
      this.logger.warn(`lab.result.completed 미러 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 외래 간호 바이탈 기록 → 혈압·체중·BMI 미러(CHRONIC 맥락 — 만성 추이 반영, G3-5) */
  @OnEvent('vitals.recorded')
  async onVitalsRecorded(p: { patientId?: string; vitalsId?: string; encounterId?: string | null; systolicBp?: number; diastolicBp?: number; weight?: number; bmi?: number; measuredAt?: Date }) {
    try {
      if (!p?.patientId || !p?.vitalsId) return;
      const at = p.measuredAt ?? new Date();
      const metrics: Array<{ code: string; value?: number }> = [
        { code: 'SBP', value: p.systolicBp }, { code: 'DBP', value: p.diastolicBp },
        { code: 'WEIGHT', value: p.weight }, { code: 'BMI', value: p.bmi },
      ];
      for (const m of metrics) {
        if (m.value == null) continue;
        const spec = CODE_SPEC[m.code];
        await this.upsert({
          patientId: p.patientId, code: m.code, value: m.value, unit: spec.unit, measuredAt: at,
          source: 'CLINIC', sourceId: `VITALS:${p.vitalsId}:${m.code}`, context: 'CHRONIC',
          normalMin: spec.min, normalMax: spec.max, encounterId: p.encounterId ?? null,
        });
      }
    } catch (e) {
      this.logger.warn(`vitals.recorded 미러 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** EWS 기록 → 혈압 미러(ACUTE 맥락 — 만성 추이 기본필터에서 분리) */
  @OnEvent('ews.recorded')
  async onEwsRecorded(p: { patientId?: string; ewsId?: string; systolicBp?: number; recordedAt?: Date }) {
    try {
      if (!p?.patientId || !p?.ewsId || p.systolicBp == null) return;
      const spec = CODE_SPEC.SBP;
      await this.upsert({
        patientId: p.patientId, code: 'SBP', value: p.systolicBp, unit: spec.unit,
        measuredAt: p.recordedAt ?? new Date(), source: 'EWS', sourceId: `EWS:${p.ewsId}:SBP`, context: 'ACUTE',
        normalMin: spec.min, normalMax: spec.max, encounterId: null,
      });
    } catch (e) {
      this.logger.warn(`ews.recorded 미러 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** (source, sourceId) 멱등 upsert */
  private async upsert(d: MirrorInput) {
    const flag = flagOf(d.value, d.normalMin, d.normalMax);
    await this.prisma.chronicObservation.upsert({
      where: { source_sourceId: { source: d.source, sourceId: d.sourceId } },
      update: { value: d.value, unit: d.unit, measuredAt: d.measuredAt, flag, normalMin: d.normalMin, normalMax: d.normalMax, context: d.context },
      create: {
        patientId: d.patientId, code: d.code, value: d.value, unit: d.unit, measuredAt: d.measuredAt,
        source: d.source, sourceId: d.sourceId, context: d.context, normalMin: d.normalMin, normalMax: d.normalMax, flag, encounterId: d.encounterId,
      },
    });
  }
}
