'use client';

import { useState, useMemo, useEffect } from 'react';
import { kdate } from '@/lib/ui-settings';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { AiSuggestionPanel } from '@/components/ai/AiSuggestionPanel';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { SurgicalChecklistPanel } from '@/app/(main)/surgery/components/SurgicalChecklistPanel';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { SurgeryConsentStatus } from './SurgeryConsentStatus';

/* ── 타입 ── */
interface PatientRef { id?: string; familyName?: string; givenName?: string; mrn?: string; dateOfBirth?: string; gender?: string; age?: number | null }
type ConsentState = 'SIGNED' | 'PENDING' | 'NONE';
/** 서버 `WorkstationService.getSurgeryPrepQueue` 한 줄 — 수술(`surgeries`)이 정본(오더가 아니다) */
interface PrepRow {
  source: 'SURGERY';
  surgeryId: string; status: string; scheduledAt: string; pastScheduled: boolean;
  procedureName?: string | null; procedureCode?: string | null; bodySite?: string | null; laterality?: string | null;
  anesthesiaType?: string | null; admissionId?: string | null; surgeonName?: string | null;
  patient?: PatientRef | null;
  prep: {
    preAnesthesia: 'NONE' | 'DRAFT' | 'COMPLETED';
    npoConfirmed: boolean | null;
    consent: Partial<Record<'SURGERY' | 'ANESTHESIA' | 'TRANSFUSION', { state: ConsentState; matchedBy: string | null }>>;
    signInCompletedAt: string | null;
  };
}
interface PrepMeta { windowStart?: string; windowEnd?: string; staleScheduled?: number; total?: number; truncated?: boolean }

type FilterKey = 'ALL' | 'TODAY' | 'TOMORROW' | 'INCOMPLETE';

/* 🔴 여기 있던 10항목 로컬 체크리스트를 걷어냈다(2026-08-18).
 *    `useState` 전용이라 **전송 코드가 아예 없었고**(새로고침하면 사라짐), 그런데도
 *    '수술 준비 완료' 버튼을 `checklistDone < checklistTotal` 로 막고 있었다 —
 *    **아무 데도 기록되지 않는 가짜 게이트**였고, 화면은 그것을 "수술 전 체크리스트 (WHO)"라고 불렀다.
 *    WHO 체크리스트의 정본은 `SurgicalChecklistPanel`(서버 `SurgicalChecklist`) 하나다.
 *
 * 🔴 (2026-09-30) 큐가 **구조적으로 영원히 비어 있었다** — `surgery-prep` 이 오더 부서 매핑에 없었고 수술은 오더도 아니다.
 *    운영에 오늘 예정 수술 4건이 있는데 "대기 중인 수술 준비가 없습니다"였다. 이제 서버가 예정 수술(`surgeries`)을 준다.
 *    그래서 오더용 접수·준비·완료 버튼(`/workstation/order/:id/*`)을 걷었다 — 수술 id 로 부르면 404 다.
 *    준비 상태는 새로 만들지 않고 이미 있는 기록(마취전평가·동의서·WHO Sign-in)에서 읽는다 — 항목마다 보이고 합쳐 "완료"라 하지 않는다.
 *    로컬 ASA 타일·금식 체크박스(어디에도 기록되지 않았다)도 걷었다 — 금식·ASA 는 마취전평가가 정본이다.
 */

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const isIncomplete = (r: PrepRow) => r.prep.preAnesthesia !== 'COMPLETED' || r.prep.consent.SURGERY?.state !== 'SIGNED';

