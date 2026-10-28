import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **관리자 전용 쓰기 버튼을 임상 직군에게 띄우지 않는다** (2026-08-30 · 발굴 22회차).
 *
 * 마스터·거버넌스 화면 5개는 nav 를 임상 직군에게 열어 두고(목록 조회는 그들 업무다)
 * **쓰기 EP 만 `@Roles(ADMIN)`** 인 구조인데, 화면이 그 버튼을 그대로 그렸다.
 * 운영 실측(의사 계정): `/consent/templates` 목록 200 · 생성/버전이력/언어설정 **403**.
 *
 * 🔴 **성격에 따라 처방이 갈린다**(§규약 5):
 *   · 주 조회까지 403 → **nav 에서 뺀다**(검진 문진표·프로그램, 21회차)
 *   · 조회는 되고 쓰기만 403 → **nav 는 두고 쓰기 UI 만 숨긴다**(이 가드)
 *
 * 판정은 `useAdminWrite()` 하나다 — 다섯 화면이 각자 `role === 'ADMIN'` 을 적으면 갈라진다.
 */
const web = (p: string) => readFileSync(join(process.cwd(), '..', 'web', 'src', p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCREENS = [
  ['app/(main)/consent/templates/page.tsx', '동의서 서식'],
  ['app/(main)/admin/gld/page.tsx', '거버넌스'],
  ['app/(main)/admin/order-sets/page.tsx', '오더세트'],
  ['app/(main)/admin/treatment-templates/page.tsx', '처치 템플릿'],
  ['app/(main)/admin/triage/page.tsx', '트리아지 마스터'],
] as const;

describe('🔴 마스터 화면의 관리자 전용 쓰기 UI 가 판정 정본을 쓴다', () => {
  it('판정 정본이 하나다 — 화면이 각자 적으면 갈라진다', () => {
    const hook = web('hooks/use-admin-write.ts');
    expect(hook).toMatch(/export function useAdminWrite\(\)/);
    expect(hook).toMatch(/=== 'ADMIN'/);
  });

  for (const [p, label] of SCREENS) {
    it(`${label} — 정본 훅을 쓰고, 자기 손으로 역할을 비교하지 않는다`, () => {
      const s = web(p);
      expect(s, '정본 훅 미사용').toMatch(/useAdminWrite\(\)/);
      expect(s, "화면이 직접 role === 'ADMIN' 을 적었다(정본이 둘이 된다)")
        .not.toMatch(/\?\.role\s*===\s*'ADMIN'/);
    });
  }

  it('🔴 동의서 서식 — 편집·생성은 숨기고 미리보기는 남긴다(조회는 임상 업무다)', () => {
    const s = web('app/(main)/consent/templates/page.tsx');
    expect(s).toMatch(/canWrite && <button onClick=\{\(\) => startEdit\(t\)\}/);
    expect(s, '미리보기까지 숨겼다 — 조회 가치를 없애면 nav 에 둘 이유가 없다')
      .toMatch(/setMode\('preview'\)[\s\S]{0,120}미리보기/);
    expect(s, '왜 버튼이 없는지 말하지 않으면 "기능이 없다"로 읽힌다').toMatch(/adminWriteNotice/);
  });

  it('🔴 거버넌스 — 위원회·정책·봉인은 숨기고 회의 등록은 남긴다(서버가 임상에 열어 둔 자리)', () => {
    const s = web('app/(main)/admin/gld/page.tsx');
    // 위원 추가는 select 2개와 함께 있어 감싼 <div> 를 막았다 — 가드는 실제 모양을 검사한다
    expect(s).toMatch(/canWrite && <div className="flex gap-1\.5">/);
    expect(s).toMatch(/canWrite && <button onClick=\{\(\) => delMut\.mutate\(m\.id\)\}/);
    expect(s).toMatch(/canWrite && <button onClick=\{\(\) => \{ if \(confirm\('의사록을 봉인/);
    // 대조군: 회의 등록 버튼은 canWrite 로 감싸지 않았다(서버가 DOCTOR·NURSE 에 열어 둔 자리)
    /**
     * 🔴 라벨 리터럴로 버튼을 찾지 않는다 — i18n 라운드에서 `+ 등록` 이 `+ <T k="등록" />` 이 되며
     *    이 가드가 **조용히 대상을 잃었다**(2026-09-08 발견). 동작(핸들러·폼 필드)으로 찾는다.
     */
    const meetingBtn = s.split('\n').find(
      (l) => l.includes('createMut.mutate()') && l.includes('form.scheduledAt'),
    );
    expect(meetingBtn, '회의 등록 버튼을 찾지 못했다 — 화면이 바뀌었으면 이 가드를 고친다').toBeTruthy();
    expect(meetingBtn!, '회의 등록까지 숨겼다 — 서버는 DOCTOR·NURSE 에 열려 있다').not.toMatch(/canWrite/);
  });

  it('🔴 트리아지 — 삭제만 숨긴다(등록·수정은 서버가 임상에 열어 둔 자리)', () => {
    const s = web('app/(main)/admin/triage/page.tsx');
    expect((s.match(/canWrite && <button onClick=\{\(\) => deleteMut\.mutate/g) ?? []).length).toBe(3);
    expect(s, '편집 버튼까지 숨겼다').toMatch(/<button onClick=\{\(\) => startEdit\(s\)\}/);
  });

  it('스캔이 실제로 파일을 읽었다(대조군)', () => {
    for (const [p] of SCREENS) expect(web(p).length).toBeGreaterThan(2000);
  });
});
