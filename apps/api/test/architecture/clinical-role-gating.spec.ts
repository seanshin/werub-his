import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **임상 화면이 "그 행위를 하는 직군"에만 버튼을 그린다** (2026-08-30 · 발굴 23회차).
 *
 * 서버는 직군을 정확히 갈라 두었는데(항암 사이클 시작=처방 · 협진 회신=의사 소견 ·
 * 병리 서명=병리의) 화면이 그 구분 없이 버튼을 그려, 간호사·약사·검사기사가
 * 누를 때마다 403 이었다. 더 나쁜 것은 **검사기사가 진단 서명을 할 수 있는 것처럼**
 * 보였다는 점이다(화면이 갖지 않은 권한을 가진 척한다).
 *
 * 🔴 반대로 **여는 것이 답인 자리도 있었다** — ICU 중증도 점수(APACHE·SOFA)는
 *    기록된 값에서 산출할 뿐이고 중환자실 간호사의 일상 업무라 서버를 열었다.
 *    성격을 구분한다: 판단·서명은 닫고, 산출·조회는 연다.
 */
const api = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const web = (p: string) => readFileSync(join(process.cwd(), '..', 'web', 'src', p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const after = (s: string, anchor: string, len = 260) => {
  const i = s.indexOf(anchor);
  expect(i, `${anchor} 를 찾지 못했다 — 코드가 옮겨졌으면 이 가드를 고친다`).toBeGreaterThan(-1);
  return s.slice(i, i + len);
};

describe('🔴 ICU 중증도 점수는 간호사 업무다 — 서버를 열었다', () => {
  const ICU = api('icu/icu.controller.ts');
  for (const h of ["@Get(':id/apache')", "@Get(':id/sofa')"]) {
    it(`${h} — 간호사가 산출할 수 있다`, () => {
      expect(after(ICU, h)).toMatch(/UserRole\.NURSE/);
    });
  }
  it('🔴 퇴실 결정은 열지 않았다(대조군 — 산출과 판단은 다르다)', () => {
    expect(after(ICU, "@Patch(':id/discharge')"), 'ICU 퇴실까지 열렸다').not.toMatch(/UserRole\.NURSE/);
  });
  it('화면도 퇴실 버튼을 의사에게만 그린다', () => {
    expect(web('app/(main)/icu/page.tsx')).toMatch(/canDischarge && <button/);
  });
});

describe('🔴 판단·서명 버튼을 그 직군에만 그린다', () => {
  it('항암 — 사이클 시작·지연·코스는 의사, 완료만 간호사(서버 구분 그대로)', () => {
    const s = web('app/(main)/chemo/page.tsx');
    expect(s).toMatch(/const canOrder = useHasRole\('DOCTOR'\)/);
    expect(s).toMatch(/const canComplete = useHasRole\('DOCTOR', 'NURSE'\)/);
    expect(s).toMatch(/canOrder && <button onClick=\{\(\) => start\.mutate/);
    expect(s).toMatch(/canComplete && <button onClick=\{\(\) => complete\.mutate/);
    expect(s, '레지멘 마스터는 의사·약사다').toMatch(/useHasRole\('DOCTOR', 'PHARMACIST'\)/);
  });

  it('협진 — 의뢰·접수·회신·종결과 수신함이 의사 전용이다', () => {
    const s = web('app/(main)/consultations/page.tsx');
    expect(s).toMatch(/const canAct = useHasRole\('DOCTOR'\)/);
    expect(s, '수신함 조회까지 막아야 한다(EP 가 의사 전용)').toMatch(/enabled: canAct/);
    expect(s).toMatch(/canAct && c\.status === 'REQUESTED'/);
  });

  it('병리 — 판독 작성·서명은 병리의만(서버가 "검사기사 서명 금지"라 적어 뒀다)', () => {
    const s = web('app/(main)/pathology/page.tsx');
    expect(s).toMatch(/const canDiagnose = useHasRole\('DOCTOR'\)/);
    expect(s).toMatch(/canDiagnose && selected\.status === 'REPORTED'/);
    expect(api('pathology/pathology.controller.ts'), '서버 가드를 화면 때문에 걷지 않는다')
      .toMatch(/@Post\('reports\/:id\/sign'\)\s*\n\s*@Roles\(UserRole\.DOCTOR, UserRole\.ADMIN\)/);
  });

  it('🔴 검체 접수·처리는 검사기사에게 남겼다(대조군 — 전부 닫은 게 아니다)', () => {
    const s = api('pathology/pathology.controller.ts');
    expect(after(s, "@Patch('specimens/:id/receive')"), '검체 접수까지 의사 전용이 됐다')
      .not.toMatch(/@Roles\(UserRole\.DOCTOR, UserRole\.ADMIN\)/);
  });
});

describe('🔴 치료 워크스테이션 — 없는 EP 를 부르지 않는다', () => {
  const s = web('app/(main)/workstation/therapy/page.tsx');

  it('서버에 없던 두 경로가 사라졌다(운영 실측 404 · 개통 이래 무동작)', () => {
    expect(s, '`med-admin` 은 서버에 존재하지 않는다').not.toMatch(/\/api\/v1\/med-admin/);
    expect(s, '`radiation/today-fractions` 는 세그먼트 순서가 틀렸다').not.toMatch(/radiation\/today-fractions/);
  });

  it('방사선은 실재 경로를 쓴다', () => {
    expect(s).toMatch(/\/api\/v1\/radiation\/fractions\/today/);
  });

  it('🔴 항암은 지어내지 않고 정본 화면으로 보낸다(목록 EP 가 서버에 없다)', () => {
    expect(s).toMatch(/href="\/chemo"/);
  });

  it('서버가 조회부터 막는 탭은 띄우지 않는다', () => {
    expect(s).toMatch(/roles: \['DOCTOR', 'NURSE'\]/);
    expect(s).toMatch(/const stations = TX_STATIONS\.filter/);
  });

  it('🔴 전체 일정·방사선은 모두에게 남겼다(대조군 — 방사선치료사의 본업이다)', () => {
    expect(s).toMatch(/id: 'schedule'[^}]*roles: null/);
    expect(s).toMatch(/id: 'radiation'[^}]*roles: null/);
  });
});

describe('🔴 판정 정본은 하나다', () => {
  it('화면이 직접 역할 문자열을 비교하지 않는다', () => {
    for (const p of ['app/(main)/chemo/page.tsx', 'app/(main)/consultations/page.tsx',
                     'app/(main)/pathology/page.tsx', 'app/(main)/icu/page.tsx']) {
      expect(web(p), `${p} 가 정본 대신 직접 비교한다`).not.toMatch(/\?\.role\s*===\s*'(DOCTOR|NURSE|PHARMACIST|LAB_TECH)'/);
    }
  });
  it('useHasRole 은 ADMIN 을 항상 통과시킨다 — 서버 RolesGuard 와 같은 규칙', () => {
    expect(web('hooks/use-admin-write.ts')).toMatch(/role === 'ADMIN' \|\| roles\.includes\(role\)/);
  });
});
