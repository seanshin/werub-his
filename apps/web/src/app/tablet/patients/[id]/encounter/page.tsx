'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePatient } from '@/hooks/usePatients';
import { useCreateEncounter, useUpdateEncounter, useSignEncounter, useAddPrescription, usePatientEncounters } from '@/hooks/useEncounters';
import { apiClient } from '@/lib/api-client';
import type { Patient } from '@/types/patient';
import TabletTopBar from '../../../_components/TabletTopBar';
import TabletActionBar from '../../../_components/TabletActionBar';
import TabletSummary from '../../../_components/TabletSummary';
import QuickPhraseChips from '../../../_components/QuickPhraseChips';
import PenNoteCanvas from '../../../_components/PenNoteCanvas';
import DictationButton from '../../../_components/DictationButton';
import BottomSheet from '../../../_components/BottomSheet';

// 노트(괘선) 배경 — Scribble 필기 친화(행간=괘선 36px)
const NOTE_BG = 'repeating-linear-gradient(#fcfdff, #fcfdff 35px, #e6effa 36px)';

type Soap = { subjective: string; objective: string; assessment: string; plan: string };
type CodeResult = { id: string; code: string; nameKo?: string; unitPrice?: number; insuranceCode?: string | null };
type Rx = { id?: string; type: string; name: string; detail: string };

const FIELDS: { key: keyof Soap; tag: 'S' | 'O' | 'A' | 'P'; label: string }[] = [
  { key: 'subjective', tag: 'S', label: 'S — 주관적' },
  { key: 'objective', tag: 'O', label: 'O — 객관적' },
  { key: 'assessment', tag: 'A', label: 'A — 평가' },
  { key: 'plan', tag: 'P', label: 'P — 계획' },
];

