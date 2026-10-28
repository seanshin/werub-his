import { Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * OMOP CDM(OHDSI Common Data Model v5.4) 현황 서비스.
 *
 * 🔴 2026-08-14 화면 실사용 점검 W7 — 이 서비스는 **전부 날조였다**.
 *    - `mockCount()` 가 PERSON 124,500 · MEASUREMENT 3,456,700 등 합계 약 1,005만 건을
 *      하드코딩해 "CDM 테이블 현황"으로 내보냈다. 실제 DB 에는 person/visit_occurrence/
 *      condition_occurrence/drug_exposure 등 **OMOP 테이블이 하나도 없다**
 *      (MEASUREMENT 는 소스 실측 1,881건 대비 1,838배).
 *    - `randomScore()` 로 완전성·적합성·타당성을 만들어 종합점수 90.7 → 92.0 → 91.4 처럼
 *      **새로고침할 때마다 값이 바뀌었다**. 품질 검증 로직은 존재하지 않는다.
 *    - `runConversion()` 은 아무것도 변환하지 않고 `setTimeout(5000)` 뒤에 status='COMPLETED',
 *      progress=100 을 대입했다(P16: 실행하지 않고 성공 상태만 기록). PrismaService 주입조차 없었다.
 *    연구·규제 심사에 이 수치가 근거로 제시되면 그대로 허위가 되므로 전량 제거했다.
 *
 * 지금 이 서비스가 말하는 것은 두 가지뿐이며 둘 다 실측이다.
 *   1) OMOP 테이블이 DB 에 실재하는가 — `information_schema` 조회(있으면 실제 count).
 *   2) 변환 **대상**(소스 EMR) 실측 건수 — CDM 산출물이 아니라는 점을 필드명/화면이 분명히 한다.
 * 변환 파이프라인·품질 검증기는 미구현이므로 '미구현'이라고 말한다(폴백·상수·난수 금지).
 */

// ── Types ──

export type ConversionStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type PipelineState = 'NOT_IMPLEMENTED';

export interface ConversionOptions {
  sourceSchema: string;
  targetCdmVersion: string;
  includeTables: string[];
  incrementalMode: boolean;
  startDate?: string;
  endDate?: string;
}

/** CDM 테이블 1개의 실측 상태 — 존재하지 않으면 건수는 0 이 아니라 null(모른다/없다) */
export interface CdmTableStatus {
  tableName: string;
  /** DB 에 해당 OMOP 테이블이 실재하는가(information_schema 실측) */
  cdmTableExists: boolean;
  /** 테이블이 없으면 null. '없음'과 '0건'은 다른 사실이라 0 으로 뭉개지 않는다 */
  cdmRecordCount: number | null;
  /** 변환 이력 저장소가 없으므로 항상 null. 🔴 종전엔 `new Date()` 라 변환이 없어도 '오늘'로 보였다 */
  lastUpdated: string | null;
  /** 변환 대상(소스 EMR) 테이블 — 매핑 계획일 뿐 변환된 적은 없다 */
  sourceTables: string[];
  /** 소스 실측 건수. **CDM 변환 결과가 아니다** */
  sourceRecordCount: number | null;
}

export interface CdmTableStatusResponse {
  cdmVersion: string;
  /** CDM 테이블이 하나라도 실재하는가 */
  cdmBuilt: boolean;
  /** 변환 파이프라인 구현 상태 */
  pipeline: PipelineState;
  checkedAt: string;
  /** 화면이 반드시 함께 말해야 하는 사실 */
  notice: string;
  tables: CdmTableStatus[];
  /** 소스 실측 합계 — 변환 결과 합계가 아니다 */
  sourceTotal: number;
  /** CDM 실측 합계. 미구축이면 null */
  cdmTotal: number | null;
}

export interface QualityReport {
  cdmVersion: string;
  /** 품질 산출 가능 여부 — 검증기 미구현이므로 항상 NOT_AVAILABLE */
  status: 'NOT_AVAILABLE';
  reason: string;
  /** 산출된 적이 없으므로 null(0 이나 상수로 채우지 않는다) */
  generatedAt: string | null;
  overallScore: number | null;
  /** 🔴 표본 부재의 정답은 폴백이 아니라 빈 목록 */
  tables: never[];
  summary: {
    totalRecords: number | null;
    avgCompleteness: number | null;
    avgConformance: number | null;
    avgPlausibility: number | null;
    passRate: number | null;
  };
}

