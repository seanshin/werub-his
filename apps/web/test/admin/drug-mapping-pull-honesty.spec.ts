/**
 * /admin/drug-mapping — 'ERP 확정분 받기' 결과 정직성(생태계 인바운드 §23 회수 · 2026-09-23)
 *
 * 🔴 서버(`pullConfirmedDrugCodes`)가 `received / updated / rejected / malformed / notFound` 를 갈라 내려도
 *    화면이 `updated` 만 읽으면 종전과 같다(main 에 이미 같은 반쪽이 있었다 — ESS `failure` 를 web 이 안 읽는다).
 *    ① 요약 함수가 분모·갈래를 뒤바꾸지 않는다  ② 화면 소스가 세 갈래를 실제로 읽는다  ③ 문구는 카탈로그에 있다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { tOf } from '@hospital-run/shared';
import { summarizePull } from '../../src/app/(main)/admin/drug-mapping/pull-summary';

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const PAGE = stripComments(readFileSync(resolve(__dirname, '../../src/app/(main)/admin/drug-mapping/page.tsx'), 'utf8'));
const SUMMARY = stripComments(readFileSync(resolve(__dirname, '../../src/app/(main)/admin/drug-mapping/pull-summary.ts'), 'utf8'));

describe('summarizePull — 분모와 미반영 갈래', () => {
  it('🔴 received 5 = updated 1 + rejected 1 + malformed 2 + notFound 1 — 합이 분모와 같다', () => {
    const s = summarizePull({ received: 5, pulled: 3, updated: 1, rejected: ['B:12ab'], malformed: ['D:?', '?:641'], notFound: ['C'] });
    expect(s).toEqual({ denom: 5, updated: 1, rejected: 1, malformed: 2, notFound: 1, unapplied: 4 });
    expect(s.updated + s.unapplied).toBe(s.denom);
  });

  it('🔴 서버가 received 를 안 주면 분모는 null — pulled 로 대신 말하지 않는다(모르는 값은 모른다고)', () => {
    const s = summarizePull({ pulled: 3, updated: 1 });
    expect(s.denom).toBeNull();
    expect(s.unapplied).toBe(0);
  });

  it('reason 이 있으면 "당기지 못한 것" — 0건 반영과 다른 사실', () => {
    const s = summarizePull({ received: 0, pulled: 0, updated: 0, reason: 'ERP_503' });
    expect(s.reason).toBe('ERP_503');
    expect(s.unapplied).toBe(0);
  });
});

describe('화면 소스 — 서버가 가른 갈래를 실제로 읽는다', () => {
  it('🔴 rejected · malformed · notFound 를 화면이 읽는다(updated 만 읽으면 종전과 같다)', () => {
    for (const k of ['rejected', 'malformed', 'notFound']) {
      expect(PAGE, `화면이 서버 응답의 \`${k}\` 를 읽지 않는다`).toMatch(new RegExp(`r\\.${k}\\b`));
    }
    // 분모(received)는 요약 함수가 읽고 화면은 그 결과(denom)를 그린다
    expect(SUMMARY).toMatch(/r\.received\b/);
    expect(PAGE).toContain('summarizePull(');
    expect(PAGE).toContain('s.denom');
    // 종전 반영 수만 말하던 토스트가 되살아나지 않았다
    expect(PAGE).not.toMatch(/ERP 확정 \$\{[^}]*updated\}건 백필/);
  });

  it('🔴 미반영 코드 목록이 토스트가 아니라 화면에 남는다(사라지는 알림은 잔여 작업의 정본 표현이 아니다)', () => {
    expect(PAGE).toContain('data-testid="pull-result"');
    expect(PAGE).toContain('data-testid={`pull-${b.key}`}');
    expect(PAGE).toContain('setLastPull(');
  });

  it('문구는 카탈로그에 있다 — en/ja 미등재(EN× 티) 없음 · 자리표시자가 세 언어에 살아 있다', () => {
    const keys = [
      'ERP 확정 {반영}/{수신}건 백필',
      '미반영 {건수}건 — 형식 거부 {거부} · 키 누락 {누락} · HIS 미존재 {미존재}',
      'ERP 확정코드를 당기지 못했습니다 ({사유})',
      'ERP 확정분 받기 결과',
      '미반영 없음',
      '형식 거부 (보험코드가 8~13자리 숫자가 아님)',
      '키 누락 (ERP 행에 HIS 코드 또는 보험코드가 비어 있음)',
      'HIS 미존재 (그 HIS 코드의 약품이 없음)',
    ];
    for (const k of keys) {
      expect(PAGE, `화면에 없는 키를 등재했다: ${k}`).toContain(k);
      for (const loc of ['en', 'ja', 'ar'] as const) {
        const r = tOf(k, loc);
        expect(r.missing, `${loc} 미등재: ${k}`).toBe(false);
        for (const p of k.match(/\{[^}]+\}/g) ?? []) expect(r.text, `${loc} 번역문에서 자리표시자 ${p} 가 사라졌다`).toContain(p);
      }
    }
  });
});
