'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAdminWrite } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { MutationError, AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface TriageSymptom {
  id: string;
  name: string;
  category?: string;
  description?: string;
  isEmergency: boolean;
  emergencyMsg?: string;
  rules?: TriageRule[];
  aliases?: TriageAlias[];
}

interface TriageRule {
  id: string;
  symptomId?: string;
  symptom?: { name: string };
  departmentName: string;
  priority: number;
  confidence: number;
  reason?: string;
  hitCount: number;
}

interface TriageAlias {
  id: string;
  alias: string;
  symptomId?: string;
  symptom?: { name: string };
  hitCount: number;
}

interface TriageStats {
  totalSymptoms: number;
  totalRules: number;
  totalAliases: number;
  topRules?: TriageRule[];
}

/** 자가 점검 — 시스템이 환자에게 제시하는 예시 문장이 실제 DB 규칙에 걸리는가 */
interface TriageSelfCheck {
  checkedAt: string;
  total: number;
  expected: number;
  recommendable: number;
  gaps: number;
  results: {
    label: string;
    phrase: string;
    expectSymptom: boolean;
    matchedSymptoms: string[];
    emergency: boolean;
    recommendable: boolean;
    gap: boolean;
  }[];
}

/** 응급 문구 점검 — 환자용 행동 지시(119)가 들어 있는가 */
interface EmergencyMsgAudit {
  id: string;
  name: string;
  emergencyMsg: string | null;
  patientActionable: boolean;
}

interface TriageSymptomForm {
  name: string;
  category: string;
  description: string;
  isEmergency: boolean;
  emergencyMsg: string;
}

interface TriageRuleForm {
  symptomId: string;
  departmentName: string;
  priority: number;
  confidence: number;
  reason: string;
}

type Tab = 'symptoms' | 'rules' | 'aliases' | 'stats';

export default function TriageAdminPage() {
  const [tab, setTab] = useState<Tab>('symptoms');

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="트리아지 관리" /></h2>
        {/* 🔴 2026-10-21 임상 규칙 교차검증 R7 — 종전 부제 "AI 접수, 온라인 예약에서 사용"은 반만 사실이었다(온라인 예약은 이 규칙을 부르지 않는다).
            이 규칙을 읽는 곳은 원무 창구 AI 접수 상담(agent-session · HIS_RECEPTION) 하나다. 응급실 KTAS 분류·AI 재평가는 쓰지 않는다. */}
        <p className="text-sm text-gray-500 mt-1"><T k="증상 → 진료과 매핑과 응급 안내 규칙을 관리합니다." /> {AI_ORIGIN_TEXT}</p>
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" data-triage-scope>
          <p><T k="이 규칙을 쓰는 곳: 원무 창구 AI 접수 상담(증상으로 진료과 안내·응급 안내)." /></p>
          <p><T k="응급실 중증도 분류(KTAS)와 응급 AI 재평가에는 쓰이지 않습니다 — 응급 분류 기준은 여기서 바뀌지 않습니다." /></p>
          <p><T k="증상·규칙은 의사도 수정할 수 있고 승인·판 기록이 없습니다(수정은 감사 기록에만 남습니다)." /></p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: 'symptoms' as Tab, label: '증상 관리' },
          { key: 'rules' as Tab, label: '매핑 규칙' },
          { key: 'aliases' as Tab, label: '별칭 관리' },
          { key: 'stats' as Tab, label: '통계' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <T k={t.label} />
          </button>
        ))}
      </div>

      {tab === 'symptoms' && <SymptomsTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'aliases' && <AliasesTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}