// ── CDM v5.4 테이블 ↔ 소스(EMR) 매핑 ──

type SourceCounter = (prisma: PrismaService) => Promise<number>;

interface CdmTableSpec {
  tableName: string;
  /** DB 에 있어야 할 실제 테이블명(OMOP 표준은 소문자) */
  physicalName: string;
  sourceTables: string[];
  countSource: SourceCounter;
}

const CDM_TABLE_SPECS: CdmTableSpec[] = [
  {
    tableName: 'PERSON',
    physicalName: 'person',
    sourceTables: ['patients'],
    countSource: (p) => p.patient.count(),
  },
  {
    tableName: 'VISIT_OCCURRENCE',
    physicalName: 'visit_occurrence',
    sourceTables: ['encounters', 'admissions'],
    countSource: async (p) => {
      const [enc, adm] = await Promise.all([p.encounter.count(), p.admission.count()]);
      return enc + adm;
    },
  },
  {
    tableName: 'CONDITION_OCCURRENCE',
    physicalName: 'condition_occurrence',
    sourceTables: ['encounter_diagnoses'],
    countSource: (p) => p.encounterDiagnosis.count(),
  },
  {
    tableName: 'DRUG_EXPOSURE',
    physicalName: 'drug_exposure',
    sourceTables: ['prescriptions'],
    countSource: (p) => p.prescription.count(),
  },
  {
    tableName: 'PROCEDURE_OCCURRENCE',
    physicalName: 'procedure_occurrence',
    sourceTables: ['surgeries'],
    countSource: (p) => p.surgery.count(),
  },
  {
    tableName: 'MEASUREMENT',
    physicalName: 'measurement',
    sourceTables: ['lab_result_items', 'pre_visit_vitals'],
    countSource: async (p) => {
      const [lab, vitals] = await Promise.all([p.labResultItem.count(), p.preVisitVitals.count()]);
      return lab + vitals;
    },
  },
  {
    tableName: 'OBSERVATION',
    physicalName: 'observation',
    sourceTables: ['nursing_assessments'],
    countSource: (p) => p.nursingAssessment.count(),
  },
  {
    tableName: 'DEATH',
    physicalName: 'death',
    sourceTables: ['patients (is_deceased)'],
    countSource: (p) => p.patient.count({ where: { isDeceased: true } }),
  },
];

const CDM_VERSION = '5.4';

const NOT_IMPLEMENTED_REASON =
  'EMR → OMOP CDM 변환 파이프라인이 구현되어 있지 않습니다. 이 화면의 건수는 CDM 산출물이 아니라 변환 대상(소스 EMR) 실측입니다.';

const QUALITY_NOT_AVAILABLE_REASON =
  'CDM 데이터가 없고 품질 검증(Data Quality Dashboard) 로직도 구현되어 있지 않아 완전성·적합성·타당성을 산출할 수 없습니다.';

