'use client';

import { T } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

/**
 * Naranjo 인과성 평가 — 🔴 고아 EP 회수(2026-08-26).
 *
 * `POST /api/v1/pharmacy/adr/naranjo` 는 서버에 있었는데 **부르는 화면이 0** 이었다.
 * 그래서 `adverse_reaction_reports.naranjo_score` 는 개통 이래 한 번도 채워지지 않았고,
 * ADR 보고의 인과관계는 약사가 드롭다운에서 **감으로 고른 값**이었다.
 *
 * 지키는 것:
 *  · 점수는 **서버가 계산한다**(화면이 배점표를 베끼면 정본이 둘이 된다).
 *  · 초기값은 **미선택** — '모름'으로 시작하면 아무것도 안 눌러도 "0점 = 희박"이 나온다.
 *  · 10문항 전체를 답해야 계산 버튼이 열린다(서버 DTO 도 같은 계약).
 *  · 결과는 **초안**이다 — 적용을 누를 때만 ADR 폼의 인과관계·점수로 옮긴다.
 */

/** 문항 문구는 서버 배점표(`computeNaranjo`)와 같은 순서다 — 순서가 어긋나면 점수가 다른 뜻이 된다. */
export const NARANJO_QUESTIONS = [
  '이 이상반응에 대한 이전의 결정적 보고가 있는가?',
  '의심 약물 투여 후에 이상반응이 나타났는가?',
  '약물 중단 또는 길항제 투여 시 이상반응이 호전되었는가?',
  '재투여 시 이상반응이 재발했는가?',
  '약물 외에 이 반응을 일으킬 다른 원인이 있는가?',
  '위약 투여 시에도 이 반응이 나타나는가?',
  '혈중 농도가 독성 수준이었는가?',
  '용량을 늘리거나 줄였을 때 반응이 심해지거나 약해졌는가?',
  '과거 유사 약물 노출 시 유사한 반응이 있었는가?',
  '객관적 증거로 이상반응이 확인되었는가?',
] as const;

type Answer = 'yes' | 'no' | 'unknown';
const ANSWER_LABEL: Record<Answer, string> = { yes: '예', no: '아니오', unknown: '모름' };

export const NARANJO_CAUSALITY_LABEL: Record<string, string> = {
  CERTAIN: '확실 (Certain)', PROBABLE: '개연 (Probable)',
  POSSIBLE: '가능 (Possible)', UNLIKELY: '희박 (Unlikely)',
};

export interface NaranjoResult {
  score: number;
  causality: string;
  /** 예/아니오로 답한 문항 수 — 같은 점수라도 근거의 두께가 다르다 */
  answered: number;
  unknown: number;
}

export default function NaranjoDialog({ onApply, onClose }: {
  onApply: (result: NaranjoResult) => void;
  onClose: () => void;
}) {
  // 🔴 초기값은 미선택(null) — 'unknown' 으로 시작하면 손대지 않은 설문이 "0점 = 희박"이 된다
  const [answers, setAnswers] = useState<Array<Answer | null>>(() => NARANJO_QUESTIONS.map(() => null));
  const [result, setResult] = useState<NaranjoResult | null>(null);

  const answeredCount = answers.filter((a) => a !== null).length;
  const complete = answeredCount === NARANJO_QUESTIONS.length;

  const compute = useMutation({
    mutationFn: (payload: string[]) =>
      apiClient.post<{ data: NaranjoResult }>('/api/v1/pharmacy/adr/naranjo', { answers: payload }),
    onSuccess: (res) => {
      const r = ((res as { data?: NaranjoResult })?.data ?? res) as NaranjoResult;
      setResult(r);
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? 'Naranjo 계산 실패'),
  });

  const pick = (idx: number, value: Answer) => {
    setAnswers((prev) => prev.map((a, i) => (i === idx ? value : a)));
    // 답을 바꾸면 이전 결과는 더 이상 이 응답의 결과가 아니다
    setResult(null);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div>
          <h3 className="font-bold text-gray-900"><T k="Naranjo 인과성 평가" /></h3>
          <p className="text-xs text-gray-500 mt-1">
            <T k="10문항 전부를 답해야 계산됩니다 · 점수는 서버가 계산합니다(" />{answeredCount}/{NARANJO_QUESTIONS.length} <T k="응답)" />
          </p>
        </div>

        <ol className="space-y-2">
          {NARANJO_QUESTIONS.map((q, i) => (
            <li key={q} className="flex items-start gap-3 p-2.5 rounded-xl bg-gray-50">
              <span className="text-xs font-bold text-gray-400 w-5 shrink-0 pt-1.5">{i + 1}</span>
              <span className="flex-1 text-xs text-gray-700 pt-1.5"><T k={q} /></span>
              <div className="flex gap-1 shrink-0">
                {(['yes', 'no', 'unknown'] as Answer[]).map((v) => (
                  <button key={v} type="button" onClick={() => pick(i, v)}
                    className={`min-h-[36px] px-2.5 text-[11px] font-medium rounded-lg border ${
                      answers[i] === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}>
                    <T k={ANSWER_LABEL[v]} />
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>

        {result && (
          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/60 space-y-1">
            <p className="text-sm font-bold text-gray-900">
              <T k="총점" /> {result.score}<T k="점 ·" /> <T k={NARANJO_CAUSALITY_LABEL[result.causality] ?? result.causality} />
            </p>
            {/* 🔴 같은 점수라도 "8문항을 판단한 결과"와 "대부분 모름이라 낮은 점수"는 다른 근거다 */}
            <p className="text-xs text-gray-600">
              <T k="판단 근거: 예/아니오" /> {result.answered}<T k="문항 · 모름" /> {result.unknown}<T k="문항" />
            </p>
            <p className="text-[11px] text-gray-500">
              <T k="계산 결과는 초안입니다 — 적용을 눌러야 보고서의 인과관계·점수로 들어갑니다." />
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={() => compute.mutate(answers as string[])}
            disabled={!complete || compute.isPending}
            className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50">
            {compute.isPending ? <T k="계산 중..." /> : complete ? <T k="점수 계산" />
              : <><T k="미응답" /> {NARANJO_QUESTIONS.length - answeredCount}<T k="문항" /></>}
          </button>
          <button type="button" onClick={() => result && onApply(result)} disabled={!result}
            className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50">
            <T k="보고서에 적용" />
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="닫기" /></button>
        </div>
      </div>
    </div>
  );
}