// ── 증상 관리 ──
function SymptomsTab() {
  const tAttr = useTAttr();
  const canWrite = useAdminWrite(); // 🔴 삭제만 서버가 @Roles(ADMIN) — 등록·수정은 임상 허용이라 그대로 둔다
  const qc = useQueryClient();
  const [catFilter, setCatFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', category: '', description: '', isEmergency: false, emergencyMsg: '' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['triage-symptoms', catFilter],
    queryFn: () => apiClient.get<{ data: TriageSymptom[] }>('/api/v1/triage/symptoms', { category: catFilter || undefined }),
  });

  const saveMut = useMutation({
    mutationFn: (d: TriageSymptomForm) => editId
      ? apiClient.patch(`/api/v1/triage/symptoms/${editId}`, d)
      : apiClient.post('/api/v1/triage/symptoms', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['triage-symptoms'] }); setShowForm(false); setEditId(null); toast.success('저장 완료'); },
    onError: (e: MutationError) => toast.error(e.message ?? '오류가 발생했습니다.'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/triage/symptoms/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['triage-symptoms'] }); toast.success('비활성화됨'); },
  });

  // 🔴 원 결함 T7 — BE 가 `{data:{data:[…]}}` 로 이중 래핑해 탭마다 방어 언랩이 붙어 있었고
  //    방어가 없던 통계 탭은 모든 수치가 0 이었다. BE 를 단일 래핑으로 고쳤으므로 여기도 한 겹만 벗긴다.
  const symptoms: TriageSymptom[] = data?.data ?? [];
  const categories: string[] = [...new Set<string>(symptoms.map((s: TriageSymptom) => s.category).filter((c): c is string => !!c))];

  const startEdit = (s: TriageSymptom) => {
    setForm({ name: s.name, category: s.category ?? '', description: s.description ?? '', isEmergency: s.isEmergency, emergencyMsg: s.emergencyMsg ?? '' });
    setEditId(s.id); setShowForm(true);
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm">
            <option value="">{tAttr('전체 카테고리')}</option>
            {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={() => { setForm({ name: '', category: '', description: '', isEmergency: false, emergencyMsg: '' }); setEditId(null); setShowForm(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"><T k="+ 증상 추가" /></button>
      </div>

      {showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-bold text-blue-900"><T k={editId ? '증상 수정' : '증상 추가'} /></h4>
          <div className="grid grid-cols-3 gap-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={tAttr('증상명 (예: 두통)')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder={tAttr('카테고리 (예: 신경계)')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={tAttr('설명')} className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isEmergency} onChange={e => setForm({ ...form, isEmergency: e.target.checked })} className="rounded" />
              <span className="text-red-600 font-medium"><T k="응급 키워드" /></span>
            </label>
            {form.isEmergency && (
              <input value={form.emergencyMsg} onChange={e => setForm({ ...form, emergencyMsg: e.target.value })}
                placeholder={tAttr('응급 메시지 — 환자에게 보이려면 119/응급실 안내를 포함하세요')} className="flex-1 px-3 py-2 border rounded-lg text-sm" />
            )}
          </div>
          {/* 🔴 T6 — DB 응급 문구가 감별진단 임상 메모라 환자(공개 예약 챗)에게 그대로 나갔다. 규칙을 화면이 말한다. */}
          {form.isEmergency && (
            <p className="text-xs text-amber-700">
              119·응급실 안내가 없는 문구는 <strong>임상 메모</strong>로 보고 환자에게 내보내지 않습니다
              (환자에게는 코드 정본의 119 안내가 나가고, 이 문구는 원무 데스크에만 참고로 붙습니다).
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={() => saveMut.mutate(form)} disabled={!form.name || saveMut.isPending}
              className="min-h-[44px] px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"><T k="저장" /></button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm"><T k="취소" /></button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500 w-[140px]"><T k="증상" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 w-[110px]"><T k="카테고리" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="진료과 매핑" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="별칭" /></th>
              <th className="text-center px-4 py-3 font-medium text-gray-500 w-[80px]"><T k="응급" /></th>
              <th className="text-right px-4 py-3 font-medium text-gray-500 w-[100px]"><T k="작업" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400"><T k="로딩 중..." /></td></tr>
            ) : symptoms.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400"><T k="등록된 증상이 없습니다" /></td></tr>
            ) : symptoms.map((s: TriageSymptom) => (
              <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-900">{s.name}</span>
                  {s.description && <p className="text-xs text-gray-400">{s.description}</p>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{s.category ?? '-'}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {(s.rules ?? []).map((r: TriageRule, i: number) => (
                      <span key={i} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                        {r.priority}순위: {r.departmentName} ({r.confidence}%)
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {(s.aliases ?? []).slice(0, 3).map((a: TriageAlias) => (
                      <span key={a.id} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{a.alias}</span>
                    ))}
                    {(s.aliases ?? []).length > 3 && <span className="text-[10px] text-gray-400">+{(s.aliases ?? []).length - 3}</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-center whitespace-nowrap">
                  {s.isEmergency ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-red-600 font-bold text-xs">🔴 <T k="응급" /></span>
                      {/* 🔴 T6 — 이 문구가 환자에게 나가는 문구인지 화면이 말한다 */}
                      {!/119|응급실|응급전화/.test(s.emergencyMsg ?? '') && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded" title={s.emergencyMsg ?? tAttr('문구 없음')}><T k="임상 메모" /></span>
                      )}
                    </div>
                  ) : <span className="text-gray-300">-</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => startEdit(s)} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"><T k="편집" /></button>
                    {canWrite && <button onClick={() => deleteMut.mutate(s.id)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-red-50 text-red-600 rounded hover:bg-red-100"><T k="삭제" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 매핑 규칙 ──
function RulesTab() {
  const tAttr = useTAttr();
  const canWrite = useAdminWrite(); // 🔴 삭제만 서버가 @Roles(ADMIN) — 등록·수정은 임상 허용이라 그대로 둔다
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ symptomId: '', departmentName: '', priority: 1, confidence: 80, reason: '' });

  const { data: symptomsData } = useQuery({
    queryKey: ['triage-symptoms-list'],
    queryFn: () => apiClient.get<{ data: TriageSymptom[] }>('/api/v1/triage/symptoms'),
  });
  const { data: rulesData, isLoading } = useQuery({
    queryKey: ['triage-rules'],
    queryFn: () => apiClient.get<{ data: TriageRule[] }>('/api/v1/triage/rules'),
  });

  const saveMut = useMutation({
    mutationFn: (d: TriageRuleForm) => apiClient.post('/api/v1/triage/rules', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['triage-rules'] }); setShowForm(false); toast.success('규칙 추가됨'); },
    onError: (e: MutationError) => toast.error(e.message ?? '오류가 발생했습니다.'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/triage/rules/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['triage-rules'] }); toast.success('비활성화됨'); },
  });

  const symptoms: TriageSymptom[] = symptomsData?.data ?? [];
  const rules: TriageRule[] = rulesData?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <div>
          <p className="text-sm text-gray-500">총 {rules.length}<Unit>개</Unit> 규칙</p>
          {/* 🔴 T9 — 화면은 &quot;1순위/2순위&quot;를 보여주지만 실제 추천 순서는 재계산 결과다. 그 사실을 적는다. */}
          <p className="text-xs text-gray-400 mt-0.5">우선순위는 <strong>가중치</strong>입니다 — 추천 순서는 신뢰도 × 가중치(1순위 ×3 · 2순위 ×2 · 3순위 ×1) 합산으로 다시 정해집니다.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"><T k="+ 규칙 추가" /></button>
      </div>

      {showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-bold text-blue-900"><T k="매핑 규칙 추가" /></h4>
          <div className="grid grid-cols-2 gap-3">
            <select value={form.symptomId} onChange={e => setForm({ ...form, symptomId: e.target.value })} className="px-3 py-2 border rounded-lg text-sm">
              <option value="">{tAttr('증상 선택')}</option>
              {symptoms.map((s: TriageSymptom) => <option key={s.id} value={s.id}>{s.name} ({s.category ?? '-'})</option>)}
            </select>
            <input value={form.departmentName} onChange={e => setForm({ ...form, departmentName: e.target.value })} placeholder={tAttr('진료과 (예: 내과)')} className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1"><T k="우선순위" /></label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value={1}>{tAttr('1순위')}</option><option value={2}>{tAttr('2순위')}</option><option value={3}>{tAttr('3순위')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1"><T k="신뢰도 (%)" /></label>
              <input type="number" value={form.confidence} onChange={e => setForm({ ...form, confidence: Number(e.target.value) })} min={0} max={100} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1"><T k="사유" /></label>
              <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder={tAttr('예: 일반 두통')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => saveMut.mutate(form)} disabled={!form.symptomId || !form.departmentName}
              className="min-h-[44px] px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"><T k="추가" /></button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm"><T k="취소" /></button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="증상" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="진료과" /></th>
              <th className="text-center px-4 py-3 font-medium text-gray-500" title={tAttr('최종 노출 순서는 신뢰도 x 가중치(1순위 x3 · 2순위 x2 · 3순위 x1) 합산 결과라 이 값과 다를 수 있습니다')}><T k="우선순위(가중치)" /></th>
              <th className="text-center px-4 py-3 font-medium text-gray-500"><T k="신뢰도" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="사유" /></th>
              <th className="text-center px-4 py-3 font-medium text-gray-500"><T k="히트" /></th>
              <th className="text-right px-4 py-3 font-medium text-gray-500"><T k="작업" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400"><T k="로딩 중..." /></td></tr>
            ) : rules.map((r: TriageRule) => (
              <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-900">{r.symptom?.name ?? '-'}</td>
                <td className="px-4 py-3"><span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs">{r.departmentName}</span></td>
                <td className="px-4 py-3 text-center">{r.priority}순위</td>
                <td className="px-4 py-3 text-center">
                  <span className={`font-bold ${r.confidence >= 80 ? 'text-green-600' : r.confidence >= 60 ? 'text-amber-600' : 'text-gray-400'}`}>{r.confidence}<Unit>%</Unit></span>
                </td>
                <td className="px-4 py-3 text-gray-500">{r.reason ?? '-'}</td>
                <td className="px-4 py-3 text-center text-xs text-gray-400">{r.hitCount}</td>
                <td className="px-4 py-3 text-right">
                  {canWrite && <button onClick={() => deleteMut.mutate(r.id)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-red-50 text-red-600 rounded hover:bg-red-100"><T k="삭제" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 별칭 관리 ──
function AliasesTab() {
  const tAttr = useTAttr();
  const canWrite = useAdminWrite(); // 🔴 삭제만 서버가 @Roles(ADMIN) — 등록·수정은 임상 허용이라 그대로 둔다
  const qc = useQueryClient();
  const [symptomFilter, setSymptomFilter] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [selectedSymptomId, setSelectedSymptomId] = useState('');

  const { data: symptomsData } = useQuery({
    queryKey: ['triage-symptoms-list'],
    queryFn: () => apiClient.get<{ data: TriageSymptom[] }>('/api/v1/triage/symptoms'),
  });
  const { data: aliasData, isLoading } = useQuery({
    queryKey: ['triage-aliases', symptomFilter],
    queryFn: () => apiClient.get<{ data: TriageAlias[] }>('/api/v1/triage/aliases', { symptomId: symptomFilter || undefined }),
  });

  const addMut = useMutation({
    mutationFn: (d: { symptomId: string; alias: string }) => apiClient.post('/api/v1/triage/aliases', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['triage-aliases'] }); setNewAlias(''); toast.success('별칭 추가됨'); },
    onError: (e: MutationError) => toast.error(e.message ?? '오류가 발생했습니다.'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/triage/aliases/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['triage-aliases'] }); },
  });

  const symptoms: TriageSymptom[] = symptomsData?.data ?? [];
  const aliases: TriageAlias[] = aliasData?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={symptomFilter} onChange={e => setSymptomFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm">
          <option value="">{tAttr('전체 증상')}</option>
          {symptoms.map((s: TriageSymptom) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <p className="text-sm text-gray-500">총 {aliases.length}<Unit>개</Unit> 별칭</p>
      </div>

      {/* 빠른 추가 */}
      <div className="bg-gray-50 rounded-xl p-4 flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1"><T k="증상" /></label>
          <select value={selectedSymptomId} onChange={e => setSelectedSymptomId(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="">{tAttr('증상 선택')}</option>
            {symptoms.map((s: TriageSymptom) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1"><T k="별칭 (자연어)" /></label>
          <input value={newAlias} onChange={e => setNewAlias(e.target.value)} placeholder={tAttr('예: 머리가 아파')} className="w-full px-3 py-2 border rounded-lg text-sm"
            onKeyDown={e => e.key === 'Enter' && selectedSymptomId && newAlias && addMut.mutate({ symptomId: selectedSymptomId, alias: newAlias })} />
        </div>
        <button onClick={() => addMut.mutate({ symptomId: selectedSymptomId, alias: newAlias })}
          disabled={!selectedSymptomId || !newAlias}
          className="min-h-[44px] px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"><T k="추가" /></button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="별칭" /></th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"><T k="매핑 증상" /></th>
              <th className="text-center px-4 py-3 font-medium text-gray-500"><T k="히트 수" /></th>
              <th className="text-right px-4 py-3 font-medium text-gray-500"><T k="작업" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400"><T k="로딩 중..." /></td></tr>
            ) : aliases.map((a: TriageAlias) => (
              <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-900">&ldquo;{a.alias}&rdquo;</td>
                <td className="px-4 py-3"><span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full text-xs">{a.symptom?.name ?? '-'}</span></td>
                <td className="px-4 py-3 text-center text-xs text-gray-400">{a.hitCount}</td>
                <td className="px-4 py-3 text-right">
                  {canWrite && <button onClick={() => deleteMut.mutate(a.id)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-red-50 text-red-600 rounded hover:bg-red-100"><T k="삭제" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 통계 ──
function StatsTab() {
  const tAttr = useTAttr();
  const { data } = useQuery({
    queryKey: ['triage-stats'],
    queryFn: () => apiClient.get<{ data: TriageStats }>('/api/v1/triage/rules/stats'),
  });
  // 🔴 원 결함 T7 — BE 가 `{data:{data:{…}}}` 로 이중 래핑했고 이 탭만 방어 언랩이 없어
  //    등록 증상·매핑 규칙·별칭이 **전부 0** 으로 보였다(실제 29 / 72 / 169).
  //    통계가 0 이면 트리아지 실패가 화면 어디에도 드러나지 않는다 — BE 를 단일 래핑으로 고쳤다.
  const stats = data?.data;

  // 🔴 T1/T2 — 시스템이 스스로 제시하는 예시 문장이 자기 매칭기를 통과하는지 화면이 말하게 한다.
  const { data: selfCheckRes, isLoading: scLoading } = useQuery({
    queryKey: ['triage-self-check'],
    queryFn: () => apiClient.get<{ data: TriageSelfCheck }>('/api/v1/triage/self-check'),
  });
  const selfCheck = selfCheckRes?.data;

  // 🔴 T6 — 응급 문구가 환자용 행동 지시인지(119) 화면이 말하게 한다.
  const { data: emgRes } = useQuery({
    queryKey: ['triage-emergency-messages'],
    queryFn: () => apiClient.get<{ data: EmergencyMsgAudit[] }>('/api/v1/triage/emergency-messages'),
  });
  const emergencyMsgs: EmergencyMsgAudit[] = emgRes?.data ?? [];
  const clinicalOnly = emergencyMsgs.filter(m => !m.patientActionable);

  return (
    <div className="space-y-6">
      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
          <p className="text-3xl font-bold text-blue-600">{stats?.totalSymptoms ?? '—'}</p>
          <p className="text-sm text-gray-500 mt-1"><T k="등록 증상" /></p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
          <p className="text-3xl font-bold text-indigo-600">{stats?.totalRules ?? '—'}</p>
          <p className="text-sm text-gray-500 mt-1"><T k="매핑 규칙" /></p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
          <p className="text-3xl font-bold text-purple-600">{stats?.totalAliases ?? '—'}</p>
          <p className="text-sm text-gray-500 mt-1"><T k="별칭" /></p>
        </div>
      </div>

      {/* 자가 점검 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-900"><T k="자가 점검 — 안내 버튼 문장이 실제로 매칭되는가" /></h3>
          {selfCheck && (
            <span className={`text-sm font-bold ${selfCheck.gaps > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {selfCheck.recommendable}/{selfCheck.expected} <T k="진료과 추천까지 도달" />
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-4">
          <T k="챗봇이 환자에게 버튼으로 제시하는 예시 문장을 현행 증상·별칭·규칙에 그대로 돌려본 결과입니다. 실패한 문장은 환자가 그 버튼을 눌러도 진료과 추천이 나오지 않습니다." />
        </p>
        {scLoading ? (
          <p className="text-sm text-gray-400"><T k="점검 중..." /></p>
        ) : !selfCheck ? (
          <EmptyState icon="🧪" title="점검 결과를 불러오지 못했습니다" />
        ) : (
          <div className="space-y-1.5">
            {selfCheck.results.map(r => (
              <div key={r.phrase} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${r.gap ? 'bg-red-50' : 'bg-gray-50'}`}>
                <span className="w-5 text-center">{r.gap ? '❌' : r.recommendable ? '✅' : '—'}</span>
                <span className="font-medium text-gray-900 w-24 shrink-0">{r.label}</span>
                <span className="text-gray-500 flex-1">&ldquo;{r.phrase}&rdquo;</span>
                {r.emergency && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded"><T k="응급" /></span>}
                <span className="text-xs text-gray-500 w-56 text-right truncate">
                  {r.matchedSymptoms.length > 0
                    ? r.matchedSymptoms.join(', ')
                    : tAttr(r.expectSymptom ? '매칭된 증상 없음 (데이터 갭)' : '증상 아님 — 정상')}
                </span>
              </div>
            ))}
          </div>
        )}
        {selfCheck && selfCheck.gaps > 0 && (
          <p className="mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ❌ {selfCheck.gaps}<Unit>건</Unit>은 해당 증상이 DB에 아예 없거나 매핑 규칙이 없어서 추천으로 이어지지 않습니다.
            &lsquo;증상 관리&rsquo; 탭에서 증상·별칭·규칙을 등록해야 해결됩니다 (코드 수정으로 해결되지 않습니다).
          </p>
        )}
      </div>

      {/* 응급 문구 점검 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1"><T k="응급 문구 점검 — 환자에게 나가는 문구인가" /></h3>
        <p className="text-xs text-gray-400 mb-4">
          환자(미인증 공개 예약 챗 이용자)에게는 <strong>행동 지시</strong>가 필요합니다.
          119·응급실 안내가 없는 문구는 감별진단용 임상 메모로 보고 <strong>환자에게 내보내지 않습니다</strong>
          (대신 코드 정본의 119 안내가 나가고, 이 문구는 원무 데스크에만 참고로 표시됩니다).
          DB 저장값은 과거 기록이므로 임의로 바꾸지 않습니다.
        </p>
        {emergencyMsgs.length === 0 ? (
          <EmptyState icon="🚑" title="응급 표시 증상이 없습니다" />
        ) : (
          <div className="space-y-1.5">
            {emergencyMsgs.map(m => (
              <div key={m.id} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-gray-50 text-sm">
                <span className="w-5 text-center">{m.patientActionable ? '✅' : '📋'}</span>
                <span className="font-medium text-gray-900 w-32 shrink-0">{m.name}</span>
                <span className="text-gray-500 flex-1">{m.emergencyMsg ?? <span className="text-gray-300"><T k="(문구 없음)" /></span>}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${m.patientActionable ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  <T k={m.patientActionable ? '환자용' : '임상 메모 · 환자 미노출'} />
                </span>
              </div>
            ))}
          </div>
        )}
        {clinicalOnly.length > 0 && (
          <p className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            📋 {clinicalOnly.length}<Unit>건</Unit>은 환자용 행동 지시가 없는 임상 메모입니다.
            환자에게는 코드 정본 안내(&ldquo;🚨 응급 상황일 수 있습니다. 지금 바로 119에…&rdquo;)가 대신 나갑니다.
            환자용 문구로 바꾸려면 &lsquo;증상 관리&rsquo; 탭에서 119 안내를 포함해 다시 작성하세요.
          </p>
        )}
      </div>

      {/* Top 매핑 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1"><T k="매핑 히트 수 Top 20" /></h3>
        {/* 🔴 T10 — 예전 히트 수는 '조회된 횟수'라 추천에 쓰이지 않은 규칙도 올랐다. 지금은 실제 추천된 횟수다. */}
        <p className="text-xs text-gray-400 mb-4"><T k="실제로 추천 결과(상위 3개 진료과)에 반영된 횟수입니다." /></p>
        <div className="space-y-2">
          {(stats?.topRules ?? []).map((r: TriageRule, i: number) => (
            <div key={r.id} className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-400 w-6">{i + 1}</span>
              <span className="text-sm font-medium text-gray-900 w-20">{r.symptom?.name}</span>
              <span className="text-xs text-gray-400">→</span>
              <span className="text-sm text-blue-700">{r.departmentName}</span>
              <div className="flex-1 mx-3">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, r.hitCount * 5)}%` }} />
                </div>
              </div>
              <span className="text-xs font-medium text-gray-500 w-12 text-right">{r.hitCount}<Unit><T k="회" /></Unit></span>
            </div>
          ))}
          {(stats?.topRules ?? []).length === 0 && <EmptyState icon="📊" title="아직 데이터가 없습니다" />}
        </div>
      </div>

      {/* 🔴 T5/T8 — '하드코딩 데이터 마이그레이션' 버튼을 제거했다.
          구 하드코딩 맵(흉통 → 응급의학과 1순위)을 현행 임상 규칙 위에 덧씌워 정본을 오염시켰고,
          토스트마저 이중 래핑 때문에 "증상 undefined" 였다. 증상/규칙 추가는 '증상 관리' 탭에서 한다. */}
    </div>
  );
}
