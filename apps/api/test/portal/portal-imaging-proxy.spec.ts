import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException, ServiceUnavailableException, HttpException, BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PortalController } from '../../src/modules/portal/portal.controller';

/**
 * PACS 직접 호출 이관 — 포털 바이너리/멀티파트 중계 가드 (2026-08-18).
 *
 * 🔴 여기 단언은 전부 **되돌리면 반드시 깨지도록** 썼다.
 *    - 소유권 검증을 빼면 → '남의 studyUID 로 남의 영상' 테스트가 통과해버린다(실패로 잡힌다)
 *    - 실패를 빈 응답/성공으로 삼키면 → '실패를 실패로 말한다' 테스트가 깨진다
 *    - 업로드 대상 환자를 브라우저 입력으로 되돌리면 → 'MRN 은 서버가 정한다' 테스트가 깨진다
 */

const MRN = 'P2026-0001';
const OWNED = '1.2.410.OWNED';
const OTHERS = '1.2.410.SOMEONE-ELSE';

function makeController(mrn = MRN) {
  const svc = { getPatientMrn: vi.fn().mockResolvedValue(mrn) };
  // 나머지 의존성은 이 EP 들이 쓰지 않는다(기존 portal.controller.spec 과 같은 방식)
  const controller = new PortalController(svc as never, ...([undefined, undefined, undefined, undefined, undefined, undefined, { serviceAuthHeaders: async () => ({}) }] as never[]));
  return { controller, svc };
}

/** 본인 study 목록 응답 */
function studiesOk(uids: string[]) {
  return { ok: true, status: 200, json: async () => ({ studies: uids.map((u) => ({ study_instance_uid: u })) }) };
}

/** OpenPACS 실제 응답 모양(2026-10-19 운영 실측) — 시리즈 → 인스턴스 → JPEG 렌더링 */
const isRenderPath = (u: string) => u.includes('/api/v1/dicomweb/') || u.includes('/api/v1/export/');
function pacsChain(url: string, render: () => unknown) {
  if (url.endsWith('/series')) return { ok: true, status: 200, json: async () => ({ series: [{ series_instance_uid: '1.2.S', instance_count: 1 }] }) };
  if (url.endsWith('/instances')) return { ok: true, status: 200, json: async () => ({ instances: [{ orthanc_id: 'orth-1' }] }) };
  return render();
}

function res() {
  const sent: { headers?: Record<string, string>; body?: Buffer } = {};
  return {
    sent,
    set: (h: Record<string, string>) => { sent.headers = h; },
    send: (b: Buffer) => { sent.body = b; },
  };
}

const req = { portalPatientId: 'p-1' } as never;

let origFetch: typeof global.fetch;
beforeEach(() => { origFetch = global.fetch; });
afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks(); });

