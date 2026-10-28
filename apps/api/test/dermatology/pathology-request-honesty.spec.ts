/**
 * 🔴 가드 — 병리 의뢰가 '제출됨'이라 적으면서 병리과에는 아무것도 가지 않던 것(2026-08-20).
 *
 * 원 결함: `submitPathology` 가 `biopsyStatus:'SUBMITTED'` 와 JSON `submittedAt: new Date()` 를 적었다.
 * 그러나 병리 워크리스트 정본은 `modules/pathology` 의 `PathologySpecimen`(accessionNo 채번·
 * status RECEIVED)이고, 이 경로는 그 행을 **만들지 않는다** — 병리과에는 의뢰가 존재한 적이 없다.
 *
 * 이 스펙이 지키는 것:
 *  ① 병리과가 받았다는 어휘('SUBMITTED')를 쓰지 않는다 → 원내 기록(LOCAL_RECORDED)
 *  ② 병리과 '접수 시각'을 지어내지 않는다 — 남기는 시각은 의사가 의뢰한 시각(requestedAt)뿐
 *  ③ 기관(병리과) 부여 접수번호가 없다는 사실이 명시된다(pathologyAccession: null)
 *  ④ 미전송 사실과 수기 조치가 근거로 남는다
 *  ⑤ 없는 접수를 대신 만들지 않는다 — PathologySpecimen 을 여기서 생성하지 않는다
 *    (물리 검체가 도착해야 성립하는 행위라, 대신 만들면 새 거짓말이 된다)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DermatologyService } from '../../src/modules/dermatology/dermatology.service';

describe('🔴 피부과 병리 의뢰 — 받는 곳이 없으면 제출이라 적지 않는다', () => {
  let service: DermatologyService;
  let p: any;

  beforeEach(() => {
    p = {
      skinLesion: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sl-1', patientId: 'p-1' }),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'sl-1', ...data })),
      },
      pathologySpecimen: { create: vi.fn(), count: vi.fn() },
    };
    service = new DermatologyService(p);
  });

  const call = () =>
    service.submitPathology('sl-1', { specimenType: 'SKIN_PUNCH', clinicalHistory: '흑색종 R/O', requestedBy: 'doc-1' });

  it('① 상태는 SUBMITTED 가 아니라 원내 기록(LOCAL_RECORDED)이다', async () => {
    await call();
    const data = p.skinLesion.update.mock.calls[0][0].data;
    expect(data.biopsyStatus).toBe('LOCAL_RECORDED');
    expect(data.biopsyStatus).not.toBe('SUBMITTED');
    expect(data.biopsyTaken).toBe(true); // 검체 채취 사실은 그대로 남는다
  });

  it('② 병리과 접수 시각을 지어내지 않는다 — 남는 시각은 의뢰 시각뿐', async () => {
    await call();
    const meta = JSON.parse(p.skinLesion.update.mock.calls[0][0].data.biopsyResult);
    expect(meta.submittedAt).toBeUndefined(); // 🔴 재주입 시 여기서 걸린다
    expect(meta.requestedAt).toEqual(expect.any(String));
    expect(new Date(meta.requestedAt).toString()).not.toBe('Invalid Date');
  });

  it('③④ 접수번호 부재와 미전송 근거·수기 조치가 남는다', async () => {
    await call();
    const meta = JSON.parse(p.skinLesion.update.mock.calls[0][0].data.biopsyResult);
    expect(meta.pathologyAccession).toBeNull();
    expect(meta.transmission.outcome).toBe('NOT_TRANSMITTED');
    expect(meta.transmission.manualFallback).toContain('병리');
    // 의뢰 내용 자체는 보존된다(기능을 죽이지 않았다)
    expect(meta.specimenType).toBe('SKIN_PUNCH');
    expect(meta.clinicalHistory).toBe('흑색종 R/O');
    expect(meta.requestedBy).toBe('doc-1');
  });

  it('⑤ 도착하지 않은 검체를 대신 접수하지 않는다', async () => {
    await call();
    expect(p.pathologySpecimen.create).not.toHaveBeenCalled();
  });

  it('⑤-b 소스에도 무조건 제출 시각을 찍는 코드가 없다', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/dermatology/dermatology.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/submittedAt:\s*new Date\(\)/);
    expect(src).not.toMatch(/biopsyStatus:\s*['"]SUBMITTED['"]/);
  });
});
