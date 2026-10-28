import { describe, it, expect, vi } from 'vitest';
import {
  GoLiveService,
  INSTITUTION_REQUIRED_KEYS,
  INSTITUTION_OPTIONAL_KEYS,
} from '../../src/modules/go-live/go-live.service';
import { GO_LIVE_REGISTRY } from '../../src/modules/go-live/go-live.registry';
import { DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

/**
 * 🔴 설치 필수 기관 키 관제 (2026-09-13 · 상용 릴리즈 기획 T3-2).
 *
 * 종전 `data.hospitalInfo` 는 6키만 보고 `config.get()` 값이 플레이스홀더 목록에 있는지로 셌다. `get()` 은 DB 행이 없으면
 * DEFAULTS 로 떨어지므로 **행 없음과 입력됨이 같은 모양**이었고, 면허·국가·응급·진료시간은 아예 세지 않았다(운영 DB 는
 * `hospital.*` 18 정의 중 6행뿐 — R2 실측). 이제 **DB 행 실재**로 13키를 세고 분모를 병기한다.
 * 🔴 관제만 한다 — 발급 차단은 `identity.unsetIssuance` 결정 뒤(가짜 게이트 금지).
 *
 * 재주입: 미입력을 입력으로 세거나(분자에 행 없음 포함) · 조회 실패를 NOT_READY 로 말하거나 · 분모를 빼거나 ·
 *         필수 목록에서 키를 빼 DEFAULTS 와 갈라지면 실패한다.
 */
type Row = { key: string; value: unknown };
const svcWith = (rows: Row[] | Error) =>
  new GoLiveService(
    {
      systemConfig: {
        findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) => {
          if (rows instanceof Error) throw rows;
          return rows.filter((r) => where.key.in.includes(r.key));
        }),
      },
    } as never,
    { get: vi.fn(async () => 'Hospital RUN 병원') } as never, // 🔴 get() 은 기본값을 돌려준다 — 이 값으로 판정하면 안 된다
  );
const full = (): Row[] => INSTITUTION_REQUIRED_KEYS.map((k) => ({ key: k, value: `실값-${k}` }));

describe('설치 필수 기관 키 — DB 행 실재로 세고 분모를 병기한다', () => {
  it('등록부 항목이 실측형·비차단·결정 연결로 있다', () => {
    const item = GO_LIVE_REGISTRY.find((d) => d.key === 'data.hospitalInfo')!;
    expect(item.type).toBe('DB_PROBE');
    expect(item.sourceKey).toBe('hospitalInfo');
    expect(item.isBlocking, '🔴 발급 차단은 결정 뒤 — 관제 항목이 개시를 막으면 가짜 게이트다').toBe(false);
    expect(item.decisionKey).toBe('identity.unsetIssuance');
    expect(DECISION_REGISTRY.some((d) => d.key === item.decisionKey)).toBe(true);
  });

  it('🔴 분류 정본이 설정 정의와 일치한다 — `hospital.*` 정의는 필수/선택 중 정확히 하나에 들어간다', () => {
    const defined = Object.keys(DEFAULTS).filter((k) => k.startsWith('hospital.')).sort();
    const classified = [...INSTITUTION_REQUIRED_KEYS, ...INSTITUTION_OPTIONAL_KEYS].sort();
    expect(classified).toEqual(defined);
    expect(new Set(classified).size, '필수·선택에 중복').toBe(classified.length);
    expect(defined.length, '대조군 — 설정 정의를 못 읽으면 이 검사는 빈 검사다').toBeGreaterThan(10);
  });

  it('🔴 행이 하나도 없으면 NOT_READY 이고 "입력 0 / 필수 13" 을 말한다 — get() 의 기본값에 속지 않는다', async () => {
    const r = await svcWith([]).deriveHospitalInfo();
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toContain(`입력 0 / 필수 ${INSTITUTION_REQUIRED_KEYS.length}`);
    expect(r.detail).toMatch(/행 없음 13/);
  });

  it('🔴 개발용 가짜 값 행은 입력으로 세지 않는다(행 실재만으로 통과시키지 않는다)', async () => {
    const rows = full().map((r) => (r.key === 'hospital.code' ? { ...r, value: '12345678' } : r));
    const r = await svcWith(rows).deriveHospitalInfo();
    expect(r.status).toBe('IN_PROGRESS');
    expect(r.detail).toContain(`입력 12 / 필수 13`);
    expect(r.detail).toMatch(/개발용 가짜 값 1\(code\)/);
  });

  it('🔴 조회 실패는 BLOCKED("판정 불가") — 미입력이라 말하지 않는다', async () => {
    const r = await svcWith(new Error('db down')).deriveHospitalInfo();
    expect(r.status).toBe('BLOCKED');
    expect(r.detail).toMatch(/판정 불가/);
  });

  it('대조군 — 전부 실값이면 READY(과잉 경보가 아니다)', async () => {
    const r = await svcWith(full()).deriveHospitalInfo();
    expect(r.status).toBe('READY');
    expect(r.detail).toContain('입력 13 / 필수 13');
  });
});
