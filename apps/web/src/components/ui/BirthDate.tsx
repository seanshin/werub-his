'use client';

import { useMemo } from 'react';
import {
  ageOf, formatAge, birthDateProblem, birthYearOptions, daysInMonth,
  splitBirthDate, joinBirthDate, BIRTH_DATE_PROBLEM_TEXT,
} from '@hospital-run/shared';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 생년월일·나이 표현 정본 — **표시(Age)와 입력(BirthDateInput)을 한 규약으로 묶는다.**
 *
 * 🔴 종전엔 화면마다 `getFullYear() - getFullYear()` 로 나이를 계산했고(6곳), 그중 4곳은
 *    월·일 보정이 없어 **생일 전이면 한 살 많게** 나왔다. 만 나이는 소아 용량·검사 기준치·
 *    DUR 연령금기가 읽는 값이라 화면마다 다른 나이가 뜨는 것 자체가 위험하다.
 *
 * 입력은 **콤보박스(년·월·일 선택)와 직접 입력을 동시에** 지원한다 — 접수 창구는 주민번호를
 * 보고 그대로 타이핑하는 게 빠르고, 환자 구술로 받을 때는 선택이 빠르다. 둘은 항상 동기화된다.
 */

/** 나이 표시 — 값이 없거나 불가능한 값이면 '나이 미상'(0세로 뭉개지 않는다) */
export function Age({
  dob, mode = 'auto', suffix = '', unknown = '나이 미상', className = '',
}: {
  dob: string | Date | null | undefined;
  /** auto=소아는 개월·일까지 · years=항상 '42세' */
  mode?: 'auto' | 'years';
  suffix?: string;
  unknown?: string;
  className?: string;
}) {
  const text = useMemo(() => {
    if (mode === 'years') {
      const a = ageOf(dob);
      return a === null ? unknown : `${a}세`;
    }
    return formatAge(dob, { unknown });
  }, [dob, mode, unknown]);

  const invalid = text === unknown;
  return (
    <span className={`${invalid ? 'text-gray-400' : ''} ${className}`.trim()} title={invalid ? '생년월일이 없거나 올바르지 않습니다' : undefined}>
      {text}{invalid ? '' : suffix}
    </span>
  );
}

const SELECT_CLS = 'rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100';

/**
 * 생년월일 입력 — 콤보박스 + 직접 입력 겸용.
 * 값은 항상 `YYYY-MM-DD`(빈 문자열이면 미입력)로 올라간다.
 */
export function BirthDateInput({
  value, onChange, disabled, required, showAge = true, id, className = '',
}: {
  value: string;
  onChange: (isoDate: string) => void;
  disabled?: boolean;
  required?: boolean;
  showAge?: boolean;
  id?: string;
  className?: string;
}) {
  const tAttr = useTAttr();
  const parts = splitBirthDate(value);
  const years = useMemo(() => birthYearOptions(), []);
  const problem = value ? birthDateProblem(value) : null;

  // 2월 30일 같은 조합을 못 만들게 일수를 좁힌다. 년·월 변경으로 일이 범위를 벗어나면 잘라낸다.
  const maxDay = daysInMonth(Number(parts.year), Number(parts.month));
  const setPart = (next: { year?: string; month?: string; day?: string }) => {
    const year = next.year ?? parts.year;
    const month = next.month ?? parts.month;
    const limit = daysInMonth(Number(year), Number(month));
    const day = String(Math.min(Number(next.day ?? parts.day) || 0, limit) || '').padStart(2, '0');
    onChange(joinBirthDate(year, month, day === '00' ? '' : day));
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {/* 직접 입력 — 주민번호를 보고 타이핑하는 접수 흐름 */}
        <input
          id={id}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          max={kstToday()}
          className={`${SELECT_CLS} flex-1 min-w-[9rem]`}
          aria-invalid={!!problem}
        />

        <span className="text-xs text-gray-400"><T k="또는" /></span>

        {/* 콤보박스 — 환자 구술로 받을 때 */}
        <div className="flex items-center gap-1">
          <select value={parts.year} onChange={(e) => setPart({ year: e.target.value })} disabled={disabled} className={SELECT_CLS} aria-label={tAttr('출생 연도')}>
            {/* <option> 은 요소를 못 품는다 — 티를 그릴 수 없는 자리라 tAttr(원문 유지가 기본) */}
            <option value="">{tAttr('년@생년월일')}</option>
            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <select value={parts.month} onChange={(e) => setPart({ month: e.target.value })} disabled={disabled} className={SELECT_CLS} aria-label={tAttr('출생 월')}>
            <option value="">{tAttr('월@생년월일')}</option>
            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
              <option key={m} value={m}>{Number(m)}</option>
            ))}
          </select>
          <select value={parts.day} onChange={(e) => setPart({ day: e.target.value })} disabled={disabled} className={SELECT_CLS} aria-label={tAttr('출생 일')}>
            <option value="">{tAttr('일@생년월일')}</option>
            {Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => (
              <option key={d} value={d}>{Number(d)}</option>
            ))}
          </select>
        </div>

        {showAge && value && !problem && (
          <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
            만 <Age dob={value} />
          </span>
        )}
      </div>

      {problem && (
        <p className="mt-1 text-xs text-rose-600">{BIRTH_DATE_PROBLEM_TEXT[problem]}</p>
      )}
    </div>
  );
}
