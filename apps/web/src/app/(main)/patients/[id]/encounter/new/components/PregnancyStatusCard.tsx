'use client';

// 임신 여부 — API·DB 는 진작 보유(Encounter.pregnancyStatus)하고 **DUR 임부금기 판정**과
// **영상 방사선 안전 판정**이 이 값을 읽는데, 웹에는 표시도 입력도 없었다.
// 그 결과 운영 진료 480건 중 기록 1건(가임기 여성 진료 106건) — 안전 규칙이 사실상 비어 있었다.
//
// 가임기 여성 진료에서만 노출한다(그 외 진료에는 아무것도 추가되지 않음).

import { useEffect, useState } from 'react';
import { ageOf } from '@hospital-run/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/stores/toast-store';
import { apiClient } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Props {
  encounterId?: string | null;
  patient: { gender?: string; dateOfBirth?: string | null } | null | undefined;
  value?: string | null;
}

const OPTIONS = [
  { key: 'PREGNANT', label: '임신', tone: 'bg-rose-600 text-white border-rose-600' },
  { key: 'NOT_PREGNANT', label: '비임신', tone: 'bg-emerald-600 text-white border-emerald-600' },
  { key: 'UNKNOWN', label: '확인 불가', tone: 'bg-gray-500 text-white border-gray-500' },
];

/** 가임기(15~50세) 여성만 대상 — 영상 안전 규칙의 판정 대상과 동일한 기준 */
function isChildbearing(patient: Props['patient']): boolean {
  if (patient?.gender !== 'FEMALE' || !patient?.dateOfBirth) return false;
  const age = ageOf(patient.dateOfBirth);
  // 나이를 계산하지 못하면 가임기에서 빼지 않는다(0세로 접어 카드를 숨기면 임부금기 입력이 사라진다)
  if (age == null) return true;
  return age >= 15 && age <= 50;
}

export function PregnancyStatusCard({ encounterId, patient, value }: Props) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [current, setCurrent] = useState<string | null>(value ?? null);
  // 🔴 재진입 시 기록값은 첫 렌더 뒤에 도착한다 — 따라가지 않으면 기록된 '임신'이 '미확인'으로 보였다(2026-09-30)
  useEffect(() => { if (value != null) setCurrent(value); }, [value]);

  const save = useMutation({
    mutationFn: (status: string) =>
      apiClient.put(`/api/v1/encounters/${encounterId}`, { pregnancyStatus: status }),
    onSuccess: (_r, status) => {
      setCurrent(status);
      toast.success(tAttr('임신 여부를 기록했습니다'));
      qc.invalidateQueries({ queryKey: ['encounter', encounterId] });
    },
    onError: () => toast.error(tAttr('임신 여부 저장에 실패했습니다')),
  });

  if (!isChildbearing(patient)) return null;

  const unset = !current;

  return (
    <div className={`rounded-xl border px-4 py-3 ${unset ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[11px] font-medium text-gray-500">
          {/* 🔴 `미확인@임신` — 맨 `미확인` 은 앞 카탈로그에서 'Unacknowledged'(인계 미확인)라 뜻이 다르다 */}
          <T k="임신 여부" />{unset && <span className="ml-1 font-bold text-amber-700"><T k="미확인@임신" /></span>}
        </p>
        <div className="ml-auto flex items-center gap-1">
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={!encounterId || save.isPending}
              onClick={() => save.mutate(o.key)}
              className={`min-h-[44px] px-3 py-1 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 ${
                current === o.key ? o.tone : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <T k={o.label} />
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-gray-500 mt-1.5">
        <T k={encounterId
          ? '처방 임부금기(DUR)·영상 방사선 안전 판정에 사용됩니다.'
          : '진료를 먼저 저장하면 기록할 수 있습니다.'} />
      </p>
    </div>
  );
}
