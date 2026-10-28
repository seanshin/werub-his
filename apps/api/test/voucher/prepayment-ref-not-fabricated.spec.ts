import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 선결제 참조번호를 **화면이 지어내지 않는다** (2026-08-27).
 *
 * 🔴 실측으로 나온 것:
 *   · 정책 `prepaymentRequired` 기본값 = **true**
 *   · 서버는 `paymentRef` 존재만으로 `paidAt = new Date()` 를 찍고, **ERP 청구에도 그 시각을 싣는다**
 *   · 그런데 배분 화면 2곳이 값이 비면 `PAY-<Date.now()>` / `SUB-<Date.now()>` 를 **만들어 보냈다**
 *     → 선결제 게이트가 화면에서 자동 우회되고, **결제된 적 없는 거래에 결제완료 시각이 박혔다.**
 *     라벨은 심지어 "선결제 ref(선택)" 이었다 — 서버는 결제 증빙으로 쓰는 값인데.
 *
 * 이 저장소의 세 규칙이 한자리에서 깨져 있었다 —
 *   "화면이 값을 지어내지 않는다"(키오스크 `KIOSK-<ts>` 승인번호와 같은 형태) ·
 *   "가짜 게이트 금지" · "일어난 사실만 기록한다".
 *
 * 재주입: 어느 화면이든 `|| \`PAY-${'$'}{Date.now()}\`` 를 되돌리면 실패한다.
 */
const WEB = path.join(__dirname, '../../../web/src/app');
const read = (rel: string) => fs.readFileSync(path.join(WEB, rel), 'utf-8');

describe('선결제 참조번호 — 화면이 지어내지 않는다', () => {
  const screens: Array<[string, string]> = [
    ['관리자 딜러 배분', '(main)/admin/voucher/distributors/page.tsx'],
    ['딜러 포털 하위배분', 'distributor/page.tsx'],
  ];

  for (const [label, rel] of screens) {
    it(`🔴 ${label} — paymentRef 를 타임스탬프로 만들어 보내지 않는다`, () => {
      const src = read(rel);
      // paymentRef 를 넘기는 자리에 Date.now() 가 섞이면 안 된다(idempotencyKey 는 별개·정당)
      const m = src.match(/paymentRef:\s*[^,]+/g) ?? [];
      expect(m.length, 'paymentRef 를 보내는 자리를 찾지 못했다 — 가드 조준이 빗나갔다').toBeGreaterThan(0);
      for (const line of m) {
        expect(line, `결제 참조번호를 지어내면 결제되지 않은 거래가 결제완료로 기록된다: ${line}`)
          .not.toMatch(/Date\.now\(\)/);
      }
    });
  }

  it('🔴 값이 비면 서버 게이트가 판단하도록 넘기지 않는다(undefined)', () => {
    for (const [, rel] of screens) {
      expect(read(rel)).toMatch(/paymentRef:\s*\w+\.paymentRef\.trim\(\)\s*\|\|\s*undefined/);
    }
  });

  it('🔴 라벨이 "선택"이라 말하지 않는다 — 서버는 결제 증빙으로 쓴다', () => {
    const src = read('(main)/admin/voucher/distributors/page.tsx');
    expect(src).not.toContain('선결제 ref(선택)');
    expect(src).toContain('입력 시 결제완료로 기록됩니다');
  });

  it('서버가 사유를 코드로 말한다(화면이 정확히 옮길 수 있게)', () => {
    const svc = fs.readFileSync(
      path.join(__dirname, '../../src/modules/voucher/voucher-trade.service.ts'), 'utf-8');
    expect(svc).toContain('PREPAYMENT_REF_REQUIRED');
    // 공백만 채워 통과시키는 우회도 막는다
    expect(svc).toMatch(/!dto\.paymentRef\?\.trim\(\)/);
  });
});
