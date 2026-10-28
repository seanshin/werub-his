'use client';

/**
 * 위치 겹침 감염 접촉자 **후보**(기획 spatial-flow-vision-3d P5 · 결정 `infection.contactCandidates`) — 관리자 전용.
 *
 * 🔴 정직 표기:
 *   - 설정이 꺼져 있으면(기본) 조회하지 않았다고 말한다(빈 목록으로 그리지 않는다).
 *   - "후보 0" 과 "지표 환자의 볼 수 있는 위치 구간이 없음"은 다른 사실이다 — 후자를 '접촉자 없음'으로 그리지 않는다.
 *   - 관측/추정 등급을 다른 모양으로 · 추정은 설정이 허용할 때만 켤 수 있다.
 *   - 해상도는 구역 단위(같은 방이라도 거리를 모른다) · 확정·격리·통보를 하지 않는다.
 */
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactCandidateGrade } from '@hospital-run/shared';
import { ApiError, apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { Duration, KDate, PatientName } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface Candidate {
  patientId: string;
  familyName: string | null;
  givenName: string | null;
  mrn: string | null;
  grade: ContactCandidateGrade;
  overlaps: number;
  overlapMinutes: number;
  zones: (string | null)[];
  firstAt: string;
  /** 이미 접촉자로 등록됨(미해소) */
  registered: boolean;
}

/** 등록 폼 선택지 — 서버 DTO `RelationshipType`·riskLevel 과 같은 값(라벨만 화면) */
const RELATIONS = [
  { v: 'PATIENT', l: '환자' }, { v: 'ROOMMATE', l: '같은 병실' }, { v: 'VISITOR', l: '방문객' },
  { v: 'FAMILY', l: '가족' }, { v: 'HEALTHCARE_WORKER', l: '의료진' }, { v: 'OTHER', l: '기타' },
] as const;
const RISKS = [{ v: 'LOW', l: '낮음' }, { v: 'MEDIUM', l: '중간' }, { v: 'HIGH', l: '높음(접촉격리 표시)' }] as const;
const PPES = [{ v: 'YES', l: '착용' }, { v: 'NO', l: '미착용' }, { v: 'UNKNOWN', l: '모름' }] as const;

/**
 * 후보 → 접촉자 등록(기존 `POST /api/v1/infection-control/contact-traces`).
 * 🔴 쓰기 폼 초기값은 전부 **미선택** — 관계·위험도·보호구를 사람이 고르기 전에는 저장하지 않는다(보호구 '모름'도 고르는 값이다).
 * 접촉 시작 시각·시간은 위치 겹침에서 온 값이라 메모에 출처를 적는다.
 */
export function RegisterContactRow({ sourcePatientId, c, onDone }: { sourcePatientId: string; c: Candidate; onDone: () => void }) {
  const tAttr = useTAttr();
  const [rel, setRel] = useState('');
  const [risk, setRisk] = useState('');
  const [ppe, setPpe] = useState('');
  const m = useMutation({
    mutationFn: () => apiClient.post('/api/v1/infection-control/contact-traces', {
      sourcePatientId,
      contactPersonId: c.patientId,
      relationshipType: rel,
      riskLevel: risk,
      ...(ppe === 'UNKNOWN' ? {} : { wearingPPE: ppe === 'YES' }),
      contactStartDate: c.firstAt,
      contactDurationMinutes: c.overlapMinutes,
      notes: `위치 겹침 후보에서 등록 · ${c.grade === 'OBSERVED' ? '관측' : '추정'} 겹침 · ${c.zones.filter(Boolean).join(', ')}`,
    }),
    onSuccess: () => { toast.success(tAttr('접촉자로 등록했습니다')); onDone(); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'CONTACT_ALREADY_REGISTERED') { toast.info(tAttr('이미 접촉자로 등록된 환자입니다')); onDone(); return; }
      toast.error(e instanceof Error ? e.message : tAttr('등록 실패'));
    },
  });
  const sel = 'min-h-[44px] rounded-lg border px-2 text-xs';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50/60 p-2">
      <select aria-label={tAttr('관계')} value={rel} onChange={(e) => setRel(e.target.value)} className={sel}>
        <option value="">{tAttr('관계 선택')}</option>
        {RELATIONS.map((o) => <option key={o.v} value={o.v}>{tAttr(o.l)}</option>)}
      </select>
      <select aria-label={tAttr('위험도')} value={risk} onChange={(e) => setRisk(e.target.value)} className={sel}>
        <option value="">{tAttr('위험도 선택')}</option>
        {RISKS.map((o) => <option key={o.v} value={o.v}>{tAttr(o.l)}</option>)}
      </select>
      <select aria-label={tAttr('보호구')} value={ppe} onChange={(e) => setPpe(e.target.value)} className={sel}>
        <option value="">{tAttr('보호구 선택')}</option>
        {PPES.map((o) => <option key={o.v} value={o.v}>{tAttr(o.l)}</option>)}
      </select>
      <button disabled={!rel || !risk || !ppe || m.isPending} onClick={() => m.mutate()}
        className="min-h-[44px] rounded-lg bg-rose-600 px-4 text-xs font-medium text-white disabled:opacity-40">
        <T k="접촉자로 등록" />
      </button>
    </div>
  );
}
type Resp =
  | { enabled: false }
  | {
      enabled: true;
      windowDays: number;
      inferredAllowed: boolean;
      includeInferred: boolean;
      indexIntervals: { observed: number; inferred: number; openExcluded: number; floorExcluded: number; otherExcluded: number };
      candidates: Candidate[];
    };

