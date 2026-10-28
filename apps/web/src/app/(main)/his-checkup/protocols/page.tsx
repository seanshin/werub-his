'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

type Band = { op: '>' | '>=' | '<' | '<=' | 'between'; value?: number | ''; min?: number | ''; max?: number | ''; grade: string };
type EditRule = {
  testCode: string; testName?: string; sex: string;
  normalLow: number | ''; normalHigh: number | ''; panicLow: number | ''; panicHigh: number | '';
  requiredInterpretation: boolean; interpretDept: string; bands: Band[];
};
type ApiRule = { testCode: string; sex: string; normalLow?: number | null; normalHigh?: number | null; panicLow?: number | null; panicHigh?: number | null; gradeBands?: Band[]; requiredInterpretation?: boolean; interpretDept?: string | null };
type Protocol = {
  id: string; code: string; name: string; status: string; version: number; gender: string;
  ageMin?: number | null; ageMax?: number | null; signerRoles: string[]; requireFourEyes: boolean; requireAllInterpretations: boolean; rules: ApiRule[];
};
type TestItem = { code: string; name: string; interpretDept?: string | null; referenceRange?: string | null; unit?: string | null; category?: string };

const STATUS_BADGE: Record<string, string> = { DRAFT: 'bg-amber-100 text-amber-700', ACTIVE: 'bg-emerald-100 text-emerald-700', RETIRED: 'bg-gray-100 text-gray-500' };
const ROLES = ['DOCTOR', 'NURSE', 'ADMIN'];
const GRADES = ['A', 'B', 'C1', 'C2', 'D1', 'D2'];
const OPS: { v: Band['op']; l: string }[] = [{ v: '>', l: '>' }, { v: '>=', l: '≥' }, { v: '<', l: '<' }, { v: '<=', l: '≤' }, { v: 'between', l: '구간' } /* 라벨 원문 — 렌더 시 <T> 로 조회 */];
const num = (v: number | '' | null | undefined) => (v === '' || v == null ? undefined : Number(v));

function toEdit(r: ApiRule): EditRule {
  return {
    testCode: r.testCode, sex: r.sex ?? 'ALL',
    normalLow: r.normalLow ?? '', normalHigh: r.normalHigh ?? '', panicLow: r.panicLow ?? '', panicHigh: r.panicHigh ?? '',
    requiredInterpretation: !!r.requiredInterpretation, interpretDept: r.interpretDept ?? '',
    bands: Array.isArray(r.gradeBands) ? r.gradeBands.map((b) => ({ op: b.op, value: b.value ?? '', min: b.min ?? '', max: b.max ?? '', grade: b.grade })) : [],
  };
}
function toApi(e: EditRule): ApiRule {
  return {
    testCode: e.testCode.trim(), sex: e.sex,
    normalLow: num(e.normalLow), normalHigh: num(e.normalHigh), panicLow: num(e.panicLow), panicHigh: num(e.panicHigh),
    requiredInterpretation: e.requiredInterpretation, interpretDept: e.interpretDept.trim() || null,
    gradeBands: e.bands.filter((b) => b.grade).map((b) => b.op === 'between' ? { op: b.op, min: num(b.min), max: num(b.max), grade: b.grade } : { op: b.op, value: num(b.value), grade: b.grade }),
  };
}

