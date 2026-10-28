'use client';

import { useEffect, useState, useCallback } from 'react';
import { kdate } from '@/lib/ui-settings';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { DOC_ISSUANCE_STATUS_LABEL } from '@hospital-run/shared';
import PatientSelector from '@/components/ui/PatientSelector';
import { T, useTAttr } from '@/components/ui/i18n-text';

type Item = {
  id: string; type: string; status: string; purpose?: string; createdAt: string;
  issuedDocumentId?: string; patient: { mrn?: string; name: string };
};
type DeathForm = { deathDate?: string; deathLocation?: string; deathType?: string; causeChain?: { a?: string; b?: string; c?: string; d?: string }; certKind?: 'DEATH_CERT' | 'POSTMORTEM' };
type BirthForm = { deliveryId?: string; birthOrder?: number };
type BirthDraft = { deliveryId: string; deliveredAt?: string; deliveryType?: string; gestationalWeeks?: string; newborns: { birthOrder: number; sex: string; birthAt: string; weightG?: number | null }[] };
type CertForm = { encounterId?: string; diagnoses: { kcdCode?: string; name?: string }[]; onsetDate?: string; treatmentOpinion?: string; purpose?: string; death?: DeathForm; birth?: BirthForm };
type Artifact = { id: string; authoredJson?: CertForm | null; signedAt?: string | null };
type Detail = { request: Item & { artifacts: Artifact[]; encounterId?: string | null } };

const TYPE_LABEL: Record<string, string> = { DIAGNOSIS_CERT: '진단서', OPINION: '소견서', ADMISSION_CERT: '입퇴원확인서', DEATH_CERT: '사망진단서', BIRTH_CERT: '출생증명서' };
const STATUS_LABEL = DOC_ISSUANCE_STATUS_LABEL; // 정본(docIssuance)
const BGROUP = ['DIAGNOSIS_CERT', 'OPINION', 'ADMISSION_CERT', 'DEATH_CERT', 'BIRTH_CERT'];
const DEATH_LOCATIONS: [string, string][] = [['HOSPITAL', '병실'], ['ER', '응급실'], ['OR', '수술실'], ['ICU', '중환자실'], ['OTHER', '기타']];
const DEATH_TYPES: [string, string][] = [['NATURAL', '병사'], ['EXTERNAL', '외인사'], ['OTHER', '기타 및 불상']];

