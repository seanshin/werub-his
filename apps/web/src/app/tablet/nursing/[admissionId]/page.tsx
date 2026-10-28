'use client';

import { use, useState } from 'react';
import { Unit } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import {
  MedDoubleCheckPanel, DoubleCheckBypassBadge, doubleCheckScopeOf, doubleCheckReady,
  doubleCheckPayload, EMPTY_DOUBLE_CHECK, type DoubleCheckValue,
} from '@/components/nursing/MedDoubleCheck';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { kstToday } from '@/lib/kst-today';

interface CarePlan { assessments: { id: string; diagnoses: { id: string; nandaName: string; status: string }[] }[] }
interface Sbar { enabled: boolean; sbar: { situation: string; background: string; assessment: string; recommendation: string }; items: { unsignedNotes: number; overdueMeds: number; activeDiagnoses: number } }
interface Mar {
  id: string; status: string; scheduledAt: string; administeredAt?: string; dose?: string; route?: string;
  notes?: string | null;
  prescription?: { route?: string | null; medicationCode?: { nameKo?: string; highAlertFlag?: boolean; highAlertCategory?: string | null } };
}
interface Note { id: string; noteType: string; status?: string; recordedAt: string; focus?: string; subjective?: string; data?: string }

const MAR_TONE: Record<string, string> = { SCHEDULED: 'text-gray-600', ADMINISTERED: 'text-emerald-600', HELD: 'text-amber-600', REFUSED: 'text-rose-600', MISSED: 'text-rose-600' };
const hhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export default function NurseTabletPatient({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const [sbar, setSbar] = useState<Sbar | null>(null);
  const [scanTarget, setScanTarget] = useState<string | null>(null);
  const [sbarState, setSbarState] = useState<'idle' | 'loading' | 'ready' | 'disabled' | 'error'>('idle');

  // care-plan 으로 환자 식별·활성 진단 요약(IPSG.1 배너용 이름/병상은 보드에서 못 받으므로 care-plan 입원 컨텍스트 사용)
  const cp = useQuery({
    queryKey: ['tablet-careplan', admissionId],
    queryFn: () => apiClient.get<{ data: CarePlan }>(`/api/v1/admissions/${admissionId}/care-plan`),
  });
  const plan = ((cp.data as { data?: { data?: CarePlan } } | undefined)?.data?.data) ?? (cp.data as { data?: CarePlan } | undefined)?.data;
  const activeDx = (plan?.assessments ?? []).flatMap((a) => a.diagnoses).filter((d) => d.status === 'ACTIVE');

  const today = kstToday();
  const marQ = useQuery({
    queryKey: ['tablet-mar', admissionId, today],
    queryFn: () => apiClient.get<{ data: Mar[] }>(`/api/v1/admissions/${admissionId}/medication-schedule`, { date: today }),
  });
  const mar = (((marQ.data as { data?: { data?: Mar[] } } | undefined)?.data?.data) ?? (marQ.data as { data?: Mar[] } | undefined)?.data) ?? [];
  const marPending = mar.filter((m) => m.status === 'SCHEDULED');

  const notesQ = useQuery({
    queryKey: ['tablet-notes', admissionId],
    queryFn: () => apiClient.get<{ data: Note[] }>(`/api/v1/inpatient/${admissionId}/nursing-notes`),
  });
  const notesRaw = ((notesQ.data as { data?: { data?: Note[] } } | undefined)?.data?.data) ?? (notesQ.data as { data?: Note[] } | undefined)?.data;
  const notes = (Array.isArray(notesRaw) ? notesRaw : []).slice(0, 4);

  const genSbar = async () => {
    setSbarState('loading');
    try {
      const r = await apiClient.get<{ data: Sbar }>(`/api/v1/admissions/${admissionId}/ai-handoff-sbar`);
      const d = ((r as { data?: { data?: Sbar } })?.data?.data) ?? (r as { data?: Sbar })?.data;
      setSbar(d ?? null); setSbarState('ready');
    } catch (e) {
      setSbarState((e as { code?: string })?.code === 'AI_ASSIST_DISABLED' ? 'disabled' : 'error');
    }
  };

  // SBAR situation 에 병동/병상/이름 포함 → IPSG.1 배너 대체(별도 환자조회 없이 재사용)
  const ident = sbar?.sbar.situation;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-20 bg-white border-b px-4 h-14 flex items-center gap-2">
        <Link href="/tablet/nursing" className="min-h-[44px] inline-flex items-center text-gray-500 text-sm">← 라운드</Link>
        <div className="flex-1" />
        <span className="text-[11px] text-gray-400">환자 차트(타블렛)</span>
      </header>

      <div className="p-3 space-y-3">
        {/* IPSG.1 환자확인 배너 */}
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3">
          <p className="text-[10px] font-semibold text-indigo-700 mb-0.5">✓ 환자 확인 (IPSG.1)</p>
          <p className="text-sm text-gray-800">{ident ?? '「SBAR 생성」 시 환자·병상이 표시됩니다. 이름·MRN·병상을 반드시 대조하세요.'}</p>
          <p className="text-[11px] text-gray-500 mt-1">활성 간호진단 {activeDx.length}<Unit>건</Unit></p>
        </div>

        {/* 빠른 작업 */}
        <div className="grid grid-cols-3 gap-2">
          <Link href={`/tablet/nursing/${admissionId}/note`} className="rounded-xl bg-white border p-3 text-center active:bg-gray-50"><div className="text-lg">📝</div><div className="text-xs text-gray-700 mt-0.5">간호기록</div></Link>
          <Link href={`/inpatient/${admissionId}/nursing/care-plan`} className="rounded-xl bg-white border p-3 text-center active:bg-gray-50"><div className="text-lg">🩺</div><div className="text-xs text-gray-700 mt-0.5">간호과정</div></Link>
          <Link href={`/inpatient/${admissionId}/nursing/mar`} className="rounded-xl bg-white border p-3 text-center active:bg-gray-50"><div className="text-lg">💊</div><div className="text-xs text-gray-700 mt-0.5">투약(MAR)</div></Link>
        </div>

        {/* 활성 간호진단(care-plan) */}
        {activeDx.length > 0 && (
          <div className="rounded-2xl border bg-white p-3">
            <p className="text-xs font-semibold text-gray-600 mb-1.5">활성 간호진단</p>
            <div className="flex flex-wrap gap-1.5">
              {activeDx.map((d) => <span key={d.id} className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px]">{d.nandaName}</span>)}
            </div>
          </div>
        )}

        {/* 금일 투약(MAR) */}
        <div className="rounded-2xl border bg-white p-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-gray-600">금일 투약 (MAR)</p>
            {marPending.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px]">예정 {marPending.length}</span>}
          </div>
          {mar.length === 0 ? <p className="text-[11px] text-gray-400">금일 투약 없음</p> : (
            <div className="space-y-1">
              {mar.slice(0, 8).map((m) => (
                <div key={m.id} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-gray-400">{hhmm(m.scheduledAt)}</span>
                    <span className="flex-1 text-gray-700 truncate">
                      {m.prescription?.medicationCode?.nameKo ?? '약품명 미상'}
                      {m.prescription?.medicationCode?.highAlertFlag && (
                        <span className="ml-1 text-[8px] bg-red-600 text-white px-1 py-0.5 rounded font-bold align-middle whitespace-nowrap">⛔고위험</span>
                      )}
                    </span>
                    {m.status === 'SCHEDULED' ? (
                      <button title="BCMA 스캔 투약 — 임상 쓰기 버튼은 44px 이상(장갑 낀 손·침상 옆)" onClick={() => setScanTarget(scanTarget === m.id ? null : m.id)}
                        className="min-h-[44px] px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-medium active:bg-rose-700">스캔 투약</button>
                    ) : (
                      <span className={`text-[10px] ${MAR_TONE[m.status] ?? 'text-gray-500'}`}>{m.status === 'ADMINISTERED' ? '투여완료' : m.status}</span>
                    )}
                  </div>
                  <DoubleCheckBypassBadge notes={m.notes} className="ml-12" />
                  {scanTarget === m.id && <TabletBcmaScan mar={m} admissionId={admissionId} onDone={() => { setScanTarget(null); marQ.refetch(); }} />}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 최근 간호기록 */}
        {notes.length > 0 && (
          <div className="rounded-2xl border bg-white p-3">
            <p className="text-xs font-semibold text-gray-600 mb-1.5">최근 간호기록</p>
            <div className="space-y-1.5">
              {notes.map((n) => (
                <div key={n.id} className="text-xs border-b border-gray-50 last:border-0 pb-1.5 last:pb-0">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-[9px] font-bold">{n.noteType}</span>
                    {n.status === 'DRAFT' && <span className="px-1 py-0.5 rounded bg-gray-100 text-gray-400 text-[9px]">임시</span>}
                    <span className="text-[10px] text-gray-400">{hhmm(n.recordedAt)}</span>
                  </div>
                  <p className="text-gray-700 mt-0.5 line-clamp-2">{n.focus || n.subjective || n.data || '(내용)'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SBAR 인계(F-3) */}
        <div className="rounded-2xl border border-amber-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-amber-800">✦ {AI_ORIGIN_TEXT} SBAR 인계</span>
            <button onClick={genSbar} disabled={sbarState === 'loading'} className="min-h-[40px] px-3 rounded-lg bg-amber-600 text-white text-xs disabled:opacity-50">{sbarState === 'loading' ? '생성 중…' : sbarState === 'idle' ? 'SBAR 생성' : '다시'}</button>
          </div>
          {sbarState === 'disabled' && <p className="mt-2 text-[11px] text-gray-500">간호 {AI_ORIGIN_TEXT} 보조가 비활성 상태입니다.</p>}
          {sbarState === 'error' && <p className="mt-2 text-[11px] text-rose-600">생성 실패. 다시 시도하세요.</p>}
          {sbarState === 'ready' && sbar && (
            <div className="mt-2 space-y-2">
              {[['S', sbar.sbar.situation], ['B', sbar.sbar.background], ['A', sbar.sbar.assessment], ['R', sbar.sbar.recommendation]].map(([l, v]) => (
                <div key={l as string} className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold grid place-items-center">{l}</span>
                  <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{v as string}</p>
                </div>
              ))}
              <p className="text-[10px] text-gray-400">데이터 근거 요약(읽기 보조). 인계 책임은 간호사.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 태블릿 BCMA 연속 스캔 — 한 입력창에 손목밴드→약품 순서로 스캔(Enter 구분·스캐너 키보드 에뮬 호환) 후 자동 투약 확인 */
function TabletBcmaScan({ mar, admissionId, onDone }: { mar: Mar; admissionId: string; onDone: () => void }) {
  const [band, setBand] = useState('');
  const [med, setMed] = useState('');
  const [buf, setBuf] = useState('');
  const [busy, setBusy] = useState(false);
  const [dc, setDc] = useState<DoubleCheckValue>(EMPTY_DOUBLE_CHECK);

  // 🔴 투여량·경로를 화면이 만들어내지 않는다 — 처방에 없으면 간호사가 입력한다(P15).
  const [give, setGive] = useState({ dose: mar.dose ?? '', route: mar.route ?? mar.prescription?.route ?? '' });
  const scope = doubleCheckScopeOf(mar, give.route);
  const needInput = !give.dose.trim() || !give.route.trim();
  const dcReady = doubleCheckReady(scope, dc);
  const step = !band ? '① 손목밴드 스캔' : !med ? '② 약품 바코드 스캔'
    : needInput ? '③ 투여량·경로 확인' : !dcReady ? '④ 독립 이중확인' : '확인 중…';

  const submit = async (bandV: string, medV: string) => {
    setBusy(true);
    try {
      const res = await apiClient.patch<{ data: { warnings?: string[] } }>(`/api/v1/medication-administrations/${mar.id}/administer`, {
        dose: give.dose.trim(), route: give.route.trim(),
        patientBandScan: bandV, medScan: medV,
        ...doubleCheckPayload(scope, dc),
      });
      const raw = res?.data as unknown as { data?: { warnings?: string[] } };
      const warns = raw?.data?.warnings ?? (res?.data as unknown as { warnings?: string[] })?.warnings;
      if (warns?.length) warns.forEach((w) => toast.warning(w)); else toast.success('스캔 대조 일치 — 투약 확인 완료');
      onDone();
    } catch (e) {
      toast.error((e as { message?: string })?.message || '대조 실패 — 투약 중단');
      setBand(''); setMed(''); // 처음부터 재스캔
    } finally { setBusy(false); }
  };

  const onEnter = () => {
    const v = buf.trim();
    setBuf('');
    if (!v) return;
    if (!band) { setBand(v); return; }
    if (!med) {
      setMed(v);
      // 추가 확인이 필요 없을 때만 자동 전송 — 이중확인 대상이면 사람이 한 단계 더 거친다.
      if (!needInput && dcReady) void submit(band, v);
    }
  };

  return (
    <div className="mt-1.5 ml-10 rounded-xl bg-rose-50 border border-rose-100 p-2.5 space-y-1.5">
      <p className="text-[10px] font-semibold text-rose-700">{step} <span className="font-normal text-rose-500">(admission {admissionId.slice(0, 8)})</span></p>
      <input
        autoFocus value={buf} disabled={busy}
        onChange={(e) => setBuf(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
        placeholder={!band ? '손목밴드(MRN) 스캔 후 Enter' : '약품 바코드 스캔 후 Enter'}
        className="w-full px-2.5 py-2 border border-rose-200 rounded-lg text-xs bg-white"
      />
      <div className="flex items-center gap-2 text-[10px] text-gray-500">
        <span className={band ? 'text-emerald-600 font-medium' : ''}>밴드 {band ? `✓ ${band}` : '대기'}</span>
        <span className={med ? 'text-emerald-600 font-medium' : ''}>약품 {med ? `✓ ${med}` : '대기'}</span>
        {(band || med) && <button onClick={() => { setBand(''); setMed(''); setBuf(''); }} className="ml-auto min-h-[44px] px-3 text-rose-500 underline">재스캔</button>}
      </div>
      {band && med && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <input value={give.dose} onChange={(e) => setGive((g) => ({ ...g, dose: e.target.value }))}
              placeholder="실제 투여량" className="min-h-[44px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
            <input value={give.route} onChange={(e) => setGive((g) => ({ ...g, route: e.target.value }))}
              placeholder="투여 경로" className="min-h-[44px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
          </div>
          <MedDoubleCheckPanel scope={scope} value={dc} onChange={setDc} compact />
          <button
            onClick={() => void submit(band, med)}
            disabled={busy || needInput || !dcReady}
            className="w-full min-h-[48px] py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 active:bg-emerald-700"
          >{busy ? '확인 중…' : '투약 확인'}</button>
        </div>
      )}
    </div>
  );
}
