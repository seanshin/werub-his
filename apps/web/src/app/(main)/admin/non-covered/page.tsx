'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { money } from '@/lib/ui-settings';
import { Money } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

type AnyRecord = Record<string, unknown>;

interface NonCoveredItem {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  description?: string;
  requiresConsent: boolean;
  isActive: boolean;
  updatedAt: string;
}

/**
 * 🔴 W8 R3 C4 — 이 화면은 **환자 고지가**(의료법 §45의2)만 보여줬다. 실제로 수납·영수증에 찍히는
 * 금액은 수가마스터(procedure_codes, insuranceCovered=false)에서 나오고 둘이 다르다.
 * 운영 실측: 16건 중 수가마스터와 코드가 일치하는 것 0건 · 도수치료(30분) 고지 100,000 ↔ 실청구 52,800(MM201).
 * 저장값은 코드로 고치지 않고(원무·보험 판단 영역) 여기서 **불일치를 드러내기만** 한다.
 */
interface ReconItem {
  noticeCode: string;
  name: string;
  category: string;
  noticePrice: number;
  status: 'MATCHED' | 'PRICE_MISMATCH' | 'NO_CLAIM_CODE';
  priceDiff: number | null;
  note?: string | null;
  claim: { code: string; name: string; unitPrice: number | null; matchedBy: 'CODE' | 'NAME' } | null;
}

interface ReconResult {
  canonicalNote: string;
  summary: {
    noticeCount: number; claimCodeCount: number; matched: number;
    priceMismatch: number; noClaimCode: number; unnoticedClaimCodes: number;
  };
  items: ReconItem[];
  unnoticed: { claimCode: string; name: string; unitPrice: number | null; note: string }[];
}

const CATEGORIES = [
  { value: 'ROOM', label: '상급병실' },
  { value: 'PROCEDURE', label: '시술/수술' },
  { value: 'EXAM', label: '검사' },
  { value: 'THERAPY', label: '치료' },
  { value: 'MATERIAL', label: '재료' },
  { value: 'CERTIFICATE', label: '제증명' },
  { value: 'OTHER', label: '기타' },
];