/** EP 가 관리자 전용 — 다른 직군에게는 버튼을 그리지 않는다(누르면 403 뿐이므로) */
export function ContactCandidatesButton({ onClick }: { onClick: () => void }) {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  if (!isAdmin) return null;
  return (
    <button onClick={onClick} className="ml-2 min-h-[32px] rounded-lg border border-rose-200 px-2 text-[11px] font-normal text-rose-700 hover:bg-rose-50">
      <T k="접촉자 후보" />
    </button>
  );
}

export function ContactCandidatesPanel({ patient, onClose }: {
  patient: { id: string; familyName: string; givenName: string; mrn?: string | null };
  onClose: () => void;
}) {
  const [days, setDays] = useState(14);
  const [inferred, setInferred] = useState(false);
  const [registering, setRegistering] = useState<string | null>(null);
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const q = useQuery({
    enabled: isAdmin,
    queryKey: ['contact-candidates', patient.id, days, inferred],
    queryFn: () => apiClient.get<{ data: Resp }>(`/api/v1/infection-control/contact-candidates?patientId=${patient.id}&days=${days}&includeInferred=${inferred}`),
  });
  const d = q.data?.data;

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-rose-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          <T k="위치 겹침 접촉자 후보" /> · <PatientName familyName={patient.familyName} givenName={patient.givenName} mrn={patient.mrn} />
        </h3>
        <button onClick={onClose} className="min-h-[40px] rounded-lg border px-3 text-xs text-gray-600 hover:bg-gray-50"><T k="닫기" /></button>
      </div>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
        <T k="후보일 뿐입니다 — 위치는 구역 단위라 같은 방에 있었어도 거리는 모릅니다. 확정은 감염관리실이 행마다 「접촉자로 등록」으로 합니다(관계·위험도·보호구를 고른 뒤). 통보는 하지 않습니다." />
      </p>
      {q.isError && <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />}
      {d && !d.enabled && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          <T k="접촉자 후보 조회가 꺼져 있어 조회하지 않았습니다 — 시스템 설정 infection.contactCandidates.enabled(기본 꺼짐) · 사람 결정 infection.contactCandidates" />
        </p>
      )}
      {d && d.enabled && (<>
        <div className="flex flex-wrap items-center gap-2">
          {[7, 14, 30].map((n) => (
            <button key={n} onClick={() => setDays(n)} aria-pressed={days === n}
              className={`min-h-[40px] rounded-lg border px-3 text-xs ${days === n ? 'border-rose-600 bg-rose-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              <Tf k="최근 {일}일" params={{ 일: n }} />
            </button>
          ))}
          {d.inferredAllowed ? (
            <label className="ml-2 flex min-h-[40px] items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={inferred} onChange={(e) => setInferred(e.target.checked)} />
              <T k="추정 위치 겹침도 별도 등급으로 보기" />
            </label>
          ) : (
            <span className="ml-2 text-[11px] text-gray-400"><T k="추정 위치 겹침은 설정으로 허용되지 않았습니다(관측만)" /></span>
          )}
        </div>
        <p className="text-[11px] text-gray-500">
          <Tf k="지표 환자 위치 구간: 관측 {관측} · 추정 {추정} · 제외 — 떠난 시각 없음 {열림} · 층 단위 {층} · 시뮬레이션·출처 미상 {기타}" params={{
            관측: d.indexIntervals.observed, 추정: d.indexIntervals.inferred, 열림: d.indexIntervals.openExcluded,
            층: d.indexIntervals.floorExcluded, 기타: d.indexIntervals.otherExcluded,
          }} />
        </p>
        {d.indexIntervals.observed === 0 && (!d.includeInferred || d.indexIntervals.inferred === 0) ? (
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700">
            <T k="지표 환자에게 쓸 수 있는 위치 구간이 없어 후보를 찾을 수 없습니다 — 「접촉자 없음」이 아닙니다." />
          </p>
        ) : d.candidates.length === 0 ? (
          <p className="text-[12px] text-gray-600"><T k="기록된 위치 구간 안에서 같은 구역·겹친 시간에 있던 환자가 없습니다(기록 밖은 모릅니다)." /></p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left"><T k="등급" /></th>
                  <th className="px-3 py-2 text-left"><T k="환자" /></th>
                  <th className="px-3 py-2 text-left"><T k="구역" /></th>
                  <th className="px-3 py-2 text-right"><T k="겹친 시간" /></th>
                  <th className="px-3 py-2 text-right"><T k="겹친 구간" /></th>
                  <th className="px-3 py-2 text-left"><T k="처음 겹친 시각" /></th>
                  <th className="px-3 py-2 text-left"><T k="확정" /></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {d.candidates.map((c) => (<Fragment key={c.patientId}>
                  <tr>
                    <td className="px-3 py-2">
                      {c.grade === 'OBSERVED'
                        ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700"><T k="관측 겹침" /></span>
                        : <span className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-500"><T k="추정 겹침" /></span>}
                    </td>
                    <td className="px-3 py-2"><PatientName familyName={c.familyName} givenName={c.givenName} mrn={c.mrn} /></td>
                    <td className="px-3 py-2 text-xs text-gray-600">{c.zones.filter(Boolean).join(', ')}</td>
                    <td className="px-3 py-2 text-right"><Duration minutes={c.overlapMinutes} /></td>
                    <td className="px-3 py-2 text-right text-gray-600">{c.overlaps}</td>
                    <td className="px-3 py-2 text-xs text-gray-500"><KDate value={c.firstAt} mode="datetimeShort" /></td>
                    <td className="px-3 py-2">
                      {c.registered ? (
                        <span className="text-[11px] text-emerald-700"><T k="접촉자로 등록됨" /></span>
                      ) : (
                        <button onClick={() => setRegistering(registering === c.patientId ? null : c.patientId)}
                          className="min-h-[44px] rounded-lg border border-rose-200 px-3 text-xs text-rose-700 hover:bg-rose-50">
                          <T k="접촉자로 등록" />
                        </button>
                      )}
                    </td>
                  </tr>
                  {registering === c.patientId && !c.registered && (
                    <tr>
                      <td colSpan={7} className="px-3 pb-3">
                        <RegisterContactRow sourcePatientId={patient.id} c={c} onDone={() => {
                          setRegistering(null);
                          qc.invalidateQueries({ queryKey: ['contact-candidates', patient.id] });
                          qc.invalidateQueries({ queryKey: ['infections'] });
                        }} />
                      </td>
                    </tr>
                  )}
                </Fragment>))}
              </tbody>
            </table>
          </div>
        )}
      </>)}
    </div>
  );
}
