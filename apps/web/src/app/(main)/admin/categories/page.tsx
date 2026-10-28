'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Category {
  id: string; code: string; name: string; description?: string;
  icon?: string; color?: string; sortOrder: number; isActive: boolean;
  showOnHome: boolean; showOnSubpage: boolean; renderMode: string;
  children?: Category[];
}

export default function CategoriesPage() {
  const tAttr = useTAttr();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', description: '', icon: '', color: '#3b82f6', showOnHome: false, renderMode: 'cards' });

  const load = () => {
    apiClient.get<{ data: Category[] }>('/api/v1/cms/categories')
      .then(res => setCategories(Array.isArray(res.data) ? res.data : (res.data as any)?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleCreate = async () => {
    try {
      await apiClient.post('/api/v1/cms/categories', { ...form, sortOrder: categories.length });
      toast.success('카테고리 생성됨');
      setShowForm(false);
      setForm({ code: '', name: '', description: '', icon: '', color: '#3b82f6', showOnHome: false, renderMode: 'cards' });
      load();
    } catch { toast.error('생성 실패'); }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await apiClient.patch(`/api/v1/cms/categories/${id}`, { isActive: !isActive });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await apiClient.del(`/api/v1/cms/categories/${id}`);
    toast.success('삭제됨');
    load();
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="카테고리 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="CMS 콘텐츠 카테고리를 관리합니다" /></p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700"><T k="+ 새 카테고리" /></button>
      </div>

      {showForm && (
        <div className="bg-white border border-blue-200 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-bold"><T k="새 카테고리" /></h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder={tAttr('코드 (예: DEPARTMENT)')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={tAttr('표시 이름')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} placeholder={tAttr('아이콘 (이모지)')} className="px-3 py-2 border rounded-lg text-sm" />
            <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="h-10 w-20" />
            <select value={form.renderMode} onChange={e => setForm(f => ({ ...f, renderMode: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm">
              <option value="cards">{tAttr('카드 그리드')}</option>
              <option value="list">{tAttr('리스트')}</option>
              <option value="accordion">{tAttr('아코디언')}</option>
              <option value="timeline">{tAttr('타임라인')}</option>
            </select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.showOnHome} onChange={e => setForm(f => ({ ...f, showOnHome: e.target.checked }))} /> <T k="홈페이지 표시" /></label>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg"><T k="생성" /></button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : categories.length === 0 ? (
        <EmptyState icon="📋" title="등록된 카테고리가 없습니다." hint="위 버튼으로 추가하세요." />
      ) : (
        <div className="space-y-2">
          {categories.map((cat, i) => (
            <div key={cat.id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm flex items-center justify-between hover:shadow-md transition">
              <div className="flex items-center gap-3">
                <span className="text-lg w-8 text-center">{cat.icon || '📄'}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{cat.name}</span>
                    <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{cat.code}</span>
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color || '#999' }} />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-gray-400"><T k="렌더링" />: {cat.renderMode}</span>
                    {cat.showOnHome && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded"><T k="홈" /></span>}
                    {cat.children && cat.children.length > 0 && <span className="text-[10px] text-gray-400"><T k="하위" /> {cat.children.length}<Unit>개</Unit></span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cat.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  <T k={cat.isActive ? '활성' : '비활성'} />
                </span>
                <button onClick={() => handleToggle(cat.id, cat.isActive)} className="text-xs text-gray-400 hover:text-amber-500"><T k={cat.isActive ? '비활성' : '활성'} /></button>
                <button onClick={() => handleDelete(cat.id)} className="text-xs text-gray-400 hover:text-red-500"><T k="삭제" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
