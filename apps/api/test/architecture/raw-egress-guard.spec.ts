import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { EgressBlockedError } from '../../src/common/util/safe-fetch';
import { aiEgressFetch } from '../../src/common/util/ai-egress-fetch';
import { SttChunkClient } from '../../src/modules/voice-emr/stt-chunk.client';
import { IntegrationOutboxService } from '../../src/modules/integration/integration-outbox.service';
import { ErpEapprovalService } from '../../src/modules/clinic-integration/erp-eapproval.service';
import { TranslationService } from '../../src/modules/i18n/translation.service';
import { ClinicApiService } from '../../src/modules/clinic-integration/clinic-api.service';
import { HospitalInfoService } from '../../src/modules/hospital-info/hospital-info.service';
import { TwinController } from '../../src/modules/twin/twin.controller';

/**
 * G3 가드 — 외부로 나가는 호출은 정본(`safeFetch` / `aiEgressFetch`)을 통과한다.
 *
 * 이 스펙이 굳히는 사실:
 *  ① `src/modules/**` 의 **raw `fetch(` 지점 수를 파일별 정확값으로 동결**한다.
 *     허용 목록은 정확한 파일 경로 + 정확한 개수뿐이다 — 패턴(디렉터리·와일드카드) 금지.
 *     🔴 여유를 두면 신규 위반을 조용히 흡수한다(2026-08-19 UI 축에서 실제로 일어났다).
 *  ② 옮긴 지점에서 **차단(EgressBlockedError)이 성공으로 둔갑하지 않는다** —
 *     나가지 않았고(fetch 미호출), 성공 기록도 남지 않는다.
 *
 * 재주입 검증(2026-08-20 실행): 아래 셋을 실제로 넣었을 때 이 스펙이 실패하는 것을 확인했다.
 *   (1) `aiEgressFetch` → raw `fetch` 복귀(stt-chunk) → ①·② 동시 실패
 *   (2) 차단을 빈 결과로 삼킴(`testWebhook` 이 `{ ok: true }` 반환) → ② 실패
 *   (3) 허용 목록을 패턴(`startsWith('src/modules/portal/')`)으로 완화 → ① 이 신규 위반을 흡수 → 재주입 실패 감지 못함
 *       → 그래서 이 파일은 **정확 경로·정확 개수**만 쓴다.
 */

