'use client';

import { useEffect, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { NAV_SECTIONS } from '@/components/layout/Sidebar';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/** 커스텀 메뉴 href 검증(BE access-control.service.sanitizeMenuHref 와 동일 규칙). 무효=null */
function sanitizeMenuHref(raw: string): string | null {
  const href = (raw ?? '').trim();
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) {
    try { const u = new URL(href); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null; }
    catch { return null; }
  }
  if (href.startsWith('//')) return null;             // 프로토콜-상대(외부 유출)
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // javascript:/data: 등 스킴 차단
  return href.startsWith('/') ? href : `/${href}`;
}

type Override = { hidden?: boolean; roles?: string[]; label?: string; order?: number };
type OverrideMap = Record<string, Override>;
type CustomItem = { id: string; section: string; href: string; label: string; roles: string[] };
interface RowItem { href: string; label: string; roles: string[]; isCustom?: boolean; id?: string }

const ROLES: [string, string][] = [
  ['ADMIN', '관리자'], ['DOCTOR', '의사'], ['NURSE', '간호사'],
  ['PHARMACIST', '약사'], ['LAB_TECH', '검사/영상'], ['READ', '조회'], ['CRM_STAFF', '상담'],
];
const SECTION_TITLES = NAV_SECTIONS.map((s) => s.title);

