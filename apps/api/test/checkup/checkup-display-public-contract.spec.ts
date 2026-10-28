import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 검진 대기 TV 보드 — 공개 화면 마스킹 계약 (2026-08-13 · 화면 점검 W5).
 *
 * 🔴 §9 완료 정의: "공개 화면(전광판·포털·디스플레이)은 **마스킹 계약 테스트**를 보유한다."
 *    검진 보드만 이 테스트가 없었고, 그 사이 세 가지가 어긋나 있었다:
 *    ① 보드가 `(main)` 스태프 셸 안에서 렌더돼 **위급값 배너가 실명+MRN 으로** 대기실 TV 에 떴다
 *    ② 인증(PATIENT_VIEW)을 요구해 TV 브라우저에 **스태프 토큰 상주**가 필요했다(전 환자 차트 접근 가능)
 *    ③ 마스킹이 `김*진`(길이 노출)이라 공개 전광판 정본(`홍○동`)과 달랐다 — 정본이 셋이 됐다
 */
const SRC = join(process.cwd(), 'src');
const WEB = join(process.cwd(), '../web/src');

describe('검진 공개 디스플레이 계약', () => {
  const service = readFileSync(join(SRC, 'modules/checkup/checkup.service.ts'), 'utf-8');
  // getDisplayData 메서드 본문만 잘라낸다(다음 메서드 선언 전까지) — 넓게 자르면 남의 코드를 검사한다
  const start = service.indexOf('async getDisplayData()');
  const rest = service.slice(start + 10);
  const end = rest.indexOf('\n  async ');
  const display = end > 0 ? rest.slice(0, end) : rest;

  it('🔴 공개 전광판 마스킹 정본(maskPublicName)을 쓴다 — 로컬 재구현 금지', () => {
    expect(display).toContain('maskPublicName');
    expect(display, "`*` 반복 마스킹은 이름 길이를 노출한다").not.toMatch(/'\*'\.repeat/);
  });

  it('🔴 공개 응답에 환자 식별·임상 정보가 실리지 않는다(필드 화이트리스트)', () => {
    // 이름은 마스킹본만, 성별·상태 원문·결과·소견은 공개 대상이 아니다
    for (const forbidden of ['mrn', 'dateOfBirth', 'finding', 'diagnosis', 'phone']) {
      expect(display, `공개 보드 응답에 ${forbidden} 가 실린다`).not.toContain(`${forbidden}:`);
    }
  });

  it('🔴 보드 화면은 스태프 셸((main)) 밖에 있다 — 셸이 실명 PHI 배너를 함께 띄운다', () => {
    const inMain = join(WEB, 'app/(main)/his-checkup/display/page.tsx');
    let exists = true;
    try { readFileSync(inMain); } catch { exists = false; }
    expect(exists, '공개 TV 보드가 (main) 셸 안에 있으면 위급값 배너·사이드바가 함께 렌더된다').toBe(false);
    // 공개 경로가 실재하고, 인증 클라이언트(apiClient)가 아니라 fetch 를 쓴다
    const board = readFileSync(join(WEB, 'app/display/_boards/CheckupBoard.tsx'), 'utf-8');
    expect(board).toContain('/api/v1/checkup/public/display');
    expect(board, '공개 보드는 인증 클라이언트를 쓰지 않는다').not.toContain('apiClient');
  });

  it('미접수(checkedInAt 없음)를 0분으로 말하지 않는다', () => {
    expect(display).toMatch(/waitMinutes:[^,]*: null/);
  });
});
