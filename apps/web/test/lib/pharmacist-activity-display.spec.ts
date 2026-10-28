import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 약사 임상활동 화면 표시 가드 — 이연 회수(2026-08-18).
 *
 * 서버가 중재·TDM 을 DB 로 영속화하면서 **정직해진 값**을 내보내기 시작했는데,
 * 화면이 그것을 옛 방식으로 번역하면 거짓말이 화면에서 되살아난다:
 *  · `acceptanceRate: null`(처리된 중재 없음 = 산출 불가) → `?? 0` 이면 **"수락률 0%"**
 *    = "의사가 약사 중재를 하나도 안 받는다"는 다른 사실이 된다.
 *  · 빈 목표범위를 `Number('') = 0` 으로 보내면 서버가 **실제 목표 0** 으로 저장한다.
 *  · 서버에 수락/거절 EP 가 있는데 부르는 화면이 없으면 모든 중재가 PENDING 으로 남는다
 *    (**EP 를 만들면 부르는 화면까지가 한 벌**).
 */

const PAGE = join(process.cwd(), 'src', 'app', '(main)', 'pharmacist-activity', 'page.tsx');
const src = readFileSync(PAGE, 'utf8');

describe('약사 활동 화면은 서버의 "산출 불가"를 0 으로 접지 않는다', () => {
  it('🔴 수락률을 `?? 0` 으로 번역하지 않는다', () => {
    expect(src).not.toMatch(/acceptanceRate\s*\?\?\s*0/);
    expect(src).toContain('산출 불가');
  });

  it('수락률의 분모(처리 건수)를 함께 보여준다', () => {
    expect(src).toMatch(/decided/);
  });
});

describe('미입력을 0 으로 보내지 않는다', () => {
  it('🔴 TDM 목표범위가 비면 전송하지 않는다', () => {
    expect(src).not.toMatch(/targetRangeMin:\s*Number\(tdmReqForm\.targetRangeMin\)/);
    expect(src).toMatch(/targetRangeMin:\s*tdmReqForm\.targetRangeMin === ''\s*\?\s*undefined/);
  });
});

describe('중재 회신 경로가 화면에 있다', () => {
  it('🔴 수락/거절이 서버 EP 를 부른다 — 없으면 모든 중재가 영구 PENDING 이다', () => {
    expect(src).toMatch(/apiClient\.patch\(`\/api\/v1\/pharmacist\/interventions\/\$\{id\}`/);
    expect(src).toContain("'ACCEPTED'");
    expect(src).toContain("'REJECTED'");
  });
});

describe('상태·유형 라벨이 서버 어휘를 덮는다', () => {
  it('🔴 ROUTE 유형이 빈 배지로 새지 않는다', () => {
    // 2026-09-30 — 유형 라벨은 의사 회신 화면(/pharmacist-replies)과 공유하는 정본 하나로 옮겼다(P12 방지)
    const canon = readFileSync(join(process.cwd(), 'src', 'lib', 'pharmacist-intervention.ts'), 'utf8');
    expect(canon).toMatch(/ROUTE:\s*'투여경로'/);
    expect(src).toMatch(/const TYPE_LABEL = INTERVENTION_TYPE_LABEL;/);
  });

  it('모르는 유형은 원문을 보여준다(무채색으로 삼키지 않는다)', () => {
    expect(src).toMatch(/TYPE_LABEL\[intv\.type\]\s*\?\?\s*intv\.type/);
  });
});
