import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserRole } from '@prisma/client';
import { Permission, ROLE_PERMISSIONS } from '../../src/modules/auth/rbac/permission.types';
import { uncatalogedPermissions } from '../../src/modules/auth/rbac/permission-catalog';
import { QualityService } from '../../src/modules/quality/quality.service';
import {
  MEASUREMENT_VALUE_MAX,
  computeMeasurementValue,
  resolveIndicatorPolicy,
  valueDerivedFromRatio,
} from '../../src/modules/quality/indicator-policy';

/**
 * 🔴 QI 측정 — **입력 권한**과 **저장 한도** 가드 (2026-08-18).
 *
 * ── 권한 실측 ─────────────────────────────────────────────────────────────
 * 종전엔 입력·정정·무효화가 전부 `@Roles(UserRole.ADMIN)` 단독이었다. 운영 실측(계정 102개)에서
 * ADMIN 은 **2개**뿐이고 그중 하나는 원무과 소속이다. 반면 25지표 중 감염관리 4·환자안전 6 =
 * **10지표(40%)** 의 산출 주체는 법령상 감염관리실(의료법 시행규칙 §43)·환자안전 전담인력
 * (환자안전법 §12)이고, 이 저장소에서 그 직군의 역할은 `NURSE` 다(운영에 '감염관리실' NURSE 실재).
 * → **지표를 만드는 사람이 지표를 넣을 수 없었다.**
 *
 * 넓혀도 PHI 노출은 늘지 않는다 — QI 측정은 기간·분자·분모·값의 집계치이고 환자 식별자가 없다.
 * 게다가 NURSE 는 이미 `GET /quality/*` 를 전부 읽는다(읽기 범위는 이번에 **바꾸지 않았다**).
 *
 * 🔴 **무효화는 정정보다 엄격해야 한다** — 정정은 행이 남고 집계에도 계속 잡히지만, 무효화는
 *    그 기간을 집계·화면에서 사라지게 하고 같은 기간을 다시 쓸 수 있게 연다.
 *    입력자가 자기 입력을 없앨 수 있으면 '나쁜 달을 지우고 다시 쓰는' 경로가 되고, 사유를 적는
 *    사람이 곧 입력자면 사유는 통제가 아니다 → 직무 분리로 무효화는 ADMIN 에만 둔다.
 *
 * ── 저장 한도 실측 ────────────────────────────────────────────────────────
 * `QiMeasurement.value` = `Decimal(5,2)` → 999.99. **운영 25지표·측정 300건 중 걸리는 것 0건**
 * (실측 최대 99.77 = 필수교육 이수율). 아래 `OPERATIONAL_INDICATORS` 가 그 분모다.
 * 남은 노출은 **배율이 '가정'인 신규 지표** 하나뿐이다 — 산출공식에 배율 힌트가 없으면 ×100 을
 * 가정하므로 건수 10건이 1000 이 되어 거절된다. 그래서 거절 메시지가 배율의 **출처**를 말해야 한다.
 */

const CONTROLLER = readFileSync(
  join(__dirname, '../../src/modules/quality/quality.controller.ts'),
  'utf8',
);

/** 데코레이터만 잘라낸다(본문·주석의 문자열이 통과 근거가 되지 않게) */
function decoratorsOf(marker: string): string {
  const at = CONTROLLER.indexOf(marker);
  expect(at, `핸들러를 찾지 못함: ${marker}`).toBeGreaterThan(-1);
  return CONTROLLER.slice(at, CONTROLLER.indexOf('async ', at));
}

