import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 대시보드 기본 배치 계약 — 2026-07-31.
 *
 * 🔴 위젯 58개 중 **25개가 어떤 역할의 기본 배치에도 없었다** — 만들어 놓고 편집 모드에서
 *    직접 추가하지 않으면 아무도 볼 수 없었다(약사의 조제 대기열, 검사기사의 검사 대기열,
 *    병동 간호의 인수인계·조기경보처럼 **그 역할의 핵심 업무 위젯**이 포함돼 있었다).
 */
const read = (f: string) => readFileSync(join(process.cwd(), 'src/app/(main)/dashboard/components', f), 'utf-8');
const layouts = read('default-layouts.ts');
const registry = read('widget-registry.ts');

const roleBlock = (name: string) => {
  const i = layouts.indexOf(`const ${name}_DEFAULT`);
  expect(i, `${name} 기본 배치가 없다`).toBeGreaterThan(-1);
  return layouts.slice(i, layouts.indexOf('};', i));
};
const idsOf = (name: string) => [...roleBlock(name).matchAll(/i:\s*'([\w-]+)'/g)].map((m) => m[1]);

describe('역할별 핵심 업무 위젯이 기본 배치에 있다', () => {
  it('약사 — 조제 대기·재고 부족·만료 임박·이상반응', () => {
    const ids = idsOf('PHARMACIST');
    for (const w of ['pharmacy-queue', 'low-stock', 'expiring-drugs', 'adr-stats']) expect(ids).toContain(w);
  });

  it('검사기사 — 검사/영상 단계 요약·대기열·혈액은행', () => {
    const ids = idsOf('LAB_TECH');
    for (const w of ['lab-panel', 'lab-queue', 'imaging-queue', 'blood-bank']) expect(ids).toContain(w);
    // 🔴 2026-10-02 — '검사실 통계'는 오늘 생성된 **결과 행**을 "대기·진행"이라 불러, 같은 화면의 대기열(오늘 접수 대기 8)과
    //    다르게 "대기 0"을 말했다. 단계 요약 하나만 둔다(카탈로그에는 남는다).
    expect(ids).not.toContain('lab-stats');
  });

  /**
   * 🔴 2026-10-02 실로그인 탐침 — 기본 배치 위젯이 그 역할에게 서버 403 이었다:
   *    경영진 12칸 중 4칸(수납·청구·예약 통계) · CRM 예약 목록·예약 통계 · 열람 전용 예약 통계.
   *    이 표는 위젯이 부르는 EP 의 서버 @Roles 를 옮겨 적은 것이다(EP 를 바꾸면 여기도 바꾼다).
   */
  const SERVER_ROLES: Record<string, string[]> = {
    'revenue-today': ['NURSE', 'ADMIN', 'RECEPTIONIST'],
    'daily-settlement': ['NURSE', 'ADMIN', 'RECEPTIONIST'],
    claims: ['ADMIN'],
    'hospital-pulse': ['ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST'],
    appointments: ['ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST'],
    'reception-queue': ['ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST'],
  };
  it('🔴 기본 배치에 그 역할이 서버에서 못 여는 위젯을 두지 않는다', () => {
    const roleBlocks: Record<string, string> = {
      EXECUTIVE: 'EXECUTIVE', CRM_MANAGER: 'CRM', READ: 'READ', PHARMACIST: 'PHARMACIST', LAB_TECH: 'LAB_TECH',
      DOCTOR: 'DOCTOR', NURSE: 'NURSE', RECEPTIONIST: 'RECEPTIONIST', ADMIN: 'ADMIN',
    };
    for (const [role, block] of Object.entries(roleBlocks)) {
      for (const w of idsOf(block)) {
        if (SERVER_ROLES[w]) expect(SERVER_ROLES[w], `${block} 기본 배치의 ${w} — ${role} 는 서버 403`).toContain(role);
      }
    }
    // 대조군: 경영진에게는 경영 정본 위젯이 있다
    expect(idsOf('EXECUTIVE')).toEqual(expect.arrayContaining(['executive-summary', 'executive-claims']));
  });

  it('병동 간호 — 인수인계·조기경보·격리(환자안전 축)', () => {
    const ids = idsOf('NURSE');
    for (const w of ['handoff', 'ews-high-risk', 'isolation-list']) expect(ids).toContain(w);
  });

  it('의사 — 조기경보·인수인계', () => {
    const ids = idsOf('DOCTOR');
    for (const w of ['ews-high-risk', 'handoff']) expect(ids).toContain(w);
  });

  /**
   * 🔴 2026-10-02 실화면 — '내 대기 환자'(/queue/my = 의사 본인 대기열)가 원무 기본 배치에 있었는데 서버는 원무에게 403,
   *    관리자 기본 배치에도 있었는데 관리자는 담당 환자가 없어 늘 빈 목록(위 띠는 "대기 환자 260"). 창구는 병원 접수 대기를 본다.
   */
  it('🔴 의사 본인 대기열(my-queue)을 진료하지 않는 역할의 기본 배치에 두지 않는다', () => {
    for (const role of ['ADMIN', 'RECEPTIONIST']) {
      expect(idsOf(role), role).not.toContain('my-queue');
      expect(idsOf(role), role).toContain('reception-queue');
    }
    // 대조군: 진료하는 역할에는 남아 있다
    expect(idsOf('DOCTOR')).toContain('my-queue');
  });

  it('관리자 — 병원 상황 요약(상황판과 같은 응답)·시스템·수납·청구 검토·직원 노출 추적', () => {
    // 2026-10-02 — 응급·ICU·감염·QI 는 병원 전체 현황이라 정본은 통합 상황판이다(대시보드가 자기 데이터로 따로 그리지 않는다)
    const ids = idsOf('ADMIN');
    for (const w of ['hospital-status', 'system-health', 'cashier-queue', 'billing-review-queue', 'staff-exposure']) expect(ids).toContain(w);
    for (const w of ['admin-panel', 'er-status', 'icu-alerts', 'infection-dashboard', 'qi-dashboard']) expect(ids).not.toContain(w);
  });

  it('🔴 신설 역할(원무)에도 기본 배치가 있다 — 없으면 의사 화면으로 폴백돼 빈 카드가 뜬다', () => {
    const ids = idsOf('RECEPTIONIST');
    for (const w of ['reception-queue', 'cashier-queue', 'appointments']) expect(ids).toContain(w);
    expect(ids).not.toContain('census'); // 임상 위젯은 넣지 않는다(권한 없음)
  });
});