export default function NonCoveredManagementPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<NonCoveredItem | null>(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [form, setForm] = useState({
    code: '', name: '', category: 'PROCEDURE', price: '',
    description: '', requiresConsent: true,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['non-covered-items', filterCategory],
    queryFn: () => apiClient.get<AnyRecord>(`/api/v1/non-covered${filterCategory ? `?category=${filterCategory}` : ''}`),
  });

  const _raw = data?.data as AnyRecord;
  const items: NonCoveredItem[] = Array.isArray(_raw) ? (_raw as NonCoveredItem[]) : ((_raw?.data ?? []) as NonCoveredItem[]);

  // 🔴 C4 — 실청구가 대조(서버 read-only 대조 EP). 실패해도 목록 화면은 살아 있어야 한다.
  const { data: reconRaw, isError: reconIsError, error: reconError, refetch: refetchRecon } = useQuery({
    queryKey: ['non-covered-recon'],
    queryFn: () => apiClient.get<AnyRecord>('/api/v1/billing/non-covered-reconciliation'),
  });
  const recon: ReconResult | null = (() => {
    const r = (reconRaw as AnyRecord | null)?.data as AnyRecord | undefined;
    if (!r) return null;
    return ((r.data ?? r) as unknown as ReconResult) ?? null;
  })();
  const reconByCode = new Map((recon?.items ?? []).map(i => [i.noticeCode, i]));

  const saveMutation = useMutation({
    mutationFn: (payload: AnyRecord) =>
      editItem
        ? apiClient.put(`/api/v1/non-covered/${editItem.id}`, payload)
        : apiClient.post('/api/v1/non-covered', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['non-covered-items'] });
      setShowForm(false);
      setEditItem(null);
      resetForm();
      toast.success(editItem ? tAttr('수정되었습니다.') : tAttr('등록되었습니다.'));
    },
    onError: () => toast.error(tAttr('저장에 실패했습니다.')),
  });

  const toggleMutation = useMutation({
    mutationFn: (item: NonCoveredItem) =>
      apiClient.patch(`/api/v1/non-covered/${item.id}/toggle`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['non-covered-items'] });
      toast.success(tAttr('상태가 변경되었습니다.'));
    },
  });

  const resetForm = () => setForm({ code: '', name: '', category: 'PROCEDURE', price: '', description: '', requiresConsent: true });

  const openEdit = (item: NonCoveredItem) => {
    setEditItem(item);
    setForm({
      code: item.code, name: item.name, category: item.category,
      price: String(item.price), description: item.description ?? '',
      requiresConsent: item.requiresConsent,
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.code || !form.name || !form.price) { toast.error(tAttr('필수 항목을 입력하세요.')); return; }
    saveMutation.mutate({ ...form, price: Number(form.price) });
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="비급여 항목 관리" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="의료법 제45조의2에 따른 비급여 진료비용 관리" /></p>
        </div>
        <button onClick={() => { resetForm(); setEditItem(null); setShowForm(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
          <T k="+ 항목 등록" />
        </button>
      </div>

      {/* 🔴 대조 EP 가 실패했다 — 아래 '대조 불가' 는 "차이가 없다"는 뜻이 아니다 */}
      {reconIsError && <QueryErrorFallback error={reconError} onRetry={() => refetchRecon()} size="compact" className="mb-4" />}

      {/* 🔴 C4 — 비급여 정본이 둘이라는 사실을 화면이 먼저 말한다 */}
      {recon && (recon.summary.priceMismatch > 0 || recon.summary.noClaimCode > 0 || recon.summary.unnoticedClaimCodes > 0) && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-bold text-red-800">
            <T k="고지가와 실청구가가 어긋납니다" /> — <T k="가격 불일치" /> {recon.summary.priceMismatch}<T k="건" /> · <T k="청구코드 없음" /> {recon.summary.noClaimCode}<T k="건" /> · <T k="고지 누락 후보" /> {recon.summary.unnoticedClaimCodes}<T k="건" />
          </p>
          <p className="text-xs text-red-700 mt-1">{recon.canonicalNote}</p>
          {recon.unnoticed.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {recon.unnoticed.map(u => (
                <li key={u.claimCode} className="text-[11px] text-red-700">
                  <span className="font-mono">{u.claimCode}</span> {u.name} — <T k="실청구가" /> <Money value={u.unitPrice ?? 0} /> · <T k="고지 가격표에 없음" />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 카테고리 필터 */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        <button onClick={() => setFilterCategory('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${!filterCategory ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          <T k="전체" />
        </button>
        {CATEGORIES.map(c => (
          <button key={c.value} onClick={() => setFilterCategory(c.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filterCategory === c.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={c.label} />
          </button>
        ))}
      </div>

      {/* 등록/수정 폼 */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-6 mb-6 space-y-4">
          <h3 className="text-sm font-bold text-gray-900"><T k={editItem ? '비급여 항목 수정' : '비급여 항목 등록'} /></h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><T k="항목코드 *" /></label>
              <input value={form.code} onChange={e => setForm(f => ({...f, code: e.target.value}))}
                placeholder="NC-001" className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><T k="항목명 *" /></label>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                placeholder={tAttr('도수치료')} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><T k="카테고리" /></label>
              <select value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{tAttr(c.label)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><T k="가격 (원) *" /></label>
              <input type="number" value={form.price} onChange={e => setForm(f => ({...f, price: e.target.value}))}
                placeholder="80000" className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block"><T k="설명" /></label>
            <input value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
              placeholder={tAttr('시술 설명, 주의사항 등')} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.requiresConsent}
              onChange={e => setForm(f => ({...f, requiresConsent: e.target.checked}))}
              className="rounded text-blue-600" />
            <span className="text-xs text-gray-700"><T k="사전 동의서 필수" /></span>
          </label>
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={saveMutation.isPending}
              className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <T k={saveMutation.isPending ? '저장 중...' : editItem ? '수정' : '등록'} />
            </button>
            <button onClick={() => { setShowForm(false); setEditItem(null); }}
              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {/* 항목 목록 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="코드" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="항목명" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="카테고리" /></th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500"><T k="환자 고지가" /></th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500"><T k="실청구가(수가마스터)" /></th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="동의서" /></th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-5 py-3 text-xs font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [1,2,3].map(i => <tr key={i}><td colSpan={8} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm"><T k="등록된 비급여 항목이 없습니다" /></td></tr>
            ) : (
              items.map(item => {
                const catLabel = CATEGORIES.find(c => c.value === item.category)?.label ?? item.category;
                const r = reconByCode.get(item.code);
                return (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{item.code}</td>
                    <td className="px-5 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-5 py-3"><span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded whitespace-nowrap"><T k={catLabel} /></span></td>
                    <td className="px-5 py-3 text-right font-mono"><Money value={item.price} /></td>
                    {/* 🔴 C4 — 실제로 청구되는 금액. 대조 결과가 없으면 '모른다'고 말한다(0 아님). */}
                    <td className="px-5 py-3 text-right font-mono">
                      {!recon ? (
                        <span className="text-xs text-gray-400"><T k="대조 불가" /></span>
                      ) : r?.claim ? (
                        <>
                          <span className={r.status === 'PRICE_MISMATCH' ? 'text-red-700 font-bold' : 'text-gray-700'}>
                            <Money value={r.claim.unitPrice ?? 0} />
                          </span>
                          <p className="text-[10px] text-gray-400 font-mono">
                            {r.claim.code}{r.claim.matchedBy === 'NAME' ? ` (${tAttr('명칭 대조')})` : ''}
                          </p>
                          {r.status === 'PRICE_MISMATCH' && (
                            <p className="text-[10px] text-red-600"><T k="고지가와" /> {Math.abs(r.priceDiff ?? 0).toLocaleString('ko-KR')}<T k="원 차이" /></p>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] text-amber-700"><T k="청구코드 없음" /></span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">{item.requiresConsent ? '✅' : '-'}</td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => toggleMutation.mutate(item)}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        <T k={item.isActive ? '활성' : '비활성'} />
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openEdit(item)} className="text-xs text-blue-600 hover:underline"><T k="수정" /></button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 안내문 */}
      <div className="mt-4 text-[10px] text-gray-400 space-y-0.5">
        <p>※ <T k="의료법 제45조의2에 따라 비급여 진료비용을 환자에게 사전 고지해야 합니다." /></p>
        <p>※ <T k="가격 변경 시 원내 게시판 및 홈페이지에 즉시 반영됩니다." /></p>
        <p>※ 🔴 <T k="이 표의 가격은" /> <b><T k="환자 고지가" /></b><T k="입니다. 수납·영수증에 실제로 찍히는 금액은 수가마스터(procedure_codes)에서 나오며, 위 “실청구가” 열이 그 값입니다." /></p>
      </div>
    </div>
  );
}
