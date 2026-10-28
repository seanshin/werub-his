'use client';

import { useState, lazy, Suspense } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { sanitizeHtml } from '@/lib/sanitize';
import { toast } from '@/stores/toast-store';

const RichTextEditor = lazy(() => import('@/components/ui/rich-text-editor').then(m => ({ default: m.RichTextEditor })));
import { MediaPickerModal } from '@/components/admin/MediaPickerModal';
import { CmsMetadataForm } from '@/components/admin/CmsMetadataForm';
import { cmsCategoryDef, cmsDisplayGaps } from '@hospital-run/shared';

interface InfoContent {
  id: string; category: string; slug: string; title: string;
  content: string; metadata: Record<string, unknown>; sortOrder: number;
  isActive: boolean; tags: string[]; imageUrl?: string;
  isPinned: boolean; updatedAt: string; createdAt: string;
}

interface CategoryCmsPageProps {
  category: string;
  title: string;
  description: string;
  /** NEWS 카테고리의 subType 필터 표시 등 */
  subTypes?: { value: string; label: string }[];
}

/**
 * '고급: 구조화 데이터' JSON 파싱 — 실패는 **저장을 막는다**.
 * 🔴 W9 실결함: 기존 코드는 `catch { return {} }` 로 삼켜, 텍스트에어리어에 오타가 하나 나면
 *    저장 시 metadata 가 `{}` 로 덮어써져 공개 화면이 읽는 키(NEWS subType·진료과 departmentName 등)가
 *    통째로 사라졌다. 화면엔 '수정 완료' 만 떴다. (서버도 병합·소거거부로 이중 방어한다.)
 */
const META_ERR_SYNTAX = '구조화 데이터(JSON) 형식이 올바르지 않습니다 — 저장하지 않았습니다';
const META_ERR_SHAPE = '구조화 데이터는 { } 객체여야 합니다 — 저장하지 않았습니다';
const UPLOAD_ERR_NO_URL = '업로드 응답에 URL이 없습니다';
/**
 * 이 파일이 **스스로 던지는** 오류 문구 — 표시할 때만 번역한다(i18n ops12).
 * 🔴 서버가 준 오류 메시지는 번역하지 않는다(서버 조립 문장 · §12-G) — 이 집합에 든 것만 `tAttr` 를 지난다.
 */
const OWN_ERRORS: ReadonlySet<string> = new Set([META_ERR_SYNTAX, META_ERR_SHAPE, UPLOAD_ERR_NO_URL]);

export function parseMetadataOrThrow(raw: string): Record<string, unknown> {
  const text = (raw ?? '').trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(META_ERR_SYNTAX);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(META_ERR_SHAPE);
  }
  return parsed as Record<string, unknown>;
}

/**
 * CMS 이미지 업로드 정본 — **미디어 라이브러리(`/media/*`)만** 쓴다.
 * 🔴 W9 실결함: 기존 '파일 업로드' 는 `/api/v1/upload/image` 로 올려 `/uploads/images/...` 를 저장했다.
 *    `/uploads` 는 PHI 보호 때문에 **응답 시점 HMAC 서명(TTL 1시간)** 게이트가 걸려 있어,
 *    (1) 공개 홈페이지가 ISR(300~3600초)로 캐싱한 서명 URL 이 만료되면 이미지가 401 로 깨지고
 *    (2) 공개 홈페이지(hospital.example.org = apps/homepage)에는 `/uploads` 프록시 자체가 없어 항상 404 다.
 *    `/media` 는 두 앱 모두 rewrite 가 있고 서명이 없는 공개 정적 경로다 — 홈페이지 이미지의 정본.
 */
export async function uploadCmsImage(file: File, folder: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiClient.fetch<{ data: { url: string } }>(
    `/api/v1/homepage/media/upload?folder=${encodeURIComponent(folder)}`,
    { method: 'POST', body: fd },
  );
  const url = res?.data?.url;
  if (!url) throw new Error(UPLOAD_ERR_NO_URL);
  return url;
}