describe('QI 측정 입력 권한 — 누가 이 일을 하는가', () => {
  it('🔴 입력·정정은 ADMIN 단독이 아니라 qi:measure:write 로 열린다', () => {
    for (const marker of ["@Post('measurements')", "@Patch('measurements/:id')"]) {
      const d = decoratorsOf(marker);
      expect(d, marker).toContain('Permission.QI_MEASURE_WRITE');
      expect(d, marker).not.toContain('@Roles(');
    }
  });

  it('🔴 무효화는 입력과 **다른** 권한(qi:measure:void)으로 걸린다', () => {
    const d = decoratorsOf("@Patch('measurements/:id/void')");
    expect(d).toContain('Permission.QI_MEASURE_VOID');
    // 같은 권한으로 되돌리면(직무 분리 소실) 실패한다
    expect(d).not.toContain('Permission.QI_MEASURE_WRITE');
  });

  it('🔴 지표 정의(방향·배율·목표)는 ADMIN 유지 — 바꾸면 전 기간 판정이 뒤집힌다', () => {
    for (const marker of ["@Post('indicators')", "@Patch('indicators/:id')"]) {
      expect(decoratorsOf(marker), marker).toContain('@Roles(UserRole.ADMIN)');
    }
  });

  it('감염관리·환자안전 지표의 산출 주체(NURSE)가 측정값을 넣을 수 있다', () => {
    expect(ROLE_PERMISSIONS[UserRole.NURSE].has(Permission.QI_MEASURE_WRITE)).toBe(true);
    expect(ROLE_PERMISSIONS[UserRole.ADMIN].has(Permission.QI_MEASURE_WRITE)).toBe(true);
  });

  it('🔴 무효화 보유 역할은 입력 보유 역할의 **진부분집합**이다(입력자가 자기 입력을 지울 수 없다)', () => {
    const roles = Object.values(UserRole) as UserRole[];
    const canWrite = roles.filter((r) => ROLE_PERMISSIONS[r].has(Permission.QI_MEASURE_WRITE));
    const canVoid = roles.filter((r) => ROLE_PERMISSIONS[r].has(Permission.QI_MEASURE_VOID));
    expect(canWrite).toEqual([UserRole.ADMIN, UserRole.NURSE]);
    expect(canVoid).toEqual([UserRole.ADMIN]);
    expect(canVoid.every((r) => canWrite.includes(r))).toBe(true);
    expect(canVoid.length).toBeLessThan(canWrite.length);
  });

  it('임상 외 역할에는 열지 않았다 — 확대는 근거가 있는 역할에만', () => {
    for (const role of [
      UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.RECEPTIONIST,
      UserRole.MEDICAL_RECORDS, UserRole.EXECUTIVE, UserRole.ADMIN_STAFF, UserRole.NUTRITION,
      UserRole.CRM_MANAGER, UserRole.CRM_STAFF, UserRole.CHECKUP, UserRole.READ,
    ]) {
      expect(`${role}:${ROLE_PERMISSIONS[role].has(Permission.QI_MEASURE_WRITE)}`).toBe(`${role}:false`);
      expect(`${role}:${ROLE_PERMISSIONS[role].has(Permission.QI_MEASURE_VOID)}`).toBe(`${role}:false`);
    }
  });

  it('신설 권한은 관리 화면(/admin/rbac)에서 라벨 없이 뜨지 않는다', () => {
    expect(uncatalogedPermissions([Permission.QI_MEASURE_WRITE, Permission.QI_MEASURE_VOID])).toEqual([]);
  });
});

/**
 * 운영 실측 지표 25종 — `GET /api/v1/quality/indicators` (2026-08-18 · his.example.org).
 * 🔴 배율은 손으로 적지 않고 **산출공식에서 다시 해석**해 대조한다(해석기가 드리프트하면 실패).
 */
