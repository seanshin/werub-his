'use client';

import { useState, lazy, Suspense } from 'react';
import { Unit } from '@/components/ui/display';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { sanitizeHtml } from '@/lib/sanitize';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

const RichTextEditor = lazy(() => import('@/components/ui/rich-text-editor').then(m => ({ default: m.RichTextEditor })));
import { MediaPickerModal } from '@/components/admin/MediaPickerModal';
import { parseMetadataOrThrow, uploadCmsImage } from '@/components/admin/CategoryCmsPage';
import { CmsMetadataForm } from '@/components/admin/CmsMetadataForm';
import { kdate } from '@/lib/ui-settings';
import { AI_ORIGIN_TEXT, CMS_CATEGORIES, cmsCategoryDef, cmsDisplayGaps } from '@hospital-run/shared';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 카테고리 목록은 shared `CMS_CATEGORIES` 정본에서 가져온다(2026-08-21).
 *    종전엔 여기에 손으로 적은 18개 배열이 있었고 **`HEALTH_VIDEO` 가 빠져 있었다** —
 *    운영 6행이 이 화면에서 보이지 않았는데, 홈페이지 관리 허브는 이 화면으로 링크하고 있었다.
 *    정본이 둘이면 갈라진다.
 */
const CATEGORIES = [
  { value: '', label: '전체', icon: '📋' },
  ...CMS_CATEGORIES.map(c => ({ value: c.category, label: c.label, icon: c.icon })),
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));

const CAT_COLOR: Record<string, string> = {
  GENERAL: 'bg-blue-50 text-blue-700 border-blue-200',
  FACILITY: 'bg-violet-50 text-violet-700 border-violet-200',
  DEPARTMENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CENTER: 'bg-red-50 text-red-700 border-red-200',
  PARKING: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  DINING: 'bg-amber-50 text-amber-700 border-amber-200',
  FUNERAL: 'bg-gray-100 text-gray-600 border-gray-300',
  FAQ: 'bg-teal-50 text-teal-700 border-teal-200',
  NON_COVERED: 'bg-rose-50 text-rose-700 border-rose-200',
  NEWS: 'bg-sky-50 text-sky-700 border-sky-200',
  HEALTH_INFO: 'bg-green-50 text-green-700 border-green-200',
  RECRUIT: 'bg-orange-50 text-orange-700 border-orange-200',
  CHECKUP_INFO: 'bg-teal-50 text-teal-700 border-teal-200',
  GALLERY: 'bg-pink-50 text-pink-700 border-pink-200',
  CSR: 'bg-lime-50 text-lime-700 border-lime-200',
  VOC: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  BANNER: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
};

interface InfoContent {
  id: string; category: string; slug: string; title: string;
  content: string; metadata: Record<string, unknown>; sortOrder: number;
  isActive: boolean; tags: string[]; imageUrl?: string;
  isPinned: boolean; updatedAt: string; createdAt: string;
}

type ViewMode = 'list' | 'edit';

