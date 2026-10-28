/**
 * 스테이션 검사항목(수가코드) 설정 — 고칠 자리가 있어야 "안 맞다"고 말할 수 있다
 *
 * 🔴 검사·영상 워크스테이션 배너가 "이 설정을 고칠 화면은 아직 없습니다 — 시스템 담당자에게 요청"이라 말했고
 *    그 말이 사실이었다(`order_codes` 쓰기 EP 가 기초검사 자리에만 있었다).
 *
 *  ① 서버에 GET/PUT `logical-stations/:stationId/order-codes` 가 있고, 화면이 **그 경로**를 부른다(P11)
 *  ② 관리 화면은 기초검사 자리를 편집 목록에서 뺀다 — 정본 상수 `DIAGNOSTIC_STATION_CATEGORY` 로
 *  ③ 배너는 더 이상 "고칠 화면이 없다"고 말하지 않고 그 자리(/admin/workstations)를 가리킨다
 *  ④ 문구는 카탈로그에 있고 en/ja/ar 에 자리표시자가 살아 있다
 *
 * 재주입: 화면의 경로 세그먼트를 `order-code` 로 바꾸면 ①이, 배너 링크를 지우면 ③이 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { tOf } from '@hospital-run/shared';

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const read = (p: string) => stripComments(readFileSync(resolve(__dirname, p), 'utf8'));
const PAGE = read('../../src/app/(main)/admin/workstations/page.tsx');
const NOTICE = read('../../src/components/workstation/StationConfigNotice.tsx');
const CTRL = read('../../../api/src/modules/workstation-setup/workstation-setup.controller.ts');

describe('① FE↔서버 경로 계약', () => {
  it('서버가 GET·PUT 을 연다', () => {
    expect(CTRL).toMatch(/@Get\('logical-stations\/:stationId\/order-codes'\)/);
    expect(CTRL).toMatch(/@Put\('logical-stations\/:stationId\/order-codes'\)/);
  });
  it('화면이 같은 경로로 조회·저장한다', () => {
    expect(PAGE).toMatch(/apiClient\.get\(`\/api\/v1\/workstation-setup\/logical-stations\/\$\{[^}]+\}\/order-codes`\)/);
    expect(PAGE).toMatch(/apiClient\.put\(`\/api\/v1\/workstation-setup\/logical-stations\/\$\{[^}]+\}\/order-codes`/);
    expect(PAGE).toContain('<StationOrderCodesEditor');
  });
});

describe('② 기초검사 자리는 여기서 편집하지 않는다', () => {
  it('정본 상수로 거른다(문자열 리터럴 아님)', () => {
    expect(PAGE).toMatch(/import \{ DIAGNOSTIC_STATION_CATEGORY \} from '@hospital-run\/shared'/);
    expect(PAGE).toMatch(/category !== DIAGNOSTIC_STATION_CATEGORY/);
  });
});

describe('③ 배너가 고칠 자리를 가리킨다', () => {
  it('"고칠 화면은 아직 없습니다"를 말하지 않는다', () => {
    expect(NOTICE).not.toContain('고칠 화면은 아직 없습니다');
    expect(NOTICE).not.toContain('시스템 담당자에게');
  });
  it('/admin/workstations 링크가 있다', () => {
    expect(NOTICE).toMatch(/<Link href="\/admin\/workstations"/);
  });
  it('대조군 — 미연결(queueWired=false) 안내는 그대로다', () => {
    expect(NOTICE).toContain('이 워크스테이션에는 아직 업무 목록이 연결되지 않았습니다');
  });
});

describe('④ 문구는 카탈로그에 있다', () => {
  const keys = [
    '스테이션 검사항목(수가코드) 설정',
    '검사·영상 워크스테이션 큐가 이 코드로 오더를 거릅니다. 수가 마스터에 없는 코드도 저장은 되지만 큐가 거르지 못하고, 하나도 맞지 않으면 부서 전체를 표시합니다. 기초검사 자리는 기초검사 워크스테이션에서 설정합니다.',
    '스테이션 선택',
    '설정을 불러오지 못했습니다',
    '수가코드를 줄바꿈·쉼표로 구분',
    '마스터 일치 {일치} / 설정 {설정}',
    '하나도 맞지 않아 큐가 부서 전체를 표시하는 중입니다',
    '마스터에 없는 코드(큐가 거르지 못함)',
    '검사항목 설정 저장',
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
