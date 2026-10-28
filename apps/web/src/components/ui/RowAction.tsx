'use client';

import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 표 행 액션 — **아이콘 버튼 + 힌트(툴팁)**.
 *
 * 🔴 배경: 목록 표의 관리 열에 한글 텍스트 버튼(차트·동의서·수정·보관·삭제)을 늘어놓으면
 *    열 폭이 모자라 **글자가 한 자씩 세로로 꺾인다**(`차\n트`·`동\n의\n서`). 폭을 늘리면
 *    정작 봐야 할 환자 정보가 밀린다. 액션은 아이콘으로 줄이고 뜻은 힌트로 알린다.
 *
 * 힌트는 `position: fixed` 로 띄운다 — 표 컨테이너가 `overflow-x-auto` 라
 * absolute 툴팁은 **잘려서 안 보인다**(overflow-x:auto 는 y 도 함께 자른다).
 * 접근성: 아이콘만으로는 뜻이 전달되지 않으므로 `aria-label` 과 네이티브 `title` 을 함께 준다.
 */

export type RowActionTone = 'neutral' | 'primary' | 'indigo' | 'amber' | 'emerald' | 'danger';

const TONE: Record<RowActionTone, string> = {
  neutral: 'bg-gray-100 text-gray-600 hover:bg-gray-200',
  primary: 'bg-blue-50 text-blue-600 hover:bg-blue-100',
  indigo: 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100',
  amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100',
  emerald: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100',
  danger: 'bg-red-50 text-red-500 hover:bg-red-100',
};

interface Common {
  icon: LucideIcon;
  /** 짧은 이름(예: '동의서') — aria-label·힌트 제목 */
  label: string;
  /** 한 줄 설명 — 무엇을 하는지. 힌트 둘째 줄 */
  hint?: string;
  tone?: RowActionTone;
  /** 우상단 카운트(첨부 건수 등) */
  badge?: number;
  disabled?: boolean;
  busy?: boolean;
}

export function RowAction({ icon: Icon, label, hint, tone = 'neutral', badge, disabled, busy, onClick }: Common & { onClick: () => void }) {
  const tAttr = useTAttr();
  const { handlers, tip } = useHint(label, hint);
  const off = !!disabled;
  return (
    <>
      <button
        type="button"
        // 🔴 native `disabled` 를 쓰지 않는다 — 브라우저가 비활성 버튼의 마우스 이벤트를 막아
        //    **"왜 못 누르는지" 힌트가 정작 필요할 때 안 뜬다.** aria-disabled + 클릭 무시로 대체.
        aria-disabled={off || busy || undefined}
        onClick={off || busy ? undefined : onClick}
        aria-label={tAttr(label)}
        title={hint ? `${tAttr(label)} — ${tAttr(hint)}` : tAttr(label)}
        className={`relative w-8 h-8 grid place-items-center rounded-lg transition ${
          off ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : busy ? `${TONE[tone]} cursor-wait` : TONE[tone]
        }`}
        {...handlers}
      >
        {busy ? <Spinner /> : <Icon className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />}
        <Badge n={badge} />
      </button>
      {tip}
    </>
  );
}

/** 파일 선택형 액션 — `<label>` 안에 숨은 file input 을 둔다(버튼으로는 파일창을 못 연다). */
export function RowActionFile({ icon: Icon, label, hint, tone = 'neutral', badge, disabled, busy, accept, onFile }: Common & {
  accept?: string; onFile: (file: File) => void;
}) {
  const tAttr = useTAttr();
  const { handlers, tip } = useHint(label, hint);
  return (
    <>
      <label
        aria-label={tAttr(label)}
        title={hint ? `${tAttr(label)} — ${tAttr(hint)}` : tAttr(label)}
        className={`relative w-8 h-8 grid place-items-center rounded-lg transition cursor-pointer ${disabled || busy ? 'opacity-40 cursor-not-allowed' : ''} ${TONE[tone]}`}
        {...handlers}
      >
        {busy ? <Spinner /> : <Icon className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />}
        <Badge n={badge} />
        <input
          type="file"
          accept={accept}
          className="hidden"
          disabled={disabled || busy}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }}
        />
      </label>
      {tip}
    </>
  );
}

/** 액션 묶음 — 행 끝에 오른쪽 정렬. 줄바꿈 없이 한 줄 유지. */
export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-1 whitespace-nowrap">{children}</div>;
}

/* ── 내부 ─────────────────────────────────────────────────────────────── */

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-gray-700 text-white text-[9px] font-semibold grid place-items-center">
      {n > 9 ? '9+' : n}
    </span>
  );
}

function Spinner() {
  return <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />;
}

/** 힌트 말풍선 최대 폭(px) — 뷰포트 클램프 계산에도 쓰인다. */
const MAX_W = 220;

/** 힌트 말풍선 — fixed 로 띄워 표의 overflow 에 잘리지 않게 한다. */
function useHint(label: string, hint?: string) {
  const ref = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = (e: React.SyntheticEvent) => {
    const el = e.currentTarget as HTMLElement;
    ref.current = el;
    const r = el.getBoundingClientRect();
    // 🔴 관리 열은 화면 오른쪽 끝에 있다. 버튼 중앙에 그대로 띄우면 말풍선이 창 밖으로 잘린다
    //    → 반폭(MAX_W/2) 기준으로 뷰포트 안에 가둔다. 가장자리에서는 중앙정렬이 살짝 어긋나지만 잘리지 않는다.
    const half = MAX_W / 2;
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    setPos({ x, y: r.top });
  };
  const hide = () => setPos(null);

  const tip = pos ? (
    <div
      role="tooltip"
      style={{ position: 'fixed', left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)', zIndex: 60, maxWidth: MAX_W }}
      // 🔴 whitespace-normal 필수 — 액션 묶음(RowActions)의 nowrap 이 상속되면 힌트가 한 줄로
      //    늘어나 max-width 를 넘고 문장이 잘린다("…의무기록 보").
      className="pointer-events-none rounded-lg bg-gray-900/95 text-white px-2.5 py-1.5 shadow-lg whitespace-normal break-keep text-left"
    >
      {/* 🔴 공용 부품이라 여기서 배선하지 않으면 **전 화면의 행 액션 라벨·힌트가 한국어로 남는다**
          (2026-09-10 사용자 지적 — "HINT 같은 공통영역"). 미등재면 원문+티로 나간다. */}
      <div className="text-[11px] font-semibold leading-tight"><T k={label} /></div>
      {hint && <div className="text-[10px] text-gray-300 leading-snug mt-0.5"><T k={hint} /></div>}
    </div>
  ) : null;

  return {
    handlers: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide },
    tip,
  };
}
