import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 '미완료 차트' 위젯 (2026-08-26 실측 · P0)
 *  ① 재개 링크에 `encounterId` 가 없어 **기존 DRAFT 를 잇지 못하고 새 DRAFT 를 또 만들었다**
 *     (빈 DRAFT 누적 → purge 크론이 사후에 덮고 있었다)
 *  ② 응답을 `as any` 로 두 모양 다 받아, 계약이 바뀌어도 **조용히 빈 목록**이 됐다
 *  ③ 조회 실패가 "없음"으로 읽혔다
 */
const W = join(process.cwd(), 'src/app/(main)/dashboard/components/widgets/DraftChartsWidget.tsx');

describe('미완료 차트 위젯', () => {
  const src = readFileSync(W, 'utf8');

  it('🔴 재개 링크가 encounterId 를 넘긴다(새 DRAFT 를 만들지 않는다)', () => {
    expect(src).toMatch(/encounter\/new\?encounterId=\$\{enc\.id\}/);
  });

  it('응답을 한 모양으로만 읽는다(as any 두 갈래 금지)', () => {
    expect(src).not.toMatch(/as any\)\?\.data/);
    expect(src).toContain('data?.data ?? []');
  });

  it('🔴 조회 실패를 "없음"으로 말하지 않는다', () => {
    expect(src).toContain('isError');
    expect(src).toContain('불러오지 못했습니다');
  });

  it('대조군 — 진짜 0건일 때는 "없음"이라고 말한다', () => {
    expect(src).toContain('없음');
  });

  it('서버에 내 것만 요청한다(mine=true·status=DRAFT)', () => {
    expect(src).toContain('status=DRAFT');
    expect(src).toContain('mine=true');
  });
});
