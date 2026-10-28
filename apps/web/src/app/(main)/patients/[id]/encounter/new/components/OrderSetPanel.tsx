'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

interface OrderSetItem {
  type: string;
  name: string;
  [key: string]: unknown;
}

interface OrderSet {
  id: string;
  name: string;
  diagnosisCode?: string;
  items: OrderSetItem[];
  ageGroup?: string;
  contraindications?: Array<{ note?: string }>;
}

export interface ApplyMeta {
  name?: string; // 적용 검토 모달 제목용
  ageGroup?: string;
  contraindications?: Array<{ note?: string }>;
}

interface FavoriteOrderSet {
  id: string;
  name: string;
  useCount: number;
  items: OrderSetItem[];
}

const TYPE_ICON: Record<string, string> = { MEDICATION: '💊', LAB: '🔬', IMAGING: '📷', ORDER: '📋' };

export function OrderSetPanel({ onApply }: { onApply: (items: OrderSetItem[], orderSetId?: string, meta?: ApplyMeta) => void }) {
  const [catFilter, setCatFilter] = useState('');
  const { data: cpData } = useQuery({
    queryKey: ['order-sets-panel', catFilter],
    queryFn: () => apiClient.get<{ data: OrderSet[] }>('/api/v1/order-sets', { category: catFilter || undefined }),
  });
  const { data: favData } = useQuery({
    queryKey: ['favorite-orders'],
    queryFn: () => apiClient.get<{ data: FavoriteOrderSet[] }>('/api/v1/favorite-orders'),
  });

  const _cpRaw = cpData?.data;
  const orderSets: OrderSet[] = Array.isArray(_cpRaw) ? _cpRaw : (_cpRaw as unknown as Record<string, unknown>)?.data as OrderSet[] ?? [];
  const _favRaw = favData?.data;
  const favorites: FavoriteOrderSet[] = Array.isArray(_favRaw) ? _favRaw : (_favRaw as unknown as Record<string, unknown>)?.data as FavoriteOrderSet[] ?? [];

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-indigo-900"><T k="약속처방 선택" /></h4>
        <div className="flex gap-1">
          {[{ v: '', l: '전체' }, { v: 'DISEASE', l: '질환' }, { v: 'SURGERY_PRE', l: '수술전' }, { v: 'ADMISSION', l: '입원' }].map(c => (
            <button key={c.v} onClick={() => setCatFilter(c.v)}
              className={`px-2 py-0.5 text-[10px] rounded ${catFilter === c.v ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600'}`}>{c.l}</button>
          ))}
        </div>
      </div>

      {favorites.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-indigo-500 uppercase mb-1"><T k="내 즐겨찾기" /></p>
          <div className="space-y-1">
            {favorites.map((f: FavoriteOrderSet) => (
              <div key={f.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                <div>
                  <span className="text-xs font-medium text-gray-900">{f.name}</span>
                  <span className="text-[10px] text-gray-400 ml-2">{f.items.length}항목 | 사용 {f.useCount}<Unit>회</Unit></span>
                </div>
                <button onClick={() => onApply(f.items, f.id, { name: f.name })} className="px-2 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700"><T k="적용" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] font-semibold text-indigo-500 uppercase mb-1"><T k="병원 약속처방" /></p>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {orderSets.length === 0 ? (
          <p className="text-xs text-indigo-400 py-2 text-center"><T k="등록된 약속처방이 없습니다" /></p>
        ) : orderSets.map((os: OrderSet) => {
          const items = os.items;
          return (
            <div key={os.id} className="bg-white rounded-lg px-3 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-gray-900">{os.name}</span>
                  {os.diagnosisCode && <span className="text-[10px] text-indigo-500 ml-1 font-mono">{os.diagnosisCode}</span>}
                  <span className="text-[10px] text-gray-400 ml-2">{items.length}항목</span>
                </div>
                <button onClick={() => onApply(items, os.id, { name: os.name, ageGroup: os.ageGroup, contraindications: os.contraindications })} className="px-2 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700"><T k="적용" /></button>
              </div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {items.slice(0, 4).map((item: OrderSetItem, i: number) => (
                  <span key={i} className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{TYPE_ICON[item.type] ?? ''} {item.name}</span>
                ))}
                {items.length > 4 && <span className="text-[9px] text-gray-400">+{items.length - 4}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