describe('포털 영상 썸네일 중계 — 본인 검사 스코프를 서버가 강제한다', () => {
  it('🔴 남의 studyUID 로는 썸네일을 주지 않는다(403) — 썸네일 요청 자체가 PACS 로 나가지 않는다', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: never) => {
      calls.push(String(url));
      return studiesOk([OWNED]) as never;
    }) as never;

    const { controller } = makeController();
    await expect(controller.getImagingThumbnail(OTHERS, req, res() as never))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.some(isRenderPath), '소유권 확인 전에 PACS 영상 경로를 부르면 안 된다').toBe(false);
  });

  it('본인 검사면 PACS 바이트를 Content-Type 을 보존해 그대로 넘긴다 · 🔴 대표 영상 = 첫 시리즈 첫 인스턴스 JPEG(URL JSON 을 주는 my-patients EP 아님)', async () => {
    const calls: string[] = [];
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    global.fetch = vi.fn(async (url: never) => {
      if (String(url).includes('/studies?')) return studiesOk([OWNED]) as never;
      calls.push(String(url));
      return pacsChain(String(url), () => ({
        ok: true, status: 200,
        headers: { get: (k: string) => (k === 'content-type' ? 'image/png' : null) },
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      })) as never;
    }) as never;

    const { controller } = makeController();
    const r = res();
    await controller.getImagingThumbnail(OWNED, req, r as never);
    expect(r.sent.headers?.['Content-Type']).toBe('image/png');
    expect(Buffer.from(r.sent.body!)).toEqual(png);
    expect(calls.some((u) => u.includes('/my-patients/'))).toBe(false);
    expect(calls.at(-1)).toMatch(/\/api\/v1\/export\/instance\/orth-1\/jpeg$/);
  });

  it('🔴 PACS 장애는 "썸네일 없음"이 아니라 503(불러오지 못함)이다', async () => {
    global.fetch = vi.fn(async (url: never) => {
      if (String(url).includes('/studies?')) return studiesOk([OWNED]) as never;
      return pacsChain(String(url), () => ({ ok: false, status: 500, headers: { get: () => null } })) as never;
    }) as never;

    const { controller } = makeController();
    await expect(controller.getImagingThumbnail(OWNED, req, res() as never))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('🔴 시리즈가 비었으면(영상 없음) 404 · 시리즈 조회 실패는 503 — 섞지 않는다', async () => {
    const mk = (series: unknown, status = 200) => vi.fn(async (url: never) => {
      if (String(url).includes('/studies?')) return studiesOk([OWNED]) as never;
      if (String(url).endsWith('/series')) return { ok: status === 200, status, json: async () => series } as never;
      throw new Error('여기까지 오면 안 된다');
    }) as never;
    global.fetch = mk({ series: [] });
    await expect(makeController().controller.getImagingThumbnail(OWNED, req, res() as never)).rejects.toBeInstanceOf(NotFoundException);
    global.fetch = mk(null, 502);
    await expect(makeController().controller.getImagingThumbnail(OWNED, req, res() as never)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('썸네일이 진짜 없으면(404) 404 로 말한다 — 장애와 섞지 않는다', async () => {
    global.fetch = vi.fn(async (url: never) => {
      if (String(url).includes('/studies?')) return studiesOk([OWNED]) as never;
      return pacsChain(String(url), () => ({ ok: false, status: 404, headers: { get: () => null } })) as never;
    }) as never;

    const { controller } = makeController();
    await expect(controller.getImagingThumbnail(OWNED, req, res() as never))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('🔴 소유권 검증은 fail-closed — 목록 조회가 실패하면 통과시키지 않는다', async () => {
    // 🔴 목록 조회만 실패시키고 **썸네일은 성공하도록** 둔다. 그래야 fail-open 으로 되돌렸을 때
    //    "이미지가 나가버리는" 것으로 실패한다(둘 다 실패시키면 어느 쪽 이유든 503 이라 구분 불가 —
    //    첫 판이 실제로 그랬고, fail-open 재주입에도 초록이었다).
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: never) => {
      calls.push(String(url));
      if (String(url).includes('/studies?')) return { ok: false, status: 503 } as never;
      return {
        ok: true, status: 200,
        headers: { get: (k: string) => (k === 'content-type' ? 'image/png' : null) },
        arrayBuffer: async () => new ArrayBuffer(4),
      } as never;
    }) as never;

    const { controller } = makeController();
    const r = res();
    await expect(controller.getImagingThumbnail(OWNED, req, r as never))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(r.sent.body, '소유권 확인 실패인데 이미지가 나갔다(fail-open)').toBeUndefined();
    expect(calls.some(isRenderPath), '검증 실패 후 PACS 영상 경로까지 부르면 안 된다').toBe(false);
  });
});

describe('포털 외부 영상 업로드 중계', () => {
  const multipart = { portalPatientId: 'p-1', headers: { 'content-type': 'multipart/form-data; boundary=xyz' } } as never;

  it('🔴 업로드 대상은 서버가 세션에서 정한다 — 브라우저가 준 식별자를 URL 에 쓰지 않는다', async () => {
    let calledUrl = '';
    global.fetch = vi.fn(async (url: never) => {
      calledUrl = String(url);
      return { ok: true, status: 200, text: async () => '{"study_instance_uid":"1.2.3"}' } as never;
    }) as never;

    const { controller, svc } = makeController();
    const out = await controller.uploadImaging(multipart);
    expect(svc.getPatientMrn).toHaveBeenCalledWith('p-1');
    expect(calledUrl).toContain(`/api/v1/patients/${MRN}/upload`);
    expect(out.data).toMatchObject({ study_instance_uid: '1.2.3' });
  });

  it('🔴 PACS 가 실패하면 성공이라 하지 않는다 — 성공 로그는 증거가 아니다', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => '{"detail":"storage full"}' }) as never) as never;
    const { controller } = makeController();
    await expect(controller.uploadImaging(multipart)).rejects.toBeInstanceOf(HttpException);
  });

  it('PACS 에 닿지 못하면 503 — "업로드는 완료되지 않았습니다"', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as never;
    const { controller } = makeController();
    await expect(controller.uploadImaging(multipart)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('multipart 가 아니면 400 — JSON 본문을 영상으로 흘려보내지 않는다', async () => {
    const { controller } = makeController();
    await expect(
      controller.uploadImaging({ portalPatientId: 'p-1', headers: { 'content-type': 'application/json' } } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('판독 PDF — "남의 것"과 "확인 불가"를 갈라 말한다', () => {
  it('본인 것이 아니면 403', async () => {
    global.fetch = vi.fn(async () => studiesOk([OWNED]) as never) as never;
    const { controller } = makeController();
    await expect(controller.getImagingReportPdf(OTHERS, req, '')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('🔴 PACS 조회 실패를 FORBIDDEN 이라 말하지 않는다 — 503(확인 불가)', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 502 }) as never) as never;
    const { controller } = makeController();
    await expect(controller.getImagingReportPdf(OWNED, req, '')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

/**
 * 🔴 코디네이터 회수분(2026-08-18) — **형제 EP 중 한 곳만 빈 배열을 돌려주고 있었다.**
 *
 * `imaging/studies`·`imaging/reports` 는 W9 에서 실패를 503 으로 말하게 바뀌었는데
 * `imaging/notifications` 만 `if (!res.ok) return { data: [] }` 로 남아,
 * 조회 실패가 환자에게 **"새 판독 없음"** 으로 보였다. 같은 개념은 같은 방식으로 실패해야 한다.
 */
describe('판독 알림도 실패를 "없음"으로 말하지 않는다', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/modules/portal/portal.controller.ts'),
    'utf-8',
  );
  // 주석은 옛 코드를 설명할 수 있다 — 코드만 본다
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔴 PACS 조회 실패를 빈 배열로 바꾸지 않는다', () => {
    expect(CODE).not.toMatch(/if \(!res\.ok\) return \{ data: \[\] \}/);
  });

  it('형제 EP 와 같은 사유 코드로 실패한다', () => {
    const block = CODE.slice(CODE.indexOf('getImagingNotifications'));
    expect(block.slice(0, 900)).toContain('PACS_UNAVAILABLE');
  });
});
