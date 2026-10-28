'use client';

/**
 * 응급 도착 상황 기록 — 첫 기록 + 추가 기록 시간순(고치지 않고 덧붙인다).
 *
 * 🔴 종전엔 등록 화면의 메모가 저장되지 않아 **어디에서도 볼 수 없었다**. 이제 환자 상세(개요)에서 보고 이어서 덧붙인다.
 * 적힌 칸만 보여 준다 — 비어 있는 칸을 "없음"으로 그리지 않는다(적지 않은 것과 없는 것은 다른 사실).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ARRIVAL_CONSCIOUSNESS_LABEL, ARRIVAL_INFO_SOURCE_LABEL, ARRIVAL_MODE_LABEL, BELONGING_CUSTODY_LABEL, COMPANION_TYPE_LABEL, INJURY_TYPE_LABEL,
  arrivalNoteHasContent,
  type ArrivalBelonging, type ArrivalConsciousness, type ArrivalInfoSource, type ArrivalMode, type CompanionType, type InjuryType,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { ArrivalNoteFields, EMPTY_ARRIVAL, toArrivalPayload, type ArrivalDraft } from '../../register/emergency/ArrivalNoteFields';

export interface ArrivalNoteRow {
  id: string; kind: 'INITIAL' | 'ADDENDUM'; createdAt: string; recordedByName: string | null;
  arrivalAt: string | null; arrivalMode: ArrivalMode | null; emsUnit: string | null;
  foundLocation: string | null; foundAt: string | null; circumstance: string | null; consciousness: ArrivalConsciousness | null;
  injuryTypes: InjuryType[] | null; companionType: CompanionType | null; companionName: string | null; companionContact: string | null; companionRelation: string | null;
  belongings: ArrivalBelonging[] | null; identifyingFeatures: string | null;
  policeInvolved: boolean | null; policeAgency: string | null; policeOfficer: string | null; policeCaseNo: string | null;
  infoSource: ArrivalInfoSource | null; note: string | null;
  prenotificationId?: string | null;
}

export function useArrivalNotes(patientId: string, enabled = true) {
  return useQuery({
    queryKey: ['arrival-notes', patientId],
    queryFn: () => apiClient.get<{ data: { patientSource: string | null; notes: ArrivalNoteRow[] } }>(`/api/v1/patients/${patientId}/arrival-notes`),
    enabled,
  });
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[108px_1fr] gap-2 text-[13px]">
      <dt className="text-gray-500"><T k={k} /></dt>
      <dd className="whitespace-pre-wrap break-words text-gray-900">{children}</dd>
    </div>
  );
}

/** 기록 한 건 — 적힌 칸만 */
export function ArrivalNoteBody({ n }: { n: ArrivalNoteRow }) {
  const tA = useTAttr();
  return (
    <dl className="space-y-1">
      {n.arrivalAt && <Row k="도착 시각"><KDate value={n.arrivalAt} mode="datetimeShort" /></Row>}
      {n.arrivalMode && <Row k="내원 수단">{tA(ARRIVAL_MODE_LABEL[n.arrivalMode])}{n.emsUnit ? ` · ${n.emsUnit}` : ''}</Row>}
      {!n.arrivalMode && n.emsUnit && <Row k="구급대·이송 기관">{n.emsUnit}</Row>}
      {n.consciousness && <Row k="도착 시 의식(AVPU)">{tA(ARRIVAL_CONSCIOUSNESS_LABEL[n.consciousness])}</Row>}
      {n.foundLocation && <Row k="발견 장소">{n.foundLocation}</Row>}
      {n.foundAt && <Row k="발견 시각"><KDate value={n.foundAt} mode="datetimeShort" /></Row>}
      {n.circumstance && <Row k="발견·도착 경위">{n.circumstance}</Row>}
      {n.injuryTypes && n.injuryTypes.length > 0 && <Row k="손상 유형">{n.injuryTypes.map((t) => tA(INJURY_TYPE_LABEL[t])).join(' · ')}</Row>}
      {(n.companionType || n.companionName) && (
        <Row k="동행·인계자">
          {[n.companionType ? tA(COMPANION_TYPE_LABEL[n.companionType]) : null, n.companionName, n.companionRelation, n.companionContact].filter(Boolean).join(' · ')}
        </Row>
      )}
      {n.belongings && n.belongings.length > 0 && (
        <Row k="소지품">{n.belongings.map((b) => `${b.item}(${tA(BELONGING_CUSTODY_LABEL[b.custody])})`).join(' · ')}</Row>
      )}
      {n.identifyingFeatures && <Row k="신체 특징·착의">{n.identifyingFeatures}</Row>}
      {n.policeInvolved != null && (
        <Row k="경찰 관여">
          {n.policeInvolved ? tA('있음') : tA('없음')}
          {[n.policeAgency, n.policeOfficer, n.policeCaseNo].filter(Boolean).length ? ` — ${[n.policeAgency, n.policeOfficer, n.policeCaseNo].filter(Boolean).join(' · ')}` : ''}
        </Row>
      )}
      {n.note && <Row k="메모">{n.note}</Row>}
    </dl>
  );
}

