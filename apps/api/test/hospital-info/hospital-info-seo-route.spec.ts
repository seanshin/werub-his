import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { HospitalInfoController } from '../../src/modules/hospital-info/hospital-info.controller';

/**
 * W9 가드 — SEO 경로는 **세그먼트가 아니라 값**이다.
 *
 * 원 결함: `@Put('seo/:path')` 는 한 세그먼트만 매칭한다. 관리 화면이 편집하는 경로의 상당수가
 * 다중 세그먼트(`/care/departments`·`/care/centers`·`/care/doctors`)라 PUT 이 라우트에 닿지도 못하고
 * 404 → 화면엔 이유 없는 '저장에 실패했습니다'. 운영 system_configs(category='seo') 가 0행인 이유다.
 */
describe('HospitalInfoController — SEO 경로 계약', () => {
  let svc: any;
  let ctrl: HospitalInfoController;

  beforeEach(() => {
    svc = { getSeoForPath: vi.fn().mockResolvedValue({}), upsertSeoEntry: vi.fn().mockResolvedValue(undefined) };
    ctrl = new HospitalInfoController(svc);
  });

  it('다중 세그먼트 경로를 저장할 수 있다 — 저장 키가 정확히 그 경로다', async () => {
    await ctrl.upsertSeoEntryByQuery('/care/departments', { title: '진료과' });
    expect(svc.upsertSeoEntry).toHaveBeenCalledWith('/care/departments', { title: '진료과' });
  });

  it('선행 슬래시 유무와 중복 슬래시를 하나로 정규화한다(정본이 갈라지지 않게)', async () => {
    await ctrl.getSeoEntryByQuery('care//doctors/');
    expect(svc.getSeoForPath).toHaveBeenCalledWith('/care/doctors');
  });

  it('구 단일 세그먼트 라우트도 같은 정규화를 쓴다', async () => {
    await ctrl.upsertSeoEntry('home', { title: '홈' });
    expect(svc.upsertSeoEntry).toHaveBeenCalledWith('/home', { title: '홈' });
  });

  it('빈 경로·경로 탈출은 400', async () => {
    await expect(ctrl.getSeoEntryByQuery('')).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.getSeoEntryByQuery('/../secret')).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.getSeoForPath).not.toHaveBeenCalled();
  });

  // ── 역검증 ──
  it('역검증 — 옛 `seo/:path` 는 다중 세그먼트를 표현할 수 없다', () => {
    const singleSegment = /^[^/]+$/;
    expect(singleSegment.test('home')).toBe(true);
    expect(singleSegment.test('care/departments')).toBe(false); // → 라우트 미매칭(404)
  });
});
