import { describe, it, expect, vi } from 'vitest';
import { ConfigRuntimeService, DEFAULTS } from '../../src/modules/config/config-runtime.service';

/**
 * 🔴 AI 프롬프트용 병원 정보(`getHospitalContext`)는 **DB 행만** 싣는다 (2026-09-11).
 *
 * 원 결함: `get()` 으로 읽어 DB 행이 없으면 DEFAULTS 플레이스홀더('Hospital RUN 병원'·'서울시 강남구'·
 *   '02-1234-5678'·'09:00~18:00')를 병원 사실로 실었다. 이 문단은 의료 AI 오케스트레이터 프롬프트·
 *   HOSPITAL_INFO 도구 요약(환자에게 나간다)·관리 EP 가 함께 쓴다 — 한 곳에서 날조가 세 곳으로 퍼졌다.
 *
 * prisma 는 실제 반환 모양(`findMany` → 행 배열)으로만 흉내 낸다. 설정 서비스는 진짜다.
 */

// findUnique 도 같은 행으로 둔다 — 종전 구현(`get()` 단건 조회 + DEFAULTS 폴백)이 되살아나면
// "메서드가 없어서"가 아니라 **플레이스홀더를 실어서** 실패하도록(다른 이유로 실패하는 가드 금지)
const svcWith = (rows: Record<string, unknown>) =>
  new ConfigRuntimeService({
    systemConfig: {
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        Object.entries(rows).filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value }))),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (rows[where.key] !== undefined ? { key: where.key, value: rows[where.key] } : null)),
    },
  } as never, { emit: () => true } as never);

describe('getHospitalContext — DEFAULTS 플레이스홀더를 병원 사실로 싣지 않는다', () => {
  it('🔴 ① 대조군 — DEFAULTS 에 실제로 플레이스홀더가 있다(없으면 이 가드는 아무것도 지키지 않는다)', () => {
    expect(DEFAULTS['hospital.hours.weekday'].value).toBe('09:00~18:00');
    expect(DEFAULTS['hospital.phone'].value).toBe('02-1234-5678');
  });

  it('🔴 ② DB 행이 없는 키는 싣지 않고 "확인되지 않은 항목"으로 밝힌다', async () => {
    const ctx = await svcWith({ 'hospital.name': '센티넬병원', 'hospital.phone': '02-000-0000' }).getHospitalContext();
    expect(ctx).toContain('병원 이름: 센티넬병원');
    expect(ctx).toContain('대표 전화: 02-000-0000');
    expect(ctx, 'DEFAULTS 평일 진료시간이 병원 사실로 실렸습니다').not.toContain('09:00~18:00');
    expect(ctx).not.toContain('서울시 강남구');
    expect(ctx).not.toContain('Hospital RUN');
    expect(ctx).toMatch(/확인되지 않은 항목[^\n]*평일 진료시간/);
  });

  it('③ DB 에 설정된 진료시간은 그대로 싣는다(대조군 — 실제보다 덜 말하지도 않는다)', async () => {
    const ctx = await svcWith({ 'hospital.hours.weekday': '09:00~17:30' }).getHospitalContext();
    expect(ctx).toContain('평일 진료시간: 09:00~17:30');
  });

  it('④ 빈 문자열 행은 설정이 아니다', async () => {
    const ctx = await svcWith({ 'hospital.name': '  ' }).getHospitalContext();
    expect(ctx).not.toContain('병원 이름:');
    expect(ctx).toMatch(/확인되지 않은 항목[^\n]*병원 이름/);
  });
});
