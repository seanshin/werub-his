/**
 * /admin/erp 「연동 모니터(outbox)」 — 서버가 말하는 보류 사실을 화면이 읽는다
 *
 * 🔴 서버 `integration-outbox.service.ts adminStats()` 는 `mode`·`outboundHeldByMode` 를 **이미 돌려주고 있었는데**
 *    화면의 `OutboxStats` 타입이 두 필드를 빠뜨려 한 번도 그려지지 않았다 — 리허설에서 보류된 PENDING 이
 *    화면에선 그냥 "밀려 있음"으로 읽혔다(P11 FE↔서버 계약 불일치 · 서버는 말하는데 화면이 안 읽는다).
 *
 *  ① 서버가 두 필드를 내려준다(계약의 반대편 — 화면만 고치고 서버가 바뀌면 이 가드가 알린다)
 *  ② 화면 소스가 두 필드를 **실제로 읽고** 모드 라벨은 shared `HIS_MODE_META` 정본에서 가져온다
 *  ③ 기준 주소 placeholder 는 호스트까지만이고, 경로가 들어갔을 때 경고가 있다(코드가 `/api/v1/…` 를 붙인다)
 *  ④ 문구는 카탈로그에 있고 자리표시자가 세 언어에 살아 있다
 *
 * 재주입: 화면에서 `outboundHeldByMode` 를 지우면 ②가, placeholder 를 `https://erp.example/api/...` 로 되돌리면 ③이 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { tOf } from '@hospital-run/shared';

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const PAGE = stripComments(readFileSync(resolve(__dirname, '../../src/app/(main)/admin/erp/page.tsx'), 'utf8'));
const SERVER = stripComments(readFileSync(resolve(__dirname, '../../../api/src/modules/integration/integration-outbox.service.ts'), 'utf8'));

describe('① 서버 계약 — adminStats 가 보류 사실을 내려준다', () => {
  it('adminStats() 반환에 mode · outboundHeldByMode 가 있다(화면이 읽을 것이 실제로 있다)', () => {
    const start = SERVER.indexOf('async adminStats()');
    expect(start, 'adminStats 를 찾지 못했다').toBeGreaterThan(-1);
    const body = SERVER.slice(start, SERVER.indexOf('async retryFailed('));
    expect(body).toMatch(/outboundHeldByMode\s*[,}]/);
    expect(body).toMatch(/\bmode\s*[,}]/);
  });
});

describe('② 화면 소스 — 서버가 말하는 보류 사실을 실제로 읽는다', () => {
  it('🔴 OutboxStats 타입과 렌더가 outboundHeldByMode · mode 를 읽는다', () => {
    expect(PAGE).toMatch(/outboundHeldByMode\?:\s*boolean/);
    expect(PAGE).toMatch(/mode\?:\s*HisMode/);
    expect(PAGE).toMatch(/outbox\?\.outboundHeldByMode/);
    expect(PAGE).toContain('data-testid="outbox-held-by-mode"');
  });

  it('모드 라벨은 shared HIS_MODE_META 정본에서 온다(화면이 모드 이름을 지어내지 않는다)', () => {
    expect(PAGE).toMatch(/import \{[^}]*\bHIS_MODE_META\b[^}]*\} from '@hospital-run\/shared'/);
    expect(PAGE).toMatch(/HIS_MODE_META\[outbox\.mode\]/);
  });

  it('PENDING 건수는 서버 byStatus 에서 읽는다(화면이 세지 않는다)', () => {
    expect(PAGE).toMatch(/outbox\.byStatus\.PENDING/);
  });
});

describe('③ 기준 주소 — 호스트까지만, 경로가 들어가면 경고', () => {
  it('🔴 placeholder 가 경로를 담지 않는다(경로는 코드가 붙인다)', () => {
    const m = PAGE.match(/value=\{webhookUrl\}[^\n]*placeholder="([^"]+)"/);
    expect(m, 'webhookUrl 입력의 placeholder 를 찾지 못했다').toBeTruthy();
    expect(new URL(m![1]).pathname.replace(/\/+$/, '')).toBe('');
  });

  it('경로가 들어갔을 때 경고가 있고, URL 이 아니면 경고를 지어내지 않는다', () => {
    expect(PAGE).toContain('data-testid="webhook-base-path-warning"');
    expect(PAGE).toMatch(/function webhookBaseHasPath\(/);
    expect(PAGE).toMatch(/catch \{ return false; \}/);
  });
});

describe('④ 문구는 카탈로그에 있다 — en/ja/ar 미등재 없음 · 자리표시자 보존', () => {
  const keys = [
    '{mode} 모드 — 대외 발송 보류 중: PENDING {count}건은 밀린 것이 아니라 보내지 않은 것입니다. 실운영으로 전환하면 그대로 나갑니다(보낼지 버릴지는 결정 등록부 ops.rehearsalOutboxAtCutover).',
    '기준 주소는 호스트까지만 적습니다 — 경로는 코드가 붙입니다 (아웃박스 /api/v1/integrations/his/<도메인>/webhook · ESS /api/v1/integration/hr/… · 청구 /api/v1/integration/billing/invoice)',
    '주소에 경로가 들어 있습니다 — 코드가 그 뒤에 /api/v1/… 를 붙이므로, 리버스 프록시 접두어가 아니라면 호스트까지만 적으세요.',
  ];
  it.each(keys)('%s', (k) => {
    expect(PAGE, '화면에 없는 키를 등재했다').toContain(k);
    for (const loc of ['en', 'ja', 'ar'] as const) {
      const r = tOf(k, loc);
      expect(r.missing, `${loc} 미등재`).toBe(false);
      for (const p of k.match(/\{[^}]+\}/g) ?? []) expect(r.text, `${loc} 번역문에서 자리표시자 ${p} 가 사라졌다`).toContain(p);
    }
  });
});