function SortableRow({ item, o, patch, onRename, onDelete }: {
  item: RowItem; o: Override; patch: (p: Partial<Override>) => void;
  onRename?: (v: string) => void; onDelete?: () => void;
}) {
  const tAttr = useTAttr();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.href });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const effectiveRoles = o.roles ?? item.roles;
  const displayName = item.isCustom ? item.label : (o.label || item.label);
  return (
    <div ref={setNodeRef} style={style} className="px-4 py-3 bg-white">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 text-base leading-none touch-none" title={tAttr('드래그하여 순서 변경')} aria-label={tAttr('순서 변경')}>⠿</button>
          <div className="min-w-0">
            <div className="text-sm text-gray-800 flex items-center gap-1.5">
              {displayName}
              {item.isCustom && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200"><T k="추가됨" /></span>}
            </div>
            <div className="text-[10px] text-gray-400 font-mono truncate">{item.href}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={!o.hidden} onChange={(e) => patch({ hidden: !e.target.checked })} /> <T k="표시" />
          </label>
          {item.isCustom && onDelete && (
            <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600" title={tAttr('메뉴 삭제')}><T k="삭제" /></button>
          )}
        </div>
      </div>
      {!o.hidden && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
          <span className="text-[10px] text-gray-400 mr-1"><T k="역할" />:</span>
          {ROLES.map(([r, lbl]) => {
            const on = effectiveRoles?.includes(r);
            return (
              <button key={r} onClick={() => {
                const cur = new Set(effectiveRoles ?? []);
                if (cur.has(r)) cur.delete(r); else cur.add(r);
                patch({ roles: [...cur] });
              }} className={`text-[10px] px-2 py-0.5 rounded-full border ${on ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}><T k={lbl} /></button>
            );
          })}
          {item.isCustom ? (
            <input value={item.label} onChange={(e) => onRename?.(e.target.value)} placeholder={tAttr('메뉴 이름')} className="ml-2 px-2 py-1 text-xs border border-gray-200 rounded-lg flex-1 min-w-[140px]" />
          ) : (
            <input value={o.label ?? ''} onChange={(e) => patch({ label: e.target.value })} placeholder={`이름 변경(기본: ${item.label})`} className="ml-2 px-2 py-1 text-xs border border-gray-200 rounded-lg flex-1 min-w-[140px]" />
          )}
        </div>
      )}
    </div>
  );
}

export default function MenuConfigPage() {
  const tAttr = useTAttr();
  const [ov, setOv] = useState<OverrideMap>({});
  const [custom, setCustom] = useState<CustomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  // 새 메뉴 추가 폼
  const [nf, setNf] = useState<{ section: string; label: string; href: string; roles: string[] }>({ section: SECTION_TITLES[0], label: '', href: '', roles: ['ADMIN'] });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'ADMIN';

  useEffect(() => {
    Promise.all([
      apiClient.get<{ data: OverrideMap }>('/api/v1/access-control/menu-overrides').then((r) => setOv(r.data ?? {})),
      apiClient.get<{ data: CustomItem[] }>('/api/v1/access-control/menu-custom').then((r) => setCustom(Array.isArray(r.data) ? r.data : [])),
    ]).catch(() => toast.error('메뉴 설정 로드 실패')).finally(() => setLoading(false));
  }, []);

  const patch = (href: string, p: Partial<Override>) => setOv((m) => ({ ...m, [href]: { ...m[href], ...p } }));

  // 섹션 내 (기본 + 커스텀) 항목 결합
  const rowsOf = (section: typeof NAV_SECTIONS[number]): RowItem[] => {
    const base: RowItem[] = (section.items as RowItem[]).map((it) => ({ href: it.href, label: it.label, roles: it.roles, isCustom: false }));
    const extra: RowItem[] = custom.filter((c) => c.section === section.title).map((c) => ({ href: c.href, label: c.label, roles: c.roles, isCustom: true, id: c.id }));
    return [...base, ...extra];
  };
  const orderedItems = (items: RowItem[]): RowItem[] => {
    const idx = new Map(items.map((it, i) => [it.href, i]));
    return [...items].sort((a, b) => (ov[a.href]?.order ?? idx.get(a.href)!) - (ov[b.href]?.order ?? idx.get(b.href)!));
  };

  const onDragEnd = (items: RowItem[], e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ordered = orderedItems(items);
    const oldI = ordered.findIndex((i) => i.href === active.id);
    const newI = ordered.findIndex((i) => i.href === over.id);
    if (oldI < 0 || newI < 0) return;
    const moved = arrayMove(ordered, oldI, newI);
    setOv((m) => { const next = { ...m }; moved.forEach((it, i) => { next[it.href] = { ...next[it.href], order: i }; }); return next; });
  };

  const addMenu = () => {
    const label = nf.label.trim();
    const href = sanitizeMenuHref(nf.href);
    if (!label || !nf.href.trim()) { toast.error('메뉴 이름과 링크(URL)를 입력하세요'); return; }
    if (!href) { toast.error('허용되지 않는 링크입니다 — 내부 경로(/...) 또는 http(s):// 주소만 가능'); return; }
    if (custom.some((c) => c.href === href) || NAV_SECTIONS.some((s) => s.items.some((i) => i.href === href))) {
      toast.error('이미 존재하는 링크(URL)입니다'); return;
    }
    const id = `custom-${href.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}-${custom.length}`;
    setCustom((c) => [...c, { id, section: nf.section, href, label, roles: nf.roles.length ? nf.roles : ['ADMIN'] }]);
    setNf((f) => ({ ...f, label: '', href: '' }));
    setOpenSection(nf.section);
    toast.success(`"${label}" 추가됨 — 저장을 눌러 반영`);
  };
  const renameCustom = (id: string, v: string) => setCustom((c) => c.map((x) => (x.id === id ? { ...x, label: v } : x)));
  const deleteCustom = (id: string) => setCustom((c) => c.filter((x) => x.id !== id));

  const save = async () => {
    setSaving(true);
    try {
      const cleaned: OverrideMap = {};
      for (const [href, o] of Object.entries(ov)) {
        const e: Override = {};
        if (o.hidden) e.hidden = true;
        if (o.roles && o.roles.length) e.roles = o.roles;
        if (o.label && o.label.trim()) e.label = o.label.trim();
        if (o.order != null) e.order = o.order;
        if (Object.keys(e).length) cleaned[href] = e;
      }
      await Promise.all([
        apiClient.put('/api/v1/access-control/menu-overrides', { overrides: cleaned }),
        apiClient.put('/api/v1/access-control/menu-custom', { items: custom }),
      ]);
      setOv(cleaned);
      toast.success('메뉴 구성·권한·순서·추가 저장 — 새로고침 후 사이드바에 반영');
    } catch (e) { toast.error((e as { message?: string })?.message ?? '저장 실패'); }
    finally { setSaving(false); }
  };

  const reset = () => { if (confirm('표시/숨김·역할·순서·라벨 오버라이드를 초기화(기본값 복원)하시겠습니까? 추가한 메뉴는 유지됩니다.')) setOv({}); };

  // 클라이언트 역할 가드 — 메뉴 구성은 전 직원 사이드바에 영향을 주므로 ADMIN 전용.
  //   (BE PUT 은 @Roles(ADMIN) 으로 이미 강제 — 이건 비-ADMIN 에게 설정 UI 노출 방지)
  if (role && !isAdmin) return <div className="p-4 text-sm text-red-500"><T k="이 페이지는 관리자(ADMIN)만 접근할 수 있습니다." /></div>;
  if (loading) return <div className="p-4 text-sm text-gray-400"><T k="불러오는 중…" /></div>;

  return (
    <div className="w-full p-4 max-w-4xl">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="메뉴 구성·권한" /></h1>
          <p className="text-sm text-gray-500">메뉴를 <b>추가/이름변경</b>, <b>드래그(⠿)로 순서 변경</b>, 표시/숨김, 메뉴별 접근 역할(세부 권한)을 지정합니다.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg"><T k="오버라이드 초기화" /></button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k={saving ? '저장 중…' : '저장'} /></button>
        </div>
      </div>

      {/* 새 메뉴 추가 */}
      <div className="mb-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="text-sm font-bold text-gray-800 mb-2">＋ <T k="새 메뉴 추가" /></div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={nf.section} onChange={(e) => setNf((f) => ({ ...f, section: e.target.value }))} className="px-2 py-2 text-sm border border-gray-200 rounded-lg">
            {SECTION_TITLES.map((t) => <option key={t} value={t}>{tAttr(t)}</option>)}
          </select>
          <input value={nf.label} onChange={(e) => setNf((f) => ({ ...f, label: e.target.value }))} placeholder={tAttr('메뉴 이름')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg flex-1 min-w-[140px]" />
          <input value={nf.href} onChange={(e) => setNf((f) => ({ ...f, href: e.target.value }))} placeholder={tAttr('링크 (예: /custom/page 또는 https://...)')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg flex-1 min-w-[200px]" />
          <button onClick={addMenu} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"><T k="추가" /></button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-gray-400 mr-1"><T k="접근 역할" />:</span>
          {ROLES.map(([r, lbl]) => {
            const on = nf.roles.includes(r);
            return <button key={r} onClick={() => setNf((f) => ({ ...f, roles: on ? f.roles.filter((x) => x !== r) : [...f.roles, r] }))} className={`text-[10px] px-2 py-0.5 rounded-full border ${on ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}><T k={lbl} /></button>;
          })}
        </div>
      </div>

      <div className="space-y-2">
        {NAV_SECTIONS.map((section) => {
          const open = openSection === section.title;
          const rows = rowsOf(section);
          const hiddenCount = rows.filter((i) => ov[i.href]?.hidden).length;
          const customCount = rows.filter((i) => i.isCustom).length;
          const ordered = orderedItems(rows);
          return (
            <div key={section.title} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <button onClick={() => setOpenSection(open ? null : section.title)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                <span className="text-sm font-bold text-gray-800"><T k={section.title} /> <span className="text-[11px] text-gray-400 font-normal">· {rows.length}개{customCount ? ` · 추가 ${customCount}` : ''}{hiddenCount ? ` · 숨김 ${hiddenCount}` : ''}</span></span>
                <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
              </button>
              {open && (
                <div className="border-t border-gray-50">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd(rows, e)}>
                    <SortableContext items={ordered.map((i) => i.href)} strategy={verticalListSortingStrategy}>
                      <div className="divide-y divide-gray-50">
                        {ordered.map((item) => (
                          <SortableRow key={item.href} item={item} o={ov[item.href] ?? {}} patch={(p) => patch(item.href, p)}
                            onRename={item.isCustom && item.id ? (v) => renameCustom(item.id!, v) : undefined}
                            onDelete={item.isCustom && item.id ? () => deleteCustom(item.id!) : undefined} />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
