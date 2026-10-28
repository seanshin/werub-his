'use client';

import { useCallback, useRef, useState } from 'react';

import { tOf, tfOf } from '@hospital-run/shared';

import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useUiLocaleStore } from '@/stores/ui-locale-store';

/**
 * 🔴 환자 앱 알림 **승인 다이얼로그** — 대외 발신은 사람이 승인해야 나간다.
 *
 * 정책(사람 지시 2026-08-20): 대외 발신은 **구현 + 설정 + 승인** 셋을 모두 만족할 때만 나간다.
 * 서버는 요청에 `notifyPatient: true` 가 없으면 설정이 켜져 있어도 보내지 않는다(`NOT_REQUESTED`).
 *
 * 🔴 매번 묻는 것이 원칙이지만 외래 대기열 호출은 시간당 수십 번이라, 매 클릭 모달은
 * 업무를 막고 결국 "항상 예"를 누르게 만든다(승인이 형식이 된다). 그래서
 * **세션 기억**을 둔다 — 선택은 탭을 닫으면 사라지고, 상단 배지가 현재 선택을 항상 보여준다.
 * 기억은 **이 브라우저 탭 안에서만** 유효하고 서버에 저장되지 않는다.
 */
export type NotifyChoice = 'ASK' | 'ALWAYS' | 'NEVER';

export function usePatientNotifyConfirm(actionLabel: string) {
  const tAttr = useTAttr();
  const [choice, setChoice] = useState<NotifyChoice>('ASK');
  const [pending, setPending] = useState<{ resolve: (v: boolean | null) => void } | null>(null);
  const resolver = useRef<((v: boolean | null) => void) | null>(null);

  /** @returns true=보낸다 · false=보내지 않는다 · null=취소(행위 자체를 중단) */
  const ask = useCallback(async (): Promise<boolean | null> => {
    if (choice === 'ALWAYS') return true;
    if (choice === 'NEVER') return false;
    return new Promise<boolean | null>((resolve) => {
      resolver.current = resolve;
      setPending({ resolve });
    });
  }, [choice]);

  const answer = (v: boolean | null, remember: boolean) => {
    if (remember && v !== null) setChoice(v ? 'ALWAYS' : 'NEVER');
    resolver.current?.(v);
    resolver.current = null;
    setPending(null);
  };

  const dialog = pending ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={tAttr('환자 앱 알림 발송 확인')}>
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-3">
        <p className="text-sm font-bold text-gray-900"><T k="환자 앱으로 알림도 보낼까요?" /></p>
        <p className="text-xs text-gray-600">
          <Tf k="{행위} 시 환자 휴대폰으로 알림이 갑니다." params={{ 행위: actionLabel }} />
          {/* 🔴 보내지 않아도 업무는 그대로 진행된다는 사실을 말한다 — 승인이 강요가 되지 않게 */}
          <Tf k="보내지 않아도 {행위}은 그대로 진행됩니다." params={{ 행위: actionLabel }} className="block mt-1 text-gray-500" />
        </p>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" id="pnc-remember" className="rounded" />
          <T k="이 탭에서 다시 묻지 않기(브라우저를 닫으면 초기화)" />
        </label>
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => answer(false, (document.getElementById('pnc-remember') as HTMLInputElement)?.checked ?? false)}
            className="flex-1 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50">
            <T k="보내지 않음" />
          </button>
          <button
            onClick={() => answer(true, (document.getElementById('pnc-remember') as HTMLInputElement)?.checked ?? false)}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">
            <T k="보내기" />
          </button>
        </div>
        <button onClick={() => answer(null, false)} className="w-full text-[11px] text-gray-400 hover:text-gray-600">{<T k="취소" />}</button>
      </div>
    </div>
  ) : null;

  /** 현재 세션 선택 배지 — 사용자가 "항상 보냄"으로 둔 것을 잊지 않게 항상 보인다 */
  const badge = choice === 'ASK' ? null : (
    <button onClick={() => setChoice('ASK')}
      title={tAttr('클릭하면 다시 매번 물어봅니다')}
      className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${
        choice === 'ALWAYS' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'
      }`}>
      {/* 라벨 + 현재 상태 + 동작 — 세 조각이라 키를 셋으로 나눈다(문장이 아니라 나열이다) */}
      <T k="환자 알림" /> <T k={choice === 'ALWAYS' ? '항상 보냄' : '보내지 않음'} /> · <T k="변경" />
    </button>
  );

  return { ask, dialog, badge, choice };
}

/**
 * 사유 어휘 → 문장 키(원문이 키다 — ko 출력은 종전과 글자 단위로 같다).
 * 🔴 (2026-09-14) 종전엔 한국어 리터럴을 그대로 돌려줘 영어·일본어 화면의 toast 도 한국어였다.
 */
const PUSH_REASON_KEY: Readonly<Record<string, string | null>> = {
  'NOT_REQUESTED': null, // 보내지 않기로 한 것 — 알릴 것이 없다
  'DISABLED_BY_CONFIG': '환자 알림이 전체 설정에서 꺼져 있어 보내지 않았습니다.',
  'TYPE_DISABLED': '이 종류의 환자 알림이 설정에서 꺼져 있어 보내지 않았습니다.',
  'QUIET_HOURS': '야간 시간대라 보내지 않았습니다(나중에 보내지 않습니다).',
  'NO_PATIENT_ACCOUNT': '환자 앱 계정이 없어 보낼 곳이 없습니다.',
  'DUPLICATE_SUPPRESSED': '같은 알림이 방금 나가 중복으로 보내지 않았습니다.',
  'NOT_APPLICABLE': '이 경우에는 환자 알림 대상이 아닙니다.',
  'CRITICAL_WITHHELD': '위급값이 포함되어 환자 알림은 보류했습니다(의료진 통보 경로를 따릅니다).',
  'NO_LISTENER': '환자 알림 처리기가 없어 아무 일도 일어나지 않았습니다.',
  'ERROR': '환자 알림 발송 중 오류가 발생했습니다.',
};

/**
 * 서버가 돌려준 발송 결과를 사람 말로 — 🔴 사유를 지어내지 않는다
 * 순수 함수라 훅을 못 쓴다 → 현재 UI 언어는 스토어에서 읽는다(`kdate()` 와 같은 방식). 미등록이면 한국어 원문.
 * 모르는 사유 코드는 번역하지 않고 코드값을 그대로 보인다(`{사유}`).
 */
export function patientPushMessage(r?: { sent?: boolean; reason?: string; pushChannel?: string | null } | null): string | null {
  if (!r) return null;
  const locale = useUiLocaleStore.getState().locale;
  if (r.sent) {
    return tOf(r.pushChannel === 'UNAVAILABLE'
      ? '환자 앱에 알림을 기록했습니다(단말 푸시는 설정되지 않아 앱을 열어야 보입니다).'
      : '환자 앱으로 알림을 보냈습니다.', locale).text;
  }
  if (!r.reason) return null;
  if (Object.prototype.hasOwnProperty.call(PUSH_REASON_KEY, r.reason)) {
    const k = PUSH_REASON_KEY[r.reason];
    return k ? tOf(k, locale).text : null;
  }
  return tfOf('환자 알림 미발송({사유}).', locale, { 사유: r.reason }).text;
}
