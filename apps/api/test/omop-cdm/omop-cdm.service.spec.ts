import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, NotImplementedException } from '@nestjs/common';
import { OmopCdmService } from '../../src/modules/omop-cdm/omop-cdm.service';
import type { ConversionOptions } from '../../src/modules/omop-cdm/omop-cdm.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * 🔴 2026-08-14 W7 — 이 스펙은 **날조를 계약으로 굳혀두고 있었다**.
 *    - `expect(person.recordCount).toBe(124500)` / `death 3240` — DB 에 존재하지도 않는
 *      OMOP 테이블의 하드코딩 행수를 "기대값"으로 고정.
 *    - `expect(table.completeness).toBeGreaterThanOrEqual(85)` — 난수 생성 범위를 계약화
 *      (검증 로직이 없는데 "품질 85점 이상"을 보장하는 것처럼 보였다).
 *    - `vi.advanceTimersByTime(6000)` 후 `status === 'COMPLETED'` — 아무것도 변환하지 않은
 *      setTimeout 을 "변환 완료"로 단언(P16).
 *    정본으로 갱신한다: 변환/추출은 미구현(501), 작업 이력 없음(404), 현황은 소스 실측,
 *    품질은 산출 불가(null + 빈 목록).
 */

const defaultOptions: ConversionOptions = {
  sourceSchema: 'hospital_run',
  targetCdmVersion: '5.4',
  includeTables: ['PERSON', 'VISIT_OCCURRENCE', 'CONDITION_OCCURRENCE'],
  incrementalMode: false,
};

/** 소스 실측을 흉내내는 최소 Prisma 더블 — 값은 테스트별로 지정한다 */
function makePrisma(opts?: {
  existingCdmTables?: string[];
  cdmRowCounts?: Record<string, number>;
  counts?: Partial<Record<string, number>>;
}) {
  const existing = opts?.existingCdmTables ?? [];
  const cdmRowCounts = opts?.cdmRowCounts ?? {};
  const counts = opts?.counts ?? {};
  const c = (key: string, fallback = 0) => counts[key] ?? fallback;

  const queryRaw = vi.fn(async (sql: unknown) => {
    const text = JSON.stringify(sql);
    // information_schema 조회
    if (text.includes('information_schema')) {
      return existing.map((table_name) => ({ table_name }));
    }
    // count(*) 조회 — 어떤 테이블인지 raw 조각에서 찾는다
    const hit = Object.keys(cdmRowCounts).find((t) => text.includes(t));
    return [{ count: BigInt(hit ? cdmRowCounts[hit] : 0) }];
  });

  const model = (key: string, fallback = 0) => ({
    count: vi.fn(async () => c(key, fallback)),
  });

  return {
    $queryRaw: queryRaw,
    patient: {
      count: vi.fn(async (args?: { where?: { isDeceased?: boolean } }) =>
        args?.where?.isDeceased ? c('deceased') : c('patient'),
      ),
    },
    encounter: model('encounter'),
    admission: model('admission'),
    encounterDiagnosis: model('encounterDiagnosis'),
    prescription: model('prescription'),
    surgery: model('surgery'),
    labResultItem: model('labResultItem'),
    preVisitVitals: model('preVisitVitals'),
    nursingAssessment: model('nursingAssessment'),
  } as unknown as PrismaService;
}