export default function SurgeryPrepWorkstationPage() {
  const tAttr = useTAttr();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-surgery-prep-queue'],
    queryFn: () => apiClient.get<{ data: PrepRow[]; meta?: Record<string, unknown> }>('/api/v1/workstation/station/surgery-prep/queue'),
    refetchInterval: 8000,
  });
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;
  const prepMeta = stationMeta?.surgeryPrep as PrepMeta | undefined;
  // 창 밖 예정 건 — 서버가 세지 못했으면(undefined) 말하지 않는다(0 으로 안심시키지 않되, 모르는 수를 지어내지도 않는다)
  const stale = typeof prepMeta?.staleScheduled === 'number' ? prepMeta.staleScheduled : 0;

  const rows: PrepRow[] = useMemo(() => {
    const raw = queueRes?.data;
    return Array.isArray(raw) ? raw.filter((r) => r && r.source === 'SURGERY') : [];
  }, [queueRes]);

  const today = dayKey(new Date());
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return dayKey(d); })();
  const onDay = (r: PrepRow, k: string) => dayKey(new Date(r.scheduledAt)) === k;

  const counts = useMemo(() => ({
    ALL: rows.length,
    TODAY: rows.filter((r) => onDay(r, today)).length,
    TOMORROW: rows.filter((r) => onDay(r, tomorrow)).length,
    INCOMPLETE: rows.filter(isIncomplete).length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, today, tomorrow]);

  const filtered = useMemo(() => {
    if (filter === 'TODAY') return rows.filter((r) => onDay(r, today));
    if (filter === 'TOMORROW') return rows.filter((r) => onDay(r, tomorrow));
    if (filter === 'INCOMPLETE') return rows.filter(isIncomplete);
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, today, tomorrow]);

  const selected = rows.find((r) => r.surgeryId === selectedId);

  const stats = [
    { label: '예정 수술', count: rows.length, cls: 'text-gray-700 bg-gray-50' },
    { label: '마취전평가 미완', count: rows.filter((r) => r.prep.preAnesthesia !== 'COMPLETED').length, cls: 'text-rose-700 bg-rose-50' },
    { label: '수술 동의 미서명', count: rows.filter((r) => r.prep.consent.SURGERY?.state !== 'SIGNED').length, cls: 'text-amber-700 bg-amber-50' },
    { label: '예정 시각 지남', count: rows.filter((r) => r.pastScheduled).length, cls: 'text-slate-700 bg-slate-100' },
  ];

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="수술 준비 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="예정 수술(어제~내일) · 마취전평가 · 동의서 · WHO Sign-in" /></p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/surgery" className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100"><T k="수술 목록" /></Link>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-gray-400">8s</span>
        </div>
      </div>

      {/* 창 밖·상한 — 잘랐으면 잘랐다고, 창 밖에 남은 예정 건이 있으면 있다고 */}
      {prepMeta && (stale > 0 || prepMeta.truncated) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-0.5" data-prep-meta>
          {stale > 0 && (
            <p data-prep-stale><Tf k="어제보다 전에 예정됐는데 시작·취소 기록이 없는 수술 {n}건은 이 목록에 없습니다 — 수술 목록에서 확인하세요." params={{ n: stale }} /></p>
          )}
          {prepMeta.truncated && <p data-prep-truncated><Tf k="예정 수술 {n}건 중 앞의 200건만 보입니다." params={{ n: prepMeta.total ?? 0 }} /></p>}
        </div>
      )}

      {/* 통계 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`rounded-xl p-3 ${s.cls}`}>
            <p className="text-[10px] font-medium opacity-70"><T k={s.label} /></p>
            <p className="text-2xl font-bold">{s.count}</p>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex gap-1.5">
        {([
          { key: 'ALL' as FilterKey, label: '전체' },
          { key: 'TODAY' as FilterKey, label: '오늘' },
          { key: 'TOMORROW' as FilterKey, label: '내일' },
          { key: 'INCOMPLETE' as FilterKey, label: '평가·동의 미완' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} data-prep-filter={f.key}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === f.key ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            <T k={f.label} />
            {counts[f.key] > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {/* 테이블 + 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[110px]"><T k="예정" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="수술명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="준비 기록" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={4} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : isError ? (
                <tr><td colSpan={4}><QueryErrorFallback error={error} onRetry={refetch} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="py-16 text-center text-gray-400 text-sm" data-prep-empty>
                  {rows.length === 0 ? <T k="어제~내일 예정된 수술이 없습니다" /> : <T k="이 조건에 맞는 수술이 없습니다" />}
                </td></tr>
              ) : filtered.map(r => {
                const isSelected = selectedId === r.surgeryId;
                return (
                  <tr key={r.surgeryId} onClick={() => setSelectedId(r.surgeryId)} data-prep-row={r.surgeryId}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-red-50' : 'hover:bg-gray-50/50'}`}>
                    <td className="px-4 py-3 text-xs">
                      <p className="font-mono text-gray-700">{kdate(r.scheduledAt, 'datetime')}</p>
                      {r.pastScheduled && <span className="text-[10px] font-semibold text-slate-600" data-prep-past><T k="예정 시각 지남 · 시작 기록 없음" /></span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{r.patient?.familyName}{r.patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{r.patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[220px]">
                      <p className="truncate">{r.procedureName || r.procedureCode || '-'}</p>
                      <p className="text-[10px] text-gray-400 truncate">{[r.bodySite, r.laterality, r.surgeonName].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-4 py-3"><PrepChips prep={r.prep} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 상세 패널 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selected ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-400"><T k="수술을 선택하세요" /></p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="수술 준비 상세" /></h3>
                <button onClick={() => setSelectedId(null)} aria-label={tAttr('닫기')} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* 환자 정보 */}
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs text-blue-600 font-medium"><T k="환자" /></p>
                <p className="text-sm font-bold text-gray-900">{selected.patient?.familyName}{selected.patient?.givenName}</p>
                <p className="text-[10px] text-gray-500">MRN: {selected.patient?.mrn}</p>
                <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                  <div><span className="text-gray-400"><T k="성별:" /></span> <span className="font-medium">{selected.patient?.gender === 'M' ? '남' : selected.patient?.gender === 'F' ? '여' : '-'}</span></div>
                  <div><span className="text-gray-400"><T k="생년월일:" /></span> <span className="font-medium">{selected.patient?.dateOfBirth?.split('T')[0] ?? '-'}</span></div>
                </div>
              </div>

              {/* 수술 정보 */}
              <div className="bg-red-50 rounded-xl p-3 space-y-1.5">
                <p className="text-xs text-red-600 font-medium"><T k="수술 정보" /></p>
                <p className="text-sm font-bold text-gray-900">{selected.procedureName || selected.procedureCode || '-'}</p>
                <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                  <div><span className="text-gray-400"><T k="집도의:" /></span> <span className="font-medium">{selected.surgeonName ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="마취:" /></span> <span className="font-medium">{selected.anesthesiaType ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="예정:" /></span> <span className="font-medium">{kdate(selected.scheduledAt, 'datetime')}</span></div>
                  <div><span className="text-gray-400"><T k="부위:" /></span> <span className="font-medium">{[selected.bodySite, selected.laterality].filter(Boolean).join(' · ') || '-'}</span></div>
                </div>
                {selected.pastScheduled && <p className="text-[11px] text-slate-600"><T k="예정 시각이 지났지만 수술 시작 기록이 없습니다 — 지연인지 기록 누락인지는 수술 기록에서 확인하세요." /></p>}
              </div>

              {/* 마취전평가 (정식 게이트 — R2-2) · 금식·ASA 의 정본 */}
              <PreAnesthesiaSection surgeryId={selected.surgeryId} />

              {/* WHO 수술안전 체크리스트 — 정본 패널(서버 기록). 여기서 누른 것이 그대로 원장에 남는다. */}
              <SurgicalChecklistPanel surgeryId={selected.surgeryId} status="" />

              {/* 동의서 — 동의서 원장에서 읽은 실제 상태(수술 연결 우선) */}
              <SurgeryConsentStatus patientId={selected.patient?.id} surgeryId={selected.surgeryId} />

              {/* WeRU.B 수술 위험도 */}
              <AiSurgeryRisk surgeryId={selected.surgeryId} />

              <Link href={`/surgery/${selected.surgeryId}`}
                className="block text-center min-h-[44px] leading-[44px] text-xs font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100">
                <T k="수술 상세 보기" />
              </Link>
              <p className="text-[11px] text-gray-400"><T k='준비 상태는 마취전평가·동의서·WHO Sign-in 기록에서 읽습니다 — 이 화면이 따로 "준비 완료"를 기록하지 않습니다.' /></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 준비 기록 칩 — 항목마다 상태(합쳐 "완료"라 하지 않는다) */
function PrepChips({ prep }: { prep: PrepRow['prep'] }) {
  const tone = (ok: boolean | null) => ok == null ? 'bg-gray-100 text-gray-500' : ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700';
  const consentLabel = (s?: ConsentState) => s === 'SIGNED' ? '서명' : s === 'PENDING' ? '서명 대기' : '없음';
  const pa = prep.preAnesthesia;
  return (
    <div className="flex flex-wrap gap-1 text-[10px] font-semibold" data-prep-chips>
      <span className={`px-1.5 py-0.5 rounded whitespace-nowrap ${tone(pa === 'COMPLETED')}`} data-chip-pa={pa}>
        <T k="마취전평가" /> · <T k={pa === 'COMPLETED' ? '완료' : pa === 'DRAFT' ? '작성 중' : '미작성'} />
      </span>
      <span className={`px-1.5 py-0.5 rounded whitespace-nowrap ${tone(prep.npoConfirmed)}`} data-chip-npo={String(prep.npoConfirmed)}>
        <T k="금식" /> · <T k={prep.npoConfirmed == null ? '평가 없음' : prep.npoConfirmed ? '확인' : '미확인'} />
      </span>
      {(['SURGERY', 'ANESTHESIA'] as const).map((k) => (
        <span key={k} className={`px-1.5 py-0.5 rounded whitespace-nowrap ${tone(prep.consent[k]?.state === 'SIGNED')}`} data-chip-consent={`${k}:${prep.consent[k]?.state ?? 'NONE'}`}>
          <T k={k === 'SURGERY' ? '수술 동의' : '마취 동의'} /> · <T k={consentLabel(prep.consent[k]?.state)} />
        </span>
      ))}
      <span className={`px-1.5 py-0.5 rounded whitespace-nowrap ${prep.signInCompletedAt ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`} data-chip-signin={prep.signInCompletedAt ? 'DONE' : 'NONE'}>
        Sign-in · <T k={prep.signInCompletedAt ? '완료' : '전'} />
      </span>
    </div>
  );
}

/* ── WeRU.B 수술 위험도 패널 ── */
// 2026-07-07 검토 교정: 종전 POST /ai/predict/surgery-risk는 BE에 없는 EP(항상 404)였고
// 실패가 '저위험' 초록 배지로 오표시됐음 → 실데이터 기반 GET /surgery/:id/ai-risk(BE 기존재)로 전환,
// 실패/미평가는 회색 '점검 불가'로 구분(안전 정보의 실패≠정상 원칙)
function AiSurgeryRisk({ surgeryId }: { surgeryId?: string }) {
  const [result, setResult] = useState<{ risk_level?: string; factors?: string[]; recommendations?: string[] } | null>(null);
  const [loading, setLoading] = useState(false);

  if (!surgeryId) return null; // 수술 기록 미연결 — 날조 입력으로 예측하지 않음

  const check = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: { prediction?: { risk_level?: string; factors?: string[]; recommendations?: string[] } | null; source?: string } }>(
        `/api/v1/surgery/${surgeryId}/ai-risk`,
      );
      const d = res?.data;
      setResult(d?.source === 'AI' && d.prediction
        ? d.prediction
        : { risk_level: 'UNKNOWN', factors: [`${AI_ORIGIN_TEXT} 평가를 받지 못했습니다`], recommendations: ['수동 평가 필요'] });
    } catch { setResult({ risk_level: 'UNKNOWN', factors: [`${AI_ORIGIN_TEXT} 분석 실패`], recommendations: ['수동 평가 필요'] }); }
    setLoading(false);
  };

  return (
    <div>
      <button onClick={check} disabled={loading}
        className="w-full px-3 py-2 bg-amber-50 text-amber-700 rounded-xl text-[11px] font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors">
        {loading ? `${AI_ORIGIN_TEXT} 수술 위험도 분석 중...` : `${AI_ORIGIN_TEXT} 수술 위험도 예측`}
      </button>
      {result && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-amber-700">{AI_ORIGIN_TEXT} 위험도 결과</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              result.risk_level === 'HIGH' ? 'bg-red-100 text-red-700'
              : result.risk_level === 'MODERATE' ? 'bg-amber-100 text-amber-700'
              : result.risk_level === 'LOW' ? 'bg-emerald-100 text-emerald-700'
              : 'bg-gray-100 text-gray-500'
            }`}>{result.risk_level === 'HIGH' ? '고위험' : result.risk_level === 'MODERATE' ? '중등도' : result.risk_level === 'LOW' ? '저위험' : '점검 불가'}</span>
          </div>
          {result.factors && result.factors.length > 0 && (
            <div className="text-[10px] text-amber-900 space-y-0.5">
              {result.factors.slice(0, 5).map((f, i) => <p key={i}>- {f}</p>)}
            </div>
          )}
          <p className="text-[11px] text-amber-500">{AI_ORIGIN_TEXT} 참고용 — 최종 판단은 의료진에게 있습니다</p>
        </div>
      )}
    </div>
  );
}

/** 마취전평가(정식·영속) — sign-in 게이트 조건. 필수 6요소 입력→완료 (2026-07 R2-2) */
function PreAnesthesiaSection({ surgeryId }: { surgeryId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['pre-anes', surgeryId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> | null }>(`/api/v1/surgery/${surgeryId}/pre-anesthesia`).then(r => {
      const raw = r.data as unknown as { data?: Record<string, unknown> | null };
      return raw?.data ?? (r.data as unknown as Record<string, unknown> | null);
    }),
  });
  const ev = (data ?? null) as Record<string, unknown> | null;
  const completed = ev?.status === 'COMPLETED';
  const [form, setForm] = useState({ asaClass: '', airwayMallampati: '', plan: '', npoConfirmed: false, labsReviewed: false, anesthesiaConsent: false });
  useEffect(() => {
    if (ev) setForm({
      asaClass: String(ev.asaClass ?? ''), airwayMallampati: String(ev.airwayMallampati ?? ''), plan: String(ev.plan ?? ''),
      npoConfirmed: ev.npoConfirmed === true, labsReviewed: ev.labsReviewed === true, anesthesiaConsent: ev.anesthesiaConsent === true,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev?.status, surgeryId]);
  const save = useMutation({
    mutationFn: () => apiClient.put(`/api/v1/surgery/${surgeryId}/pre-anesthesia`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pre-anes', surgeryId] }); toast.success('마취전평가 저장'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '저장 실패'),
  });
  const complete = useMutation({
    mutationFn: async () => { await apiClient.put(`/api/v1/surgery/${surgeryId}/pre-anesthesia`, form); return apiClient.post(`/api/v1/surgery/${surgeryId}/pre-anesthesia/complete`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pre-anes', surgeryId] }); toast.success('마취전평가 완료 — sign-in 게이트 통과 가능'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '필수 항목을 확인하세요'),
  });

  return (
    <div className={`rounded-xl p-3 space-y-2 ${completed ? 'bg-emerald-50' : 'bg-rose-50'}`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-semibold ${completed ? 'text-emerald-700' : 'text-rose-700'}`}><T k="마취전평가 (sign-in 게이트)" /></p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${completed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
          {completed ? '완료' : ev ? '작성 중' : '미작성'}
        </span>
      </div>
      {!completed && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <select value={form.asaClass} onChange={e => setForm(f => ({ ...f, asaClass: e.target.value }))} className="text-[11px] border border-rose-200 rounded-lg px-1.5 py-1 bg-white">
              <option value="">ASA*</option>{['1','2','3','4','5','6','2E','3E','4E'].map(v => <option key={v} value={v}>ASA {v}</option>)}
            </select>
            <select value={form.airwayMallampati} onChange={e => setForm(f => ({ ...f, airwayMallampati: e.target.value }))} className="text-[11px] border border-rose-200 rounded-lg px-1.5 py-1 bg-white">
              <option value="">{tAttr('기도*')}</option>{['I','II','III','IV'].map(v => <option key={v} value={v}>MP {v}</option>)}
            </select>
            <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} className="text-[11px] border border-rose-200 rounded-lg px-1.5 py-1 bg-white">
              <option value="">{tAttr('계획*')}</option>{['GENERAL','SPINAL','EPIDURAL','SEDATION','LOCAL'].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {([['npoConfirmed','금식(NPO)'],['labsReviewed','술전검사 리뷰'],['anesthesiaConsent','마취 동의']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.checked }))} className="w-3 h-3 rounded border-rose-300 text-rose-600" />
                {label}*
              </label>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => save.mutate()} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-white border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-100"><T k="임시 저장" /></button>
            <button onClick={() => complete.mutate()} disabled={complete.isPending} className="min-h-[48px] py-3 px-4 text-sm font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"><T k="평가 완료" /></button>
          </div>
        </>
      )}
      {completed && <p className="text-[10px] text-emerald-600">ASA {String(ev?.asaClass)} · MP {String(ev?.airwayMallampati)} · {String(ev?.plan)} — 완료 후 수정 불가(재평가는 마취과 협의)</p>}
    </div>
  );
}
