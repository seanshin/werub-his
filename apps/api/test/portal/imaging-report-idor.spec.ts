import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PortalController } from '../../src/modules/portal/portal.controller';

/**
 * 2026-07 권한 경계(IDOR) 전수 회귀 — 판독 PDF 소유권 검증은 fail-closed.
 *
 * 종전: `if (studiesRes.ok) { owns 검증 }` — PACS studies 조회가 실패하면 소유권 확인 없이
 *       임의 studyUid 의 판독 PDF 를 반환하던 IDOR(다른 환자 영상 판독 열람).
 * 봉합: studies 조회 실패 → '검증 불가'이므로 PDF 미발급. 소유(owns)일 때만 PDF.
 *
 * 🔴 2026-08-18 갱신: 종전에는 **연결 실패까지 'FORBIDDEN'** 이라 말했다 —
 *    '남의 것'과 '확인할 수 없다'는 다른 사실이다(P1). 이제 403 / 503 으로 갈라 말한다.
 *    fail-closed 자체(=PDF 미도달)는 그대로 단언한다.
 */
describe('PortalController.getImagingReportPdf — 소유권 fail-closed', () => {
  let controller: PortalController;
  const svc = { getPatientMrn: vi.fn().mockResolvedValue('MRN-1') };
  const req: any = { portalPatientId: 'pat-1' };

  beforeEach(() => {
    controller = new PortalController(svc as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, { serviceAuthHeaders: async () => ({}) } as any);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('🔴 PACS studies 조회 실패 시 소유권 검증 없이 PDF 를 주지 않는다(503 확인 불가)', async () => {
    // studies 조회는 실패(502), 만약 우회되면 그 뒤 PDF fetch 가 성공을 반환하도록 설정
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502 })                       // studies
      .mockResolvedValueOnce({ ok: true, text: async () => '<pdf>' });         // pdf(도달하면 안 됨)
    vi.stubGlobal('fetch', fetchMock);

    await expect(controller.getImagingReportPdf('victim-study-uid', req, 'Bearer x'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    // PDF fetch 까지 가지 않았어야 한다 — studies 1회만 호출
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('본인 소유 study 는 PDF 반환', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ studies: [{ study_instance_uid: 'mine' }] }) })
      .mockResolvedValueOnce({ ok: true, text: async () => '<pdf-html>' });
    vi.stubGlobal('fetch', fetchMock);

    const r: any = await controller.getImagingReportPdf('mine', req, 'Bearer x');

    expect(r.data?.html).toBe('<pdf-html>');
  });

  it('타인 소유 study(목록에 없음) 는 FORBIDDEN', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ studies: [{ study_instance_uid: 'mine' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(controller.getImagingReportPdf('someone-elses', req, 'Bearer x'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(fetchMock).toHaveBeenCalledTimes(1); // PDF 미도달
  });
});
