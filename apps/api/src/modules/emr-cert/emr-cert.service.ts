import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * EMR 인증제 자가 점검 — **화면·심사에 나가는 수치는 실집계이거나 '미측정'이다.**
 *
 * 🔴 종전(2026-08-14 W8·P15/P16): 지표 10건이 `status:'PASS'` 하드코딩이었고, 총계는
 *    `total: 59` **리터럴**이었다. 등재된 것은 10건뿐인데 화면은 "59개 중 …·달성률 90%"
 *    로 읽혔고(passRate 는 10 을 분모로 쓰면서 total 은 59 를 말했다), 아무도 아무것도
 *    측정하지 않았다. **인증 심사에 제출될 수 있는 수치가 코드에 박혀 있었다.**
 *
 * 지금은:
 *  - 지표마다 **자동 집계식(measure)** 이 있으면 실제로 세어서 판정하고, `basis` 에 무엇을
 *    세었는지 남긴다. 집계식이 없으면 `NOT_MEASURED`(미측정) — PASS 로 위장하지 않는다.
 *  - 통과율의 분모는 **자동 집계로 판정한 지표**뿐이고(`passRateBasis`), 측정 0건이면 `null`
 *    (= 산출 불가). 임의로 올리거나 내리지 않는다.
 *  - 인증 기준의 전체 지표 수는 시스템이 아는 사실이 아니다 → SystemConfig
 *    `emrCert.standardIndicatorCount` 에 사람이 넣기 전에는 `null`(미확인).
 *    등재율(coverage)도 그 값이 있을 때만 산출한다.
 */

export type CertStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT_MEASURED';

export interface CertIndicator {
  id: string;
  category: string;
  name: string;
  status: CertStatus;
  /** 어떤 실집계로 나온 판정인지(미측정이면 왜 못 세는지) — 화면에 그대로 노출한다 */
  basis: string;
  measured: boolean;
}

/** 자동 집계 결과 — 지표 하나의 근거 */
interface Measurement {
  status: CertStatus;
  basis: string;
}

const STANDARD_COUNT_KEY = 'emrCert.standardIndicatorCount';

@Injectable()
export class EmrCertService {
  constructor(private readonly prisma: PrismaService) {}

  /** 등재된 자가점검 지표 정의 — 판정은 measure() 가 실집계로 만든다(상수 status 없음) */
  private readonly definitions: {
    id: string;
    category: string;
    name: string;
    measure: (() => Promise<Measurement>) | null;
    /** measure 가 null 일 때 왜 못 세는지 */
    notMeasuredReason?: string;
  }[] = [
    {
      id: 'FN-01', category: '기능', name: '환자 등록/조회',
      measure: async () => this.fromCount('환자 원장', await this.prisma.patient.count()),
    },
    {
      id: 'FN-02', category: '기능', name: '진료기록 작성/조회',
      measure: async () => this.fromCount('진료(Encounter) 기록', await this.prisma.encounter.count()),
    },
    {
      id: 'FN-03', category: '기능', name: '처방전달(OCS)',
      measure: async () => {
        const [rx, orders] = await Promise.all([this.prisma.prescription.count(), this.prisma.order.count()]);
        return this.fromCount('처방·오더', rx + orders, `처방 ${rx}건 · 오더 ${orders}건`);
      },
    },
    {
      id: 'FN-04', category: '기능', name: '검사결과 조회',
      measure: async () => this.fromCount('검사 결과', await this.prisma.labResult.count()),
    },
    {
      id: 'FN-05', category: '기능', name: '의약품 안전(DUR)',
      measure: async () => this.fromCount('DUR 규칙 등재', await this.prisma.durRule.count()),
    },
    {
      id: 'SE-01', category: '보안', name: '접근통제(RBAC)',
      measure: null,
      notMeasuredReason: '가드 배선 여부는 런타임 집계 대상이 아님 — 권한 매트릭스 점검(수기) 결과를 등재해야 판정 가능',
    },
    {
      id: 'SE-02', category: '보안', name: '감사추적(Audit Trail)',
      measure: async () => this.fromCount('감사 로그', await this.prisma.auditLog.count()),
    },
    {
      id: 'SE-03', category: '보안', name: '데이터 암호화',
      measure: async () => ({
        status: process.env.ENCRYPTION_KEY ? ('PASS' as CertStatus) : ('FAIL' as CertStatus),
        basis: process.env.ENCRYPTION_KEY ? '암호화 키(ENCRYPTION_KEY) 설정됨' : '암호화 키(ENCRYPTION_KEY) 미설정',
      }),
    },
    {
      id: 'IO-01', category: '상호운용', name: '진료정보교류(FHIR)',
      measure: null,
      notMeasuredReason: '외부 교류 실적을 남기는 원장이 없음 — 교류 건수 집계 경로 신설 전까지 판정 불가',
    },
    {
      id: 'IO-02', category: '상호운용', name: '표준용어체계(KCD/EDI)',
      measure: async () => this.fromCount('진단코드(KCD) 마스터', await this.prisma.diagnosisCode.count()),
    },
  ];