@Injectable()
export class OmopCdmService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * EMR → OMOP CDM 변환 실행.
   * 🔴 미구현. 종전 구현은 5초 뒤 '완료 100%'를 대입할 뿐 변환은 없었다(P16).
   *    구현될 때까지 성공을 흉내내지 않고 501 로 거절한다.
   */
  runConversion(_options: ConversionOptions): never {
    throw new NotImplementedException({
      code: 'CDM_CONVERSION_NOT_IMPLEMENTED',
      message: NOT_IMPLEMENTED_REASON,
    });
  }

  /**
   * 변환 작업 상태 조회.
   * 🔴 종전엔 인메모리 Map 이라 pm2 재시작(=매 배포)·다중 인스턴스에서 실행 중 작업이 사라졌다.
   *    변환 자체가 없으므로 작업도 없다 — 저장소를 만들지 않고 없다고 답한다.
   */
  getConversionStatus(jobId: string): never {
    throw new NotFoundException({
      code: 'CDM_JOB_NOT_FOUND',
      message: `변환 작업을 찾을 수 없습니다(${jobId}). ${NOT_IMPLEMENTED_REASON}`,
    });
  }

  /** CDM 테이블 실재 여부 + 변환 대상(소스 EMR) 실측 건수 */
  async getTableCounts(): Promise<{ data: CdmTableStatusResponse }> {
    const existing = await this.findExistingCdmTables();

    const tables: CdmTableStatus[] = await Promise.all(
      CDM_TABLE_SPECS.map(async (spec) => {
        const cdmTableExists = existing.has(spec.physicalName);
        const [cdmRecordCount, sourceRecordCount] = await Promise.all([
          cdmTableExists ? this.countPhysicalTable(spec.physicalName) : Promise.resolve(null),
          spec.countSource(this.prisma),
        ]);
        return {
          tableName: spec.tableName,
          cdmTableExists,
          cdmRecordCount,
          // 변환 이력 저장소가 없다 — 모르는 시각은 추정하지 않는다
          lastUpdated: null,
          sourceTables: spec.sourceTables,
          sourceRecordCount,
        };
      }),
    );

    const cdmBuilt = tables.some((t) => t.cdmTableExists);

    return {
      data: {
        cdmVersion: CDM_VERSION,
        cdmBuilt,
        pipeline: 'NOT_IMPLEMENTED',
        checkedAt: new Date().toISOString(),
        notice: NOT_IMPLEMENTED_REASON,
        tables,
        sourceTotal: tables.reduce((s, t) => s + (t.sourceRecordCount ?? 0), 0),
        cdmTotal: cdmBuilt ? tables.reduce((s, t) => s + (t.cdmRecordCount ?? 0), 0) : null,
      },
    };
  }

  /**
   * 데이터 품질 리포트.
   * 🔴 종전엔 randomScore(85~100) 로 지표를 만들어 새로고침마다 종합점수가 바뀌었다.
   *    검증 로직이 없으므로 점수는 null('산출 불가')이고 표는 빈 목록이다.
   */
  getQualityReport(): { data: QualityReport } {
    return {
      data: {
        cdmVersion: CDM_VERSION,
        status: 'NOT_AVAILABLE',
        reason: QUALITY_NOT_AVAILABLE_REASON,
        generatedAt: null,
        overallScore: null,
        tables: [],
        summary: {
          totalRecords: null,
          avgCompleteness: null,
          avgConformance: null,
          avgPlausibility: null,
          passRate: null,
        },
      },
    };
  }

  /**
   * 변환 데이터 추출 다운로드.
   * 🔴 종전엔 난수 파일크기(50~250MB)와 `/api/v1/cdm/downloads/...`(라우트 없음) 를 돌려줬다.
   */
  downloadExtract(jobId: string): never {
    throw new NotImplementedException({
      code: 'CDM_EXTRACT_NOT_IMPLEMENTED',
      message: `추출할 변환 산출물이 없습니다(${jobId}). ${NOT_IMPLEMENTED_REASON}`,
    });
  }

  // ── Helpers ──

  /** 현재 search_path 안에 실재하는 OMOP 테이블명 집합 */
  private async findExistingCdmTables(): Promise<Set<string>> {
    const names = CDM_TABLE_SPECS.map((s) => s.physicalName);
    const rows = await this.prisma.$queryRaw<{ table_name: string }[]>(Prisma.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ANY (current_schemas(false))
        AND lower(table_name) IN (${Prisma.join(names)})
    `);
    return new Set(rows.map((r) => r.table_name.toLowerCase()));
  }

  /**
   * 실재하는 CDM 테이블의 행 수.
   * 식별자는 CDM_TABLE_SPECS 화이트리스트에서만 오고 information_schema 로 존재를 확인한 뒤 쓴다.
   */
  private async countPhysicalTable(physicalName: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS count FROM ${Prisma.raw(`"${physicalName}"`)}`,
    );
    return Number(rows[0]?.count ?? 0);
  }
}

/** 테스트/가드용 — 매핑 정본 노출 */
export const OMOP_CDM_TABLE_SPECS = CDM_TABLE_SPECS;
