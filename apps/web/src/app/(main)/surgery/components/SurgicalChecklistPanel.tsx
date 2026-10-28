'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { MutationError } from '@hospital-run/shared';
import { KDate } from '@/components/ui/display';
import { T, useTAttr, Tf } from '@/components/ui/i18n-text';

/**
 * WHO 수술 안전 체크리스트(IPSG.4) — 이 화면 하나가 정본이다.
 *
 * 🔴 종전에는 수술 진료 레이아웃에 **두 번째 체크리스트 UI** 가 따로 있었고, 그쪽은
 *    `POST /api/v1/surgery/:id/checklist` 에 17개 체크값을 실어 보냈지만 서버 핸들러에는
 *    `@Body` 자체가 없어(`createChecklist(surgeryId)`) **본문이 통째로 버려졌다** —
 *    그런데도 화면은 "체크리스트가 저장되었습니다"라고 말했다. 게다가 그쪽 키 이름
 *    (`patientIdentity`·`pulseOx`·`allergyChecked`·`airwayChecked`·`bloodLossRisk`·
 *     `patientConfirmed`·`anticipatedEvents`·`antibioticGiven`)은 서버 정의
 *    (`SurgeryAdvancedService.CHECKLIST_ITEMS`)와 하나도 맞지 않았고, 필수 항목인
 *    `procedure`(수술명 확인)·`site`(수술 부위 확인)는 화면에 아예 없었다.
 *
 *    → 항목 정의는 **서버가 내려주는 `items`** 만 쓴다(화면이 따로 적어두면 조용히 드리프트한다).
 *      토글은 즉시 해당 단계만 PATCH 한다 — 누르지 않은 단계에 완료 시각을 찍지 않는다.
 *
 * 🔴 2026-08-18 수렴 — 같은 사실을 말하던 화면이 넷이었다(P12).
 *    ② `/surgery` 안전체크리스트 탭 · ③ 수술준비 워크스테이션 · ④ Op Note `whoChecklist`.
 *    ②③ 은 이 컴포넌트를 호출하도록 바꾸고, ④ 는 이 정본에서 파생하도록 서버를 고쳤다.
 *
 * 🔴 "완료"의 정의 — 서버가 `${phase}CompletedAt/By` 를 **필수 항목이 전부 찼을 때만** 찍는다.
 *    항목 하나만 눌러도 저장은 된다(부분 저장 허용 — 수술 전 확인은 나눠서 입력한다).
 *    저장됐다는 것과 그 단계가 완료됐다는 것은 다른 말이고, 화면도 다르게 말한다.
 */

/* ── 수술 안전 체크리스트 (WHO Surgical Safety Checklist, IPSG.4) ── */
interface ChecklistItemDef { key: string; field: string; label: string; required: boolean }
type PhaseProgress = { requiredComplete: boolean; requiredDone: number; requiredTotal: number; doneCount: number; totalCount: number };
interface ChecklistData {
  checklist: Record<string, unknown> | null;
  items: Record<'signIn' | 'timeOut' | 'signOut', ChecklistItemDef[]>;
  progress: Record<'signIn' | 'timeOut' | 'signOut', PhaseProgress> | null;
  completedByName: Record<'signIn' | 'timeOut' | 'signOut', string | null> | null;
}
const PHASE_META: Record<string, { label: string; color: string }> = {
  signIn: { label: 'Sign In (마취 전)', color: 'indigo' },
  timeOut: { label: 'Time Out (절개 전)', color: 'amber' },
  signOut: { label: 'Sign Out (퇴실 전)', color: 'emerald' },
};

/* ── 수술 계수(count) ─────────────────────────────────────────────────────────
 * 🔴 거즈·바늘·기구 계수는 **사람이 두 번 세는 절차**다. 이 화면은 그 절차를 대신하지 않는다 —
 *    센 결과를 기록하게 할 뿐이다. 그래서:
 *      · 초기=최종 이어도 화면이 자동으로 '일치'로 채우지 않는다(오타를 '확인됨'으로 만들지 않기 위해).
 *        사람이 '일치' 또는 '해당없음'을 직접 골라야 확인으로 센다.
 *      · 초기≠최종 이면 **불일치로 고정**하고 '일치'를 고를 수 없게 한다(숨기는 방향으로는 자동이 없다).
 *      · 종합 판정도 서버가 숫자에서 다시 계산한다 — 화면이 보낸 'MATCH' 를 그대로 믿지 않는다.
 * ────────────────────────────────────────────────────────────────────────── */
