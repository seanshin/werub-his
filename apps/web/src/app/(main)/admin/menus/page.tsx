'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface MenuItem {
  id: string; menuGroup: string; label: string; href?: string;
  icon?: string; sortOrder: number; isActive: boolean; isExternal: boolean;
  categoryCode?: string; roles: string[];
  children?: MenuItem[];
}

const GROUPS = [
  { value: 'GNB', label: '홈페이지 GNB' },
  { value: 'SIDEBAR', label: 'HIS 사이드바' },
  { value: 'FOOTER', label: '푸터 메뉴' },
  { value: 'MOBILE_NAV', label: '모바일 내비게이션' },
];

export default function MenusPage() {
  const tAttr = useTAttr();
  const [group, setGroup] = useState('GNB');
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ label: '', href: '', icon: '', menuGroup: 'GNB', isExternal: false, categoryCode: '' });

  const load = () => {
    setLoading(true);
    apiClient.get<{ data: MenuItem[] }>(`/api/v1/cms/menus?group=${group}`)
      .then(res => setMenus(Array.isArray(res.data) ? res.data : (res.data as any)?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, [group]);

  const handleCreate = async () => {
    try {
      await apiClient.post('/api/v1/cms/menus', { ...form, menuGroup: group, sortOrder: menus.length });
      toast.success('메뉴 추가됨');
      setShowForm(false);
      setForm({ label: '', href: '', icon: '', menuGroup: group, isExternal: false, categoryCode: '' });
      load();
    } catch { toast.error('추가 실패'); }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await apiClient.patch(`/api/v1/cms/menus/${id}`, { isActive: !isActive });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 메뉴와 하위 메뉴를 모두 삭제하시겠습니까?')) return;
    await apiClient.del(`/api/v1/cms/menus/${id}`);
    toast.success('삭제됨');
    load();
  };

  const renderMenu = (item: MenuItem, depth: number = 0) => (
    <div key={item.id}>
      <div className={`flex items-center justify-between py-2.5 px-4 hover:bg-gray-50 rounded-lg ${depth > 0 ? 'ml-8' : ''}`}>
        <div className="flex items-center gap-2">
          <span className="text-gray-300 cursor-grab">≡</span>
          {item.icon && <span className="text-sm">{item.icon}</span>}
          <span className="text-sm font-medium text-gray-900">{item.label}</span>
          {item.href && <span className="text-[10px] text-gray-400 font-mono">{item.href}</span>}
          {item.isExternal && <span className="text-[10px] bg-purple-100 text-purple-700 px-1 rounded"><T k="외부" /></span>}
          {item.categoryCode && <span className="text-[10px] bg-teal-100 text-teal-700 px-1 rounded">CMS:{item.categoryCode}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            <T k={item.isActive ? '표시' : '숨김'} />
          </span>
          <button onClick={() => handleToggle(item.id, item.isActive)} className="text-xs text-gray-400 hover:text-amber-500"><T k={item.isActive ? '숨기기' : '표시'} /></button>
          <button onClick={() => handleDelete(item.id)} className="text-xs text-gray-400 hover:text-red-500"><T k="삭제" /></button>
        </div>
      </div>
      {item.children?.map(child => renderMenu(child, depth + 1))}
    </div>
  );

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="메뉴 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="홈페이지 GNB, HIS 사이드바, 푸터 메뉴를 관리합니다" /></p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700"><T k="+ 메뉴 추가" /></button>
      </div>

      {/* 그룹 탭 */}
      <div className="flex gap-2">
        {GROUPS.map(g => (
          <button key={g.value} onClick={() => setGroup(g.value)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition ${group === g.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <T k={g.label} />
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-white border border-blue-200 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-bold"><T k="새 메뉴 추가" /> (<T k={GROUPS.find(g => g.value === group)?.label ?? ''} />)</h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder={tAttr('메뉴 이름')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={form.href} onChange={e => setForm(f => ({ ...f, href: e.target.value }))} placeholder={tAttr('URL (예: /about)')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} placeholder={tAttr('아이콘 (선택)')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={form.categoryCode} onChange={e => setForm(f => ({ ...f, categoryCode: e.target.value }))} placeholder={tAttr('CMS 카테고리 코드 (선택)')} className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isExternal} onChange={e => setForm(f => ({ ...f, isExternal: e.target.checked }))} /> <T k="외부 링크 (새 탭)" /></label>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg"><T k="추가" /></button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {/* 메뉴 트리 */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm divide-y">
        {loading ? (
          <div className="p-8 text-center text-gray-400"><T k="로딩 중..." /></div>
        ) : menus.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <T k="등록된 메뉴가 없습니다." /> {group === 'GNB' ? <T k="현재 GNB.tsx 코드에 하드코딩된 메뉴가 사용됩니다." /> : ''}
          </div>
        ) : (
          menus.map(m => renderMenu(m))
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-xs text-blue-700">
          <T k="메뉴를 DB에 등록하면 향후 동적 렌더링으로 전환됩니다. 현재는 코드 하드코딩 메뉴가 폴백으로 사용됩니다." />
        </p>
      </div>
    </div>
  );
}