/** 진단서 워크스테이션 — 담당의가 진단서·소견서·입퇴원확인서 요청을 작성·서명·발급(의료법 §17) */
export default function CertificateWorkstationPage() {
  const tAttr = useTAttr();
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<Detail | null>(null);
  const [cert, setCert] = useState<CertForm>({ diagnoses: [] });
  const [draftInfo, setDraftInfo] = useState<{ isAttending?: boolean; encounterId?: string | null; chronicSummary?: string | null; suggestedKind?: string | null; birthDraft?: BirthDraft | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  // 진료 화면 '진단서·소견서'가 환자·종류를 넘긴다 — 접수 창을 그 값으로 연다(환자를 다시 찾지 않게)
  const [prefill] = useState(() => {
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams(window.location.search);
    const patientId = q.get('patientId'); const type = q.get('type');
    if (!patientId) return null;
    // 환자 차트(의무기록 탭)는 환자만 넘긴다 — 종류는 비워 둔다(고르지 않은 종류를 미리 채우지 않는다 · 2026-10-03)
    if (!type) return { patientId, type: '' };
    return BGROUP.includes(type) ? { patientId, type } : null;
  });
  const [showIntake, setShowIntake] = useState(!!prefill);
  /** 조회에 실패한 증명서 유형 — 빈 배열이어야 목록이 완전하다 */
  const [failedTypes, setFailedTypes] = useState<string[]>([]);

  const loadQueue = useCallback(async () => {
    // 🔴 종전에는 유형별 조회 실패를 `.catch(() => [])` 로 접었다. 진단서 조회만 죽어도
    //    그 유형의 요청 전부가 **말없이 큐에서 빠졌고**, 셋 다 죽으면 화면은
    //    "처리할 증명서 요청이 없습니다"라고 단정했다 — 조회 실패가 '요청 없음'으로 읽혔다.
    //    부분 성공은 살리되 **어느 유형을 못 읽었는지 화면이 말한다.**
    const settled = await Promise.all(BGROUP.map(async (t) => {
      try {
        const r = await apiClient.get<{ data: { items: Item[] } }>(`/api/v1/staff/document-requests?type=${t}`);
        return { type: t, items: r.data.items ?? [], ok: true };
      } catch {
        return { type: t, items: [] as Item[], ok: false };
      }
    }));
    setFailedTypes(settled.filter((s) => !s.ok).map((s) => s.type));
    const merged = settled.flatMap((s) => s.items).filter((it) => showRejected || (it.status !== 'REJECTED' && it.status !== 'DELIVERED'))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    setItems(merged);
  }, [showRejected]);

  useEffect(() => { loadQueue(); const t = setInterval(loadQueue, 8000); return () => clearInterval(t); }, [loadQueue]);

  const openDetail = async (id: string) => {
    try {
      const r = await apiClient.get<{ data: Detail }>(`/api/v1/staff/document-requests/${id}`);
      setSel(r.data); setDraftInfo(null);
      const authored = r.data.request.artifacts?.[0]?.authoredJson;
      setCert(authored ? { ...authored, diagnoses: authored.diagnoses ?? [] } : { diagnoses: [], purpose: r.data.request.purpose });
    } catch { toast.error('상세 조회 실패'); }
  };

  const loadDraft = async (id: string) => {
    try {
      const r = await apiClient.get<{ data: { encounterId: string | null; isAttending: boolean; draft: (CertForm & { death?: DeathForm & { deathDate?: string }; birth?: BirthDraft }) | null; chronicSummary: { text: string } | null; suggestedKind?: string | null } }>(`/api/v1/staff/document-requests/${id}/draft`);
      const birthDraft = (r.data.draft as { birth?: BirthDraft } | null)?.birth ?? null;
      setDraftInfo({ isAttending: r.data.isAttending, encounterId: r.data.encounterId, chronicSummary: r.data.chronicSummary?.text ?? null, suggestedKind: r.data.suggestedKind ?? null, birthDraft });
      if (r.data.draft) {
        const d = r.data.draft;
        setCert({
          ...d, encounterId: r.data.encounterId ?? undefined, diagnoses: d.diagnoses ?? [],
          death: d.death ? { ...d.death, deathDate: d.death.deathDate ? String(d.death.deathDate).slice(0, 16) : undefined } : undefined,
          // 출생: 단태아면 자동 지정, 다태아는 의사가 순번을 고른다(자동 단정 금지)
          birth: birthDraft ? { deliveryId: birthDraft.deliveryId, birthOrder: birthDraft.newborns.length === 1 ? birthDraft.newborns[0].birthOrder : undefined } : undefined,
        });
      }
      else toast.info(r.data && 'suggestedKind' in r.data ? '자동 채울 원천 기록(사망 처리/분만 기록)이 없습니다.' : '자동 채울 진료기록이 없습니다.');
    } catch { toast.error('초안 로드 실패'); }
  };

  const act = async (id: string, path: string, body: object, ok: string) => {
    setBusy(true);
    try { await apiClient.post(`/api/v1/staff/document-requests/${id}/${path}`, body); toast.success(ok); await openDetail(id); await loadQueue(); }
    catch (e) { toast.error((e as { message?: string })?.message ?? '실패'); }
    finally { setBusy(false); }
  };

  const r = sel?.request;
  const art = sel?.request.artifacts?.[0];
  const signed = !!art?.signedAt;
  const issued = !!r?.issuedDocumentId;
  const setDx = (i: number, k: 'name' | 'kcdCode', v: string) => setCert((c) => ({ ...c, diagnoses: c.diagnoses.map((d, j) => j === i ? { ...d, [k]: v } : d) }));

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-900"><T k="진단서 워크스테이션" /></h2>
        <button onClick={() => setShowIntake(true)} className="min-h-[44px] px-4 rounded-xl bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900">+ <T k="창구 접수" /></button>
      </div>
      <p className="text-sm text-gray-500 mb-4"><T k="진단서·소견서·입퇴원확인서·사망진단서·출생증명서를 자격 있는 의사가 작성·전자서명·발급합니다(의료법 §17). 사망진단서는 포털 신청이 성립하지 않아 창구 접수로 들어옵니다." /></p>

      <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
        <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
        {/* 🔴 라벨이 동작과 달랐다 — 필터가 거르는 것은 `DELIVERED`(교부완료)인데 "발급완료"라고 썼다.
             `READY`(발급완료)는 체크 없이도 보인다. 라벨을 **정본에서 만들어** 다시 갈라지지 않게 한다. */}
        <T k={STATUS_LABEL.DELIVERED} />·<T k={STATUS_LABEL.REJECTED} /> <T k="포함" />
      </label>

      {failedTypes.length > 0 && (
        <div className="mb-3">
          <QueryErrorFallback
            size="compact"
            error={new Error(`${failedTypes.map((t) => TYPE_LABEL[t] ?? t).join('·')} 조회에 실패했습니다 — 요청이 없는 것이 아니라 목록이 불완전합니다.`)}
            onRetry={loadQueue}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border divide-y">
          {items.length === 0 && (failedTypes.length > 0
            ? <div className="p-6 text-sm text-red-600"><T k="요청이 없는 것이 아니라 조회에 실패했습니다." /></div>
            : <div className="p-6 text-sm text-gray-400"><T k="처리할 증명서 요청이 없습니다." /></div>)}
          {items.map((it) => (
            <button key={it.id} onClick={() => openDetail(it.id)} className={`w-full text-left p-3 hover:bg-gray-50 ${sel?.request.id === it.id ? 'bg-blue-50' : ''}`}>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-gray-900">{it.patient.name} <span className="text-gray-400 font-normal">{it.patient.mrn}</span></span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600"><T k={TYPE_LABEL[it.type] ?? it.type} /></span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5"><T k={STATUS_LABEL[it.status] ?? it.status} /> · {it.purpose || <T k="목적 미기재" />}</div>
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl border p-4">
          {!r && <div className="text-sm text-gray-400"><T k="좌측에서 요청을 선택하세요." /></div>}
          {r && (
            <>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-base font-bold text-gray-900">{r.patient.name} <span className="text-sm text-gray-400">{r.patient.mrn}</span></div>
                  <div className="text-xs text-gray-500"><T k={TYPE_LABEL[r.type]} /> · <T k={STATUS_LABEL[r.status]} /> {signed && !issued && <span className="text-emerald-600">· <T k="서명완료" /></span>}</div>
                </div>
                {issued && <span className="text-[11px] font-mono text-emerald-600">{r.issuedDocumentId}</span>}
              </div>
              <div className="text-sm text-gray-600 mb-3"><T k="목적" />: {r.purpose || '-'}</div>

              {!issued && (
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700"><T k="증명서 작성" /></span>
                    <button onClick={() => loadDraft(r.id)} disabled={busy || signed} className="text-xs px-2 py-1 border rounded-lg text-gray-600 disabled:opacity-50"><T k="진료기록 자동채움" /></button>
                  </div>
                  {draftInfo && draftInfo.isAttending === false && ['DIAGNOSIS_CERT', 'DEATH_CERT', 'BIRTH_CERT'].includes(r.type) && (
                    <p className="text-[11px] text-red-500">⚠️ <T k="작성 자격(직접 진찰·사망 확인·분만 관여)이 확인되지 않습니다 — 서버가 작성 시 거부합니다(의료법 §17)." /></p>
                  )}

                  {r.type === 'DEATH_CERT' && (
                    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-gray-600"><T k="사망진단서 — 원천은 사망 처리 기록(환자 차트)" /></span>
                        {draftInfo?.suggestedKind && (
                          <span className="text-[10px] text-amber-700"><T k="48시간 규칙 제안" />: <T k={draftInfo.suggestedKind === 'DEATH_CERT' ? '사망진단서' : '시체검안서'} /> (<T k="확정은 의사" />)</span>
                        )}
                        {draftInfo && draftInfo.suggestedKind === null && (
                          <span className="text-[10px] text-gray-400"><T k="최종 진료 기록 부재 — 서식 종류 판정 불가(의사가 정합니다)" /></span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={cert.death?.certKind ?? ''} onChange={(e) => setCert((c) => ({ ...c, death: { ...c.death, certKind: (e.target.value || undefined) as DeathForm['certKind'] } }))} disabled={signed} className="px-2 py-1 border rounded text-xs disabled:bg-gray-50">
                          <option value="">{tAttr('서식 종류 — 선택')}</option>
                          <option value="DEATH_CERT">{tAttr('사망진단서')}</option>
                          <option value="POSTMORTEM">{tAttr('시체검안서')}</option>
                        </select>
                        <input type="datetime-local" value={cert.death?.deathDate ?? ''} onChange={(e) => setCert((c) => ({ ...c, death: { ...c.death, deathDate: e.target.value } }))} disabled={signed} className="px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                        <select value={cert.death?.deathLocation ?? ''} onChange={(e) => setCert((c) => ({ ...c, death: { ...c.death, deathLocation: e.target.value || undefined } }))} disabled={signed} className="px-2 py-1 border rounded text-xs disabled:bg-gray-50">
                          <option value="">{tAttr('사망 장소 — 선택')}</option>
                          {DEATH_LOCATIONS.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
                        </select>
                        <select value={cert.death?.deathType ?? ''} onChange={(e) => setCert((c) => ({ ...c, death: { ...c.death, deathType: e.target.value || undefined } }))} disabled={signed} className="px-2 py-1 border rounded text-xs disabled:bg-gray-50">
                          <option value="">{tAttr('사망의 종류 — 선택')}</option>
                          {DEATH_TYPES.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
                        </select>
                      </div>
                      {(['a', 'b', 'c', 'd'] as const).map((k) => (
                        <input key={k} value={cert.death?.causeChain?.[k] ?? ''} onChange={(e) => setCert((c) => ({ ...c, death: { ...c.death, causeChain: { ...c.death?.causeChain, [k]: e.target.value } } }))} disabled={signed}
                          placeholder={tAttr(k === 'a' ? '(가) 직접 사인 — 필수' : k === 'b' ? '(나) (가)의 원인' : k === 'c' ? '(다) (나)의 원인' : '(라) (다)의 원인')}
                          className="w-full px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                      ))}
                    </div>
                  )}

                  {r.type === 'BIRTH_CERT' && (
                    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                      <span className="text-[11px] font-bold text-gray-600"><T k="출생증명서 — 원천은 분만·신생아 기록(수정 불가·자동채움으로 불러오세요)" /></span>
                      {!draftInfo?.birthDraft && <p className="text-[11px] text-gray-400"><T k='먼저 "진료기록 자동채움"으로 분만 기록을 불러오세요.' /></p>}
                      {draftInfo?.birthDraft && (
                        <>
                          <p className="text-[11px] text-gray-600">
                            <T k="분만" /> {draftInfo.birthDraft.deliveredAt ? kdate(draftInfo.birthDraft.deliveredAt, 'datetimeSec') : '-'} · {draftInfo.birthDraft.deliveryType ?? '-'} · <T k="주수" /> {draftInfo.birthDraft.gestationalWeeks ?? '-'}
                          </p>
                          <select value={cert.birth?.birthOrder ?? ''} onChange={(e) => setCert((c) => ({ ...c, birth: { deliveryId: draftInfo.birthDraft!.deliveryId, birthOrder: e.target.value ? Number(e.target.value) : undefined } }))} disabled={signed} className="w-full px-2 py-1 border rounded text-xs disabled:bg-gray-50">
                            <option value="">{tAttr('대상 신생아 — 선택')}{draftInfo.birthDraft.newborns.length > 1 ? ` ${tAttr('(다태아: 순번별 각각 발급)')}` : ''}</option>
                            {draftInfo.birthDraft.newborns.map((n) => (
                              <option key={n.birthOrder} value={n.birthOrder}>
                                {n.birthOrder}번 · {n.sex === 'M' ? tAttr('남') : n.sex === 'F' ? tAttr('여') : n.sex} · {kdate(n.birthAt, 'datetimeSec')}{n.weightG != null ? ` · ${n.weightG}g` : ''}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  )}

                  {r.type !== 'DEATH_CERT' && r.type !== 'BIRTH_CERT' && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between"><span className="text-[11px] text-gray-400"><T k="진단" /></span>
                      <button onClick={() => setCert((c) => ({ ...c, diagnoses: [...c.diagnoses, {}] }))} disabled={signed} className="text-[11px] text-blue-600 disabled:opacity-50">+ <T k="추가" /></button></div>
                    {cert.diagnoses.map((d, i) => (
                      <div key={i} className="flex gap-1">
                        <input value={d.name ?? ''} onChange={(e) => setDx(i, 'name', e.target.value)} disabled={signed} placeholder={tAttr('진단명')} className="flex-1 px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                        <input value={d.kcdCode ?? ''} onChange={(e) => setDx(i, 'kcdCode', e.target.value)} disabled={signed} placeholder="KCD" className="w-24 px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                      </div>
                    ))}
                  </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {r.type !== 'DEATH_CERT' && r.type !== 'BIRTH_CERT' && (
                      <input type="date" value={cert.onsetDate?.slice(0, 10) ?? ''} onChange={(e) => setCert((c) => ({ ...c, onsetDate: e.target.value }))} disabled={signed} className="px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                    )}
                    <input value={cert.purpose ?? ''} onChange={(e) => setCert((c) => ({ ...c, purpose: e.target.value }))} disabled={signed} placeholder={tAttr('용도')} className="px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                  </div>
                  {draftInfo?.chronicSummary && !signed && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-amber-800"><T k="만성질환 경과 (자동·SoT 파생)" /></span>
                        <button onClick={() => setCert((c) => ({ ...c, treatmentOpinion: `${c.treatmentOpinion ? c.treatmentOpinion + '\n' : ''}${draftInfo.chronicSummary}` }))} className="text-[11px] px-2 py-0.5 bg-amber-600 text-white rounded"><T k="치료의견에 삽입" /></button>
                      </div>
                      <pre className="whitespace-pre-wrap text-gray-700 font-sans">{draftInfo.chronicSummary}</pre>
                    </div>
                  )}
                  {r.type !== 'DEATH_CERT' && r.type !== 'BIRTH_CERT' && (
                    <textarea value={cert.treatmentOpinion ?? ''} onChange={(e) => setCert((c) => ({ ...c, treatmentOpinion: e.target.value }))} disabled={signed} placeholder={tAttr('향후 치료 의견')} rows={2} className="w-full px-2 py-1 border rounded text-xs resize-none disabled:bg-gray-50" />
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {!signed && <button onClick={() => act(r.id, 'author', { ...cert, encounterId: cert.encounterId ?? draftInfo?.encounterId ?? sel?.request.encounterId }, '작성 저장됨')} disabled={busy} className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-sm disabled:opacity-50"><T k="작성 저장" /></button>}
                    {!signed && art?.authoredJson && <button onClick={() => act(r.id, 'sign', {}, '전자서명 완료')} disabled={busy} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"><T k="전자서명" /></button>}
                    {signed && <button onClick={() => act(r.id, 'issue', {}, '발급 완료')} disabled={busy} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"><T k="발급" /></button>}
                    <button onClick={() => act(r.id, 'reject', { reason: 'OTHER', detail: '' }, '반려됨')} disabled={busy} className="px-3 py-1.5 border text-gray-600 rounded-lg text-sm"><T k="반려@행위" /></button>
                  </div>
                </div>
              )}
              {issued && <p className="text-sm text-emerald-600"><T k="발급 완료 — 환자가 포털에서 다운로드할 수 있습니다." /></p>}
            </>
          )}
        </div>
      </div>

      {showIntake && <IntakeDialog initial={prefill} onClose={() => setShowIntake(false)} onCreated={() => { setShowIntake(false); loadQueue(); }} />}
    </div>
  );
}

/** 창구(원무) 접수 — N-W1. 🔴 신청인 신분·관계 확인은 창구의 대면 책임(시스템 미검증 — 화면이 그 사실을 말한다). */
function IntakeDialog({ onClose, onCreated, initial }: { onClose: () => void; onCreated: () => void; initial?: { patientId: string; type: string } | null }) {
  const [patientId, setPatientId] = useState(initial?.patientId ?? '');
  const [type, setType] = useState(initial?.type ?? '');
  const [purpose, setPurpose] = useState('');
  const [relation, setRelation] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!patientId || !type) return;
    setBusy(true);
    try {
      await apiClient.post('/api/v1/staff/document-requests', {
        patientId, type, purpose: purpose.trim() || undefined,
        ...(relation.trim() ? { requesterRelation: relation.trim(), legalBasis: type === 'DEATH_CERT' ? 'BEREAVED' : undefined } : {}),
      });
      toast.success('접수되었습니다 — 큐에서 작성·발급을 진행하세요.');
      onCreated();
    } catch (e) { toast.error((e as { message?: string })?.message ?? '접수 실패'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-gray-900">증명서 창구 접수</h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">대상 환자 *</label>
            <PatientSelector value={patientId} onChange={(id) => setPatientId(id)} autoFocus={!initial} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">서류 종류 *</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <option value="">— 선택 —</option>
              {BGROUP.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">용도</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">신청인 관계(대리 신청 시)</label>
            <input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="예: 배우자·자녀 (사망진단서=유족)" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <p className="mt-1 text-[11px] text-amber-700">신분·관계 확인은 창구의 대면 책임입니다 — 시스템은 검증하지 않고 기록만 남깁니다.</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700">취소</button>
          <button onClick={submit} disabled={busy || !patientId || !type} className="min-h-[44px] rounded-lg bg-gray-800 px-4 text-sm font-bold text-white disabled:opacity-50">
            {busy ? '접수 중…' : '접수'}
          </button>
        </div>
      </div>
    </div>
  );
}