const OPERATIONAL_INDICATORS = [
  { name: '30일 내 재입원율', formula: '(30일 이내 재입원 환자 수 / 퇴원 환자 수) × 100', target: 5, scale: 100, maxObserved: 4.93 },
  { name: '검사결과 보고시간', formula: '접수 ~ 결과 보고 평균 시간 (분)', target: 60, scale: 1, maxObserved: 61.74 },
  { name: '낙상 발생률', formula: '(낙상 발생 건수 / 재원일수) × 1000', target: 1.5, scale: 1000, maxObserved: 1.47 },
  { name: '병상 가동률', formula: '(점유 병상일수 / 가용 병상일수) × 100', target: 85, scale: 100, maxObserved: 88.4 },
  { name: '병원감염 발생률', formula: '(병원감염 발생 건수 / 재원일수) × 1000', target: 3, scale: 1000, maxObserved: 2.71 },
  { name: '손위생 수행률', formula: '(손위생 수행 횟수 / 손위생 기회 횟수) × 100', target: 95, scale: 100, maxObserved: 98.47 },
  { name: '수술 사망률', formula: '(수술 후 30일 내 사망 수 / 수술 건수) × 100', target: 0.5, scale: 100, maxObserved: 0.45 },
  { name: '수술부위 감염률', formula: '(수술부위 감염 건수 / 수술 건수) × 100', target: 2, scale: 100, maxObserved: 1.73 },
  { name: '수술실 가동률', formula: '(수술 시간 / 운영 가능 시간) × 100', target: 75, scale: 100, maxObserved: 80.78 },
  { name: '수혈 부작용 발생률', formula: '(수혈 부작용 건수 / 총 수혈 건수) × 100', target: 0.3, scale: 100, maxObserved: 0.29 },
  { name: '외래 초진 대기시간', formula: '접수 ~ 진료 시작 평균 시간 (분)', target: 30, scale: 1, maxObserved: 32.54 },
  { name: '요로감염 발생률 (도뇨관)', formula: '(CAUTI 건수 / 도뇨관 유치일수) × 1000', target: 2, scale: 1000, maxObserved: 1.84 },
  { name: '욕창 발생률', formula: '(욕창 신규 발생 건수 / 재원일수) × 1000', target: 1, scale: 1000, maxObserved: 0.98 },
  { name: '응급실 체류시간 (중증)', formula: 'KTAS 1-2 환자 응급실 평균 체류시간 (분)', target: 60, scale: 1, maxObserved: 59.96 },
  { name: '의료수익 대비 인건비율', formula: '(인건비 / 의료수익) × 100', target: 55, scale: 100, maxObserved: 54.7 },
  { name: '인공호흡기 관련 폐렴 발생률', formula: '(VAP 건수 / 인공호흡기 유치일수) × 1000', target: 2, scale: 1000, maxObserved: 2.1 },
  { name: '중심정맥관 관련 혈류감염률', formula: '(CLABSI 건수 / 중심정맥관 유치일수) × 1000', target: 1.5, scale: 1000, maxObserved: 1.38 },
  { name: '직원 이직률', formula: '(퇴직자 수 / 평균 재직자 수) × 100', target: 10, scale: 100, maxObserved: 9.8 },
  { name: '진료비 청구 반송률', formula: '(반송 건수 / 청구 건수) × 100', target: 3, scale: 100, maxObserved: 3.95 },
  { name: '처방전달시간', formula: '처방 ~ 약국 수령 평균 시간 (분)', target: 20, scale: 1, maxObserved: 20.7 },
  { name: '투약오류 발생률', formula: '(투약오류 건수 / 총 투약 건수) × 1000', target: 0.5, scale: 1000, maxObserved: 0.39 },
  { name: '평균 재원일수', formula: '총 재원일수 / 퇴원 환자 수', target: 7, scale: 1, maxObserved: 7.01 },
  { name: '필수교육 이수율', formula: '(이수자 수 / 대상자 수) × 100', target: 95, scale: 100, maxObserved: 99.77 },
  { name: '환자 불만 건수', formula: '월간 환자 불만 접수 건수', target: 5, scale: 1, maxObserved: 7.95 },
  { name: '환자만족도', formula: '환자만족도 설문 평균 점수 (100점 만점)', target: 85, scale: 1, maxObserved: 89.96 },
];