const COUNT_PRESETS: Array<{ item: string; label: string }> = [
  { item: 'GAUZE', label: '거즈' },
  { item: 'SPONGE', label: '수술용 스펀지' },
  { item: 'NEEDLE', label: '바늘' },
  { item: 'INSTRUMENT', label: '기구' },
  { item: 'BLADE', label: '칼날·기타 예리물' },
];
type CountRow = { item: string; initial: string; final: string; status: '' | 'MATCH' | 'MISMATCH' | 'NA' };

/** 화면 미리보기 — 판정 정본은 서버(`deriveCountStatus`)다. 규칙은 같게 유지한다. */
function previewCountStatus(rows: CountRow[]): 'MATCH' | 'MISMATCH' | 'UNRESOLVED' {
  const entered = rows.filter(r => r.initial !== '' || r.final !== '' || r.status !== '');
  if (!entered.length) return 'UNRESOLVED';
  const numMismatch = entered.some(r => r.initial !== '' && r.final !== '' && Number(r.initial) !== Number(r.final));
  if (numMismatch || entered.some(r => r.status === 'MISMATCH')) return 'MISMATCH';
  if (entered.every(r => r.status === 'MATCH' || r.status === 'NA')) return 'MATCH';
  return 'UNRESOLVED';
}

const COUNT_STATUS_META: Record<string, { label: string; cls: string }> = {
  MATCH: { label: '일치 (확인 완료)', cls: 'bg-emerald-100 text-emerald-700' },
  MISMATCH: { label: '불일치 — 해소 기록 필요', cls: 'bg-red-100 text-red-700' },
  UNRESOLVED: { label: '확인 미완료', cls: 'bg-amber-100 text-amber-700' },
};

