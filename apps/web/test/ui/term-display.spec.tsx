import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TERM_LANG_DEFAULT, TERM_EN_UNREGISTERED, labTermText, portalLabTermText } from '@hospital-run/shared';
import { Term, termTextOf } from '../../src/components/ui/term';
import { DrugName } from '../../src/components/ui/display';
import { useTermLangStore } from '../../src/stores/term-lang-store';

/**
 * 의료용어 한/영 토글 가드 — 기획 medical-term-display-toggle.plan.md P0.
 *
 *  1. 🔴 EN 모드에서 영문명이 없으면 지어내지 않고 '영문명 미등록'을 밝힌다
 *  2. 🔴 기본값은 KO — 저장 없는 사용자 화면이 오늘과 같다
 *  3. 🔴 인쇄/대외 출력물은 토글의 영향권 밖(print 라우트가 스토어를 소비하지 않고,
 *     DrugName bilingual 은 모드와 무관하게 고정 병기)
 *  4. 🔴 미배선 방지 — emr.locale(키만 있고 소비처 0) 선례 재발 금지: 소비처를 센다
 *  5. 어시스턴트 퀵칩 명령이 서버 커맨드에 실재한다(/진단 유령 명령 재발 금지)
 */

const WEB = process.cwd();
const REPO = join(WEB, '..', '..');

describe('termTextOf — 렌더 규칙', () => {
  const pair = { nameKo: '급성 인두염', nameEn: 'Acute pharyngitis' };

  it('모드별 규칙: KO/EN/BOTH', () => {
    expect(termTextOf(pair, 'KO').text).toBe('급성 인두염');
    expect(termTextOf(pair, 'EN').text).toBe('Acute pharyngitis');
    expect(termTextOf(pair, 'BOTH').text).toBe('급성 인두염 (Acute pharyngitis)');
  });

  it('🔴 EN 모드 + 영문명 없음 = 한글 그대로 + enMissing(지어내지 않는다)', () => {
    const r = termTextOf({ nameKo: '급성 인두염', nameEn: null }, 'EN');
    expect(r.text).toBe('급성 인두염');
    expect(r.enMissing).toBe(true);
  });

  it('KO 모드 + 한글 없음 = 있는 언어(영문) 그대로 — 조용한 공백 금지(대조군)', () => {
    const r = termTextOf({ nameKo: '', nameEn: 'WBC' }, 'KO');
    expect(r.text).toBe('WBC');
    expect(r.enMissing).toBe(false);
  });

  it('BOTH 인데 한쪽뿐이면 병기하지 않고 있는 쪽만(빈 괄호를 그리지 않는다)', () => {
    expect(termTextOf({ nameKo: '급성 인두염' }, 'BOTH').text).toBe('급성 인두염');
    expect(termTextOf({ nameEn: 'WBC' }, 'BOTH').text).toBe('WBC');
  });
});

describe('Term / DrugName 컴포넌트', () => {
  it('🔴 기본값은 KO — 스토어 초기 상태가 현행 유지다', () => {
    expect(TERM_LANG_DEFAULT).toBe('KO');
    expect(useTermLangStore.getState().mode).toBe('KO');
  });

  it('🔴 EN 모드에서 영문 미등록이면 미등록 티가 실제로 그려진다', () => {
    useTermLangStore.setState({ mode: 'EN' });
    const { container } = render(<Term nameKo="급성 인두염" nameEn={null} />);
    expect(container.textContent).toContain('급성 인두염');
    expect(container.textContent).toContain('EN×');
    expect(container.querySelector(`[title="${TERM_EN_UNREGISTERED}"]`)).toBeTruthy();
    useTermLangStore.setState({ mode: 'KO' });
  });

  it('🔴 DrugName bilingual(인쇄용)은 모드와 무관하게 고정 병기 — 표기 선호가 대외 문서를 못 바꾼다', () => {
    useTermLangStore.setState({ mode: 'EN' });
    const { container } = render(<DrugName bilingual nameKo="아스피린정" nameEn="Aspirin" />);
    expect(container.textContent).toBe('아스피린정 (Aspirin)');
    useTermLangStore.setState({ mode: 'KO' });
  });

  it('DrugName EN 모드는 상품명→성분→한글+티 순(로마자 변환 없음)', () => {
    useTermLangStore.setState({ mode: 'EN' });
    const byIngredient = render(<DrugName nameKo="타이레놀정" ingredient="Acetaminophen" />);
    expect(byIngredient.container.textContent).toBe('Acetaminophen');
    const noEn = render(<DrugName nameKo="쌍화탕" />);
    expect(noEn.container.textContent).toContain('쌍화탕');
    expect(noEn.container.textContent).toContain('EN×');
    useTermLangStore.setState({ mode: 'KO' });
  });
});