describe('OmopCdmService', () => {
  let service: OmopCdmService;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = makePrisma({
      counts: {
        patient: 874,
        deceased: 3,
        encounter: 584,
        admission: 120,
        encounterDiagnosis: 419,
        prescription: 616,
        surgery: 12,
        labResultItem: 1881,
        preVisitVitals: 40,
        nursingAssessment: 77,
      },
    });
    service = new OmopCdmService(prisma);
  });

  describe('runConversion — 미구현을 미구현이라 말한다', () => {
    it('변환을 흉내내지 않고 501 로 거절한다', () => {
      expect(() => service.runConversion(defaultOptions)).toThrow(NotImplementedException);
    });

    it('거절 사유에 CDM_CONVERSION_NOT_IMPLEMENTED 코드가 실린다', () => {
      try {
        service.runConversion(defaultOptions);
        throw new Error('should have thrown');
      } catch (e) {
        const res = (e as NotImplementedException).getResponse() as { code: string };
        expect(res.code).toBe('CDM_CONVERSION_NOT_IMPLEMENTED');
      }
    });
  });

  describe('getConversionStatus — 작업 이력이 없다', () => {
    it('어떤 jobId 로도 404 다(인메모리 Map 제거)', () => {
      expect(() => service.getConversionStatus('cdm-anything')).toThrow(NotFoundException);
    });
  });

  describe('downloadExtract — 산출물이 없다', () => {
    it('501 로 거절한다', () => {
      expect(() => service.downloadExtract('cdm-anything')).toThrow(NotImplementedException);
    });
  });

  describe('getTableCounts', () => {
    it('CDM 테이블이 없으면 cdmRecordCount 는 0 이 아니라 null 이다', async () => {
      const { data } = await service.getTableCounts();

      expect(data.cdmBuilt).toBe(false);
      expect(data.cdmTotal).toBeNull();
      for (const t of data.tables) {
        expect(t.cdmTableExists).toBe(false);
        expect(t.cdmRecordCount).toBeNull();
      }
    });

    it('소스 건수는 실측 count 를 그대로 쓴다', async () => {
      const { data } = await service.getTableCounts();

      const person = data.tables.find((t) => t.tableName === 'PERSON')!;
      expect(person.sourceRecordCount).toBe(874);

      const visit = data.tables.find((t) => t.tableName === 'VISIT_OCCURRENCE')!;
      expect(visit.sourceRecordCount).toBe(584 + 120);

      const measurement = data.tables.find((t) => t.tableName === 'MEASUREMENT')!;
      expect(measurement.sourceRecordCount).toBe(1881 + 40);

      const death = data.tables.find((t) => t.tableName === 'DEATH')!;
      expect(death.sourceRecordCount).toBe(3);
    });

    it('변환 이력이 없으므로 lastUpdated 는 항상 null 이다(오늘로 위장 금지)', async () => {
      const { data } = await service.getTableCounts();
      for (const t of data.tables) {
        expect(t.lastUpdated).toBeNull();
      }
    });

    it('파이프라인 상태와 사실 고지를 함께 내려보낸다', async () => {
      const { data } = await service.getTableCounts();
      expect(data.pipeline).toBe('NOT_IMPLEMENTED');
      expect(data.notice).toContain('변환 대상');
      expect(data.cdmVersion).toBe('5.4');
    });

    it('OMOP 테이블이 실재하면 그때는 실제 행수를 센다', async () => {
      const withCdm = makePrisma({
        existingCdmTables: ['person'],
        cdmRowCounts: { person: 42 },
        counts: { patient: 874 },
      });
      const svc = new OmopCdmService(withCdm);

      const { data } = await svc.getTableCounts();
      const person = data.tables.find((t) => t.tableName === 'PERSON')!;

      expect(person.cdmTableExists).toBe(true);
      expect(person.cdmRecordCount).toBe(42);
      expect(data.cdmBuilt).toBe(true);
      expect(data.cdmTotal).toBe(42);
    });
  });

  describe('getQualityReport — 검증 로직이 없으므로 산출 불가', () => {
    it('모든 지표가 null 이고 표는 빈 목록이다', () => {
      const { data } = service.getQualityReport();

      expect(data.status).toBe('NOT_AVAILABLE');
      expect(data.overallScore).toBeNull();
      expect(data.generatedAt).toBeNull();
      expect(data.tables).toEqual([]);
      expect(data.summary.avgCompleteness).toBeNull();
      expect(data.summary.avgConformance).toBeNull();
      expect(data.summary.avgPlausibility).toBeNull();
      expect(data.summary.passRate).toBeNull();
      expect(data.summary.totalRecords).toBeNull();
      expect(data.reason).toBeTruthy();
    });

    it('호출할 때마다 같은 값이다(난수 금지 — 종전엔 90.7→92.0→91.4 로 흔들렸다)', () => {
      const a = service.getQualityReport().data;
      const b = service.getQualityReport().data;
      const c = service.getQualityReport().data;
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    });
  });
});
