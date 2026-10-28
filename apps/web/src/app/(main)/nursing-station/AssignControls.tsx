'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NursingShift } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { SHIFT_KEY, type Staffing } from './board-types';

/** 배정은 간호사·관리자만(서버 `nurse-station/assignments` @Roles 와 같다) — 의사는 보기만 */
export const ASSIGN_ROLES = ['NURSE', 'ADMIN'] as const;
export const canAssignRole = (role: string | null) => !!role && (ASSIGN_ROLES as readonly string[]).includes(role);

/**
 * "내가 담당" — 상번 인수(`take-over`): 그 입원의 다른 간호사 활성 배정은 같은 순간 해제된다.
 * 근무조는 **서버가 준 지금 근무조**(브라우저 시계로 판정하지 않는다) — 없으면(구버전 응답) 누를 수 없다.
 */
export function useTakeOver(queryKey: unknown[]) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  // 호출 자리의 게이트 — 화면이 버튼을 숨기는 것과 별개로, 권한 밖 역할은 부르지 않는다(서버 @Roles NURSE·ADMIN)
  const canAssign = useHasRole('NURSE');
  return useMutation({
    mutationFn: async (v: { admissionId: string; shift: NursingShift }) => {
      if (!canAssign) throw new Error(tAttr('담당 배정은 간호사·관리자만 할 수 있습니다.'));
      return apiClient.post('/api/v1/nurse-station/assignments/take-over', { admissionId: v.admissionId, shiftType: v.shift });
    },
    onSuccess: () => { toast.success(tAttr('담당으로 넘겨받았습니다.')); qc.invalidateQueries({ queryKey }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('담당을 넘겨받지 못했습니다.')),
  });
}

/**
 * 선택 배정 막대 — 카드를 고르고 간호사를 정해 한꺼번에 배정한다(수간호사의 근무조 시작 배정).
 *  · 후보 = 이번 근무조 근무표(★) + 간호사 전체 · 근무조 = 서버가 준 지금 근무조
 *  · 한 건씩 보내고 성공·실패 수를 그대로 말한다(일부 실패를 "완료"로 접지 않는다)
 */
export function AssignBar({ selected, shift, staffing, queryKey, onDone, onCancel }: {
  selected: string[]; shift: NursingShift; staffing: Staffing | undefined; queryKey: unknown[];
  onDone: () => void; onCancel: () => void;
}) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [nurseId, setNurseId] = useState('');
  const nursesQ = useQuery({
    queryKey: ['nurse-list'],
    queryFn: () => apiClient.get<{ data: { id: string; familyName?: string; givenName?: string }[] }>('/api/v1/users?role=NURSE'),
    staleTime: 5 * 60 * 1000,
  });
  const nurses = nursesQ.data?.data ?? [];
  const onRoster = staffing?.current.roster ?? [];
  const rosterIds = new Set(onRoster.map((r) => r.userId));

  const canAssign = useHasRole('NURSE');
  const assign = useMutation({
    mutationFn: async () => {
      if (!canAssign) throw new Error(tAttr('담당 배정은 간호사·관리자만 할 수 있습니다.'));
      let ok = 0; const failed: string[] = [];
      for (const admissionId of selected) {
        try {
          await apiClient.post('/api/v1/nurse-station/assignments', { nurseId, admissionId, shiftType: shift, isPrimary: true });
          ok += 1;
        } catch (e) { failed.push(extractErrorMessage(e) || admissionId); }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      qc.invalidateQueries({ queryKey });
      if (failed.length === 0) { toast.success(tfAttr('{수}명 배정했습니다.', { 수: ok })); onDone(); }
      else toast.error(tfAttr('{성공}명 배정 · {실패}명 실패 — {사유}', { 성공: ok, 실패: failed.length, 사유: failed[0] }));
    },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('담당 배정은 간호사·관리자만 할 수 있습니다.')),
  });

  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/95 px-3 py-2 shadow-sm backdrop-blur" role="region" aria-label={tAttr('담당 배정')}>
      <span className="text-xs font-semibold text-indigo-900"><Tf k="{수}명 선택" params={{ 수: selected.length }} /></span>
      <span className="text-[11px] text-indigo-700">· <T k={SHIFT_KEY[shift]} /> <T k="근무조로 배정" /></span>
      {nursesQ.isError ? (
        <QueryErrorFallback error={nursesQ.error} onRetry={() => nursesQ.refetch()} size="compact" />
      ) : (
        <select value={nurseId} onChange={(e) => setNurseId(e.target.value)} aria-label={tAttr('배정할 간호사')}
          className="min-h-[36px] rounded-lg border border-indigo-200 bg-white px-2 text-sm">
          <option value="">{tAttr('— 간호사 —')}</option>
          {onRoster.length > 0 && (
            <optgroup label={tAttr('★ 이번 근무조 근무표')}>
              {onRoster.map((r) => <option key={r.userId} value={r.userId}>{r.name}</option>)}
            </optgroup>
          )}
          <optgroup label={tAttr('간호사')}>
            {nurses.filter((u) => !rosterIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.familyName}{u.givenName}</option>)}
          </optgroup>
        </select>
      )}
      <button type="button" onClick={() => assign.mutate()} disabled={!nurseId || selected.length === 0 || assign.isPending}
        className="min-h-[36px] rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
        {assign.isPending ? <T k="배정 중…" /> : <T k="배정" />}
      </button>
      <button type="button" onClick={onCancel} className="min-h-[36px] rounded-lg px-2 text-sm text-gray-600 hover:bg-white"><T k="취소" /></button>
      <p className="w-full text-[10px] text-indigo-700/80"><T k="같은 환자의 다른 담당은 해제하지 않습니다 — 넘겨받기는 카드의 '내가 담당'을 쓰세요." /></p>
    </div>
  );
}
