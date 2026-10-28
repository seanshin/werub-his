'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { INSURANCE_LABEL } from '@hospital-run/shared';
import { T, Tf } from '@/components/ui/i18n-text';
import { PatientName } from '@/components/ui/display';

/**
 * 🔴 중복 의심 그룹 검토 (환자관리 A5 · 2026-08-31).
 * 종전엔 대시보드에 카운트만 있고 **나란히 비교할 화면이 없어** 병합 모달로 수동 처리뿐이었다.
 * 성명+생년월일이 같은 활성 환자를 그룹으로 나란히 보여준다. 🔴 자동 병합은 없다 — 사람이 판단한다.
 */
type Member = {
  id: string; mrn: string; phone: string | null; gender: string; insuranceType: string;
  createdAt: string; _count: { encounters: number; admissions: number };
};
type Group = { familyName: string; givenName: string; dateOfBirth: string; members: Member[] };

/**
 * 병합 검토로 넘길 두 명 — 먼저 등록된 기록을 대상(남김)으로, 나중 기록을 원(비활성)으로 제안한다.
 * 병합 창에서 바꿀 수 있다(제안일 뿐 · 같은 사람인지·어느 쪽을 남길지는 사람이 정한다).
 */
export function mergeSuggestion(members: Array<{ id: string; createdAt: string }>): { sourceId: string; targetId: string } | null {
  if (members.length < 2) return null;
  const sorted = [...members].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { targetId: sorted[0].id, sourceId: sorted[sorted.length - 1].id };
}

export function DuplicateReviewModal({ onClose, onMerge }: { onClose: () => void; onMerge: (initial?: { sourceId: string; targetId: string }) => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['patient-duplicate-groups'],
    queryFn: () => apiClient.get<{ data: { groups: Group[]; groupCount: number } }>('/api/v1/patients/duplicate-groups'),
  });
  const groups = data?.data?.groups ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900"><T k="중복 의심 그룹 검토" /></h2>
          <button onClick={() => onMerge()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"><T k="병합 도구 열기" /></button>
        </div>
        <p className="mt-1 text-xs text-gray-500"><T k="성명·생년월일이 같은 활성 환자입니다. 🔴 자동 병합은 없습니다 — 같은 사람인지 확인 후 병합하세요." /></p>

        {isLoading && <p className="mt-6 text-sm text-gray-400"><T k="불러오는 중…" /></p>}
        {isError && <p className="mt-6 text-sm text-red-500"><T k="중복 그룹을 불러오지 못했습니다." /></p>}
        {!isLoading && !isError && groups.length === 0 && (
          <p className="mt-6 text-sm text-gray-500"><T k="중복 의심 그룹이 없습니다." /></p>
        )}

        <div className="mt-4 space-y-4">
          {groups.map((g, i) => (
            <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-800"><PatientName familyName={g.familyName} givenName={g.givenName} showMrn={false} /> · {String(g.dateOfBirth).slice(0, 10)} <span className="text-xs text-amber-700"><Tf k="({수}명)" params={{ 수: g.members.length }} /></span></p>
                {mergeSuggestion(g.members) && (
                  <button type="button" onClick={() => onMerge(mergeSuggestion(g.members)!)} className="rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50" data-dup-merge-review>
                    <T k="이 그룹 병합 검토" />
                  </button>
                )}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {g.members.map((m) => (
                  <Link key={m.id} href={`/patients/${m.id}`} className="block rounded-lg border border-gray-100 bg-white p-2.5 hover:border-blue-200">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700">{m.mrn}</span>
                      <span className="text-[10px] text-gray-400">{m.createdAt.slice(0, 10)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {m.phone ?? <T k="전화 없음" />} · <T k={INSURANCE_LABEL[m.insuranceType] ?? m.insuranceType} /> · <Tf k="진료 {진료} · 입원 {입원}" params={{ 진료: m._count.encounters, 입원: m._count.admissions }} />
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
