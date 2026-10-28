'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { EmptyState, Unit } from '@/components/ui/display';
import { kstToday, kstTodayPlus } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

// ── Types ──
interface Popup {
  id: string; title: string; type: string; content?: string;
  imageUrl?: string; linkUrl?: string; linkText?: string;
  targetPages: string[]; startDate: string; endDate: string;
  isActive: boolean; hideToday: boolean; sortOrder: number;
  bgColor?: string; textColor?: string; buttonText?: string; buttonColor?: string;
  clipartId?: string; clipartPosition?: string; overlayOpacity?: number;
  borderRadius?: number; fontSize?: string; templateId?: string;
  creator?: { familyName: string; givenName: string };
  createdAt: string;
}

interface Template {
  id: string; name: string; category: string; type: string; thumbnail: string;
  defaults: Record<string, string>;
}

interface ClipartIcon { id: string; name: string; path: string }
interface ClipartCategory { id: string; name: string; icons: ClipartIcon[] }

type FormData = {
  title: string; type: string; content: string; imageUrl: string;
  linkUrl: string; startDate: string; endDate: string; hideToday: boolean; sortOrder: number;
  bgColor: string; textColor: string; buttonText: string; buttonColor: string;
  clipartId: string; clipartPosition: string; overlayOpacity: number; borderRadius: number; fontSize: string;
};

const DEFAULTS: FormData = {
  title: '', type: 'MODAL', content: '', imageUrl: '', linkUrl: '',
  startDate: '', endDate: '', hideToday: true, sortOrder: 0,
  bgColor: '#FFFFFF', textColor: '#111827', buttonText: '자세히 보기', buttonColor: '#2563EB',
  clipartId: '', clipartPosition: 'top', overlayOpacity: 0, borderRadius: 16, fontSize: 'md',
};

const TYPE_OPTIONS = [
  { value: 'MODAL', label: '팝업 모달', icon: '📢' },
  { value: 'STRIP', label: '띠배너', icon: '📌' },
  { value: 'FLOATING', label: '플로팅', icon: '💬' },
  { value: 'PAGE_BANNER', label: '페이지 배너', icon: '📋' },
];

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-100 text-green-700', scheduled: 'bg-amber-100 text-amber-700',
  expired: 'bg-gray-100 text-gray-500', inactive: 'bg-red-100 text-red-600',
};
const STATUS_LABEL: Record<string, string> = { active: '활성', scheduled: '예약', expired: '만료', inactive: '비활성' };
/** 🔴 '예약'은 진료 예약(Appointment)과 동음이의 — 게시 상태는 `예약@상태`(Scheduled) */
const statusKey = (label: string) => (label === '예약' ? '예약@상태' : label);

function getStatus(p: Popup): string {
  if (!p.isActive) return 'inactive';
  const now = new Date();
  if (new Date(p.startDate) > now) return 'scheduled';
  if (new Date(p.endDate) < now) return 'expired';
  return 'active';
}