export default function HospitalInfoAdminPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get('category') ?? searchParams.get('tab') ?? '';
  const [filter, setFilter] = useState(initialCategory);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editItem, setEditItem] = useState<InfoContent | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 항상 전체 데이터를 가져오고, 카테고리/검색 필터는 클라이언트에서 처리
  const { data: listRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hospital-info-admin'],
    queryFn: () => apiClient.get<{ data: InfoContent[] }>('/api/v1/hospital-info'),
  });
  const allItems: InfoContent[] = Array.isArray(listRes?.data) ? listRes.data : (listRes?.data as any)?.data ?? [];

  // 카테고리 + 검색 필터 (클라이언트)
  const items = allItems.filter(i => {
    if (filter && i.category !== filter) return false;
    if (search && !i.title.includes(search) && !i.content.includes(search) && !i.tags.some(t => t.includes(search))) return false;
    return true;
  });

  /**
   * 🔴 W9 실결함: 여기서 부르던 `/api/revalidate` 는 **HIS 앱(apps/web) 자기 자신**의 라우트였고,
   *    공개 홈페이지 hospital.example.org(apps/homepage)은 건드리지도 않았다. 게다가 시크릿
   *    `'hospitalrun-revalidate'` 가 클라이언트 번들에 하드코딩돼 있어(= 방문자 누구나 열람) 시크릿 구실도 못 했다.
   *    공개 반영 정본은 서버 경유 `POST /api/v1/hospital-info/revalidate-homepage`
   *    (→ HOMEPAGE_PUBLIC_URL/revalidate, 서버 .env 의 HOMEPAGE_REVALIDATE_SECRET) 하나다.
   *    실패는 조용히 삼키지 않는다 — 안 되면 콘텐츠는 최대 1시간(ISR) 낡은 채로 공개된다.
   */
  const revalidateHomepage = () => {
    apiClient.post('/api/v1/hospital-info/revalidate-homepage', {})
      .catch((e: { message?: string }) => toast.warning(`${tAttr('저장은 됐지만 홈페이지 즉시 반영은 실패했습니다')} — ${e?.message ?? tAttr('연결/시크릿 확인')}`));
  };

  const toggleMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/hospital-info/${id}/toggle`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hospital-info-admin'] }); revalidateHomepage(); toast.success(tAttr('상태 변경')); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.fetch(`/api/v1/hospital-info/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hospital-info-admin'] }); revalidateHomepage(); toast.success(tAttr('삭제 완료')); },
  });

  const openEditor = (item: InfoContent | null) => {
    setEditItem(item);
    setViewMode('edit');
  };

  const closeEditor = () => {
    setViewMode('list');
    setEditItem(null);
  };

  // 카테고리별 통계
  const catCounts: Record<string, number> = {};
  allItems.forEach(i => { catCounts[i.category] = (catCounts[i.category] ?? 0) + 1; });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  // ── 편집 모드 ──
  if (viewMode === 'edit') {
    return <EditorView item={editItem} onClose={closeEditor} onSaved={() => { qc.invalidateQueries({ queryKey: ['hospital-info-admin'] }); closeEditor(); }} />;
  }

  // ── 목록 모드 ──
  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="병원 정보 관리 (CMS)" /></h1>
          <p className="text-sm text-gray-500 mt-1">환자포털·{AI_ORIGIN_TEXT} 도우미·홈페이지에 표시되는 모든 병원 정보를 관리합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={async () => {
            try {
              const res = await apiClient.get<{ data: { exportedAt: string; contents: unknown[] } }>('/api/v1/hospital-info/export/all');
              const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `cms-export-${kstToday()}.json`; a.click();
              URL.revokeObjectURL(url);
              toast.success(`${res.data.contents.length}건 내보내기 완료`);
            } catch { toast.error(tAttr('내보내기 실패')); }
          }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-200">
            <T k="내보내기" />
          </button>
          <label className="px-3 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-200 cursor-pointer">
            <T k="가져오기" />
            <input type="file" accept=".json" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              try {
                const text = await file.text();
                const json = JSON.parse(text);
                const res = await apiClient.post<{ data: { created: number; updated: number; total: number } }>('/api/v1/hospital-info/import/all', json);
                toast.success(`가져오기 완료: ${res.data.created}건 생성, ${res.data.updated}건 수정`);
                qc.invalidateQueries({ queryKey: ['hospital-info-admin'] });
              } catch { toast.error(tAttr('가져오기 실패 — JSON 형식을 확인하세요')); }
              e.target.value = '';
            }} />
          </label>
          <button onClick={() => openEditor(null)}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm">
            <T k="+ 새 콘텐츠 추가" />
          </button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-5 lg:grid-cols-9 gap-2">
        {CATEGORIES.map(c => {
          const count = c.value ? (catCounts[c.value] ?? 0) : allItems.length;
          return (
            <button key={c.value} onClick={() => setFilter(c.value)}
              className={`p-2.5 rounded-xl text-center transition border ${filter === c.value ? 'ring-2 ring-blue-500 border-blue-300 bg-blue-50' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
              <div className="text-base">{c.icon}</div>
              <div className="text-[10px] font-medium text-gray-600 mt-0.5"><T k={c.label} /></div>
              <div className="text-sm font-bold text-gray-900">{count}</div>
            </button>
          );
        })}
      </div>

      {/* 검색 */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tAttr('제목, 내용, 태그로 검색...')}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
        </div>
        <div className="text-xs text-gray-400 self-center whitespace-nowrap">{items.length}<Unit><T k="건" /></Unit></div>
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div className="py-16 text-center text-gray-400"><T k="로딩 중..." /></div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          {search ? `"${search}" 검색 결과 없음` : <T k="등록된 콘텐츠가 없습니다" />}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const cat = CAT_MAP[item.category];
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id} className={`bg-white border rounded-2xl overflow-hidden transition ${!item.isActive ? 'opacity-50 border-dashed' : 'border-gray-100'}`}>
                {/* 헤더 행 */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpandedId(isExpanded ? null : item.id)} className="text-gray-400 hover:text-gray-600">
                    <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                  <span className="text-base">{cat?.icon ?? '📋'}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap border ${CAT_COLOR[item.category] ?? 'bg-gray-100'}`}>
                    <T k={cat?.label ?? item.category} />
                  </span>
                  {item.isPinned && <span className="text-[10px] text-orange-500 font-bold whitespace-nowrap">📌 <T k="고정" /></span>}
                  {!item.isActive && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold whitespace-nowrap"><T k="비활성" /></span>}
                  <span className="text-sm font-bold text-gray-900 truncate flex-1">{item.title}</span>
                  <span className="text-[10px] text-gray-300 whitespace-nowrap">{kdate(new Date(item.updatedAt))}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => openEditor(item)}
                      className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-[11px] font-medium hover:bg-blue-100"><T k="편집" /></button>
                    <button onClick={async () => {
                      try {
                        const res = await apiClient.get<{ data: Array<{ id: string; action: string; changes: Record<string, unknown>; changedAt: string; changer: { familyName: string; givenName: string } }> }>(`/api/v1/hospital-info/${item.id}/history`);
                        const h = res.data ?? [];
                        if (!h.length) { toast.info(tAttr('변경이력이 없습니다')); return; }
                        const msg = h.slice(0, 10).map(a => `${kdate(new Date(a.changedAt), 'datetime')} — ${a.action} (${a.changer.familyName}${a.changer.givenName})`).join('\n');
                        alert(`변경이력 (최근 ${Math.min(h.length, 10)}건)\n\n${msg}`);
                      } catch { toast.error(tAttr('이력 조회 실패')); }
                    }} className="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-lg text-[11px] font-medium hover:bg-purple-100"><T k="이력" /></button>
                    <button onClick={() => toggleMut.mutate(item.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${item.isActive ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                      <T k={item.isActive ? '숨김' : '공개'} />
                    </button>
                    <button onClick={() => { if (confirm(`"${item.title}" 을 삭제하시겠습니까?`)) deleteMut.mutate(item.id); }}
                      className="px-2.5 py-1 bg-red-50 text-red-600 rounded-lg text-[11px] font-medium hover:bg-red-100"><T k="삭제" /></button>
                  </div>
                </div>
                {/* 펼침 미리보기 */}
                {isExpanded && (
                  <div className="px-5 pb-4 border-t border-gray-50 bg-gray-50/50">
                    <div className="grid grid-cols-3 gap-4 mt-3">
                      <div className="col-span-2">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k="본문 미리보기" /></p>
                        <div className="bg-white rounded-xl border border-gray-100 p-4 text-xs text-gray-700 whitespace-pre-wrap max-h-[300px] overflow-y-auto leading-relaxed">
                          {item.content}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k="슬러그" /></p>
                          <p className="text-xs font-mono text-gray-600 bg-white rounded-lg border px-2 py-1">{item.slug}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">태그 ({AI_ORIGIN_TEXT} 매칭용)</p>
                          <div className="flex flex-wrap gap-1">
                            {item.tags.map(tag => (
                              <span key={tag} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{tag}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k="정보" /></p>
                          <div className="text-[10px] text-gray-500 space-y-0.5">
                            <p><T k="정렬" />: {item.sortOrder}</p>
                            <p><T k="등록@일시" />: {kdate(new Date(item.createdAt))}</p>
                            <p><T k="수정@일시" />: {kdate(new Date(item.updatedAt))}</p>
                            <p><T k="글자 수" />: {item.content.length}자</p>
                          </div>
                        </div>
                        <button onClick={() => openEditor(item)}
                          className="w-full py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
                          <T k="편집하기" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// 편집 화면 (전체 화면)
// ══════════════════════════════════════════════

function EditorView({ item, onClose, onSaved }: { item: InfoContent | null; onClose: () => void; onSaved: () => void }) {
  const tAttr = useTAttr();
  const isEdit = !!item;
  const [showPreview, setShowPreview] = useState(false);
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [form, setForm] = useState({
    category: item?.category ?? 'GENERAL',
    slug: item?.slug ?? '',
    title: item?.title ?? '',
    content: item?.content ?? '',
    sortOrder: String(item?.sortOrder ?? 0),
    tags: item?.tags?.join(', ') ?? '',
    isPinned: item?.isPinned ?? false,
    imageUrl: item?.imageUrl ?? '',
    metadataStr: item?.metadata ? JSON.stringify(item.metadata, null, 2) : '{}',
  });

  const saveMut = useMutation({
    mutationFn: async (d: typeof form) => {
      const body = {
        category: d.category, slug: d.slug, title: d.title, content: d.content,
        sortOrder: parseInt(d.sortOrder) || 0,
        tags: d.tags.split(',').map(t => t.trim()).filter(Boolean),
        isPinned: d.isPinned,
        imageUrl: d.imageUrl || undefined,
        // 🔴 W9: 파싱 실패를 `{}` 로 삼켜 구조화 데이터를 통째로 덮어쓰던 것 → 저장 자체를 막는다.
        metadata: parseMetadataOrThrow(d.metadataStr),
      };
      if (isEdit) return apiClient.put(`/api/v1/hospital-info/${item!.id}`, body);
      return apiClient.post('/api/v1/hospital-info', body);
    },
    onSuccess: () => {
      toast.success(isEdit ? tAttr('수정 완료') : tAttr('등록 완료'));
      // 공개 홈페이지 ISR 캐시 무효화 — 서버 경유 정본(아래 revalidateHomepage 주석 참조)
      apiClient.post('/api/v1/hospital-info/revalidate-homepage', {})
        .catch((e: { message?: string }) => toast.warning(`${tAttr('저장은 됐지만 홈페이지 즉시 반영은 실패했습니다')} — ${e?.message ?? tAttr('연결/시크릿 확인')}`));
      onSaved();
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('저장 실패')),
  });

  // 슬러그 자동 생성 (새 콘텐츠)
  const autoSlug = () => {
    if (!isEdit && !form.slug && form.title) {
      const slug = form.title.replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 50);
      setForm(f => ({ ...f, slug }));
    }
  };

  return (
    <div className="space-y-4">
      {/* 상단 바 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            <T k="목록으로" />
          </button>
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? `${tAttr('편집')}: ${item!.title}` : <T k="새 콘텐츠 작성" />}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPreview(!showPreview)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${showPreview ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <T k={showPreview ? '편집' : '미리보기'} />
          </button>
          <button onClick={() => { if (!form.title) { toast.warning(tAttr('제목을 입력하세요')); return; } if (!form.slug) { toast.warning(tAttr('슬러그를 입력하세요')); return; } saveMut.mutate(form); }}
            disabled={saveMut.isPending}
            className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shadow-sm">
            <T k={saveMut.isPending ? '저장 중...' : isEdit ? '수정 저장' : '등록@버튼'} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* 왼쪽: 편집 영역 */}
        <div className={`${showPreview ? 'col-span-1' : 'col-span-2'} space-y-4`}>
          {/* 기본 정보 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
            <h3 className="text-sm font-bold text-gray-800"><T k="기본 정보" /></h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="카테고리" /></label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  disabled={isEdit} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-50">
                  {CATEGORIES.filter(c => c.value).map(c => <option key={c.value} value={c.value}>{c.icon} {tAttr(c.label)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="슬러그 (URL 식별자)" /></label>
                <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                  disabled={isEdit} placeholder={tAttr('예: parking-guide')}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono disabled:bg-gray-50" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="정렬순서" /></label>
                <input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="제목" /></label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} onBlur={autoSlug}
                placeholder={tAttr('병원 안내 제목을 입력하세요')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium" />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={form.isPinned} onChange={e => setForm(f => ({ ...f, isPinned: e.target.checked }))}
                  className="rounded border-gray-300" />
                📌 <T k="상단 고정 (긴급 공지)" />
              </label>
            </div>
          </div>

          {/* 본문 편집 (리치텍스트) */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-800"><T k="본문" /></h3>
              <span className="text-[10px] text-gray-400">{form.content.length}자</span>
            </div>
            <Suspense fallback={<div className="h-[300px] border border-gray-200 rounded-xl flex items-center justify-center text-sm text-gray-400"><T k="에디터 로딩 중..." /></div>}>
              <RichTextEditor
                content={form.content}
                onChange={(html: string) => setForm(f => ({ ...f, content: html }))}
                placeholder={tAttr('환자에게 표시될 내용을 작성하세요...')}
                /* 🔴 W9: 본문 삽입 이미지도 공개 경로(/media) — /uploads 서명은 1시간 뒤 만료된다 */
                uploader={(file) => uploadCmsImage(file, `/homepage/${form.category.toLowerCase()}`)}
              />
            </Suspense>
          </div>

          {/* 태그 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2">검색 태그 ({AI_ORIGIN_TEXT} 매칭용)</h3>
            <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              placeholder={tAttr('쉼표로 구분: 주차, 주차장, 요금, 무료, 전기차')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            <p className="text-[10px] text-gray-400 mt-1">환자가 {AI_ORIGIN_TEXT} 도우미에게 질문할 때 이 태그와 매칭하여 이 콘텐츠를 응답합니다</p>
            {form.tags && (
              <div className="flex flex-wrap gap-1 mt-2">
                {form.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                  <span key={tag} className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{tag}</span>
                ))}
              </div>
            )}
          </div>

          {/* 대표 이미지 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2"><T k="대표 이미지" /></h3>
            <div className="flex items-center gap-2">
              <input value={form.imageUrl ?? ''} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))}
                placeholder={tAttr('이미지 URL')}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              <button onClick={() => setMediaPickerOpen(true)}
                className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 transition whitespace-nowrap">
                <T k="미디어 선택" />
              </button>
              <label className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium cursor-pointer hover:bg-blue-100 transition whitespace-nowrap">
                <T k="파일 업로드" />
                {/* 🔴 W9: `/api/v1/upload/image`(→ `/uploads/*`)는 HMAC 서명 TTL 1시간 게이트라
                    공개 홈페이지 ISR 캐시에서 이미지가 만료되고, hospital.example.org 엔 `/uploads` 프록시조차 없다.
                    홈페이지 이미지 정본은 미디어 라이브러리(`/media/*`) 하나다. */}
                <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const url = await uploadCmsImage(file, `/homepage/${form.category.toLowerCase()}`);
                    setForm(f => ({ ...f, imageUrl: url }));
                    toast.success(tAttr('이미지 업로드 완료'));
                  } catch (err) { toast.error((err as { message?: string })?.message || tAttr('업로드 실패')); }
                  e.target.value = '';
                }} />
              </label>
            </div>
            <MediaPickerModal
              open={mediaPickerOpen}
              onClose={() => setMediaPickerOpen(false)}
              onSelect={(url) => setForm(f => ({ ...f, imageUrl: url }))}
            />
            {form.imageUrl && (
              <div className="mt-2 relative inline-block">
                <img src={form.imageUrl} alt={tAttr('대표 이미지')} className="h-20 rounded-lg border border-gray-200 object-cover" />
                <button onClick={() => setForm(f => ({ ...f, imageUrl: '' }))}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600">x</button>
              </div>
            )}
          </div>

          {/* 🔴 구조화 데이터 — 생 JSON 대신 카테고리별 필드 정본(shared `CMS_CATEGORIES`)으로 편집한다.
              전용 편집 화면이 있는 카테고리는 그쪽이 정본이라는 사실을 함께 말한다(정본이 둘이면 갈라진다). */}
          {(() => {
            const def = cmsCategoryDef(form.category);
            return def?.adminHref ? (
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-2.5">
                <p className="text-[11px] text-blue-900">
                  <b>{def.label}</b> 은(는) 전용 편집 화면이 있습니다 —{' '}
                  <a href={def.adminHref} className="font-bold underline underline-offset-2">{def.adminHref}</a>
                  {' '}에서 목록·미리보기와 함께 편집하는 것이 정본입니다. 여기서도 저장은 됩니다.
                </p>
              </div>
            ) : null;
          })()}
          <CmsMetadataForm
            category={form.category}
            value={(() => { try { return JSON.parse(form.metadataStr || '{}') ?? {}; } catch { return {}; } })()}
            onChange={(next) => setForm(f => ({ ...f, metadataStr: JSON.stringify(next, null, 2) }))}
            imageUrl={form.imageUrl}
          />
        </div>

        {/* 오른쪽: 미리보기 */}
        <div className={showPreview ? 'col-span-2' : 'col-span-1'}>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sticky top-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-800"><T k="미리보기 (환자 화면)" /></h3>
              <div className="flex items-center gap-1">
                {['desktop', 'tablet', 'mobile'].map(d => (
                  <button key={d} onClick={() => setPreviewDevice?.(d)} className={`p-1 rounded text-gray-400 hover:text-gray-700 ${previewDevice === d ? 'bg-gray-100 text-gray-700' : ''}`} title={d}>
                    {d === 'desktop' ? '🖥' : d === 'tablet' ? '📱' : '📲'}
                  </button>
                ))}
                <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold border ${CAT_COLOR[form.category] ?? 'bg-gray-100'}`}>
                  {CAT_MAP[form.category]?.icon} <T k={CAT_MAP[form.category]?.label ?? ''} />
                </span>
              </div>
            </div>
            <div className={`border border-gray-100 rounded-xl p-4 bg-gray-50/50 min-h-[300px] mx-auto transition-all ${previewDevice === 'mobile' ? 'max-w-[375px]' : previewDevice === 'tablet' ? 'max-w-[768px]' : ''}`}>
              {form.title && <h4 className="text-base font-bold text-gray-900 mb-3">{form.title}</h4>}
              {form.content ? (
                <div className="prose prose-sm max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(form.content) }} />
              ) : (
                <p className="text-sm text-gray-300 italic"><T k="본문을 입력하면 여기에 미리보기가 표시됩니다" /></p>
              )}
            </div>
            {form.tags && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 mb-1">{AI_ORIGIN_TEXT} 매칭 태그</p>
                <div className="flex flex-wrap gap-1">
                  {form.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                    <span key={tag} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
