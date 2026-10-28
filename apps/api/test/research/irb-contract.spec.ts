import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ResearchService } from '../../src/modules/research/research.service';
import { irbValidityOf, IRB_EXPIRY_SOON_DAYS, ymdOf, todayYmd } from '../../src/modules/research/irb-validity';

/**
 * 임상연구(IRB) 계약 가드 — 화면 실사용 점검 W7.
 *
 * 여기서 지키는 두 가지:
 *  1. **통계 응답의 형태**(객체 vs 배열). 서버가 객체를 주고 화면이 배열로 읽어 통계 탭이
 *     `stats.byType.map is not a function` 으로 통째 죽었다(P11 — FE↔서버 계약 불일치).
 *  2. **IRB 만료 표기**. 만료일이 없으면 '유효'가 아니라 '만료일 미등록'이다(P1 — 미상을 최선값으로 폴백 금지).
 */

const RESEARCH_DIR = path.join(__dirname, '..', '..', 'src', 'modules', 'research');
const WEB_PAGE = path.join(
  __dirname, '..', '..', '..', 'web', 'src', 'app', '(main)', 'research', 'page.tsx',
);

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    researchStudy: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn() },
    researchSubject: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
    researchDocument: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    irbAmendment: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    patient: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(async (fn: any) => fn({})),
    ...overrides,
  } as any;
}

describe('IRB 계약 가드 — 통계 응답 형태', () => {
  let service: ResearchService;
  let prisma: any;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ResearchService(prisma);
  });

  it('byType·byStatus·monthlyEnrollment 는 항상 배열이다 (연구 0건이어도)', async () => {
    const stats = await service.getStats();

    for (const key of ['byType', 'byStatus', 'monthlyEnrollment'] as const) {
      expect(Array.isArray(stats[key]), `${key} 는 배열이어야 한다 — 객체를 주면 화면의 .map() 이 TypeError`).toBe(true);
    }
  });

  it('배열 원소는 {type|status, count} 형태다', async () => {
    prisma.researchStudy.findMany.mockResolvedValue([
      { id: 'a', studyType: 'RETROSPECTIVE', irbStatus: 'APPROVED', irbExpiryDate: null, targetEnroll: null, currentEnroll: 0 },
    ]);

    const stats = await service.getStats();

    expect(stats.byType[0]).toEqual({ type: 'RETROSPECTIVE', count: 1 });
    expect(stats.byStatus[0]).toEqual({ status: 'APPROVED', count: 1 });
  });

  it('화면이 읽는 카드 6종 키가 응답에 모두 있다 (undefined% 재발 방지)', async () => {
    const stats = await service.getStats();

    for (const key of ['totalStudies', 'activeStudies', 'totalSubjects', 'pendingReviews', 'approvalRate', 'enrollmentRate'] as const) {
      expect(stats, `${key} 누락 — 화면은 "undefined%" 를 그린다`).toHaveProperty(key);
    }
    // 비율은 표본이 없으면 null(산출 불가)이지 0 이 아니다
    expect(stats.approvalRate).toBeNull();
    expect(stats.enrollmentRate).toBeNull();
    // 분모를 함께 내려 화면이 근거를 말할 수 있게 한다
    expect(stats.approvalBasis).toEqual({ approved: 0, rejected: 0, decided: 0 });
  });

  it('규제 경보(irbExpiry) 3종이 응답에 있다', async () => {
    const stats = await service.getStats();
    expect(stats.irbExpiry).toEqual({ expired: 0, expiringSoon: 0, noExpiryOnRecord: 0 });
  });
});