describe('저장 한도 999.99 — 실제로 걸리는 지표를 센다(추정하지 않는다)', () => {
  it('운영 25지표의 배율은 산출공식에서 그대로 재현된다(분모 동결)', () => {
    expect(OPERATIONAL_INDICATORS).toHaveLength(25);
    for (const i of OPERATIONAL_INDICATORS) {
      const policy = resolveIndicatorPolicy({ name: i.name, formula: i.formula });
      expect(`${i.name}=${policy.valueScale}`).toBe(`${i.name}=${i.scale}`);
      // 25지표 전량 배율이 **확정**돼 있다 — '가정' 배율이 하나라도 생기면 한도 노출이 생긴다
      expect(`${i.name}:${policy.valueScaleKnown}`).toBe(`${i.name}:true`);
    }
  });

  it('🔴 실측 최대값(99.77)은 한도의 1/10 — 걸리는 지표 0건', () => {
    const over = OPERATIONAL_INDICATORS.filter((i) => i.maxObserved > MEASUREMENT_VALUE_MAX);
    expect(over.map((i) => i.name)).toEqual([]);
    expect(Math.max(...OPERATIONAL_INDICATORS.map((i) => i.maxObserved))).toBeLessThan(100);
  });

  it('🔴 비율형 지표(×100·×1000)는 한도에 **수학적으로** 닿지 못한다', () => {
    for (const i of OPERATIONAL_INDICATORS.filter((x) => x.scale >= 100)) {
      // 한도에 닿으려면 분자/분모 비율이 이만큼이어야 한다 — ×100 은 999.9%, ×1000 은 사건수=유치일수
      const ratioNeeded = MEASUREMENT_VALUE_MAX / i.scale;
      expect(`${i.name}:${ratioNeeded > 0.99}`).toBe(`${i.name}:true`);
    }
    // 배율 1(평균·점수·건수) 7종만 값이 곧 실수치라 이론상 999.99 가 천장이다
    expect(OPERATIONAL_INDICATORS.filter((x) => x.scale === 1)).toHaveLength(7);
  });
});

// ── 서비스 동작 가드 ────────────────────────────────────────────────────────

const IND_ASSUMED = {
  id: 'ind-a', name: '무균조제 오류 보고', formula: '월간 무균조제 오류 보고 (약제부)',
  targetValue: 5, direction: 'LOWER_IS_BETTER', unit: null, valueScale: null,
};
const IND_COUNT = { ...IND_ASSUMED, id: 'ind-c', valueScale: 1 };

function makeService(indicator: Record<string, unknown>, measurement: Record<string, unknown> | null = null) {
  const prisma = {
    qualityIndicator: {
      findUnique: vi.fn().mockResolvedValue(indicator),
      update: vi.fn().mockResolvedValue(indicator),
    },
    qiMeasurement: {
      findUnique: vi.fn().mockResolvedValue(measurement),
      findMany: vi.fn().mockResolvedValue(measurement ? [measurement] : []),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', ...data })),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', ...measurement, ...data })),
    },
  };
  return { svc: new QualityService(prisma as never), prisma };
}

