import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PacsExportService } from '../../src/modules/portal/pacs-export.service';

/**
 * 🔴 r1 #15-2 — 포털 선택 내보내기 소유 확인이 PACS 조회 실패를 "남의 검사"로 말했다.
 *
 * 종전: export 토큰(`scope:patient-export`)으로 `patients/{mrn}/studies` 호출 → PACS 는 임상 인증만 받아 401 →
 * `!res.ok → new Set()` → 호출부가 "본인의 검사가 아닌 항목이 포함되었습니다"(403). PACS 장애·타임아웃도 같은 문장.
 * 이제 썸네일·판독 PDF 와 같은 정본(`pacs-study-ownership`)을 지난다: **서비스 계정 헤더** · 조회 실패=503 · 불일치만 403.
 */

const MRN = 'P2026-0001';
const OWNED = '1.2.410.OWNED';
const OTHERS = '1.2.410.SOMEONE-ELSE';
const SERVICE_HEADERS = { Authorization: 'Bearer svc-token' };

function make() {
  const cfg: Record<string, unknown> = { 'pacs.exportEnabled': true, 'pacs.exportSecret': 'export-secret' };
  const configRuntime = { get: vi.fn(async (k: string) => cfg[k]) };
  const portal = { getPatientMrn: vi.fn().mockResolvedValue(MRN), logAudit: vi.fn().mockResolvedValue(undefined) };
  const pacsProxy = { serviceAuthHeaders: vi.fn(async () => SERVICE_HEADERS) };
  return new PacsExportService(configRuntime as never, portal as never, pacsProxy as never);
}

type Call = { url: string; headers: Record<string, string> };
let calls: Call[];
let origFetch: typeof global.fetch;
beforeEach(() => { origFetch = global.fetch; calls = []; });
afterEach(() => { global.fetch = origFetch; });

function fetchWith(studies: (init: RequestInit | undefined) => Response) {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    if (String(url).includes('/studies')) return studies(init);
    // 내보내기 요청 생성
    return new Response(JSON.stringify({ request_id: 'req-1', status: 'pending' }), { status: 200 });
  }) as never;
}
const studiesOk = (uids: string[]) => () => new Response(JSON.stringify({ studies: uids.map((u) => ({ study_instance_uid: u })) }), { status: 200 });

describe('포털 선택 내보내기 — 소유 확인', () => {
  it('🔴 PACS 조회 401 → 503(확인 불가) · "본인 검사가 아니다"(403)라고 말하지 않는다 · 요청은 만들지 않는다', async () => {
    fetchWith(() => new Response('unauthorized', { status: 401 }));
    const err = await make().requestExport('p-1', 'SELF_VIEW', [OWNED]).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err).not.toBeInstanceOf(ForbiddenException);
    expect(calls.some((c) => c.url.includes('patient-export/requests'))).toBe(false);
  });

  it('🔴 PACS 연결 실패(네트워크) → 503', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); }) as never;
    await expect(make().requestExport('p-1', 'SELF_VIEW', [OWNED])).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('🔴 소유 조회는 export 토큰이 아니라 서비스 계정 헤더로 나간다(썸네일·PDF 정본과 같다)', async () => {
    fetchWith(studiesOk([OWNED]));
    await make().requestExport('p-1', 'SELF_VIEW', [OWNED]);
    const studiesCall = calls.find((c) => c.url.includes('/studies'));
    expect(studiesCall?.headers).toEqual(SERVICE_HEADERS);
  });

  it('남의 studyUID 가 섞이면 403(안전측 유지)', async () => {
    fetchWith(studiesOk([OWNED]));
    const err = await make().requestExport('p-1', 'SELF_VIEW', [OWNED, OTHERS]).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(calls.some((c) => c.url.includes('patient-export/requests'))).toBe(false);
  });

  it('대조군 — 본인 검사만이면 요청이 만들어진다(성공을 실패로 말하지 않는다)', async () => {
    fetchWith(studiesOk([OWNED]));
    await expect(make().requestExport('p-1', 'SELF_VIEW', [OWNED])).resolves.toEqual({ requestId: 'req-1', status: 'pending' });
  });

  it('대조군 — 선택 없이(전체) 내보내면 소유 조회를 부르지 않는다', async () => {
    fetchWith(studiesOk([]));
    await make().requestExport('p-1', 'SELF_VIEW');
    expect(calls.some((c) => c.url.includes('/studies'))).toBe(false);
  });
});
