'use client';

import { TERM_LANG_MODES, TERM_LANG_LABEL, TERM_LANG_DESC } from '@hospital-run/shared';
import { useTermLangStore } from '@/stores/term-lang-store';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useTopBarDensity } from '@/components/layout/topbar-density';

/**
 * 의료용어 한/영 표시 세그먼트 — TopBar 우측(기획 medical-term-display-toggle.plan.md §2.2).
 * 🔴 표시만 바꾼다 — 저장 값·검색·집계·인쇄/대외 문서 불변. 현재 상태가 항상 보이는
 *    세그먼트 형태(순환 버튼은 지금 무엇인지 안 보인다).
 */
export function TermLangToggle() {
  const { mode, setMode } = useTermLangStore();
  // 🔴 라벨·설명 정본은 shared(TERM_LANG_LABEL/DESC) — 여기서 다시 적지 않고 렌더에서만 조회한다
  const tAttr = useTAttr();
  const density = useTopBarDensity();
  return (
    <div
      role="group"
      aria-label={tAttr('의료용어 표시 언어')}
      title={tAttr('의료용어(진단명·약품명·검사 항목명) 표시 언어 — 표시만 바뀝니다(저장·검색·인쇄 불변)')}
      className="flex shrink-0 items-center whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 p-0.5"
    >
      {/* 적용 범위 힌트 — 무엇의 한/영인지 토글 자체가 말한다(상시 노출은 짧게: 상세는 title) */}
      {density === 0 && <T k="의료코드" className="select-none pl-1.5 pr-1 text-[10px] font-medium text-gray-400" />}
      {TERM_LANG_MODES.map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          title={tAttr(TERM_LANG_DESC[m])}
          className={`min-h-[28px] rounded-md px-2 text-[11px] font-medium transition-colors ${
            mode === m ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <T k={TERM_LANG_LABEL[m]} />
        </button>
      ))}
    </div>
  );
}