export default function TabletEncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: patientRes } = usePatient(id);
  const patient = (patientRes?.data ?? null) as Patient | null;
  const { data: pastEnc } = usePatientEncounters(id);

  const createEncounter = useCreateEncounter();
  const updateEncounter = useUpdateEncounter();
  const signEncounter = useSignEncounter();
  const addPrescription = useAddPrescription();

  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [initDone, setInitDone] = useState(false);
  const [soap, setSoap] = useState<Soap>({ subjective: '', objective: '', assessment: '', plan: '' });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [penMode, setPenMode] = useState(false); // 키보드/펜 입력 모드
  const [showSketch, setShowSketch] = useState(false);
  const [showContext, setShowContext] = useState(false); // 세로 차트참조 바텀시트
  const qc = useQueryClient();

  // 진료 첨부(펜 스케치) 목록
  type Att = { id: string; url: string; kind: string; note?: string | null; createdAt: string };
  const { data: attRes } = useQuery({
    queryKey: ['enc-attachments', encounterId],
    queryFn: () => apiClient.get<{ data: Att[] }>(`/api/v1/encounters/${encounterId}/attachments`),
    enabled: !!encounterId,
  });
  const attachments = (attRes?.data ?? []) as Att[];

  const saveSketch = async (dataUrl: string) => {
    if (!encounterId) return;
    await apiClient.post(`/api/v1/encounters/${encounterId}/attachments`, { kind: 'SKETCH', dataUrl });
    qc.invalidateQueries({ queryKey: ['enc-attachments', encounterId] });
  };

  // open DRAFT 재사용(없으면 생성) — 데스크탑/타블렛 이중 DRAFT 생성 방지
  useEffect(() => {
    if (initDone || !patient || !pastEnc) return;
    const draft = (pastEnc.data ?? []).find((e) => (e as { status?: string }).status === 'DRAFT') as
      | { id: string; subjective?: string; objective?: string; assessment?: string; plan?: string }
      | undefined;
    if (draft) {
      setEncounterId(draft.id);
      setSoap({ subjective: draft.subjective ?? '', objective: draft.objective ?? '', assessment: draft.assessment ?? '', plan: draft.plan ?? '' });
      setInitDone(true);
    } else {
      createEncounter
        .mutateAsync({ patientId: id })
        .then((res) => { setEncounterId(res.data.id); setInitDone(true); })
        .catch((e) => { setError(`진료 생성 실패: ${String((e as Error)?.message ?? '')}`); setInitDone(true); });
    }
  }, [patient, pastEnc, initDone, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = (key: keyof Soap, text: string) =>
    setSoap((p) => ({ ...p, [key]: p[key] ? `${p[key]}\n${text}` : text }));

  const handleSave = async () => {
    if (!encounterId) return;
    setSaving(true); setError(null);
    try {
      await updateEncounter.mutateAsync({ id: encounterId, data: soap });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(`저장 실패: ${String((e as Error)?.message ?? '')}`); }
    finally { setSaving(false); }
  };

  const handleSign = async () => {
    if (!encounterId) return;
    setSigning(true); setError(null);
    try {
      await updateEncounter.mutateAsync({ id: encounterId, data: soap });
      await signEncounter.mutateAsync(encounterId); // Tier2 step-up은 apiClient가 자동 처리
      router.push(`/tablet/patients/${id}`);
    } catch (e) { setError(`서명 실패: ${String((e as Error)?.message ?? '')}`); }
    finally { setSigning(false); }
  };

  // ── 처방/오더 ──
  const [rxType, setRxType] = useState<'MEDICATION' | 'LAB'>('MEDICATION');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CodeResult[]>([]);
  const [activeRx, setActiveRx] = useState<Rx[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (value: string) => {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    if (value.trim().length < 1) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      try {
        const res = await apiClient.get<{ data: CodeResult[] }>('/api/v1/code-search', { q: value, type: rxType });
        setResults((res?.data ?? []) as CodeResult[]);
      } catch { setResults([]); }
    }, 300);
  };

  const addRx = async (c: CodeResult) => {
    if (!encounterId) return;
    const payload =
      rxType === 'MEDICATION'
        ? { type: 'MEDICATION', priority: 'ROUTINE', medicationCodeId: c.id, dosage: '1정', frequency: '1일 3회', duration: 3, quantity: 3, route: 'PO' }
        : { type: 'LAB', priority: 'ROUTINE', procedureCodeId: c.id };
    try {
      const res = await addPrescription.mutateAsync({ encounterId, data: payload });
      setActiveRx((p) => [
        { id: res.data?.id, type: rxType, name: c.nameKo ?? c.code, detail: rxType === 'MEDICATION' ? '1정 1일 3회 · 3일' : '검사' },
        ...p,
      ]);
      setQ(''); setResults([]);
    } catch (e) { setError(`처방 추가 실패: ${String((e as Error)?.message ?? '')}`); }
  };

  return (
    <div className="min-h-screen flex flex-col pb-20">
      <TabletTopBar patient={patient} patientId={id} />
      <div className="px-3 py-2 text-sm text-gray-500">진료 작성 {encounterId ? '(작성중)' : '· 준비 중…'}</div>
      {error && <div className="mx-3 mb-2 px-4 py-2 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 px-3 flex-1">
        {/* 좌: 차트 참조(컨텍스트) — 가로 2-pane, 세로는 바텀시트 */}
        <section className="hidden lg:block order-2 lg:order-1">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-2 mb-2 text-sm font-semibold text-gray-600">차트 참조</div>
          <TabletSummary patientId={id} />
        </section>

        {/* 우: 작성 영역 */}
        <section className="order-1 lg:order-2 space-y-3">
          {/* SOAP — 키보드/펜(노트) 모드 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                {([['keyboard', '⌨ 키보드'], ['pen', '✎ 펜(노트)']] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setPenMode(m === 'pen')}
                    className={`min-h-[40px] px-4 rounded-lg text-sm font-semibold ${(penMode ? 'pen' : 'keyboard') === m ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {penMode && <span className="text-xs text-gray-400">펜으로 칸에 바로 필기 → 텍스트 변환(Scribble)</span>}
            </div>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-semibold text-gray-700">{f.label}</label>
                  <DictationButton onText={(t) => insert(f.key, t)} />
                </div>
                <QuickPhraseChips field={f.tag} onInsert={(t) => insert(f.key, t)} />
                <textarea
                  value={soap[f.key]}
                  onChange={(e) => setSoap((p) => ({ ...p, [f.key]: e.target.value }))}
                  rows={penMode ? 4 : 3}
                  className={`w-full rounded-xl p-3 text-base outline-none resize-y ${penMode ? 'border border-blue-100 focus:border-blue-400 leading-9' : 'border border-gray-200 focus:border-blue-400'}`}
                  style={penMode ? { background: NOTE_BG, lineHeight: '36px', minHeight: 148 } : undefined}
                />
              </div>
            ))}
          </div>

          {/* 펜 스케치(도해) */}
          {penMode && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <button onClick={() => setShowSketch((v) => !v)} className="w-full flex items-center justify-between min-h-[44px] text-sm font-semibold text-gray-700">
                <span>✎ 펜 스케치(도해·병변 표시)</span>
                <span className="text-gray-400">{showSketch ? '접기 ▴' : '펼치기 ▾'}</span>
              </button>
              {showSketch && <div className="mt-3"><PenNoteCanvas onSave={saveSketch} /></div>}
              {attachments.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-500 mb-1.5">저장된 스케치 {attachments.length}</div>
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((a) => (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block w-24 h-20 rounded-lg border border-gray-200 overflow-hidden bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.url} alt="스케치" className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 처방/오더 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-3 w-fit">
              {(['MEDICATION', 'LAB'] as const).map((t) => (
                <button key={t} onClick={() => { setRxType(t); setResults([]); setQ(''); }}
                  className={`min-h-[40px] px-4 rounded-lg text-sm font-semibold ${rxType === t ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500'}`}>
                  {t === 'MEDICATION' ? '약물' : '검사'}
                </button>
              ))}
            </div>
            <input value={q} onChange={(e) => search(e.target.value)} placeholder={rxType === 'MEDICATION' ? '약물명 검색…' : '검사명 검색…'}
              className="w-full h-12 px-4 rounded-xl border border-gray-200 text-base outline-none focus:border-blue-400" />
            {results.length > 0 && (
              <ul className="mt-2 border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-60 overflow-auto">
                {results.slice(0, 12).map((c) => (
                  <li key={c.id}>
                    <button onClick={() => addRx(c)} className="w-full text-left px-4 min-h-[48px] py-2 active:bg-blue-50 flex justify-between items-center">
                      <span className="text-base text-gray-800">{c.nameKo ?? c.code}</span>
                      <span className="text-xs text-gray-400">{c.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {activeRx.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {activeRx.map((r, i) => (
                  <li key={r.id ?? i} className="flex justify-between items-center text-base bg-gray-50 rounded-xl px-3 py-2">
                    <span className="text-gray-800">{r.name}</span>
                    <span className="text-sm text-gray-500">{r.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* 세로: 차트 참조 바텀시트(가로에선 좌측 패널이 상시 표시) */}
      <button onClick={() => setShowContext(true)} className="lg:hidden fixed bottom-[72px] left-3 z-30 min-h-[44px] px-4 rounded-2xl bg-white border border-gray-200 shadow-md text-sm font-semibold text-gray-700">▲ 차트 참조</button>
      <BottomSheet open={showContext} title="차트 참조" onClose={() => setShowContext(false)}>
        <TabletSummary patientId={id} />
      </BottomSheet>

      <TabletActionBar
        left={[{ key: 'save', label: saved ? '저장됨 ✓' : '임시저장', icon: '💾', onTap: handleSave, disabled: saving || !encounterId }]}
        right={[
          { key: 'sign', label: signing ? '서명 중…' : '서명·완료', icon: '✓', primary: true, onTap: handleSign, disabled: signing || !encounterId },
        ]}
      />
    </div>
  );
}