describe('배치 커버리지', () => {
  const registryIds = [...registry.matchAll(/\{\s*id:\s*'([\w-]+)'/g)].map((m) => m[1]);
  const placed = new Set([...layouts.matchAll(/i:\s*'([\w-]+)'/g)].map((m) => m[1]));

  it('레지스트리를 실제로 읽었다(파싱 실패를 통과로 오인하지 않게)', () => {
    expect(registryIds.length).toBeGreaterThan(50);
  });

  it('어떤 역할에도 배치되지 않은 위젯은 카탈로그 전용 목록으로만 남는다', () => {
    // 여기 남은 것들은 "필요한 사람이 직접 추가" 하는 선택 위젯이다(핵심 업무 아님)
    const CATALOG_ONLY = new Set([
      'er-queue', 'icu-dashboard', 'safety-incidents', 'satisfaction', 'chart-top-dx', 'chart-infection',
      // 2026-10-02 — 병원 전체 현황(정본=통합 상황판)·추이(정본=경영 화면)라 임상·관리자 기본 배치에서 뺐다.
      //   카탈로그에서 직접 추가할 수 있고, 저장된 배치에 남은 것은 범위 표식+링크가 붙는다.
      'admin-panel', 'er-status', 'icu-alerts', 'infection-dashboard', 'qi-dashboard', 'ipsg-summary',
      'hospital-pulse', 'charts', 'chart-hourly', 'chart-weekly',
      // 2026-10-02 역할별 재검토 — 머리(hero)와 같은 내용(접속 정보)·같은 화면에서 다른 기준으로 같은 말(검사실 통계)·
      //   관리자 전용 EP(청구 현황)라 기본 배치에서 뺐다. 필요하면 카탈로그에서 추가한다.
      'session-info', 'lab-stats', 'claims',
    ]);
    const unplaced = registryIds.filter((id) => !placed.has(id));
    expect(unplaced.filter((id) => !CATALOG_ONLY.has(id))).toEqual([]);
  });
});

describe('기본값으로 되돌리기 — 첫 화면과 같은 판정(2026-10-03)', () => {
  it("🔴 '기본값으로'도 역할 + 부서로 고른다 — 부서를 빼면 비병동 간호사가 병동 배치를 받는다", async () => {
    const { getDefaultConfig } = await import('./default-layouts');
    const ids = (c: ReturnType<typeof getDefaultConfig>) => (c.layouts.lg ?? []).map((w) => w.i);
    // 대조군: 부서가 있으면 비병동 배치 · 없으면 병동 배치(두 배치가 실제로 다르다)
    expect(ids(getDefaultConfig('NURSE', '건강검진센터(간호사)'))).toContain('reception-queue');
    expect(ids(getDefaultConfig('NURSE'))).not.toContain('reception-queue');
    const store = readFileSync(join(process.cwd(), 'src/app/(main)/dashboard/stores/dashboard-store.ts'), 'utf-8');
    expect(store).toMatch(/resetToDefault: \(role, department\) => \{[\s\S]{0,200}getDefaultConfig\(role, department\)/);
    const hook = readFileSync(join(process.cwd(), 'src/app/(main)/dashboard/hooks/use-dashboard-config.ts'), 'utf-8');
    expect(hook).toMatch(/store\.resetToDefault\(user\?\.role, user\?\.department\)/);
  });
});