/**
 * 공개 홈페이지 ISR 캐시 무효화 — 서버 경유 정본.
 * 🔴 W9: 이 편집기(뉴스·건강정보·진료과·센터·갤러리·CSR·채용·배너)는 저장 후 아무것도 갱신하지 않아
 *    같은 레코드를 /admin/hospital-info 에서 고칠 때와 결과가 달랐다(정본이 둘). 최대 1시간 낡은 채 공개된다.
 */
function revalidateHomepage(tAttr: (k: string) => string, tfAttr: (k: string, p: Record<string, string | number>) => string) {
  // 사유 자리의 서버 메시지는 번역하지 않는다 — 폴백 문구만 크롬이다
  apiClient.post('/api/v1/hospital-info/revalidate-homepage', {})
    .catch((e: { message?: string }) => toast.warning(tfAttr('저장은 됐지만 홈페이지 즉시 반영은 실패했습니다 — {사유}', { 사유: e?.message ?? tAttr('연결/시크릿 확인') })));
}

const CAT_COLOR: Record<string, string> = {
  DEPARTMENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CENTER: 'bg-red-50 text-red-700 border-red-200',
  NEWS: 'bg-sky-50 text-sky-700 border-sky-200',
  HEALTH_INFO: 'bg-green-50 text-green-700 border-green-200',
  HEALTH_VIDEO: 'bg-pink-50 text-pink-700 border-pink-200',
  GALLERY: 'bg-pink-50 text-pink-700 border-pink-200',
  CSR: 'bg-lime-50 text-lime-700 border-lime-200',
  RECRUIT: 'bg-orange-50 text-orange-700 border-orange-200',
};