export default function CheckupProtocolsPage() {
  const tAttr = useTAttr();
  const [list, setList] = useState<Protocol[]>([]);
  const [sel, setSel] = useState<Protocol | null>(null);
  const [rules, setRules] = useState<EditRule[]>([]);
  const [catalog, setCatalog] = useState<TestItem[]>([]);
  const [showRetired, setShowRetired] = useState(false);
  const [preview, setPreview] = useState({ testCode: '', value: '' });
  const [previewResult, setPreviewResult] = useState('');
  const [loading, setLoading] = useState(false);

  const loadList = () => apiClient.get<{ data: Protocol[] }>('/api/v1/checkup/protocols').then((r) => setList(r.data ?? [])).catch(() => toast.error('목록 조회 실패'));
  useEffect(() => {
    loadList();
    apiClient.get<{ data: TestItem[] }>('/api/v1/checkup/test-catalog').then((r) => setCatalog((r.data ?? []) as TestItem[])).catch(() => {});
  }, []);

  const open = async (id: string) => {
    const r = await apiClient.get<{ data: Protocol }>(`/api/v1/checkup/protocols/${id}`);
    setSel(r.data); setRules((r.data.rules ?? []).map(toEdit)); setPreviewResult('');
  };

  const create = async () => {
    const code = prompt('프로토콜 코드 (예: CK-STD-2026)'); if (!code) return;
    const name = prompt('프로토콜 이름'); if (!name) return;
    setLoading(true);
    try { const r = await apiClient.post<{ data: Protocol }>('/api/v1/checkup/protocols', { code, name }); toast.success('생성됨(DRAFT)'); await loadList(); await open(r.data.id); }
    catch (e) { toast.error((e as { message?: string })?.message ?? '생성 실패'); } finally { setLoading(false); }
  };

  const saveMeta = async () => {
    if (!sel) return; setLoading(true);
    try { await apiClient.put(`/api/v1/checkup/protocols/${sel.id}`, { name: sel.name, gender: sel.gender, ageMin: sel.ageMin, ageMax: sel.ageMax, signerRoles: sel.signerRoles, requireFourEyes: sel.requireFourEyes, requireAllInterpretations: sel.requireAllInterpretations }); toast.success('메타 저장'); await loadList(); }
    catch (e) { toast.error((e as { message?: string })?.message ?? '저장 실패'); } finally { setLoading(false); }
  };

  const saveRules = async () => {
    if (!sel) return;
    const bad = rules.find((r) => !r.testCode.trim());
    if (bad) { toast.error('검사코드가 비어있는 룰이 있습니다.'); return; }
    setLoading(true);
    try { await apiClient.put(`/api/v1/checkup/protocols/${sel.id}/rules`, { rules: rules.map(toApi) }); toast.success(`룰 ${rules.length}건 저장`); await open(sel.id); }
    catch (e) { toast.error((e as { message?: string })?.message ?? '룰 저장 실패'); } finally { setLoading(false); }
  };

  const act = async (path: string, msg: string) => {
    if (!sel) return; setLoading(true);
    try { const r = await apiClient.post<{ data: Protocol }>(`/api/v1/checkup/protocols/${sel.id}/${path}`, {}); toast.success(msg); await loadList(); await open(path === 'clone' ? r.data.id : sel.id); }
    catch (e) { toast.error((e as { message?: string })?.message ?? '실패'); } finally { setLoading(false); }
  };

  const runPreview = async () => {
    if (!sel || !preview.testCode) return;
    try { const r = await apiClient.post<{ data: { finding: string; grade: string | null; panic: boolean; matched: boolean } }>(`/api/v1/checkup/protocols/${sel.id}/judge-preview`, preview); const d = r.data; setPreviewResult(`판정: ${d.finding} · 등급 ${d.grade ?? '-'}${d.panic ? ' · 위급값' : ''}${d.matched ? '' : ' (룰 미매칭)'}`); }
    catch { setPreviewResult('미리보기 실패'); }
  };

  const isDraft = sel?.status === 'DRAFT';
  const filtered = list.filter((p) => showRetired || p.status !== 'RETIRED');
  const upd = (i: number, patch: Partial<EditRule>) => setRules((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const updBand = (ri: number, bi: number, patch: Partial<Band>) => setRules((rs) => rs.map((r, idx) => idx === ri ? { ...r, bands: r.bands.map((b, j) => j === bi ? { ...b, ...patch } : b) } : r));

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <div><h1 className="text-2xl font-bold text-gray-900"><T k="검진 프로토콜" /></h1><p className="text-sm text-gray-500"><T k="판정 룰·서명 자격·검토 단계를 정의·발효합니다. (DRAFT만 수정)" /></p></div>
        <button onClick={create} disabled={loading} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"><T k="+ 새 프로토콜" /></button>
      </div>

      <div className="lg:flex lg:gap-5">
        <aside className="lg:w-72 lg:flex-none mb-4 lg:mb-0">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-2"><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /><T k="폐기(RETIRED) 표시" /></label>
          <div className="bg-white rounded-xl border border-gray-100 divide-y">
            {filtered.length === 0 && <p className="p-4 text-sm text-gray-400"><T k="프로토콜이 없습니다." /></p>}
            {filtered.map((p) => (
              <button key={p.id} onClick={() => open(p.id)} className={`w-full text-left p-3 hover:bg-gray-50 ${sel?.id === p.id ? 'bg-blue-50' : ''}`}>
                <div className="flex items-center justify-between"><span className="font-medium text-gray-900 text-sm">{p.name}</span><span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_BADGE[p.status]}`}>{p.status}</span></div>
                <div className="text-xs text-gray-400 mt-0.5">{p.code} · v{p.version} · {p.gender}</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex-1 min-w-0">
          {!sel ? <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm"><T k="좌측에서 프로토콜을 선택하세요." /></div> : (
            <div className="space-y-4">
              {/* 메타 */}
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2"><h2 className="text-lg font-bold text-gray-900">{sel.name}</h2><span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_BADGE[sel.status]}`}>{sel.status}</span><span className="text-xs text-gray-400">v{sel.version}</span></div>
                  <div className="flex gap-2">
                    {sel.status === 'DRAFT' && <button onClick={() => act('publish', '발효됨')} disabled={loading} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg disabled:opacity-50"><T k="발효" /></button>}
                    {sel.status !== 'DRAFT' && <button onClick={() => act('clone', '새 버전(DRAFT) 생성')} disabled={loading} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"><T k="새 버전 복제" /></button>}
                    {sel.status !== 'RETIRED' && <button onClick={() => act('retire', '폐기됨')} disabled={loading} className="px-3 py-1.5 text-sm border border-gray-200 text-gray-600 rounded-lg disabled:opacity-50"><T k="폐기" /></button>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <label className="block"><span className="text-xs text-gray-500"><T k="이름" /></span><input disabled={!isDraft} value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} className="w-full border rounded-lg px-2 py-1.5 mt-0.5 disabled:bg-gray-50" /></label>
                  <label className="block"><span className="text-xs text-gray-500"><T k="성별" /></span><select disabled={!isDraft} value={sel.gender} onChange={(e) => setSel({ ...sel, gender: e.target.value })} className="w-full border rounded-lg px-2 py-1.5 mt-0.5 disabled:bg-gray-50"><option value="ALL">{tAttr('전체')}</option><option value="MALE">{tAttr('남')}</option><option value="FEMALE">{tAttr('여')}</option></select></label>
                  <label className="block"><span className="text-xs text-gray-500"><T k="연령(최소/최대)" /></span><div className="flex gap-1"><input disabled={!isDraft} type="number" value={sel.ageMin ?? ''} onChange={(e) => setSel({ ...sel, ageMin: e.target.value ? Number(e.target.value) : null })} className="w-full border rounded-lg px-2 py-1.5 mt-0.5 disabled:bg-gray-50" placeholder="min" /><input disabled={!isDraft} type="number" value={sel.ageMax ?? ''} onChange={(e) => setSel({ ...sel, ageMax: e.target.value ? Number(e.target.value) : null })} className="w-full border rounded-lg px-2 py-1.5 mt-0.5 disabled:bg-gray-50" placeholder="max" /></div></label>
                  <div><span className="text-xs text-gray-500"><T k="서명 자격(역할)" /></span><div className="flex gap-2 mt-1">{ROLES.map((r) => <label key={r} className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={!isDraft} checked={sel.signerRoles?.includes(r)} onChange={(e) => setSel({ ...sel, signerRoles: e.target.checked ? [...(sel.signerRoles ?? []), r] : sel.signerRoles.filter((x) => x !== r) })} />{r}</label>)}</div></div>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!isDraft} checked={sel.requireFourEyes} onChange={(e) => setSel({ ...sel, requireFourEyes: e.target.checked })} /><T k="4-eyes(작성≠서명)" /></label>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!isDraft} checked={sel.requireAllInterpretations} onChange={(e) => setSel({ ...sel, requireAllInterpretations: e.target.checked })} /><T k="미완료 판독 0 게이트" /></label>
                </div>
                {isDraft && <button onClick={saveMeta} disabled={loading} className="mt-3 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"><T k="메타 저장" /></button>}
              </div>

              {/* 구조화 판정 룰 */}
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-900"><T k="판정 룰" /> ({rules.length})</h3>
                  {isDraft && <div className="flex gap-2"><button onClick={() => setRules((r) => [...r, { testCode: '', sex: 'ALL', normalLow: '', normalHigh: '', panicLow: '', panicHigh: '', requiredInterpretation: false, interpretDept: '', bands: [] }])} className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg"><T k="+ 검사 룰" /></button><button onClick={saveRules} disabled={loading} className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg disabled:opacity-50"><T k="룰 저장" /></button></div>}
                </div>
                <datalist id="testcodes">{catalog.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</datalist>
                {rules.length === 0 && <p className="text-sm text-gray-400 py-4 text-center"><T k="판정 룰이 없습니다." /> {isDraft && <T k="+ 검사 룰로 추가하세요." />}</p>}
                <div className="space-y-3">
                  {rules.map((r, i) => {
                    const cat = catalog.find((t) => t.code === r.testCode);
                    return (
                      <div key={i} className="border border-gray-100 rounded-lg p-3 bg-gray-50/40">
                        <div className="flex flex-wrap items-end gap-2 text-xs">
                          <label className="block"><span className="text-gray-500"><T k="검사코드" /></span><input disabled={!isDraft} list="testcodes" value={r.testCode} onChange={(e) => { const code = e.target.value; const c = catalog.find((t) => t.code === code); upd(i, { testCode: code, interpretDept: r.interpretDept || (c?.interpretDept ?? '') }); }} className="block border rounded px-2 py-1 w-32 mt-0.5 disabled:bg-gray-100 font-mono" placeholder="FBS" /></label>
                          <span className="text-gray-600 pb-1">{cat?.name ?? ''}{cat?.unit ? ` (${cat.unit})` : ''}</span>
                          <label className="block"><span className="text-gray-500"><T k="성별" /></span><select disabled={!isDraft} value={r.sex} onChange={(e) => upd(i, { sex: e.target.value })} className="block border rounded px-1.5 py-1 mt-0.5 disabled:bg-gray-100"><option value="ALL">{tAttr('전체')}</option><option value="MALE">{tAttr('남')}</option><option value="FEMALE">{tAttr('여')}</option></select></label>
                          <label className="block"><span className="text-gray-500"><T k="정상 하한" /></span><input disabled={!isDraft} type="number" value={r.normalLow} onChange={(e) => upd(i, { normalLow: e.target.value === '' ? '' : Number(e.target.value) })} className="block border rounded px-2 py-1 w-20 mt-0.5 disabled:bg-gray-100" /></label>
                          <label className="block"><span className="text-gray-500"><T k="정상 상한" /></span><input disabled={!isDraft} type="number" value={r.normalHigh} onChange={(e) => upd(i, { normalHigh: e.target.value === '' ? '' : Number(e.target.value) })} className="block border rounded px-2 py-1 w-20 mt-0.5 disabled:bg-gray-100" /></label>
                          <label className="block"><span className="text-gray-500"><T k="위급 하한" /></span><input disabled={!isDraft} type="number" value={r.panicLow} onChange={(e) => upd(i, { panicLow: e.target.value === '' ? '' : Number(e.target.value) })} className="block border rounded px-2 py-1 w-20 mt-0.5 disabled:bg-gray-100" /></label>
                          <label className="block"><span className="text-gray-500"><T k="위급 상한" /></span><input disabled={!isDraft} type="number" value={r.panicHigh} onChange={(e) => upd(i, { panicHigh: e.target.value === '' ? '' : Number(e.target.value) })} className="block border rounded px-2 py-1 w-20 mt-0.5 disabled:bg-gray-100" /></label>
                          <label className="flex items-center gap-1 pb-1"><input type="checkbox" disabled={!isDraft} checked={r.requiredInterpretation} onChange={(e) => upd(i, { requiredInterpretation: e.target.checked })} /><T k="필수판독" /></label>
                          {isDraft && <button onClick={() => setRules((rs) => rs.filter((_, idx) => idx !== i))} className="ml-auto text-red-500 pb-1"><T k="삭제" /></button>}
                        </div>
                        {/* 등급 경계 */}
                        <div className="mt-2 pl-2 border-l-2 border-indigo-100">
                          <div className="flex items-center gap-2 mb-1"><span className="text-[11px] font-medium text-gray-500"><T k="등급 경계" /></span>{isDraft && <button onClick={() => upd(i, { bands: [...r.bands, { op: '>=', value: '', grade: 'C1' }] })} className="text-[11px] text-blue-600"><T k="+ 경계" /></button>}</div>
                          {r.bands.length === 0 && <p className="text-[11px] text-gray-400"><T k="경계 없음 (정상범위만 사용)" /></p>}
                          {r.bands.map((b, bi) => (
                            <div key={bi} className="flex items-center gap-1.5 text-xs mb-1">
                              <select disabled={!isDraft} value={b.op} onChange={(e) => updBand(i, bi, { op: e.target.value as Band['op'] })} className="border rounded px-1 py-0.5 disabled:bg-gray-100">{OPS.map((o) => <option key={o.v} value={o.v}>{tAttr(o.l)}</option>)}</select>
                              {b.op === 'between' ? (<>
                                <input disabled={!isDraft} type="number" value={b.min ?? ''} onChange={(e) => updBand(i, bi, { min: e.target.value === '' ? '' : Number(e.target.value) })} className="border rounded px-1.5 py-0.5 w-16 disabled:bg-gray-100" placeholder="min" />
                                <span>~</span>
                                <input disabled={!isDraft} type="number" value={b.max ?? ''} onChange={(e) => updBand(i, bi, { max: e.target.value === '' ? '' : Number(e.target.value) })} className="border rounded px-1.5 py-0.5 w-16 disabled:bg-gray-100" placeholder="max" />
                              </>) : (
                                <input disabled={!isDraft} type="number" value={b.value ?? ''} onChange={(e) => updBand(i, bi, { value: e.target.value === '' ? '' : Number(e.target.value) })} className="border rounded px-1.5 py-0.5 w-20 disabled:bg-gray-100" placeholder={tAttr('값')} />
                              )}
                              <span className="text-gray-400">→</span>
                              <select disabled={!isDraft} value={b.grade} onChange={(e) => updBand(i, bi, { grade: e.target.value })} className="border rounded px-1 py-0.5 disabled:bg-gray-100">{GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</select>
                              {isDraft && <button onClick={() => upd(i, { bands: r.bands.filter((_, j) => j !== bi) })} className="text-red-400 text-[11px]">×</button>}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-2"><T k="판정 우선순위: 위급값 → 등급경계(위에서부터) → 정상범위(A/B). 등급 A=정상·C2/D1/D2=위급(CRITICAL)." /></p>
              </div>

              {/* 미리보기 */}
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <h3 className="text-sm font-bold text-gray-900 mb-2"><T k="판정 미리보기" /></h3>
                <div className="flex gap-2 items-center">
                  <input list="testcodes" value={preview.testCode} onChange={(e) => setPreview({ ...preview, testCode: e.target.value })} placeholder="testCode (예: FBS)" className="border rounded-lg px-2 py-1.5 text-sm w-40 font-mono" />
                  <input value={preview.value} onChange={(e) => setPreview({ ...preview, value: e.target.value })} placeholder={tAttr('값')} className="border rounded-lg px-2 py-1.5 text-sm w-28" />
                  <button onClick={runPreview} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg"><T k="판정" /></button>
                  {previewResult && <span className="text-sm text-gray-700 font-medium">{previewResult}</span>}
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5"><T k="발효(ACTIVE) 프로토콜 기준으로 판정합니다." /></p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