// ── ① 구조 가드: raw 아웃바운드 호출 기준선(2026-08-20 실측 동결) ──────────────
//
// 세는 규칙: 전역 `fetch(` 호출만(선행 문자가 식별자/`.` 가 아닌 소문자 fetch).
//   → `safeFetch(` · `aiEgressFetch(` · `this.sttFetch(` · `this.aiFetch(` 등 래퍼는 대문자 F 라 제외된다.
// 남아 있는 것들은 "고쳐야 할 목록"이지 "괜찮다는 뜻"이 아니다. 분류는 각 항목 주석 참조.
const RAW_FETCH_BASELINE: Record<string, number> = {
  // (나) 내부 목적지 — 원내/loopback. safeFetch 로 옮기면 기능이 죽는다(사설 대역 차단).
  'src/modules/pacs-proxy/pacs-proxy.service.ts': 3, // OPENPACS_API_URL 기본 http://127.0.0.1:8000
  'src/modules/portal/portal.controller.ts': 6, // PACS_API_URL 기본 http://127.0.0.1:8000
  // 2026-09-28 r1 #15-2: 소유 확인 조회를 정본으로 **옮겼다**(7→6 · 새 파일 +1 · 총수 불변 — 새 발신 아님).
  //   선택 내보내기가 export 토큰으로 따로 부르던 소유 조회는 이 정본을 지난다(pacs-export 의 pacsFetch 는 그대로).
  'src/modules/portal/pacs-study-ownership.ts': 1, // 동일 PACS(PACS_API_URL)
  'src/modules/portal/pacs-export.service.ts': 1, // 동일 PACS
  'src/modules/document/document.service.ts': 1, // PDF_SERVICE_URL 기본 http://localhost:3505
  // (나-3) 원격진료 녹화 서버 프록시(외부 점검). 목적지 `TELEHEALTH_RECORDINGS_URL` 는 **원내 Jitsi 부가 API**
  //   (웹이 동일 출처 `/meet-api` 로 부르던 그 서비스)라 safeFetch 로 옮기면 사설대역 차단에 걸려 기능이 죽는다.
  //   🔴 이 한 줄은 **새 발신이 아니라 자리 이동**이다 — 종전에는 브라우저 번들에 박힌 API 키로 브라우저가 직접 불렀고
  //      (이 가드의 관측 밖), 그 호출과 키를 서버로 옮긴 것이다. 프록시 없이 이 수만 올리면 완화다 — 짝 스펙
  //      `test/telehealth/recordings-proxy.spec.ts` 가 화면에서 키·직접 호출이 사라졌음을 함께 못박는다.
  //   등재: shared `EGRESS_ROUTES` `telehealth.recordings`.
  'src/modules/telehealth/telehealth-recordings.service.ts': 1,
  // (나-2) ERP — 목적지가 **실측상 루프백**이다. 운영 설정 `erp.webhookUrl=http://localhost:8001`
  //   (docs/05-reference/his-reply-esign6-roundtrip-ready.md · dev-simulation-production-switchover.md).
  //   safeFetch 로 옮기면 사설대역 차단에 걸려 ERP 연동이 통째로 죽는다 → 이관하지 않는다.
  //   🔴 운영 ERP 를 외부 URL 로 교체하는 날, 이 3파일은 safeFetch 이관 대상이 된다(잔여 백로그).
  'src/modules/ess/ess.service.ts': 3, // erp.webhookUrl(DB) — 급여·연차·증명서 PDF
  'src/modules/billing/billing.service.ts': 2, // erp.webhookUrl(DB) — invoice pull·확정약가 pull
  'src/modules/portal/portal.service.ts': 1, // erp.webhookUrl(DB) — 입원 중간정산
  // (라) 정본 자체는 여기 없다 — 2026-08-20 medical-ai 수렴으로 `src/modules/**` 의 AI raw fetch 는 0 이 됐다.
  //     실제로 나가는 한 줄은 `src/common/util/ai-egress-fetch.ts` 하나뿐(그 파일이 정본이다).
};
const RAW_FETCH_TOTAL = 19; // 18 → 19 (2026-09-21 녹화 서버 프록시 · D-27 — 브라우저에 있던 호출이 서버로 옮겨온 것이지 새 발신이 아니다)

