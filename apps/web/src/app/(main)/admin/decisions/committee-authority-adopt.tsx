'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CommitteeCode } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 위원회 결정권한자 표 — 원내 채택 기록(2026-10-12 기획 P3 G7).
 * 🔴 종전엔 이 표를 쓰는 경로가 없어 개발 시드가 영원히 남았다. 원내 위원회 규정으로 정한 값과 **근거(규정·의결 번호)** 를 적는다.
 *  · 처음 값은 지금 보이는 값(정의 또는 시드) — 고친 칸만 바뀐다 · 근거 칸은 비어서 시작한다(근거를 지어 채우지 않는다)
 *  · 🔴 시스템은 규정 문서의 진위를 검증하지 못한다 — 적힌 근거·기록자·시각을 남길 뿐이다 · 관리자만
 */
type Authority = { chair: string; secretary: string; verifier: string; votingRule: string; exOfficio: readonly string[] };
export function CommitteeAuthorityAdopt({ code, a }: { code: CommitteeCode; a: Authority }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ chair: a.chair, secretary: a.secretary, verifier: a.verifier, votingRule: a.votingRule, exOfficio: a.exOfficio.join(', '), basisRef: '' });
  const save = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/admin/decisions/committee-authority/${code}`, {
      chair: f.chair, secretary: f.secretary, verifier: f.verifier, votingRule: f.votingRule,
      exOfficio: f.exOfficio.split(',').map((x) => x.trim()).filter(Boolean), basisRef: f.basisRef,
    }),
    onSuccess: () => { setOpen(false); void qc.invalidateQueries({ queryKey: ['human-decisions'] }); },
  });
  if (!isAdmin) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-[36px] self-start rounded-lg border border-teal-300 bg-white px-3 text-[12px] font-semibold text-teal-800 hover:bg-teal-50" data-committee-adopt-open={code}>
        <T k="원내 규정으로 채택 기록" />
      </button>
    );
  }
  const ready = f.basisRef.trim().length >= 2 && [f.chair, f.secretary, f.verifier, f.votingRule].every((x) => x.trim());
  const input = (k: keyof typeof f, label: string) => (
    <label className="grid gap-1 text-[11px] text-gray-600">
      <T k={label} />
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="min-h-[36px] rounded-lg border px-2 text-[12px] text-gray-900" data-committee-adopt-field={k} />
    </label>
  );
  return (
    <div className="grid gap-2 rounded-xl border border-teal-200 bg-teal-50/40 px-4 py-3" data-committee-adopt-form={code}>
      <p className="text-[11px] text-teal-900"><T k="원내 위원회 규정으로 정한 값과 그 근거를 적습니다. 시스템은 규정 문서의 진위를 검증하지 못합니다 — 적힌 근거·기록자·시각을 남길 뿐입니다." /></p>
      <div className="grid gap-2 sm:grid-cols-2">
        {input('chair', '위원장')}
        {input('secretary', '간사(안건 접수·회의 배정)')}
        {input('verifier', '확인 담당(⑦)')}
        {input('votingRule', '의결 요건')}
        {input('exOfficio', '당연직 위원(쉼표로 구분)')}
        {input('basisRef', '채택 근거 — 위원회 규정·의결 번호(필수)')}
      </div>
      {save.isError && <p className="text-[12px] text-red-700">{extractErrorMessage(save.error)}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!ready || save.isPending} onClick={() => save.mutate()} className="min-h-[36px] rounded-lg bg-teal-700 px-3 text-[12px] font-semibold text-white disabled:opacity-40" data-committee-adopt-save>
          <T k="채택 기록" />
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[36px] rounded-lg border px-3 text-[12px]">{tAttr('취소')}</button>
      </div>
    </div>
  );
}