describe('한도 초과는 자르지 않고 거절하되, **배율이 가정임을 말한다**', () => {
  it('🔴 배율 미등재(가정 ×100) 지표는 건수 10건도 저장 못 한다 — 메시지가 그 이유를 말한다', async () => {
    const { svc } = makeService(IND_ASSUMED);
    // 산출공식에 배율 힌트가 없으므로 ×100 가정 → 10 × 100 = 1000 > 999.99
    expect(resolveIndicatorPolicy(IND_ASSUMED as never).valueScaleSource).toBe('ASSUMED');
    const call = svc.addMeasurement({ indicatorId: 'ind-a', period: '2026-08', numerator: 10, denominator: 1 } as never);
    await expect(call).rejects.toThrow(/999\.99/);
    // 🔴 '가정'을 '등재'처럼 말하면 담당자가 진짜 원인(미등재 배율)을 못 찾는다(P1)
    await expect(call).rejects.toThrow(/가정/);
    await expect(call).rejects.toThrow(/valueScale=1/);
  });

  it('배율을 1 로 등재하면 같은 입력이 그대로 저장된다(한도 문제가 아니었다)', async () => {
    const { svc } = makeService(IND_COUNT);
    const r = await svc.addMeasurement({ indicatorId: 'ind-c', period: '2026-08', numerator: 10, denominator: 1 } as never);
    expect(Number(r.value)).toBe(10);
  });

  it('🔴 진짜 한도 초과도 값을 잘라 저장하지 않는다', async () => {
    const { svc, prisma } = makeService(IND_COUNT);
    await expect(
      svc.addMeasurement({ indicatorId: 'ind-c', period: '2026-08', numerator: 1200, denominator: 1 } as never),
    ).rejects.toThrow(/999\.99/);
    expect(prisma.qiMeasurement.create).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 정정이 손대지 않은 값을 조용히 바꾸던 것 — 운영 측정 300건 중 **273건(91%)** 은 저장된 값이
 *    그 행의 분자/분모에서 나온 값이 아니다(시드가 값을 먼저 정하고 분자/분모를 ×100 가정으로 역산).
 *    화면의 [정정] 폼은 분자/분모를 프리필하므로 **그대로 저장을 누르기만 해도** ×1000 지표가
 *    10배(낙상 0.79 → 7.95)로 튀고 달성 판정까지 뒤집혔다.
 */
describe('정정은 고친 것만 바꾼다', () => {
  const ROW = {
    id: 'm1', period: '2026-07', numerator: 68, denominator: 8550, value: 0.79,
    notes: null, voidedAt: null, meetTarget: true,
    indicator: { id: 'ind-f', name: '낙상 발생률', formula: '(낙상 발생 건수 / 재원일수) × 1000', targetValue: 1.5, direction: 'LOWER_IS_BETTER', unit: null, valueScale: 1000 },
  };

  it('🔴 아무것도 바뀌지 않는 정정은 거절한다(누르기만 해도 값이 재산출되지 않는다)', async () => {
    const { svc, prisma } = makeService(ROW.indicator, ROW);
    await expect(
      svc.updateMeasurement('m1', { numerator: 68, denominator: 8550 }),
    ).rejects.toThrow(/정정할 내용이 없습니다/);
    expect(prisma.qiMeasurement.update).not.toHaveBeenCalled();
  });

  it('비고만 고치면 값·판정에 손대지 않는다(측정을 다시 한 것이 아니다)', async () => {
    const { svc, prisma } = makeService(ROW.indicator, ROW);
    const r = await svc.updateMeasurement('m1', { notes: '감염관리위원회 확인' });
    expect((r as { valueRecomputed: boolean }).valueRecomputed).toBe(false);
    expect(r.value).toBe(0.79);
    const written = prisma.qiMeasurement.update.mock.calls[0][0].data;
    expect(Object.keys(written)).toEqual(['notes']); // value·meetTarget·measuredAt 을 건드리지 않는다
  });

  it('분자/분모를 실제로 고치면 재산출하되, 이전 값이 분자/분모에서 나온 값이 아니었음을 드러낸다', async () => {
    const { svc } = makeService(ROW.indicator, ROW);
    const r = await svc.updateMeasurement('m1', { numerator: 12, denominator: 8550 });
    expect(Number(r.value)).toBe(1.4);
    expect((r as { previousValue: number }).previousValue).toBe(0.79);
    // 🔴 0.79 ≠ 68/8550×1000(=7.95) — 감추면 담당자는 자기가 고친 것보다 큰 변화를 모른다
    expect((r as { previousValueDerived: boolean }).previousValueDerived).toBe(false);
  });

  it('읽기도 값이 분자/분모에서 나온 것인지 함께 낸다(P12 — 같은 사실에 정본이 둘)', async () => {
    const { svc } = makeService(ROW.indicator, ROW);
    const rows = await svc.getMeasurements('ind-f');
    expect(rows[0].valueDerived).toBe(false);
    expect(rows[0].ratioValue).toBe(7.95);
  });

  it('🔴 저장 자릿수 계약(소수 2자리 = Decimal(5,2))이 실제로 지켜진다', () => {
    // roundBy 의 키 `qiValue` 는 shared 미등재라 **반올림이 일어나지 않는다** — 보정이 사라지면 실패한다.
    expect(computeMeasurementValue(68, 8550, 1000)).toBe(7.95);
    expect(computeMeasurementValue(1, 3, 100)).toBe(33.33);
    expect(computeMeasurementValue(2, 3, 1)).toBe(0.67);
    expect(computeMeasurementValue(1, 0, 100)).toBeNull(); // 분모 0 = 산출 불가(0 이 아니다)
  });

  it('정합한 행은 valueDerived=true — 경보가 남발되지 않는다(거짓 경보는 진짜 경보를 죽인다)', () => {
    expect(valueDerivedFromRatio(7.95, 68, 8550, 1000)).toBe(true);
    expect(valueDerivedFromRatio(0.79, 68, 8550, 1000)).toBe(false);
    expect(valueDerivedFromRatio(null, 68, 8550, 1000)).toBeNull(); // 모르면 모른다
  });
});