export default function PopupsPage() {
  const tAttr = useTAttr();
  const [popups, setPopups] = useState<Popup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>({ ...DEFAULTS });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [cliparts, setCliparts] = useState<ClipartCategory[]>([]);
  const [showCliparts, setShowCliparts] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [tab, setTab] = useState<'content' | 'style' | 'preview'>('content');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    apiClient.get<{ data: Popup[] }>('/api/v1/homepage/popups')
      .then(res => setPopups(Array.isArray(res.data) ? res.data : (res.data as Record<string, unknown>)?.data as Popup[] ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    apiClient.get<{ data: Template[] }>('/api/v1/homepage/popup-templates')
      .then(res => setTemplates(Array.isArray(res.data) ? res.data : (res.data as Record<string, unknown>)?.data as Template[] ?? []))
      .catch(() => {});
    apiClient.get<{ data: { categories: ClipartCategory[] } }>('/api/v1/homepage/cliparts')
      .then(res => {
        const d = res.data as Record<string, unknown>;
        const cats = (d?.categories ?? (d?.data as Record<string, unknown>)?.categories ?? []) as ClipartCategory[];
        setCliparts(cats);
      })
      .catch(() => {});
  }, []);

  const f = useCallback((key: keyof FormData, val: unknown) => setForm(p => ({ ...p, [key]: val })), []);

  const handleSave = async () => {
    // 🔴 W9: 제목·기간 없이 저장하면 서버에서 Invalid Date 로 500 이 나고 화면엔 이유 없는
    //    '저장에 실패했습니다' 만 떴다. 못 만드는 조건은 누르기 전에 말한다.
    if (!form.title.trim()) { toast.warning(tAttr('제목을 입력하세요')); return; }
    if (!form.startDate || !form.endDate) { toast.warning(tAttr('노출 시작일과 종료일을 지정하세요')); return; }
    if (form.endDate < form.startDate) { toast.warning(tAttr('종료일이 시작일보다 빠릅니다')); return; }
    try {
      if (editId) {
        await apiClient.patch(`/api/v1/homepage/popups/${editId}`, form);
        toast.success(tAttr('팝업이 수정되었습니다'));
      } else {
        await apiClient.post('/api/v1/homepage/popups', form);
        toast.success(tAttr('팝업이 생성되었습니다'));
      }
      setShowForm(false); setEditId(null); setForm({ ...DEFAULTS }); setTab('content');
      load();
    } catch (e) { toast.error((e as { message?: string })?.message || tAttr('저장에 실패했습니다')); }
  };

  // 🔴 W9: 복제·토글·삭제에 try/catch 가 없어 서버가 거부해도 화면이 아무 말도 하지 않았다
  //    (토글 실패 시 목록만 다시 그려져 '눌렀는데 안 바뀐다'로 보인다).
  const handleClone = async (id: string) => {
    try {
      await apiClient.post(`/api/v1/homepage/popups/${id}/clone`, {});
      toast.success(tAttr('팝업이 복제되었습니다 (비활성 상태)'));
      load();
    } catch (e) { toast.error((e as { message?: string })?.message || tAttr('복제 실패')); }
  };

  const handleToggle = async (id: string) => {
    try {
      await apiClient.patch(`/api/v1/homepage/popups/${id}/toggle`, {});
      load();
    } catch (e) { toast.error((e as { message?: string })?.message || tAttr('상태 변경 실패')); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(tAttr('정말 삭제하시겠습니까?'))) return;
    try {
      await apiClient.del(`/api/v1/homepage/popups/${id}`);
      toast.success(tAttr('삭제되었습니다'));
      load();
    } catch (e) { toast.error((e as { message?: string })?.message || tAttr('삭제 실패')); }
  };

  const startEdit = (p: Popup) => {
    setEditId(p.id);
    setForm({
      title: p.title, type: p.type, content: p.content || '', imageUrl: p.imageUrl || '',
      linkUrl: p.linkUrl || '', startDate: p.startDate?.slice(0, 10) ?? '', endDate: p.endDate?.slice(0, 10) ?? '',
      hideToday: p.hideToday, sortOrder: p.sortOrder,
      bgColor: p.bgColor || '#FFFFFF', textColor: p.textColor || '#111827',
      buttonText: p.buttonText || p.linkText || '자세히 보기', buttonColor: p.buttonColor || '#2563EB',
      clipartId: p.clipartId || '', clipartPosition: p.clipartPosition || 'top',
      overlayOpacity: p.overlayOpacity ?? 0, borderRadius: p.borderRadius ?? 16, fontSize: p.fontSize || 'md',
    });
    setShowForm(true); setTab('content');
  };

  const startNew = () => {
    setEditId(null);
    setForm({
      ...DEFAULTS,
      startDate: kstToday(),
      endDate: kstTodayPlus(30),
    });
    setShowForm(true); setTab('content');
  };

  const applyTemplate = (t: Template) => {
    setForm(prev => ({
      ...prev, type: t.type, ...t.defaults,
      title: prev.title || t.name,
    }));
    setShowTemplates(false);
    toast.success(`"${t.name}" 템플릿이 적용되었습니다`);
  };

  // 이미지 업로드
  const handleImageUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error(tAttr('5MB 이하 파일만 가능합니다')); return; }
    if (!file.type.startsWith('image/')) { toast.error(tAttr('이미지 파일만 가능합니다')); return; }
    try {
      const fd = new FormData();
      fd.append('file', file);
      // 🔴 W9: 폴더를 FormData 본문에 넣었지만 서버는 `@Query('folder')` 로 읽는다 →
      //    /popup 폴더 지정이 통째로 무시되고 미디어 루트에 쌓였다(FE↔서버 계약 불일치).
      const token = apiClient.getToken();
      const res = await fetch('/api/v1/homepage/media/upload?folder=%2Fhomepage%2Fpopup', {
        method: 'POST',
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? body?.message ?? `업로드 실패 (HTTP ${res.status})`);
      }
      const data = await res.json();
      const url = data.data?.url ?? data.url;
      if (!url) throw new Error(tAttr('업로드 응답에 URL이 없습니다'));
      f('imageUrl', url); toast.success(tAttr('이미지가 업로드되었습니다'));
    } catch (e) { toast.error((e as { message?: string })?.message || tAttr('업로드 실패')); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageUpload(file);
  };

  const FONT_SIZE: Record<string, string> = { sm: 'text-sm', md: 'text-base', lg: 'text-lg' };

  return (
    <div className="max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="공지/팝업 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="홈페이지 팝업, 띠배너, 플로팅 배너를 관리합니다" /></p>
        </div>
        <button onClick={startNew} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          <T k="+ 새 팝업 추가" />
        </button>
      </div>

      {/* 생성/편집 폼 */}
      {showForm && (
        <div className="bg-white border border-blue-200 rounded-2xl shadow-sm overflow-hidden">
          {/* 폼 헤더 */}
          <div className="bg-blue-50 px-6 py-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-blue-900"><T k={editId ? '팝업 수정' : '새 팝업 추가'} /></h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowTemplates(!showTemplates)}
                className="px-3 py-1.5 bg-purple-100 text-purple-700 text-xs font-medium rounded-lg hover:bg-purple-200">
                <T k="템플릿 선택" />
              </button>
            </div>
          </div>

          {/* 템플릿 선택 */}
          {showTemplates && (
            <div className="px-6 py-4 bg-purple-50 border-b border-purple-200">
              <p className="text-xs text-purple-700 mb-3 font-medium"><T k="템플릿을 선택하면 스타일이 자동 적용됩니다" /></p>
              <div className="grid grid-cols-4 lg:grid-cols-7 gap-3">
                {templates.map(t => (
                  <button key={t.id} onClick={() => applyTemplate(t)}
                    className="p-3 bg-white rounded-xl border border-purple-100 hover:border-purple-400 hover:shadow-md transition text-center">
                    <img src={t.thumbnail} alt={t.name} className="w-8 h-8 mx-auto mb-1.5" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <p className="text-[10px] font-medium text-gray-700">{t.name}</p>
                    <p className="text-[8px] text-gray-400">{t.category}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 폼 탭 */}
          <div className="flex gap-1 bg-gray-50 px-6 py-2 border-b">
            {(['content', 'style', 'preview'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-xs font-medium rounded-lg transition ${tab === t ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                <T k={t === 'content' ? '내용' : t === 'style' ? '스타일' : '미리보기'} />
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* Content Tab — 좌우 분할: 폼 + 라이브 프리뷰 */}
            {tab === 'content' && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* 좌측: 입력 폼 */}
                <div className="lg:col-span-3 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1"><T k="제목" /></label>
                      <input value={form.title} onChange={e => f('title', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder={tAttr('팝업 제목')} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1"><T k="유형" /></label>
                      <select value={form.type} onChange={e => f('type', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                        {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1"><T k="내용@본문" /></label>
                    <textarea value={form.content} onChange={e => f('content', e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder={tAttr('팝업 본문 내용')} />
                  </div>

                  {/* 클립아트 퀵선택 (내용 탭에 인라인) */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1"><T k="클립아트 (선택)" /></label>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {form.clipartId && (
                        <button onClick={() => f('clipartId', '')}
                          className="flex-shrink-0 w-12 h-12 rounded-lg border-2 border-red-300 bg-red-50 flex items-center justify-center text-red-400 text-lg hover:bg-red-100">
                          ✕
                        </button>
                      )}
                      {cliparts.flatMap(c => c.icons).slice(0, 16).map(icon => (
                        <button key={icon.id} onClick={() => f('clipartId', form.clipartId === icon.id ? '' : icon.id)}
                          className={`flex-shrink-0 w-12 h-12 rounded-lg border-2 flex items-center justify-center transition ${form.clipartId === icon.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
                          <img src={icon.path} alt={icon.name} className="w-7 h-7" />
                        </button>
                      ))}
                      <button onClick={() => { setTab('style'); setShowCliparts(true); }}
                        className="flex-shrink-0 w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs hover:border-blue-300">
                        <T k="더보기" />
                      </button>
                    </div>
                    {form.clipartId && (
                      <div className="flex gap-1 mt-2">
                        {(['top', 'left', 'right'] as const).map(pos => (
                          <button key={pos} onClick={() => f('clipartPosition', pos)}
                            className={`px-2.5 py-1 text-[10px] rounded border ${form.clipartPosition === pos ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200'}`}>
                            <T k={pos === 'top' ? '상단' : pos === 'left' ? '좌측' : '우측'} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 이미지 업로드 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1"><T k="이미지 (선택)" /></label>
                    <div
                      className={`border-2 border-dashed rounded-xl p-4 text-center transition cursor-pointer ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                      onClick={() => fileRef.current?.click()}>
                      {form.imageUrl ? (
                        <div className="flex items-center gap-3">
                          <img src={form.imageUrl} alt="preview" className="w-20 h-14 object-cover rounded-lg" />
                          <div className="text-left flex-1 min-w-0">
                            <p className="text-xs text-gray-700 font-medium truncate">{form.imageUrl}</p>
                            <button onClick={e => { e.stopPropagation(); f('imageUrl', ''); }} className="text-[10px] text-red-500 hover:underline mt-0.5"><T k="제거" /></button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400"><T k="드래그&드롭 또는 클릭 (PNG/JPG/WebP, 최대 5MB)" /></p>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) handleImageUpload(file); }} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1"><T k="버튼 텍스트" /></label>
                      <input value={form.buttonText} onChange={e => f('buttonText', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1"><T k="링크 URL" /></label>
                      <input value={form.linkUrl} onChange={e => f('linkUrl', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="/checkup" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1"><T k="시작일" /></label>
                      <input type="date" value={form.startDate} onChange={e => f('startDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1"><T k="종료일" /></label>
                      <input type="date" value={form.endDate} onChange={e => f('endDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input type="checkbox" checked={form.hideToday} onChange={e => f('hideToday', e.target.checked)} className="rounded" />
                    <T k={'"오늘 하루 안 보기" 옵션'} />
                  </label>
                </div>

                {/* 우측: 라이브 미니 프리뷰 */}
                <div className="lg:col-span-2">
                  <div className="sticky top-4">
                    <p className="text-[10px] text-gray-400 uppercase font-medium mb-2"><T k="라이브 미리보기" /></p>
                    <div className="bg-gray-800 rounded-2xl p-3 min-h-[300px] flex items-center justify-center">
                      {form.type === 'MODAL' && (
                        <div style={{ backgroundColor: form.bgColor, color: form.textColor, borderRadius: `${form.borderRadius}px` }}
                          className="w-full max-w-[280px] shadow-2xl overflow-hidden relative">
                          {form.overlayOpacity > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: form.overlayOpacity / 100 }} />}
                          <div className="relative p-5 space-y-3">
                            {form.clipartId && form.clipartPosition === 'top' && (
                              <div className="text-center"><img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path} alt="" className="w-12 h-12 mx-auto" /></div>
                            )}
                            {form.imageUrl && <img src={form.imageUrl} alt="" className="w-full rounded-lg" />}
                            <div className={form.clipartId && form.clipartPosition === 'left' ? 'flex items-start gap-3' : form.clipartId && form.clipartPosition === 'right' ? 'flex items-start gap-3 flex-row-reverse' : ''}>
                              {form.clipartId && (form.clipartPosition === 'left' || form.clipartPosition === 'right') && (
                                <img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path} alt="" className="w-10 h-10 flex-shrink-0 mt-0.5" />
                              )}
                              <div className="flex-1 min-w-0">
                                <h3 className={`font-bold ${FONT_SIZE[form.fontSize] ?? 'text-sm'} leading-snug`}>{form.title || <T k="팝업 제목" />}</h3>
                                <p className={`opacity-80 mt-1 ${form.fontSize === 'lg' ? 'text-sm' : 'text-xs'} leading-relaxed`}>
                                  {form.content || <T k="내용을 입력하면 여기에 표시됩니다." />}
                                </p>
                              </div>
                            </div>
                            {form.buttonText && (
                              <button style={{ backgroundColor: form.buttonColor }} className="px-3 py-1.5 text-white text-xs rounded-lg font-medium w-full">
                                {form.buttonText}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {form.type === 'STRIP' && (
                        <div style={{ backgroundColor: form.bgColor, color: form.textColor }} className="w-full py-2.5 px-4 flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            {form.clipartId && <img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path} alt="" className="w-4 h-4 flex-shrink-0" />}
                            <span className="font-medium text-xs truncate">{form.title || <T k="띠배너 제목" />}</span>
                          </div>
                          {form.buttonText && (
                            <button style={{ backgroundColor: form.buttonColor }} className="px-2 py-1 text-white text-[10px] rounded font-medium whitespace-nowrap ml-2">{form.buttonText}</button>
                          )}
                        </div>
                      )}
                      {form.type === 'FLOATING' && (
                        <div className="w-full flex justify-end">
                          <div style={{ backgroundColor: form.bgColor, color: form.textColor, borderRadius: `${form.borderRadius}px` }} className="w-56 shadow-2xl overflow-hidden">
                            {form.imageUrl && <img src={form.imageUrl} alt="" className="w-full h-24 object-cover" />}
                            <div className="p-3 space-y-1.5">
                              {form.clipartId && <img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path} alt="" className="w-8 h-8" />}
                              <h4 className="font-bold text-xs">{form.title || <T k="플로팅" />}</h4>
                              <p className="text-[10px] opacity-80">{form.content || <T k="내용" />}</p>
                              {form.buttonText && <button style={{ backgroundColor: form.buttonColor }} className="px-2 py-1 text-white text-[10px] rounded">{form.buttonText}</button>}
                            </div>
                          </div>
                        </div>
                      )}
                      {form.type === 'PAGE_BANNER' && (
                        <div style={{ backgroundColor: form.bgColor, color: form.textColor }} className="w-full py-5 px-5 relative">
                          <div className="flex items-center gap-3">
                            {form.clipartId && <img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path} alt="" className="w-10 h-10 flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-sm">{form.title || <T k="배너" />}</h3>
                              <p className="text-[10px] opacity-80 mt-0.5">{form.content || <T k="내용" />}</p>
                            </div>
                            {form.buttonText && <button style={{ backgroundColor: form.buttonColor }} className="px-3 py-1.5 text-white text-[10px] rounded font-medium whitespace-nowrap">{form.buttonText}</button>}
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-[9px] text-gray-400 text-center mt-2"><T k="내용을 입력하면 실시간 반영됩니다" /></p>
                  </div>
                </div>
              </div>
            )}

            {/* Style Tab */}
            {tab === 'style' && (
              <div className="space-y-5">
                {/* 🔴 W9: 이 탭이 편집하는 스타일 값은 (a) 생성 시 서버가 통째로 버렸고(수정 시에만 저장 — 봉합함),
                    (b) 공개 홈페이지 렌더러가 아직 title/content/imageUrl/linkUrl/linkText 만 읽는다.
                    "라이브 미리보기" 가 방문자가 보는 화면과 다르다는 사실을 숨기지 않는다. */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <p className="text-[11px] text-amber-800">
                    <b>미리보기 ≠ 공개 화면</b> — 색상·클립아트·모서리·글꼴 크기는 저장되지만, 공개 홈페이지 팝업은
                    아직 기본 디자인으로 표시됩니다(제목·내용·이미지·링크·버튼 문구만 반영). 홈페이지 배선 후 그대로 적용됩니다.
                  </p>
                </div>
                {/* Colors */}
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1"><T k="배경색" /></label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={form.bgColor} onChange={e => f('bgColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                      <input value={form.bgColor} onChange={e => f('bgColor', e.target.value)} className="flex-1 px-2 py-1.5 border rounded text-xs font-mono" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1"><T k="텍스트색" /></label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={form.textColor} onChange={e => f('textColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                      <input value={form.textColor} onChange={e => f('textColor', e.target.value)} className="flex-1 px-2 py-1.5 border rounded text-xs font-mono" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1"><T k="버튼색" /></label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={form.buttonColor} onChange={e => f('buttonColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                      <input value={form.buttonColor} onChange={e => f('buttonColor', e.target.value)} className="flex-1 px-2 py-1.5 border rounded text-xs font-mono" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1"><T k="글꼴 크기" /></label>
                    <select value={form.fontSize} onChange={e => f('fontSize', e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm">
                      <option value="sm">Small</option>
                      <option value="md">Medium</option>
                      <option value="lg">Large</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1">모서리 둥글기 ({form.borderRadius}px)</label>
                    <input type="range" min={0} max={32} value={form.borderRadius} onChange={e => f('borderRadius', Number(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1">오버레이 투명도 ({form.overlayOpacity}<Unit>%</Unit>)</label>
                    <input type="range" min={0} max={80} value={form.overlayOpacity} onChange={e => f('overlayOpacity', Number(e.target.value))} className="w-full" />
                  </div>
                </div>

                {/* 클립아트 선택 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-medium text-gray-500 uppercase"><T k="클립아트" /></label>
                    <button onClick={() => setShowCliparts(!showCliparts)} className="text-[10px] text-blue-600 hover:underline">
                      <T k={showCliparts ? '닫기' : '선택하기'} />
                    </button>
                  </div>
                  {form.clipartId && (
                    <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg mb-2">
                      <img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path ?? ''} alt="" className="w-10 h-10" />
                      <span className="text-xs text-gray-600">{cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.name ?? form.clipartId}</span>
                      <button onClick={() => f('clipartId', '')} className="text-[10px] text-red-500 ml-auto"><T k="제거" /></button>
                    </div>
                  )}
                  {showCliparts && (
                    <div className="border rounded-xl p-4 bg-gray-50 space-y-3 max-h-60 overflow-y-auto">
                      {cliparts.map(cat => (
                        <div key={cat.id}>
                          <p className="text-[10px] text-gray-400 uppercase mb-1.5">{cat.name}</p>
                          <div className="grid grid-cols-8 gap-2">
                            {cat.icons.map(icon => (
                              <button key={icon.id} onClick={() => { f('clipartId', icon.id); setShowCliparts(false); }}
                                className={`p-2 rounded-lg border transition hover:bg-blue-50 ${form.clipartId === icon.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                                <img src={icon.path} alt={icon.name} className="w-8 h-8 mx-auto" onError={e => { (e.target as HTMLImageElement).src = ''; }} />
                                <p className="text-[8px] text-center text-gray-500 mt-0.5 truncate">{icon.name}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {form.clipartId && (
                    <div className="mt-2">
                      <label className="text-[10px] font-medium text-gray-500 uppercase"><T k="위치" /></label>
                      <div className="flex gap-2 mt-1">
                        {(['top', 'left', 'right', 'background'] as const).map(pos => (
                          <button key={pos} onClick={() => f('clipartPosition', pos)}
                            className={`px-3 py-1 text-[10px] rounded-lg border ${form.clipartPosition === pos ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                            {pos}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Preview Tab */}
            {tab === 'preview' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <button onClick={() => setPreviewDevice('desktop')}
                    className={`px-3 py-1.5 text-xs rounded-lg ${previewDevice === 'desktop' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <T k="데스크톱" />
                  </button>
                  <button onClick={() => setPreviewDevice('mobile')}
                    className={`px-3 py-1.5 text-xs rounded-lg ${previewDevice === 'mobile' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <T k="모바일" />
                  </button>
                </div>

                <div className={`bg-gray-800 rounded-2xl p-4 flex items-center justify-center min-h-[400px] ${previewDevice === 'mobile' ? 'max-w-[375px] mx-auto' : ''}`}>
                  {/* MODAL preview */}
                  {form.type === 'MODAL' && (
                    <div style={{ backgroundColor: form.bgColor, color: form.textColor, borderRadius: `${form.borderRadius}px`, maxWidth: previewDevice === 'mobile' ? '320px' : '450px' }}
                      className="w-full shadow-2xl overflow-hidden relative">
                      {form.overlayOpacity > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: form.overlayOpacity / 100 }} />}
                      <div className="relative p-6 space-y-4">
                        {form.clipartId && form.clipartPosition === 'top' && (
                          <div className="text-center">
                            <img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path} alt="" className="w-16 h-16 mx-auto" />
                          </div>
                        )}
                        {form.imageUrl && <img src={form.imageUrl} alt="" className="w-full rounded-lg" />}
                        <h3 className={`font-bold ${FONT_SIZE[form.fontSize] ?? 'text-base'}`}>{form.title || <T k="팝업 제목" />}</h3>
                        <p className={`opacity-80 ${form.fontSize === 'lg' ? 'text-base' : form.fontSize === 'sm' ? 'text-xs' : 'text-sm'}`}>
                          {form.content || <T k="팝업 내용이 여기에 표시됩니다." />}
                        </p>
                        {form.buttonText && (
                          <button style={{ backgroundColor: form.buttonColor }} className="px-4 py-2 text-white text-sm rounded-lg font-medium w-full">
                            {form.buttonText}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* STRIP preview */}
                  {form.type === 'STRIP' && (
                    <div style={{ backgroundColor: form.bgColor, color: form.textColor }} className="w-full py-3 px-6 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {form.clipartId && (
                          <img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path} alt="" className="w-5 h-5" />
                        )}
                        <span className={`font-medium ${FONT_SIZE[form.fontSize] ?? 'text-sm'}`}>{form.title || <T k="띠배너 제목" />}</span>
                        {form.content && <span className="opacity-70 text-xs hidden sm:inline">{form.content}</span>}
                      </div>
                      {form.buttonText && (
                        <button style={{ backgroundColor: form.buttonColor }} className="px-3 py-1 text-white text-xs rounded font-medium whitespace-nowrap">
                          {form.buttonText}
                        </button>
                      )}
                    </div>
                  )}

                  {/* FLOATING preview */}
                  {form.type === 'FLOATING' && (
                    <div className="w-full flex justify-end">
                      <div style={{ backgroundColor: form.bgColor, color: form.textColor, borderRadius: `${form.borderRadius}px` }}
                        className="w-72 shadow-2xl overflow-hidden">
                        {form.imageUrl && <img src={form.imageUrl} alt="" className="w-full h-32 object-cover" />}
                        <div className="p-4 space-y-2">
                          {form.clipartId && (
                            <img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path} alt="" className="w-10 h-10" />
                          )}
                          <h4 className={`font-bold ${form.fontSize === 'sm' ? 'text-sm' : 'text-base'}`}>{form.title || <T k="플로팅 제목" />}</h4>
                          <p className="text-xs opacity-80">{form.content || <T k="내용" />}</p>
                          {form.buttonText && (
                            <button style={{ backgroundColor: form.buttonColor }} className="px-3 py-1.5 text-white text-xs rounded font-medium">
                              {form.buttonText}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* PAGE_BANNER preview */}
                  {form.type === 'PAGE_BANNER' && (
                    <div style={{ backgroundColor: form.bgColor, color: form.textColor }} className="w-full py-8 px-8 relative overflow-hidden">
                      {form.overlayOpacity > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: form.overlayOpacity / 100 }} />}
                      {form.imageUrl && <img src={form.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                      <div className="relative flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {form.clipartId && (
                            <img src={cliparts.flatMap(c => c.icons).find(i => i.id === form.clipartId)?.path} alt="" className="w-12 h-12" />
                          )}
                          <div>
                            <h3 className={`font-bold ${FONT_SIZE[form.fontSize] ?? 'text-lg'}`}>{form.title || <T k="배너 제목" />}</h3>
                            <p className="text-sm opacity-80 mt-1">{form.content || <T k="배너 내용" />}</p>
                          </div>
                        </div>
                        {form.buttonText && (
                          <button style={{ backgroundColor: form.buttonColor }} className="px-5 py-2.5 text-white text-sm rounded-lg font-medium whitespace-nowrap">
                            {form.buttonText}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 폼 하단 */}
          <div className="px-6 py-4 bg-gray-50 border-t flex gap-2">
            <button onClick={handleSave} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
              {/* 🔴 '수정'은 기록 정정(Amended)과 동음이의 — 버튼은 `수정@버튼`(Save changes) */}
              <T k={editId ? '수정@버튼' : '생성'} />
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); setTab('content'); }}
              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : popups.length === 0 ? (
        <EmptyState icon="📋" title="등록된 팝업이 없습니다." hint="위 버튼으로 추가하세요." />
      ) : (
        <div className="space-y-3">
          {popups.map(popup => {
            const status = getStatus(popup);
            const typeCfg = TYPE_OPTIONS.find(t => t.value === popup.type);
            return (
              <div key={popup.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                      style={{ backgroundColor: popup.bgColor || '#EFF6FF' }}>
                      {popup.clipartId ? (
                        <img src={cliparts.flatMap(c => c.icons).find(i => i.id === popup.clipartId)?.path ?? ''} alt="" className="w-6 h-6" />
                      ) : (
                        typeCfg?.icon || '📢'
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">{popup.title}</h3>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                        <span><T k={typeCfg?.label ?? ''} /></span>
                        <span>|</span>
                        <span>{String(popup.startDate ?? '').slice(0, 10)} ~ {String(popup.endDate ?? '').slice(0, 10)}</span>
                        {popup.templateId && <span className="bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded"><T k="템플릿" /></span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[status]}`}><T k={statusKey(STATUS_LABEL[status])} /></span>
                    <button onClick={() => startEdit(popup)} className="text-xs text-blue-600 hover:underline"><T k="편집" /></button>
                    <button onClick={() => handleClone(popup.id)} className="text-xs text-purple-600 hover:underline"><T k="복제" /></button>
                    <button onClick={() => handleToggle(popup.id)} className="text-xs text-gray-400 hover:text-amber-500"><T k={popup.isActive ? '비활성' : '활성'} /></button>
                    <button onClick={() => handleDelete(popup.id)} className="text-xs text-gray-400 hover:text-red-500"><T k="삭제" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
