'use client';

/**
 * 사유(自由文) 입력 공통 부품 (2026-08-24 · 입력 보조 UX P2 — input-assist-ux.plan.md §4)
 *
 * 🔴 실측: `placeholder="…사유"` 입력이 **43곳**인데 `datalist` 는 전 FE 에 **3곳**뿐이었다.
 *    급양 축이 정답 모양을 이미 만들어 뒀는데(`MEAL_UNDELIVERED_REASON_PRESET` — "정본이 정하는 것은
 *    입력 보조이지 허용 목록이 아니다") **그 모양을 재사용할 부품이 없어서** 화면마다 맨 `<input>` 이었다.
 *
 * 이 부품이 하는 일은 셋뿐이다.
 *  1. **프리셋을 datalist 로 제안한다** — 있을 때만. `<datalist>` 는 제한이 아니라 제안이라
 *     목록 밖 값을 타이핑하는 것을 브라우저가 막지 않는다(그게 이 부품을 datalist 로 만든 이유다).
 *  2. **필수 자리에서 공백만 넣는 것을 막는다** — 어휘는 절대 강제하지 않는다.
 *  3. 기존 input 과 **같은 스타일 계약**을 유지한다(`className` 을 그대로 전달 — 화면이 정한다).
 *
 * 🔴 하지 않는 것:
 *  · 프리셋 밖 값 차단(enum 강제) — 급양에서 철회한 그 함정
 *  · 사유 문안을 지어내기 — 프리셋은 운영 DB 실사용에서만(`lib/reason-presets.ts` §실측)
 *  · 값 자동 채움 — 사유는 사람이 쓴 것만 기록이다
 *
 * ## 제출 게이트는 화면이 잡는다
 * `required` 는 이 부품 안의 표시·`aria-required` 까지다. 제출 버튼의 `disabled` 는 이 부품이
 * 볼 수 없으므로 **`reasonFilled()` 를 화면이 그대로 쓴다**(`!reason` 이 아니라).
 * 부품이 조용히 막을 수 있는 척하지 않는다 — 그러면 화면이 갖지 않은 보증을 가진 것으로 읽힌다.
 */
import { useId } from 'react';
import { REASON_PRESETS, reasonFilled, type ReasonDomain } from '@/lib/reason-presets';
import { T, useTAttr } from '@/components/ui/i18n-text';

export interface ReasonInputProps {
  /** 프리셋 정본의 도메인 키. 프리셋이 비어 있으면 datalist 없이 자유 입력만 렌더한다 */
  domain: ReasonDomain;
  value: string;
  /** 🔴 이벤트가 아니라 문자열을 넘긴다 — 값을 가공하지 않는다(trim 도 하지 않는다: 타이핑을 방해한다) */
  onChange: (next: string) => void;
  placeholder?: string;
  /** 비어 있으면 안 되는 자리 — 공백만 입력하면 화면이 그 사실을 말한다 */
  required?: boolean;
  /** 기존 input 의 className 을 그대로 넘긴다(스타일 계약 보존) */
  className?: string;
  /** 여러 줄 입력이던 자리는 textarea 로 그대로 */
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  'data-testid'?: string;
}

export function ReasonInput({
  domain,
  value,
  onChange,
  placeholder,
  required = false,
  className = '',
  multiline = false,
  rows,
  disabled,
  maxLength,
  autoFocus,
  'data-testid': testId,
}: ReasonInputProps) {
  const listId = useId();
  const tAttr = useTAttr();
  const preset = REASON_PRESETS[domain] ?? [];
  const hasPreset = preset.length > 0;
  /** 공백만 넣은 상태 — 아직 아무것도 안 쓴 것(빈 칸)과는 구분해서 말한다 */
  const blankOnly = required && value.length > 0 && !reasonFilled(value);

  const shared = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    // 🔴 속성 자리라 티를 그릴 수 없다 — tAttr 은 미등록이면 한국어 원문을 그대로 준다(지어내지 않는다)
    placeholder: placeholder ? tAttr(placeholder) : placeholder,
    className,
    disabled,
    maxLength,
    autoFocus,
    'aria-required': required || undefined,
    'aria-invalid': blankOnly || undefined,
    'data-testid': testId,
  };

  return (
    <>
      {multiline ? (
        <textarea {...shared} rows={rows} />
      ) : (
        // 🔴 list 는 프리셋이 있을 때만 — 빈 datalist 를 붙이면 브라우저가 빈 제안 상자를 띄운다
        <input type="text" {...shared} list={hasPreset ? listId : undefined} />
      )}
      {hasPreset && (
        <datalist id={listId} data-testid={testId ? `${testId}-preset` : undefined}>
          {preset.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      )}
      {/* 🔴 (2026-09-15 U4) 서버가 저장 길이를 넘는 사유를 400 으로 거부한다 — 한도에 가까워지면 남은 길이를 보여 준다(숫자만 · 번역 불필요) */}
      {maxLength != null && value.length >= Math.floor(maxLength * 0.8) && (
        <p className="mt-0.5 text-right text-[11px] tabular-nums text-gray-400" data-testid={testId ? `${testId}-count` : undefined}>
          {value.length}/{maxLength}
        </p>
      )}
      {blankOnly && (
        <p className="mt-0.5 text-[11px] text-red-600"><T k="사유를 입력해 주세요(공백만으로는 남길 수 없습니다)." /></p>
      )}
    </>
  );
}

export { reasonFilled };
