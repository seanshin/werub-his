import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 스테이션 검사 완료 범위 계약 (2026-08-13 · 화면 점검 W5).
 *
 * 🔴 종전 `updateMany({ where: { visitId, category, finding: 'PENDING' } })` 는 **같은 분류의
 *    미시행 항목까지 전부** 그 스테이션의 판정으로 마감했다. 판정 기본값은 '정상'이다.
 *    LAB = 채혈실 + 검체실, DIAGNOSTIC = 심전도·폐기능·내시경·안과 이므로:
 *    채혈실이 완료를 찍으면 **채취조차 안 한 소변검사가 '정상 · 완료'**,
 *    심전도실이 찍으면 **위내시경이 '정상'** 으로 결과지에 인쇄된다.
 *    시행하지 않은 검사를 정상이라 말하면 병변은 다음 검진(1년 뒤)까지 발견되지 않는다.
 */
const SRC = join(process.cwd(), 'src/modules/checkup/checkup-station.service.ts');
const WEB = join(process.cwd(), '../web/src/app/(main)/his-checkup/ws/components');

describe('스테이션 완료 — 시행한 검사만 마감', () => {
  const svc = readFileSync(SRC, 'utf-8');
  const start = svc.indexOf('async complete(');
  const body = svc.slice(start, svc.indexOf('\n  async ', start + 10));

  it('🔴 category 만으로 일괄 마감하지 않는다 — testName 범위가 있어야 한다', () => {
    const update = body.slice(body.indexOf('checkupResultItem.updateMany'));
    expect(update, 'testName 범위 없이 category 로 일괄 마감하면 미시행 검사가 정상이 된다').toContain('testName');
  });

  it('🔴 범위가 비면 결과 항목을 건드리지 않는다 — 서버가 추측하면 날조가 된다', () => {
    expect(body).toMatch(/scopedNames\.length > 0/);
    expect(body).toMatch(/itemsUpdated/);
  });

  it('화면은 시행한 검사를 명시해 보낸다(기본 전체선택 금지)', () => {
    const form = readFileSync(join(WEB, 'DynamicStationForm.tsx'), 'utf-8');
    expect(form).toContain('testNames');
    expect(form, '기본값으로 전체를 고르면 사람이 밝히는 사실이 아니게 된다').toMatch(/useState<string\[\]>\(\[\]\)/);
    const page = readFileSync(join(WEB, 'StationPage.tsx'), 'utf-8');
    expect(page).toContain('testNames: body.testNames');
    // 환자가 바뀌면 폼이 초기화돼야 한다 — 입력값이 다른 환자에게 전송되던 결함
    expect(page).toContain('key={activeVisitId');
  });
});