export function SurgicalChecklistPanel({ surgeryId, status }: { surgeryId: string; status: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['surgery-checklist', surgeryId],
    queryFn: () => apiClient.get<{ data: ChecklistData }>(`/api/v1/surgery/${surgeryId}/checklist`),
  });
  const cd = (data?.data as { data?: ChecklistData })?.data ?? (data?.data as ChecklistData | undefined);
  const checklist = cd?.checklist ?? null;
  const progress = cd?.progress ?? null;
  const byName = cd?.completedByName ?? null;

  const createMut = useMutation({
    // 생성 트리거다 — 서버 핸들러에 @Body 가 없다. 본문을 실어 보내면 조용히 버려지므로 보내지 않는다.
    mutationFn: () => apiClient.post(`/api/v1/surgery/${surgeryId}/checklist`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surgery-checklist', surgeryId] }),
  });
  const updateMut = useMutation({
    mutationFn: (vars: { phase: string; body: Record<string, unknown> }) =>
      apiClient.patch(`/api/v1/surgery/${surgeryId}/checklist/${vars.phase}`, vars.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['surgery-checklist', surgeryId] }); qc.invalidateQueries({ queryKey: ['surgery-checklist-progress'] }); toast.success('저장됨'); },
    onError: (err: MutationError) => toast.error(err?.message || '저장 실패'),
  });

  /* 계수 입력 — 서버 값에서 초기화한다(입력 중 폴링에 덮이지 않도록 surgeryId 바뀔 때만 재동기화). */
  const [countRows, setCountRows] = useState<CountRow[]>(() => COUNT_PRESETS.map(p => ({ item: p.item, initial: '', final: '', status: '' })));
  const [countNote, setCountNote] = useState('');
  const [countLoaded, setCountLoaded] = useState(false);
  useEffect(() => { setCountLoaded(false); }, [surgeryId]);
  useEffect(() => {
    if (countLoaded || !checklist) return;
    const saved = Array.isArray(checklist.countItems) ? (checklist.countItems as Array<Record<string, unknown>>) : [];
    setCountRows(COUNT_PRESETS.map(p => {
      const s = saved.find(x => x?.item === p.item);
      return {
        item: p.item,
        initial: s?.initial === undefined || s?.initial === null ? '' : String(s.initial),
        final: s?.final === undefined || s?.final === null ? '' : String(s.final),
        status: (s?.status === 'MATCH' || s?.status === 'MISMATCH' || s?.status === 'NA') ? s.status : '',
      };
    }));
    setCountNote(typeof checklist.countDiscrepancyNote === 'string' ? checklist.countDiscrepancyNote : '');
    setCountLoaded(true);
  }, [checklist, countLoaded]);

  const items = cd?.items;
  const canStart = !!progress?.signIn.requiredComplete && !!progress?.timeOut.requiredComplete;

  if (!checklist) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-amber-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900"><T k="🛡️ 수술 안전 체크리스트 (WHO)" /></h2>
            <p className="text-xs text-amber-600 mt-1"><T k="수술 시작 전 Sign-In·Time-Out 필수 항목을 완료해야 합니다. (IPSG.4)" /></p>
          </div>
          <button onClick={() => createMut.mutate()} disabled={createMut.isPending}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
            <T k="체크리스트 시작" />
          </button>
        </div>
      </div>
    );
  }

  const savedCountStatus = typeof checklist.countStatus === 'string' ? checklist.countStatus : null;
  const preview = previewCountStatus(countRows);
  const rowMismatch = (r: CountRow) => r.initial !== '' && r.final !== '' && Number(r.initial) !== Number(r.final);

  const saveCounts = () => {
    const payload = countRows
      .filter(r => r.initial !== '' && r.final !== '')
      .map(r => ({
        item: r.item,
        initial: Number(r.initial),
        final: Number(r.final),
        // 숫자가 어긋나면 사람이 무엇을 골랐든 불일치다 — 서버도 같은 판정을 다시 한다.
        status: rowMismatch(r) ? 'MISMATCH' : (r.status || undefined),
      }));
    updateMut.mutate({
      phase: 'signOut',
      body: {
        countItems: payload,
        countStatus: preview,
        countDiscrepancyNote: countNote.trim() || undefined,
      },
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900"><T k="🛡️ 수술 안전 체크리스트 (WHO · IPSG.4)" /></h2>
        {status === 'SCHEDULED' && (
          canStart
            ? <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700"><T k="✓ 수술 시작 가능" /></span>
            : <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700"><T k="⛔ 필수항목 미완료 — 시작 차단" /></span>
        )}
      </div>

      {(['signIn', 'timeOut', 'signOut'] as const).map((phase) => {
        const pItems = items?.[phase] ?? [];
        const pp = progress?.[phase];
        const localVal = (it: ChecklistItemDef) => checklist[it.field] === true;
        const completedAt = checklist[`${phase}CompletedAt`];
        return (
          <div key={phase} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
              <span className="text-sm font-semibold text-gray-800"><T k={PHASE_META[phase].label} /></span>
              <span className={`text-[11px] font-medium ${pp?.requiredComplete ? 'text-emerald-600' : 'text-red-500'}`}>
                필수 {pp?.requiredDone ?? 0}/{pp?.requiredTotal ?? 0} · 전체 {pp?.doneCount ?? 0}/{pp?.totalCount ?? 0}
              </span>
            </div>
            {/* 🔴 완료 스탬프는 필수항목이 전부 찼을 때만 찍힌다. 미완료면 시각·확인자를 말하지 않는다. */}
            <div className="px-3 py-1.5 border-b border-gray-100 text-[11px]">
              {completedAt ? (
                <span className="text-emerald-700">
                  ✓ 완료 · 확인자 {byName?.[phase] ?? '미상'} · <KDate value={String(completedAt)} mode="datetime" />
                </span>
              ) : (
                <span className="text-gray-400"><T k="미완료 — 필수 항목이 모두 확인되면 완료 시각·확인자가 기록됩니다(중간 입력은 그대로 저장됩니다)" /></span>
              )}
            </div>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {pItems.map((it) => (
                <button key={it.key}
                  onClick={() => updateMut.mutate({ phase, body: { [it.key]: !localVal(it) } })}
                  disabled={updateMut.isPending}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all ${localVal(it) ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] shrink-0 ${localVal(it) ? 'bg-emerald-600 text-white' : 'border border-gray-300'}`}>{localVal(it) ? '✓' : ''}</span>
                  <span className="text-xs text-gray-800">{it.label}{it.required && <span className="text-red-400"> *</span>}</span>
                </button>
              ))}
            </div>

            {/* ── 수술 계수 대조 (Sign-Out) ── */}
            {phase === 'signOut' && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-800"><T k="수술 계수 대조 (거즈·바늘·기구)" /></span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${COUNT_STATUS_META[savedCountStatus ?? 'UNRESOLVED'].cls}`}>
                    <T k="저장됨:" /> {savedCountStatus ? <T k={COUNT_STATUS_META[savedCountStatus]?.label ?? savedCountStatus} /> : <T k="기록 없음" />}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400">
                  <T k="두 사람이 센 결과를 그대로 적습니다. 숫자가 같아도 화면이 자동으로 &lsquo;일치&rsquo;로 채우지 않습니다 — 확인한 사람이 직접 고릅니다." />
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left font-medium py-1"><T k="품목" /></th>
                        <th className="text-left font-medium py-1 w-[80px]"><T k="초기" /></th>
                        <th className="text-left font-medium py-1 w-[80px]"><T k="최종" /></th>
                        <th className="text-left font-medium py-1 w-[150px]"><T k="확인" /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {countRows.map((r, i) => {
                        const mism = rowMismatch(r);
                        return (
                          <tr key={r.item} className={mism ? 'bg-red-50' : ''}>
                            <td className="py-1 text-gray-700"><T k={COUNT_PRESETS[i].label} /></td>
                            <td className="py-1"><input type="number" min={0} value={r.initial} inputMode="numeric"
                              onChange={e => setCountRows(p => p.map((x, j) => j === i ? { ...x, initial: e.target.value } : x))}
                              className="w-16 px-1.5 py-1 border border-gray-200 rounded text-[11px]" /></td>
                            <td className="py-1"><input type="number" min={0} value={r.final} inputMode="numeric"
                              onChange={e => setCountRows(p => p.map((x, j) => j === i ? { ...x, final: e.target.value } : x))}
                              className="w-16 px-1.5 py-1 border border-gray-200 rounded text-[11px]" /></td>
                            <td className="py-1">
                              {mism ? (
                                <span className="text-[10px] font-bold text-red-700"><T k="불일치 (숫자 불일치 — 변경 불가)" /></span>
                              ) : (
                                <select value={r.status}
                                  onChange={e => setCountRows(p => p.map((x, j) => j === i ? { ...x, status: e.target.value as CountRow['status'] } : x))}
                                  className="px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white">
                                  <option value=""><T k="확인 필요" /></option>
                                  <option value="MATCH"><T k="일치" /></option>
                                  <option value="MISMATCH"><T k="불일치" /></option>
                                  <option value="NA"><T k="해당없음" /></option>
                                </select>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {preview === 'MISMATCH' && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-red-700">
                      <T k="불일치 — 재계수·영상(X-ray) 확인 등" /> <b><T k="해소 기록" /></b> <T k="없이는 수술을 종료할 수 없습니다(잔류이물 방지)." />
                    </p>
                    <textarea value={countNote} onChange={e => setCountNote(e.target.value)} rows={2}
                      placeholder={tAttr('해소 기록 (예: 재계수 2회 시행, 이동형 X-ray 확인 — 잔류물 없음, 판독 OO)')}
                      className="w-full px-2 py-1.5 border border-red-200 rounded text-[11px]" />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${COUNT_STATUS_META[preview].cls}`}><Tf k="입력 중: {상태}" params={{ 상태: tAttr(COUNT_STATUS_META[preview].label) }} /></span>
                  <button onClick={saveCounts} disabled={updateMut.isPending}
                    className="px-3 py-1.5 text-[11px] font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
                    <T k="계수 저장" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[10px] text-gray-400"><T k="* 필수 항목. Sign-In·Time-Out 필수항목 미완료 시 수술 시작이 차단됩니다 (JCI IPSG.4 / WHO 수술 안전 체크리스트)." /></p>
    </div>
  );
}