export function ArrivalNotesPanel({ patientId }: { patientId: string }) {
  const tA = useTAttr();
  const qc = useQueryClient();
  const q = useArrivalNotes(patientId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ArrivalDraft>(EMPTY_ARRIVAL);
  const payload = toArrivalPayload(draft);
  const save = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/patients/${patientId}/arrival-notes`, payload),
    onSuccess: () => {
      toast.success(tA('도착 상황을 기록했습니다'));
      setDraft(EMPTY_ARRIVAL);
      setAdding(false);
      qc.invalidateQueries({ queryKey: ['arrival-notes', patientId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tA('기록 실패')),
  });
  const notes = q.data?.data.notes ?? [];

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-900">🚑 <T k="도착 상황 기록" /></p>
          <p className="text-[11px] text-gray-500"><T k="처음 기록은 고치지 않고, 나중에 알게 된 사실은 추가 기록으로 덧붙입니다 — 시간순" /></p>
        </div>
        {/* 목록이 온 뒤에만 — 불러오는 중에 '첫 기록'이라 부르지 않는다 */}
        {!adding && q.isSuccess && (
          <button onClick={() => setAdding(true)} className="min-h-[44px] rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700">
            + {notes.length ? <T k="추가 기록" /> : <T k="첫 기록" />}
          </button>
        )}
      </div>

      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
        : q.isLoading ? <p className="text-[12px] text-gray-500"><T k="불러오는 중…" /></p>
        : notes.length === 0 ? <p className="rounded-xl bg-gray-50 px-3 py-2 text-[12px] text-gray-600"><T k="남긴 도착 상황 기록이 없습니다." /></p>
        : (
          <ol className="relative space-y-3 border-l-2 border-rose-100 pl-4">
            {notes.map((n, i) => (
              <li key={n.id} className="relative">
                <span className={`absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 border-white ${n.kind === 'INITIAL' ? 'bg-rose-600' : 'bg-amber-500'}`} />
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${n.kind === 'INITIAL' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                    {n.kind === 'INITIAL' ? <T k="첫 기록" /> : <Tf k="추가 기록 {n}" params={{ n: i }} />}
                  </span>
                  <KDate value={n.createdAt} mode="datetimeShort" />
                  {n.recordedByName && <span>· {n.recordedByName}</span>}
                  {n.infoSource && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600"><T k="출처" />: {tA(ARRIVAL_INFO_SOURCE_LABEL[n.infoSource])}</span>}
                  {n.prenotificationId && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700"><T k="사전통보에서 불러와 확인함" /></span>}
                </div>
                <ArrivalNoteBody n={n} />
              </li>
            ))}
          </ol>
        )}

      {adding && (
        <div className="mt-4 space-y-3 rounded-2xl border border-rose-200 bg-rose-50/30 p-3">
          <p className="text-sm font-semibold text-gray-900">{notes.length ? <T k="추가 기록 — 새로 알게 된 것만 적습니다" /> : <T k="첫 기록" />}</p>
          <ArrivalNoteFields value={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setDraft(EMPTY_ARRIVAL); }} className="min-h-[44px] rounded-xl px-4 text-sm text-gray-600 hover:bg-gray-100"><T k="취소" /></button>
            <button onClick={() => save.mutate()} disabled={!arrivalNoteHasContent(payload) || save.isPending}
              className="min-h-[44px] rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
              {save.isPending ? <T k="저장 중…" /> : <T k="기록 저장" />}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
