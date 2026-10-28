'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 인수인계 **등록**.
 *
 * 🔴 2026-08-26 사람 신고: "인수인계 등록 기능이 있어야 하지 않나?"
 *    서버 `POST /api/v1/handoffs` 는 진작 있었고 입원 상세·간호 스테이션·간호 대시보드는
 *    그것을 부르는데, **정작 인수인계 전용 화면은 확인(acknowledge)만** 할 수 있었다.
 *    이 저장소 규약 — **EP 를 만들면 부르는 화면까지가 한 벌**이다.
 *
 * 🔴 SBAR 로 받아 서버 계약(`summary`)에 맞춰 보낸다 — 간호 스테이션과 **같은 형식**이다.
 *    형식이 갈리면 같은 인계가 화면마다 다르게 읽힌다.
 */
type Admission = {
  id: string; patientId: string; patientName?: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  wardName?: string; bedLabel?: string; bed?: { ward?: { name?: string } };
};
type NurseLite = { id: string; name?: string; familyName?: string; givenName?: string };

const HANDOFF_TYPES = [
  { value: 'NURSING_SHIFT', label: '간호 교대' },
  { value: 'SHIFT_CHANGE', label: '의사 교대' },
  { value: 'TRANSFER', label: '전동·전과' },
];

export function NewHandoffForm() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    type: 'NURSING_SHIFT', admissionId: '', toUserId: '',
    situation: '', background: '', assessment: '', recommendation: '', pending: '',
  });

  /** 🔴 실패를 기본값으로 접지 않는다 — 접으면 "재원 환자 없음"으로 보인다 */
  const admQ = useQuery({
    queryKey: ['handoff-admissions'],
    queryFn: () => apiClient.get<{ data: Admission[] }>('/api/v1/inpatient?status=ADMITTED&limit=200'),
    enabled: open,
    staleTime: 60_000,
  });
  const admissions: Admission[] = (() => {
    const raw = admQ.data?.data as unknown;
    return Array.isArray(raw) ? (raw as Admission[]) : ((raw as { data?: Admission[] })?.data ?? []);
  })();

  /**
   * 다음 교대 간호사 제안 — 서버 응답은 `{ nextShift, entries: [{ staffId, staffName }] }` 이다.
   * 🔴 (2026-10-07) 종전엔 이것을 간호사 **배열**로 가정해 늘 빈 목록 → 인수자를 고를 수 없어 이 화면에서 인계 등록이 막혀 있었다
   *    ("근무표에 다음 교대자가 없어"라는 틀린 안내까지 · P11·P1). 같은 응답을 간호 워크스테이션은 바르게 읽는다.
   *    제안이 없어도 등록은 되어야 한다 — 전체 간호사 목록을 뒤에 붙인다(간호 워크스테이션과 같은 규약).
   */
  const nurseQ = useQuery({
    queryKey: ['handoff-next-shift-nurses'],
    queryFn: () => apiClient.get<unknown>('/api/v1/handoffs/next-shift-nurses'),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const allNursesQ = useQuery({
    queryKey: ['nurse-list-all'],
    queryFn: () => apiClient.get<{ data: NurseLite[]; meta?: { total?: number } }>('/api/v1/users?role=NURSE&limit=200'),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const nextShift = (() => {
    const a = (nurseQ.data as { data?: unknown } | undefined)?.data as { nextShift?: string; entries?: { staffId: string; staffName: string }[]; data?: unknown } | undefined;
    const b = a && 'entries' in a ? a : (a?.data as typeof a);
    return { shift: b?.nextShift ?? null, entries: Array.isArray(b?.entries) ? b!.entries! : [] };
  })();
  const suggestedIds = new Set(nextShift.entries.map((e) => e.staffId));
  const allNurses: NurseLite[] = (() => {
    const raw = allNursesQ.data?.data as unknown;
    return Array.isArray(raw) ? (raw as NurseLite[]) : ((raw as { data?: NurseLite[] })?.data ?? []);
  })();
  const nurses: (NurseLite & { suggested: boolean })[] = [
    ...nextShift.entries.map((e) => ({ id: e.staffId, name: e.staffName, suggested: true })),
    ...allNurses.filter((n) => !suggestedIds.has(n.id)).map((n) => ({ ...n, suggested: false })),
  ];

  const sel = admissions.find((a) => a.id === f.admissionId);
  const nameOf = (n: NurseLite) => n.name ?? (`${n.familyName ?? ''}${n.givenName ?? ''}`.trim() || n.id);

  const createMut = useMutation({
    // 🔴 스프레드로 보내지 않는다 — 폼에만 있는 키가 섞이면 whitelist 가 조용히 지운다
    mutationFn: () => apiClient.post('/api/v1/handoffs', {
      type: f.type,
      patientId: sel?.patientId,
      admissionId: f.admissionId,
      // 필드명은 의사 중심이지만 User FK — 간호 인계에도 그대로 쓴다(간호 스테이션과 같은 규약)
      fromDoctorId: me?.id,
      toDoctorId: f.toUserId,
      summary: ['S: ' + f.situation, 'B: ' + f.background, 'A: ' + f.assessment, 'R: ' + f.recommendation].join('\n'),
      ...(f.pending.trim()
        ? { pendingItems: { items: f.pending.split('\n').map((s) => s.trim()).filter(Boolean) } }
        : {}),
    }),
    onSuccess: () => {
      toast.success(tAttr('인계를 등록했습니다 — 인수자 확인 대기'));
      setF({ type: 'NURSING_SHIFT', admissionId: '', toUserId: '', situation: '', background: '', assessment: '', recommendation: '', pending: '' });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['handoffs-pending'] });
      qc.invalidateQueries({ queryKey: ['handoffs-recent'] });
    },
    // 🔴 실패 사유를 그대로 — "실패"만으로는 무엇을 고쳐야 할지 알 수 없다
    onError: (e: Error) => toast.error(e?.message || tAttr('인계 등록에 실패했습니다')),
  });

  const canSubmit = !!f.admissionId && !!f.toUserId && f.situation.trim().length > 0;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
        + <T k="인계 등록" />
      </button>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50/30 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800"><T k="새 인수인계 (SBAR)" /></p>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="text-[11px] text-gray-500"><T k="유형" /></label>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm">
            {HANDOFF_TYPES.map((t) => <option key={t.value} value={t.value}>{tAttr(t.label)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-500"><T k="환자(재원)" /> *</label>
          <select value={f.admissionId} onChange={(e) => setF({ ...f, admissionId: e.target.value })}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm">
            <option value="">{tAttr('— 선택 —')}</option>
            {admissions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.patientName ?? `${a.patient?.familyName ?? ''}${a.patient?.givenName ?? ''}`} · {a.wardName ?? a.bed?.ward?.name ?? ''} {a.bedLabel ?? ''}
              </option>
            ))}
          </select>
          {admQ.isError && <p className="mt-0.5 text-[11px] text-rose-600"><T k="재원 목록을 불러오지 못했습니다 — 없다는 뜻이 아닙니다." /></p>}
        </div>
        <div>
          <label className="text-[11px] text-gray-500"><T k="인수자" /> *</label>
          <select value={f.toUserId} onChange={(e) => setF({ ...f, toUserId: e.target.value })}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm">
            <option value="">{tAttr('— 선택 —')}</option>
            {nurses.map((n) => <option key={n.id} value={n.id}>{n.suggested ? '★ ' : ''}{nameOf(n)}</option>)}
          </select>
          {/* 🔴 제안 없음·조회 실패·전체 목록 실패를 가른다 — 제안이 없어도 전체 목록으로 고를 수 있다 */}
          {nurseQ.isError
            ? <p className="mt-0.5 text-[11px] text-rose-600" data-handoff-suggest="failed"><T k="다음 교대 근무표를 불러오지 못했습니다 — 전체 간호사에서 고르세요." /></p>
            : !nurseQ.isLoading && nextShift.entries.length === 0
              ? <p className="mt-0.5 text-[11px] text-amber-700" data-handoff-suggest="none"><T k="근무표에 다음 교대자가 없어 제안하지 못했습니다 — 전체 간호사에서 고르세요." /></p>
              : nextShift.entries.length > 0 ? <p className="mt-0.5 text-[11px] text-gray-500" data-handoff-suggest={nextShift.entries.length}><T k="★ 다음 근무조 근무표에 있는 간호사" /></p> : null}
          {allNursesQ.isError && <p className="mt-0.5 text-[11px] text-rose-600" data-handoff-all="failed"><T k="간호사 목록을 불러오지 못했습니다." /></p>}
          {allNurses.length >= 200 && <p className="mt-0.5 text-[11px] text-amber-700"><T k="간호사 목록은 200명까지만 보입니다." /></p>}
        </div>
      </div>

      {([
        ['situation', 'S — 상황', '지금 무엇이 문제인가'],
        ['background', 'B — 배경', '진단·경과·관련 이력'],
        ['assessment', 'A — 평가', '내 판단'],
        ['recommendation', 'R — 권고', '다음 근무자가 할 일'],
      ] as const).map(([key, label, hint]) => (
        <div key={key}>
          <label className="text-[11px] text-gray-500"><T k={label} /> <span className="text-gray-400">— <T k={hint} /></span></label>
          <textarea rows={2} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
        </div>
      ))}

      <div>
        <label className="text-[11px] text-gray-500"><T k="미결 항목" /> <span className="text-gray-400">— <T k="한 줄에 하나" /></span></label>
        <textarea rows={2} value={f.pending} onChange={(e) => setF({ ...f, pending: e.target.value })}
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600"><T k="취소" /></button>
        <button type="button" onClick={() => createMut.mutate()} disabled={!canSubmit || createMut.isPending}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          <T k={createMut.isPending ? '등록 중…' : '인계 등록'} />
        </button>
      </div>
    </div>
  );
}