describe('IRB 계약 가드 — 만료 판정', () => {
  const at = (ymd: string) => new Date(`${ymd}T09:00:00`);

  it('🔴 만료일이 없으면 "유효"가 아니라 NO_EXPIRY_ON_RECORD 다', () => {
    const v = irbValidityOf({ irbStatus: 'APPROVED', irbExpiryDate: null }, at('2026-08-14'));

    expect(v.state).toBe('NO_EXPIRY_ON_RECORD');
    expect(v.state).not.toBe('VALID');
    expect(v.daysLeft).toBeNull();
    expect(v.reason).toContain('판정할 수 없습니다');
  });

  it('만료일이 지났으면 EXPIRED + 경과일수', () => {
    const v = irbValidityOf({ irbStatus: 'APPROVED', irbExpiryDate: new Date('2026-01-15T00:00:00Z') }, at('2026-08-14'));

    expect(v.state).toBe('EXPIRED');
    expect(v.daysLeft).toBe(-211);
    expect(v.reason).toBe('승인 만료 211일 경과');
  });

  it('당일 만료는 아직 EXPIRED 가 아니다 (경계)', () => {
    const v = irbValidityOf({ irbStatus: 'APPROVED', irbExpiryDate: new Date('2026-08-14T00:00:00Z') }, at('2026-08-14'));

    expect(v.state).toBe('EXPIRING_SOON');
    expect(v.daysLeft).toBe(0);
    expect(v.reason).toBe('오늘 만료');
  });

  it(`임박 경계(${IRB_EXPIRY_SOON_DAYS}일)를 정확히 가른다`, () => {
    const soon = irbValidityOf(
      { irbStatus: 'APPROVED', irbExpiryDate: new Date('2026-09-13T00:00:00Z') }, at('2026-08-14'),
    );
    const valid = irbValidityOf(
      { irbStatus: 'APPROVED', irbExpiryDate: new Date('2026-09-14T00:00:00Z') }, at('2026-08-14'),
    );

    expect(soon.daysLeft).toBe(IRB_EXPIRY_SOON_DAYS);
    expect(soon.state).toBe('EXPIRING_SOON');
    expect(valid.daysLeft).toBe(IRB_EXPIRY_SOON_DAYS + 1);
    expect(valid.state).toBe('VALID');
  });

  it('승인 상태가 아니면 만료 판정 대상이 아니다', () => {
    for (const s of ['SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'CLOSED']) {
      expect(irbValidityOf({ irbStatus: s, irbExpiryDate: null }).state).toBe('NOT_APPROVED');
    }
  });

  it('date-only 는 KST 에서도 하루 밀리지 않는다', () => {
    // @db.Date 는 UTC 자정으로 온다 — toLocaleDateString 경로였다면 KST 에서 하루 당겨졌을 값
    expect(ymdOf(new Date('2026-08-14T00:00:00Z'))).toBe('2026-08-14');
    expect(todayYmd(new Date('2026-08-14T23:30:00'))).toBe('2026-08-14');
  });
});

describe('IRB 계약 가드 — 날조 상수 재유입 차단', () => {
  const serviceSrc = fs.readFileSync(path.join(RESEARCH_DIR, 'research.service.ts'), 'utf8');

  it('🔴 추출 EP 에 상수 검사값(WBC 6200 · Hb 13.5 · BP 120/80)이 없다', () => {
    expect(serviceSrc).not.toMatch(/value:\s*6200/);
    expect(serviceSrc).not.toMatch(/'120\/80'/);
  });

  it('🔴 CDM mock 상수 테이블(person 1250 등)이 없다 — 정본은 omop-cdm 모듈', () => {
    expect(serviceSrc).not.toMatch(/condition_occurrence/);
    expect(serviceSrc).not.toMatch(/qualityScore/);
  });

  it('🔴 승인 시 만료일을 +N일로 계산해 채우지 않는다', () => {
    // 만료 기간은 IRB 의결값이라 시스템이 추정하면 실제 승인서와 다른 날짜가 법정 기록으로 남는다
    expect(serviceSrc).not.toMatch(/irbExpiryDate[^\n]*(setFullYear|365|86_?400_?000\s*\*)/);
  });
});

describe('IRB 계약 가드 — 화면 표기', () => {
  const pageSrc = fs.readFileSync(WEB_PAGE, 'utf8');
  /**
   * 주석 제거본으로 검사한다 — 주석에는 **고친 결함의 이름**(piName·patientName 등)이 남아 있고,
   * 그게 남아 있는 것이 이 저장소의 규약이다. 실행되는 코드만 본다.
   */
  const code = pageSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')          // 블록·JSX 주석
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))   // 줄 주석
    .join('\n');

  it('화면이 IRB 만료일과 만료 판정을 렌더한다', () => {
    expect(code).toContain('irbExpiryDate');
    expect(code).toContain('irbValidity');
    expect(code).toContain('만료일 미등록');
  });

  it('🔴 심의 상태를 SCHEDULED/IN_PROGRESS 3항 연쇄로 낙착시키지 않는다 (APPROVED→"보류" 재발 방지)', () => {
    expect(code).not.toMatch(/status === 'SCHEDULED'/);
    expect(code).not.toMatch(/status === 'IN_PROGRESS'\s*\?/);
    // IRB 어휘 표(SUSPENDED='보류')를 통해서만 '보류'가 나올 수 있다
    expect(code).not.toMatch(/\?[^\n]*'보류'/);
  });

  it('🔴 예정 심의는 irb-calendar EP 를 부른다 (승인일을 예정일로 그리던 자리)', () => {
    expect(code).toContain('/api/v1/research/irb-calendar');
  });

  it('🔴 서버에 없는 키(piName·currentEnrollment·targetEnrollment·patientName)를 읽지 않는다', () => {
    for (const dead of ['piName', 'currentEnrollment', 'targetEnrollment', 'patientName', 'protocolSummary']) {
      expect(code, `${dead} 는 서버 응답에 없는 키다`).not.toContain(dead);
    }
  });

  it('🔴 진료과 필터를 상수 목록으로 박지 않는다 (실데이터 전멸 재발 방지)', () => {
    expect(code).not.toMatch(/const DEPARTMENTS\s*=/);
    expect(code).toContain('deptOptions');
  });

  it('RETROSPECTIVE 유형에 라벨이 있다', () => {
    expect(code).toMatch(/RETROSPECTIVE:\s*'후향적연구'/);
  });

  it('철회는 사유를 사람에게 묻고 계약대로 `reason` 으로 보낸다', () => {
    expect(code).not.toContain("'연구자 판단'");
    expect(code).toMatch(/withdraw`,\s*\{\s*reason\s*\}/);
  });
});