  /** "N건 있으면 충족" 형태의 공통 판정 — 0건은 FAIL(근거 없음)이지 PASS 가 아니다 */
  private fromCount(label: string, n: number, detail?: string): Measurement {
    return {
      status: n > 0 ? 'PASS' : 'FAIL',
      basis: `${label} ${detail ?? `${n}건`}`,
    };
  }

  private async standardIndicatorCount(): Promise<number | null> {
    const row = await this.prisma.systemConfig
      .findUnique({ where: { key: STANDARD_COUNT_KEY } })
      .catch(() => null);
    const v = row?.value as unknown;
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }

  private async evaluate(): Promise<CertIndicator[]> {
    return Promise.all(
      this.definitions.map(async (d) => {
        if (!d.measure) {
          return {
            id: d.id, category: d.category, name: d.name,
            status: 'NOT_MEASURED' as CertStatus,
            basis: d.notMeasuredReason ?? '자동 집계 경로 없음',
            measured: false,
          };
        }
        try {
          const m = await d.measure();
          return { id: d.id, category: d.category, name: d.name, status: m.status, basis: m.basis, measured: true };
        } catch (e) {
          // 집계가 실패했으면 '충족'이 아니라 '측정 못 함'이다.
          return {
            id: d.id, category: d.category, name: d.name,
            status: 'NOT_MEASURED' as CertStatus,
            basis: `집계 실패 — ${(e as Error).message}`,
            measured: false,
          };
        }
      }),
    );
  }

  async getChecklist() {
    const indicators = await this.evaluate();
    const standard = await this.standardIndicatorCount();

    const registered = indicators.length;
    const measuredList = indicators.filter((i) => i.measured);
    const measured = measuredList.length;
    const passed = measuredList.filter((i) => i.status === 'PASS').length;
    const partial = measuredList.filter((i) => i.status === 'PARTIAL').length;
    const failed = measuredList.filter((i) => i.status === 'FAIL').length;

    return {
      registered,
      measured,
      notMeasured: registered - measured,
      passed,
      partial,
      failed,
      // 🔴 분모는 '측정된 지표'뿐 — 미측정을 통과로도 미충족으로도 세지 않는다. 0건이면 산출 불가.
      passRate: measured > 0 ? Math.round((passed / measured) * 100) : null,
      passRateBasis: measured > 0 ? `자동 집계로 판정한 ${measured}개 지표 기준` : '자동 집계로 판정한 지표 없음 — 산출 불가',
      // 인증 기준의 전체 지표 수는 시스템이 모른다. 사람이 SystemConfig 에 넣기 전엔 null.
      standardIndicatorCount: standard,
      standardCountKey: STANDARD_COUNT_KEY,
      coverage: standard ? Math.round((registered / standard) * 100) : null,
      evaluatedAt: new Date().toISOString(),
      indicators,
    };
  }

  async getByCategory(category: string) {
    const indicators = await this.evaluate();
    return indicators.filter((i) => i.category === category);
  }
}