describe('배선·경계', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

  it('🔴 print 라우트는 용어 모드를 소비하지 않는다 — 인쇄물이 사용자 선호에 흔들리면 안 된다', () => {
    const printDir = join(WEB, 'src', 'app', '(main)', 'print');
    expect(existsSync(printDir), 'print 디렉터리가 이동했다 — 가드 경로를 갱신하라').toBe(true);
    const offenders = walk(printDir).filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes('term-lang-store') || src.includes('useTermLang');
    });
    expect(offenders).toEqual([]);
  });

  it('🔴 미배선 방지 — 스토어/부품의 실소비 화면이 있다(emr.locale 선례 재발 금지)', () => {
    const files = walk(join(WEB, 'src'));
    const consumers = files.filter((f) => {
      if (/term-lang-store|components\/ui\/term/.test(f)) return false; // 정본 자신 제외
      const src = readFileSync(f, 'utf8');
      return src.includes("term-lang-store") || src.includes("from '@/components/ui/term'");
    });
    // TopBar 토글·layout 하이드레이션·display(DrugName)·진단 입력·검사 피커 — 5 미만이면 배선이 죽은 것
    expect(consumers.length, `소비처 파일: ${consumers.join(', ')}`).toBeGreaterThanOrEqual(5);
  });

  it('🔴 어시스턴트 명령은 정본 하나 — 화면이 자기 칩 목록을 두지 않는다(/진단 유령 명령 재발 금지)', () => {
    // 2026-10-02 재구성: 칩·팔레트·`/도움` 이 shared `AI_CHAT_COMMANDS` 를 읽고, 서버 분기 ↔ 정본 집합 일치는
    // api `test/medical-ai/ai-chat-assistant.spec.ts` 가 양방향으로 대조한다.
    const bar = readFileSync(join(WEB, 'src', 'components', 'ai', 'AiChatBar.tsx'), 'utf8');
    expect(bar.includes('AI_CHAT_COMMANDS'), '정본을 읽지 않는다 — 가드가 헛돈다').toBe(true);
    const literalChips = [...bar.matchAll(/cmd: '(\/[^\s']+)\s*'/g)].map((m) => m[1]);
    expect(literalChips, `화면에 명령 리터럴 목록이 되살아났다: ${literalChips.join(',')}`).toEqual([]);
  });

  it('🔴 Cmd+K 검색: Enter 가 선택 항목으로 이동한다(닫기만 하던 결함 재발 금지)', () => {
    const src = readFileSync(join(WEB, 'src', 'components', 'layout', 'SmartSearchBar.tsx'), 'utf8');
    const enter = /e\.key === 'Enter' && selectedIdx >= 0[\s\S]{0,200}?router\.push\(results\[selectedIdx\]\.href\)/.test(src);
    expect(enter, 'Enter 선택 이동이 사라졌다').toBe(true);
  });

  it('"어시스턴트에게 묻기" 동선은 EP 허용 역할 게이트 아래에만 있다(403 초대 금지)', () => {
    const src = readFileSync(join(WEB, 'src', 'components', 'layout', 'SmartSearchBar.tsx'), 'utf8');
    expect(src.includes('어시스턴트에게 묻기'), '묻기 동선이 없다').toBe(true);
    expect(src.includes('canUseAiChat'), '역할 게이트가 없다').toBe(true);
  });

  it('🔴 검색 정본은 한 벌 — TopBar 는 SmartSearchBar 를 열기만 하고 자체 검색을 갖지 않는다(P1)', () => {
    const top = readFileSync(join(WEB, 'src', 'components', 'layout', 'TopBar.tsx'), 'utf8');
    expect(top.includes('useSmartSearchStore'), 'TopBar 가 통합검색을 열지 못한다').toBe(true);
    expect(top.includes('/api/v1/codes/'), 'TopBar 에 자체 검색 구현이 되살아났다 — 두 벌은 P12 다').toBe(false);
    expect(top.includes('apiClient'), 'TopBar 가 검색 API 를 직접 부른다').toBe(false);
  });
});