export function CategoryCmsPage({ category, title, description, subTypes }: CategoryCmsPageProps) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'edit'>('list');
  const [editItem, setEditItem] = useState<InfoContent | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: listRes, isLoading } = useQuery({
    queryKey: ['homepage-cms', category],
    queryFn: () => apiClient.get<{ data: InfoContent[] }>(`/api/v1/hospital-info?category=${category}`),
  });
  const allItems: InfoContent[] = Array.isArray(listRes?.data) ? listRes.data : (listRes?.data as any)?.data ?? [];

  const items = search
    ? allItems.filter(i => i.title.includes(search) || i.content.includes(search) || i.tags.some(t => t.includes(search)))
    : allItems;

  const toggleMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/hospital-info/${id}/toggle`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['homepage-cms', category] }); revalidateHomepage(tAttr, tfAttr); toast.success(tAttr('상태 변경')); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.fetch(`/api/v1/hospital-info/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['homepage-cms', category] }); revalidateHomepage(tAttr, tfAttr); toast.success(tAttr('삭제 완료')); },
  });

  if (viewMode === 'edit') {
    return (
      <EditorView
        item={editItem}
        category={category}
        subTypes={subTypes}
        onClose={() => { setViewMode('list'); setEditItem(null); }}
        onSaved={() => { qc.invalidateQueries({ queryKey: ['homepage-cms', category] }); setViewMode('list'); setEditItem(null); }}
      />
    );
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-1">{description}</p>
          {/* 🔴 "이 화면에서 고친 것이 홈페이지 어디에 나오는가" — CMS 는 데이터가 아니라 **화면**을 고치는 도구다 */}
          {(() => {
            const def = cmsCategoryDef(category);
            if (!def) return null;
            return def.publicPaths.length > 0 ? (
              <p className="text-[11px] text-gray-400 mt-0.5">
                <Tf k="공개 위치 · {경로}" params={{ 경로: <b className="text-gray-500">{def.publicPaths.join(' · ')}</b> }} />
                {def.imageRole === 'REQUIRED' && <span className="ml-1.5 text-rose-600">· <T k="대표 이미지가 화면의 주된 요소입니다" /></span>}
              </p>
            ) : (
              <p className="text-[11px] text-amber-700 mt-0.5"><T k="이 카테고리를 읽는 공개 화면이 확인되지 않았습니다 — 저장해도 홈페이지에 나오지 않습니다." /></p>
            );
          })()}
        </div>
        <button onClick={() => { setEditItem(null); setViewMode('edit'); }}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm">
          + <T k="새 항목 추가" />
        </button>
      </div>

      {/* 검색 */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tAttr('제목, 내용, 태그로 검색...')}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
        </div>
        <span className="text-xs text-gray-400 self-center whitespace-nowrap">{items.length}<Unit>건</Unit></span>
        {/* 🔴 "공개 화면이 읽는데 비어 있는" 항목 수 — 분모와 함께 낸다(분모 0이면 산출 불가) */}
        {items.length > 0 && (() => {
          const withGaps = items.filter(i => cmsDisplayGaps(category, i).length > 0).length;
          return withGaps === 0 ? (
            <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1 self-center whitespace-nowrap">
              <Tf k="공개 표시 필수 항목 충족 {충족}/{전체}" params={{ 충족: items.length, 전체: items.length }} />
            </span>
          ) : (
            <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 self-center whitespace-nowrap"
              title={tAttr('공개 화면이 읽는 값이 비어 있어 그 자리가 폴백으로 그려집니다')}>
              <Tf k="보완 필요 {보완}/{전체}" params={{ 보완: withGaps, 전체: items.length }} />
            </span>
          );
        })()}
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div className="py-16 text-center text-gray-400"><T k="로딩 중..." /></div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          {search ? <Tf k='"{검색어}" 검색 결과 없음' params={{ 검색어: search }} /> : <T k="등록된 항목이 없습니다" />}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const isExpanded = expandedId === item.id;
            const subType = (item.metadata as Record<string, string>)?.subType;
            return (
              <div key={item.id} className={`bg-white border rounded-2xl overflow-hidden transition ${!item.isActive ? 'opacity-50 border-dashed' : 'border-gray-100'}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpandedId(isExpanded ? null : item.id)} className="text-gray-400 hover:text-gray-600">
                    <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                  {item.isPinned && <span className="text-[10px] text-orange-500 font-bold whitespace-nowrap">📌</span>}
                  {!item.isActive && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold whitespace-nowrap"><T k="비활성" /></span>}
                  {subType && subTypes && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold whitespace-nowrap ${CAT_COLOR[category] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                      {subTypes.find(s => s.value === subType)?.label ?? subType}
                    </span>
                  )}
                  <span className="text-sm font-bold text-gray-900 truncate flex-1">{item.title}</span>
                  {(() => {
                    const gaps = cmsDisplayGaps(category, item);
                    return gaps.length > 0 ? (
                      <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-bold whitespace-nowrap"
                        title={tfAttr('공개 화면이 읽는데 비어 있음: {항목}', { 항목: gaps.map(g => g.label).join(' · ') })}>
                        <Tf k="보완 {수}" params={{ 수: gaps.length }} />
                      </span>
                    ) : null;
                  })()}
                  <span className="text-[10px] text-gray-300 whitespace-nowrap">{kdate(new Date(item.updatedAt), 'date')}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => { setEditItem(item); setViewMode('edit'); }}
                      className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-[11px] font-medium hover:bg-blue-100"><T k="편집" /></button>
                    <button onClick={() => toggleMut.mutate(item.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${item.isActive ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                      {item.isActive ? <T k="숨김" /> : <T k="공개" />}
                    </button>
                    <button onClick={() => { if (confirm(tfAttr('"{제목}" 을 삭제하시겠습니까?', { 제목: item.title }))) deleteMut.mutate(item.id); }}
                      className="px-2.5 py-1 bg-red-50 text-red-600 rounded-lg text-[11px] font-medium hover:bg-red-100"><T k="삭제" /></button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-5 pb-4 border-t border-gray-50 bg-gray-50/50">
                    <div className="grid grid-cols-3 gap-4 mt-3">
                      <div className="col-span-2">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k="본문 미리보기" /></p>
                        <div className="bg-white rounded-xl border border-gray-100 p-4 text-xs text-gray-700 whitespace-pre-wrap max-h-[300px] overflow-y-auto leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content) }} />
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k="슬러그" /></p>
                          <p className="text-xs font-mono text-gray-600 bg-white rounded-lg border px-2 py-1">{item.slug}</p>
                        </div>
                        {item.imageUrl && (
                          <div>
                            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k="이미지" /></p>
                            <img src={item.imageUrl} alt="" className="h-16 rounded-lg border object-cover" />
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k="태그" /></p>
                          <div className="flex flex-wrap gap-1">
                            {item.tags.map(tag => (
                              <span key={tag} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{tag}</span>
                            ))}
                          </div>
                        </div>
                        <button onClick={() => { setEditItem(item); setViewMode('edit'); }}
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

/* ─── 편집 뷰 ─── */
function EditorView({ item, category, subTypes, onClose, onSaved }: {
  item: InfoContent | null; category: string;
  subTypes?: { value: string; label: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const isEdit = !!item;
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [form, setForm] = useState({
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
        category,
        slug: d.slug,
        title: d.title,
        content: d.content,
        sortOrder: parseInt(d.sortOrder) || 0,
        tags: d.tags.split(',').map(t => t.trim()).filter(Boolean),
        isPinned: d.isPinned,
        imageUrl: d.imageUrl || undefined,
        // 🔴 W9: 여기서 파싱 실패를 `{}` 로 삼켜 **구조화 데이터를 통째로 날렸다**(오타 한 글자 = subType 소멸).
        //    파싱 실패는 저장하지 않는다(parseMetadataOrThrow 가 던지고 onError 가 이유를 말한다).
        metadata: parseMetadataOrThrow(d.metadataStr),
      };
      if (isEdit) return apiClient.put(`/api/v1/hospital-info/${item!.id}`, body);
      return apiClient.post('/api/v1/hospital-info', body);
    },
    onSuccess: () => { toast.success(isEdit ? tAttr('수정 완료') : tAttr('등록 완료')); revalidateHomepage(tAttr, tfAttr); onSaved(); },
    // 이 파일이 던진 문구만 번역한다 — 서버 오류 메시지는 그대로(§12-G)
    onError: (e) => { const m = (e as { message?: string })?.message; toast.error(m ? (OWN_ERRORS.has(m) ? tAttr(m) : m) : tAttr('저장 실패')); },
  });

  const autoSlug = () => {
    if (!isEdit && !form.slug && form.title) {
      const slug = form.title.replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 50);
      setForm(f => ({ ...f, slug }));
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            <T k="목록으로" />
          </button>
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? <Tf k="편집: {제목}" params={{ 제목: item!.title }} /> : <T k="새 항목 작성" />}</h2>
        </div>
        <button onClick={() => { if (!form.title) { toast.warning(tAttr('제목을 입력하세요')); return; } if (!form.slug) { toast.warning(tAttr('슬러그를 입력하세요')); return; } saveMut.mutate(form); }}
          disabled={saveMut.isPending}
          className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shadow-sm">
          {saveMut.isPending ? <T k="저장 중..." /> : isEdit ? <T k="수정 저장" /> : <T k="등록@저장" />}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          {/* 기본 정보 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
            <h3 className="text-sm font-bold text-gray-800"><T k="기본 정보" /></h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="슬러그 (URL)" /></label>
                <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                  disabled={isEdit} placeholder={tAttr('예: my-news-item')}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono disabled:bg-gray-50" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="정렬순서" /></label>
                <input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              {subTypes && (
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="유형" /></label>
                  {/* 🔴 W9: value 가 '' 인데 '(미지정)' 옵션이 없어 브라우저가 첫 항목('공지사항')을 그려줬다.
                      화면은 '공지사항' 이라 말하고 저장되는 metadata 엔 subType 이 없어, 공개 뉴스 화면의
                      유형 필터에서 그 글만 사라졌다. 모르는 값은 '미지정'이라고 말한다. */}
                  <select
                    value={(() => { try { return JSON.parse(form.metadataStr)?.subType ?? ''; } catch { return ''; } })()}
                    onChange={e => {
                      let meta: Record<string, unknown> = {};
                      try { meta = JSON.parse(form.metadataStr || '{}') ?? {}; } catch { toast.warning(tAttr('구조화 데이터(JSON)가 올바르지 않아 유형을 바꿀 수 없습니다')); return; }
                      if (e.target.value) meta.subType = e.target.value; else delete meta.subType;
                      setForm(f => ({ ...f, metadataStr: JSON.stringify(meta, null, 2) }));
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                    <option value="">{tAttr('(유형 미지정)')}</option>
                    {subTypes.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="제목" /></label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} onBlur={autoSlug}
                placeholder={tAttr('제목을 입력하세요')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium" />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={form.isPinned} onChange={e => setForm(f => ({ ...f, isPinned: e.target.checked }))}
                className="rounded border-gray-300" />
              📌 <T k="상단 고정" />
            </label>
          </div>

          {/* 본문 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-800"><T k="본문" /></h3>
              <span className="text-[10px] text-gray-400"><Tf k="{수}자" params={{ 수: form.content.length }} /></span>
            </div>
            <Suspense fallback={<div className="h-[300px] border border-gray-200 rounded-xl flex items-center justify-center text-sm text-gray-400"><T k="에디터 로딩 중..." /></div>}>
              <RichTextEditor
                content={form.content}
                onChange={(html: string) => setForm(f => ({ ...f, content: html }))}
                placeholder={tAttr('내용을 작성하세요...')}
                /* 🔴 W9: 본문에 끼워 넣는 이미지도 공개 경로(/media)로 — /uploads 는 1시간 뒤 깨진다 */
                uploader={(file) => uploadCmsImage(file, `/homepage/${category.toLowerCase()}`)}
              />
            </Suspense>
          </div>

          {/* 태그 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2"><T k="검색 태그" /></h3>
            <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              placeholder={tAttr('쉼표로 구분')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            {form.tags && (
              <div className="flex flex-wrap gap-1 mt-2">
                {form.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                  <span key={tag} className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 오른쪽: 이미지 + 미리보기 */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2"><T k="대표 이미지" /></h3>
            <input value={form.imageUrl ?? ''} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))}
              placeholder={tAttr('이미지 URL')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-2" />
            <div className="flex gap-2">
              <button onClick={() => setMediaPickerOpen(true)}
                className="flex-1 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 transition text-center">
                <T k="미디어 선택" />
              </button>
              <label className="flex-1 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium cursor-pointer hover:bg-blue-100 transition text-center">
                <T k="파일 업로드" />
                <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  try {
                    const url = await uploadCmsImage(file, `/homepage/${category.toLowerCase()}`);
                    setForm(f => ({ ...f, imageUrl: url }));
                    toast.success(tAttr('업로드 완료'));
                  } catch (err) { const m = (err as { message?: string })?.message; toast.error(m ? (OWN_ERRORS.has(m) ? tAttr(m) : m) : tAttr('업로드 실패')); }
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
                <img src={form.imageUrl} alt="" className="h-20 rounded-lg border object-cover" />
                <button onClick={() => setForm(f => ({ ...f, imageUrl: '' }))}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600">x</button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 sticky top-4">
            <h3 className="text-sm font-bold text-gray-800 mb-3"><T k="미리보기" /></h3>
            <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50 min-h-[200px]">
              {form.title && <h4 className="text-base font-bold text-gray-900 mb-3">{form.title}</h4>}
              {form.content ? (
                <div className="prose prose-sm max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(form.content) }} />
              ) : (
                <p className="text-sm text-gray-300 italic"><T k="본문을 입력하면 미리보기가 표시됩니다" /></p>
              )}
            </div>
          </div>

          {/* 🔴 구조화 데이터 — 생 JSON 대신 **카테고리별 필드 정본**(shared `CMS_CATEGORIES`)으로 편집한다.
              편집자가 "이 값이 공개 화면에서 무엇이 되는지"와 "무엇이 비어 있는지"를 그 자리에서 본다.
              정본에 없는 키는 지우지 않고 고급 영역에서 보존한다. */}
          <CmsMetadataForm
            category={category}
            value={(() => { try { return JSON.parse(form.metadataStr || '{}') ?? {}; } catch { return {}; } })()}
            onChange={(next) => setForm(f => ({ ...f, metadataStr: JSON.stringify(next, null, 2) }))}
            imageUrl={form.imageUrl}
          />
        </div>
      </div>
    </div>
  );
}