const RAW_FETCH_RE = /(?<![A-Za-z0-9_$.])fetch\s*\(/g;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

describe('G3 구조 가드 — raw 아웃바운드 호출 기준선', () => {
  const apiRoot = join(__dirname, '../..');
  const modulesDir = join(apiRoot, 'src/modules');

  const measured: Record<string, number> = {};
  for (const abs of walk(modulesDir)) {
    const rel = abs.slice(apiRoot.length + 1).split('\\').join('/');
    const n = (readFileSync(abs, 'utf8').match(RAW_FETCH_RE) ?? []).length;
    if (n) measured[rel] = n;
  }

  it('새 파일에서 raw fetch 가 생기지 않는다(허용 목록은 정확 경로만)', () => {
    const unexpected = Object.keys(measured).filter((f) => !(f in RAW_FETCH_BASELINE));
    expect(
      unexpected,
      `raw fetch 신규 파일 — safeFetch(외부) 또는 aiEgressFetch(AI 목적지)를 쓰세요:\n${unexpected.join('\n')}`,
    ).toEqual([]);
  });

  it('파일별 raw fetch 수가 기준선과 정확히 같다(늘어도 줄어도 실패 — 줄었으면 기준선을 내린다)', () => {
    for (const [file, expected] of Object.entries(RAW_FETCH_BASELINE)) {
      expect(measured[file] ?? 0, `${file} 의 raw fetch 수`).toBe(expected);
    }
  });

  it('총 raw fetch 수가 동결값과 같다', () => {
    expect(Object.values(measured).reduce((a, b) => a + b, 0)).toBe(RAW_FETCH_TOTAL);
    expect(Object.values(RAW_FETCH_BASELINE).reduce((a, b) => a + b, 0)).toBe(RAW_FETCH_TOTAL);
  });

  it('이관한 모듈은 정본을 import 한다(raw fetch 복귀 시 위 카운트와 함께 이중으로 잡힌다)', () => {
    const canon: Record<string, string> = {
      'src/modules/medical-ai/medical-ai.service.ts': 'ai-egress-fetch', // 2026-08-20 수렴(정본이 둘이던 나머지 한쪽)
      // 2026-08-20 G3 2차(가-2 · env/코드상수 외부 목적지 11지점)
      'src/modules/clinic-integration/clinic-api.service.ts': 'safe-fetch',
      'src/modules/twin/twin.controller.ts': 'safe-fetch',
      'src/modules/hospital-info/hospital-info.service.ts': 'safe-fetch',
      'src/modules/holiday/holiday.service.ts': 'safe-fetch',
      'src/modules/voucher/voucher-email.service.ts': 'safe-fetch',
      'src/modules/voice-emr/stt-chunk.client.ts': 'ai-egress-fetch',
      'src/modules/scribe/scribe-ai.client.ts': 'ai-egress-fetch',
      'src/modules/formulary/formulary.service.ts': 'ai-egress-fetch',
      'src/modules/gld/governance.service.ts': 'ai-egress-fetch',
      'src/modules/voc/voc-ai.service.ts': 'ai-egress-fetch',
      'src/modules/portal/drug-explain.service.ts': 'ai-egress-fetch',
      'src/modules/i18n/translation.service.ts': 'ai-egress-fetch',
      'src/modules/data-quality/data-quality.service.ts': 'ai-egress-fetch',
      'src/modules/concierge/concierge.service.ts': 'ai-egress-fetch',
      'src/modules/integration/integration-outbox.service.ts': 'safe-fetch',
      'src/modules/clinic-integration/erp-eapproval.service.ts': 'safe-fetch',
    };
    for (const [file, util] of Object.entries(canon)) {
      const src = readFileSync(join(apiRoot, file), 'utf8');
      expect(src, `${file} 이 ${util} 정본을 부르지 않습니다`).toContain(`common/util/${util}`);
      expect(measured[file] ?? 0, `${file} 에 raw fetch 가 되살아났습니다`).toBe(0);
    }
  });

  it('SSRF 검증 로직 사본이 다시 생기지 않는다(정본이 둘이면 갈라진다)', () => {
    // 2026-08-20: erp-eapproval 이 safe-fetch 보다 좁은 차단 정규식 사본을 갖고 있었다
    // (100.64/10·IPv6 ULA·fe80: 누락). 사본 판별 = 사설대역 리터럴이 safe-fetch 밖에 있는지.
    const offenders: string[] = [];
    for (const abs of walk(modulesDir)) {
      const src = readFileSync(abs, 'utf8');
      if (/169\.254\.|192\.168\\\.|172\\\.\(1\[6-9\]/.test(src) && /RegExp|\/\^\(/.test(src)) {
        offenders.push(abs.slice(apiRoot.length + 1));
      }
    }
    expect(offenders, `사설대역 차단 정규식은 common/util/safe-fetch 에만 둔다:\n${offenders.join('\n')}`).toEqual([]);
  });
});

// ── ② 행동 가드: 차단이 성공으로 둔갑하지 않는다 ────────────────────────────
describe('G3 행동 가드 — EgressBlockedError 는 성공이 되지 않는다', () => {
  const ALLOWED = 'ai.allowed.example';
  const BLOCKED_URL = 'https://evil.example';
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let prevAllow: string | undefined;

  beforeEach(() => {
    prevAllow = process.env.AI_EGRESS_ALLOWED_HOSTS;
    process.env.AI_EGRESS_ALLOWED_HOSTS = ALLOWED;
    // 실제로 나가면 안 된다 — 나갔는지 자체를 단언한다("보냈다"를 로그로 믿지 않는다).
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: '나가면 안 되는 응답' }),
      text: async () => '나가면 안 되는 응답',
    } as never);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    if (prevAllow === undefined) delete process.env.AI_EGRESS_ALLOWED_HOSTS;
    else process.env.AI_EGRESS_ALLOWED_HOSTS = prevAllow;
  });

  it('aiEgressFetch — 허용 목록 밖 호스트는 fetch 를 부르지 않고 던진다', async () => {
    await expect(
      aiEgressFetch(BLOCKED_URL, '/api/generate', { method: 'POST', body: '{}' }, { client: 'test' }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('VoiceEMR STT — 차단 시 진료 음성이 나가지 않고, 빈 결과로 덮이지 않는다', async () => {
    const config = {
      get: vi.fn(async (k: string) => {
        if (k === 'ai.server.url') return BLOCKED_URL;
        if (k === 'ai.server.gpuKey') return 'sk-test';
        if (k === 'ai.server.enabled') return true;
        if (k === 'ai.server.timeout') return 5000;
        return null;
      }),
    };
    const client = new SttChunkClient(config as never);
    await expect(
      client.sendChunk({ sessionId: 's1', pcm: new Uint8Array([1, 2, 3]), mode: 'final' }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled(); // PCM 이 한 바이트도 나가지 않았다
  });

  it('웹훅 테스트 발송 — 내부망 URL 은 차단되고, 성공(ok:true)·전송 기록으로 남지 않는다', async () => {
    const update = vi.fn();
    const prisma = {
      hisWebhook: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'w1', targetUrl: 'http://127.0.0.1:8042/steal', secret: 's', format: 'JSON',
        }),
        update,
      },
    };
    const svc = new IntegrationOutboxService(prisma as never, { get: vi.fn() } as never);
    const res = await svc.testWebhook('w1');
    expect(res.ok).toBe(false);
    expect((res as { blocked?: boolean }).blocked).toBe(true); // 차단과 상류 실패를 구분해서 말한다
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled(); // lastDeliveryAt = "보냈다"는 기록 — 남기지 않는다
  });

  it('ERP 콜백 URL 검증이 safe-fetch 정본 폭을 갖는다(옛 사본이 통과시키던 대역)', () => {
    const svc = new ErpEapprovalService(
      {} as never,
      {} as never,
      { get: vi.fn().mockReturnValue('') } as never,
    );
    const isSafe = (u: string) => (svc as unknown as { isCallbackUrlSafe(u: string): boolean }).isCallbackUrlSafe(u);
    // 옛 정규식이 통과시키던 것들 — 이제 전부 차단
    expect(isSafe('http://100.64.0.1/cb')).toBe(false); // CGNAT
    expect(isSafe('http://[fd00::1]/cb')).toBe(false); // IPv6 ULA
    expect(isSafe('http://[fe80::1]/cb')).toBe(false); // IPv6 link-local
    expect(isSafe('http://[::1]/cb')).toBe(false); // IPv6 loopback(대괄호 표기)
    // 원래도 차단하던 것 · 정상 외부
    expect(isSafe('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafe('https://erp.example.com/cb')).toBe(true);
  });

  it('번역 — 차단이 "번역 성공"으로 둔갑하지 않는다(원문 + fallback 표기)', async () => {
    const prisma = {
      systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'ai.server.url', value: BLOCKED_URL }]) },
      translation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    };
    const svc = new TranslationService(prisma as never, { get: vi.fn().mockReturnValue('') } as never);
    const out = await svc.translate('심근경색', 'en');
    expect(out.fallback).toBe(true); // 번역했다고 말하지 않는다
    expect(out.translated).toBe('심근경색'); // 지어낸 번역문이 아니라 원문
    expect(prisma.translation.create).not.toHaveBeenCalled(); // 캐시에 가짜를 적지 않는다
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── ③ 행동 가드(2026-08-20 G3 2차 이관분) — 차단이 "성공"·"조용한 실패"가 되지 않는다 ──────
//
// 재주입 검증(실행함):
//   (a) clinic-api 를 raw `fetch` 로 되돌림 → ①(카운트·canon) + 아래 clinic 테스트 동시 실패
//   (b) voucher-email 의 차단 분기를 지우고 SIMULATION 폴백으로 되돌림 → '모의 발송'이 되어 실패
//   (c) twin 의 차단 로그를 지움 → "카드 없음"이 장애와 구분되지 않아 실패
//   (d) RAW_FETCH_TOTAL 을 18 → 25 로 여유를 둠 → ①의 총합 단언이 실패(여유 금지 재확인)
describe('G3 행동 가드 2차 — env/코드상수 외부 목적지 이관분', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ valid: true, user: { email: '나가면 안 됨' }, id: 'sent' }),
      text: async () => 'ok',
    } as never);
    errSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    errSpy.mockRestore();
    vi.restoreAllMocks();
  });

  const blockedMsgs = () => errSpy.mock.calls.map((c) => String(c[0])).join('\n');

  it('Clinic 알림 — CLINIC_API_URL 이 내부망이면 나가지 않고 BAD_GATEWAY 로 실패한다', async () => {
    const config = { get: vi.fn((k: string, d?: string) => (k === 'CLINIC_API_URL' ? 'http://127.0.0.1:9999' : (d ?? 'x'))) };
    const svc = new ClinicApiService(config as never);
    await expect(
      svc.sendNotification({ recipients: ['u1'], title: '위급', message: '환자 상태' }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled(); // PHI 를 담은 알림이 한 바이트도 나가지 않았다
    expect(blockedMsgs()).toMatch(/차단/); // 조용히 삼키지 않는다
  });

  it('Clinic SSO — 차단은 "검증 성공"이 되지 않는다(null = 로그인 거부, fail-closed)', async () => {
    const config = { get: vi.fn((k: string, d?: string) => (k === 'CLINIC_API_URL' ? 'http://169.254.169.254' : (d ?? 'x'))) };
    const svc = new ClinicApiService(config as never);
    const user = await svc.verifySsoToken('tok-abcdefgh');
    expect(user).toBeNull(); // mock fetch 는 valid:true 를 주지만 거기까지 가지 못한다
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(blockedMsgs()).toMatch(/차단/);
  });

  it('홈페이지 revalidate — 차단이 "반영 성공"으로 둔갑하지 않고 원인을 구분해 말한다', async () => {
    const config = {
      get: vi.fn((k: string) =>
        k === 'HOMEPAGE_PUBLIC_URL' ? 'http://10.0.0.5' : k === 'HOMEPAGE_REVALIDATE_SECRET' ? 'sec' : ''),
    };
    const svc = new HospitalInfoService({} as never, config as never);
    await expect(svc.revalidateHomepage({ all: true })).rejects.toThrow(/차단/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('트윈 CDS — 차단 시 카드는 비지만, "위험 없음"과 구분되게 원장에 남는다', async () => {
    const config = {
      get: vi.fn((k: string) =>
        k === 'TWIN_LAUNCH_SECRET' ? 'sec' : k === 'TWIN_BASE_URL' ? 'http://127.0.0.1:8080' : ''),
    };
    const prisma = {
      patientAiConsent: { findUnique: vi.fn().mockResolvedValue({ consented: true, revokedAt: null }) },
    };
    const ctrl = new TwinController(config as never, prisma as never, {} as never, {} as never);
    const out = await ctrl.cdsPatientView('11111111-1111-4111-8111-111111111111');
    expect(out.data.cards).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled(); // PHI(patientId) 가 나가지 않았다
    expect(blockedMsgs()).toMatch(/차단/); // 침묵하면 장애와 구분되지 않는다
  });

});