describe('선호 서버 동기화(P2) — 정직성', () => {
  const store = readFileSync(join(WEB, 'src', 'stores', 'term-lang-store.ts'), 'utf8');

  it('🔴 모드 변경은 즉시 피드백한다 — 대상 용어 없는 화면에서 죽은 스위치로 읽힌 실신고(2026-09-06)', () => {
    expect(/setMode:[\s\S]{0,600}?toast\.info\(`용어 표시: \$\{TERM_LANG_LABEL\[m\]\}/.test(store)).toBe(true);
    expect(store).toContain('있는 화면에 적용됩니다');
  });

  it('🔴 서버 저장 실패를 조용히 삼키지 않는다 — "이 기기에만 저장됨" 토스트', () => {
    expect(/put\('\/api\/v1\/users\/me\/ui-preferences'[\s\S]{0,200}?catch[\s\S]{0,200}?toast\.warning/.test(store)).toBe(true);
    expect(store).toContain('이 기기에만 저장됐습니다');
  });

  it('🔴 하이드레이션은 서버 값을 되쓰지 않는다 — setMode(PUT 포함)가 아니라 로컬 적용만', () => {
    const hyd = /export function useHydrateTermLang[\s\S]*?\n}\n/.exec(store)?.[0] ?? '';
    expect(hyd.length).toBeGreaterThan(100);
    expect(hyd).toContain('applyLocal');
    expect(hyd.includes('setMode'), '하이드레이션이 setMode 를 부르면 받은 값을 서버에 되써 무한 왕복이다').toBe(false);
  });

  it('서버 미설정(null)을 KO 선택으로 만들지 않는다 — isMode 검사 뒤에만 적용', () => {
    expect(/isMode\(server\)[\s\S]{0,80}?applyLocal\(server\)/.test(store)).toBe(true);
  });
});

describe('P3 — 원시 용어 렌더 기준선(전 메뉴 확산·점진 상환)', () => {
  /**
   * 🔴 계수 휴리스틱(기획 §P3.3): JSX 직접 렌더 `{expr.nameKo}`·`{expr.testName}` 만 센다.
   *  - `${…}` 템플릿(confirm·토스트·프롬프트)·`value={…}`(편집 폼)은 원문 유지가 정답이라 제외
   *  - 정본 부품 파일·print 라우트 제외 · 처치(procedureCode)는 데이터 대기라 분리 집계
   *  - 🔴 grep 계수는 하한이다 — 간접 렌더(변수 경유)는 W1 파일 목록 핀으로 다룬다(§P3.2)
   */
  const walkAll = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walkAll(p) : /\.tsx$/.test(f) ? [p] : [];
  });
  const files = walkAll(join(WEB, 'src', 'app')).filter((f) =>
    !f.includes('/print/') && !/components\/ui\/(term|lab-term)\.tsx/.test(f));

  const countRaw = (re: RegExp) => {
    let total = 0; let procedure = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const line of src.split('\n')) {
        if (/value=\{/.test(line) && re.test(line)) continue; // 편집 폼 바인딩 — 표시 아님
        const m = line.match(re);
        if (!m) continue;
        for (const hit of line.matchAll(new RegExp(re.source, 'g'))) {
          if (/\$\{[^}]*$/.test(line.slice(0, hit.index))) continue; // 템플릿 리터럴 내부 — 원문 유지 대상
          // 🔴 정본 부품에 넘기는 prop(`nameKo={x.nameKo}`)은 원시 렌더가 아니다 —
          //    처음 이걸 세는 바람에 배선할수록 기준선이 "늘어나는" 오탐이 났다(2026-09-06)
          if (/[A-Za-z]=$/.test(line.slice(0, hit.index))) continue;
          if (/procedureCode/.test(hit[0])) procedure += 1; else total += 1;
        }
      }
    }
    return { total, procedure };
  };

  it('🔴 원시 nameKo JSX 렌더가 늘지 않는다(기준선 — 웨이브마다 내린다)', () => {
    const { total, procedure } = countRaw(/\{[a-zA-Z_?.!]*\.nameKo\}/);
    expect(total, '원시 진단·코드명 렌더가 늘었다 — <Term> 을 쓰라').toBeLessThanOrEqual(40);
    expect(40 - total, '많이 줄었다 — 기준선을 내려라').toBeLessThanOrEqual(10);
    // 처치는 데이터 확보 전 의도적 원문(분리 집계 — 게으른 미배선과 구분)
    expect(procedure, '처치 렌더 분리 집계가 변했다 — 데이터 트랙 확인').toBeLessThanOrEqual(12);
  });

  it('🔴 원시 testName JSX 렌더가 늘지 않는다(기준선)', () => {
    const { total } = countRaw(/\{[a-zA-Z_?.!]*\.testName\}/);
    expect(total, '원시 검사명 렌더가 늘었다 — <LabTerm> 을 쓰라').toBeLessThanOrEqual(7);
    expect(7 - total, '많이 줄었다 — 기준선을 내려라').toBeLessThanOrEqual(10);
  });

  it('🔴 window.print 화면 3곳에 용어 부품이 없다 — 화면 인쇄에 표기 선호가 실리면 안 된다', () => {
    for (const f of [
      'src/app/(main)/patients/[id]/components/PatientHeader.tsx',
      'src/app/(main)/reception/components/ReceptionTicket.tsx',
      'src/app/(main)/inventory/components/QrTab.tsx',
    ]) {
      const src = readFileSync(join(WEB, f), 'utf8');
      expect(/ui\/term|ui\/lab-term|<DrugName/.test(src), `${f}: window.print 화면에 용어 부품 금지`).toBe(false);
    }
  });
});

describe('검사 항목명 한/영 정본(P1) — labTermText', () => {
  it('병기 규칙: 사전 등재 항목은 KO/BOTH 에서 `EN (한글)`, EN 에서 영문 정돈', () => {
    expect(labTermText('WBC', 'KO')).toBe('WBC (백혈구)');
    expect(labTermText('WBC (백혈구)', 'EN')).toBe('WBC');
    expect(labTermText('공복혈당 (FBS)', 'KO')).toBe('FBS (공복혈당)');
    expect(labTermText('칼륨', 'KO')).toBe('K (칼륨)');
  });

  it('🔴 미등재는 원문 그대로 — 번역을 지어내지 않는다(AST 류는 의도적 미등재)', () => {
    expect(labTermText('AST', 'KO')).toBe('AST');
    expect(labTermText('AST (GOT)', 'KO')).toBe('AST (GOT)');
    expect(labTermText('1,5-AG', 'KO')).toBe('1,5-AG');
    expect(labTermText('Anti-TPO Ab', 'EN')).toBe('Anti-TPO Ab');
  });

  it('포털은 한글 우선 병기 — 모르면 원문 그대로(일반인 대상)', () => {
    expect(portalLabTermText('WBC')).toBe('백혈구 (WBC)');
    expect(portalLabTermText('공복혈당 (FBS)')).toBe('공복혈당 (FBS)');
    expect(portalLabTermText('UACR')).toBe('UACR');
  });

  it('🔴 표시 전용 — 저장 경로(lab 결과 입력)가 lab-term 을 소비하지 않는다', () => {
    // 저장되는 testName(:218 selectTestCode)은 원문 유지 — 표시 부품이 저장 경로에 끼면 값이 바뀐다
    const labPage = readFileSync(join(WEB, 'src', 'app', '(main)', 'lab', 'page.tsx'), 'utf8');
    expect(/testName:\s*[^,]*labTermText/.test(labPage)).toBe(false);
  });

  it('포털·직원 소비처가 실제로 배선됐다(미배선 방지)', () => {
    const files = [
      ['src/app/(main)/patients/[id]/components/LabResultsTab.tsx', '<LabTerm'],
      ['src/app/(main)/workstation/diagnostic/page.tsx', '<LabTerm'],
      ['src/app/portal/_health/HealthTab.tsx', '<PortalLabTerm'],
      // 잔여 회수(2026-09-06): 투약 탭·오더 목록 약품명 — 문자열 파이프에 쌍을 실어 배선
      ['src/app/(main)/patients/[id]/components/MedicationTab.tsx', '<DrugName'],
      ['src/app/(main)/orders/page.tsx', '<DrugName'],
    ] as const;
    for (const [f, tag] of files) {
      expect(readFileSync(join(WEB, f), 'utf8').includes(tag), `${f}: ${tag} 미배선`).toBe(true);
    }
  });

  it('🔴 오더 EP 서버 select 가 용어 쌍(nameEn·ingredient)을 싣는다 — 빼면 EN 모드가 전부 미등록 티가 된다', () => {
    const svc = readFileSync(join(REPO, 'apps', 'api', 'src', 'modules', 'order', 'order.service.ts'), 'utf8');
    const hits = (svc.match(/medicationCode: \{ select: \{[^}]*nameEn: true[^}]*ingredient: true[^}]*\} \}/g) ?? []).length;
    expect(hits, 'order.service 의 medicationCode select 두 곳이 쌍을 실어야 한다').toBeGreaterThanOrEqual(2);
  });
});
