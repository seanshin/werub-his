'use client';

import { useEffect, useMemo, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { WIDGET_LIST, CATEGORY_LABELS, type WidgetCategory } from '../../dashboard/components/widget-registry';

const ROLES = [
  { v: 'DOCTOR', l: '의사' }, { v: 'NURSE', l: '간호사' }, { v: 'PHARMACIST', l: '약사' },
  { v: 'LAB_TECH', l: '검사기사' }, { v: 'ADMIN', l: '관리자' },
];
interface Template { id: string; scope: string; scopeRef: string; config: { layouts?: { lg?: { i: string }[] } }; updatedAt: string }

export default function DashboardTemplatesPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [scope, setScope] = useState<'ROLE' | 'DEPARTMENT'>('ROLE');
  const [scopeRef, setScopeRef] = useState('DOCTOR');
  const [deptInput, setDeptInput] = useState('');
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  // 🔴 조회 실패를 "저장된 템플릿 없음(시스템 기본값 사용 중)"으로 말하지 않는다 — 종전 `.catch(() => {})` 는
  //    실패를 '없음'으로 번역했고, 그 화면에서 저장하면 실제로 있던 템플릿을 모르는 채 덮어쓸 수 있었다.
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = () => apiClient.get<{ data: Template[] }>('/api/v1/dashboard/templates')
    .then((r) => { setTemplates(r.data ?? []); setLoadFailed(false); })
    .catch(() => setLoadFailed(true));
  useEffect(() => { reload(); }, []);

  const effRef = scope === 'DEPARTMENT' ? deptInput.trim() : scopeRef;

  // 선택한 scope/ref의 기존 템플릿 로드
  useEffect(() => {
    const t = templates.find((x) => x.scope === scope && x.scopeRef === effRef);
    if (t?.config?.layouts?.lg) setEnabled(new Set(t.config.layouts.lg.map((w) => w.i)));
    else setEnabled(new Set());
  }, [templates, scope, effRef]);

  // 위젯 목록: 역할 스코프면 해당 역할 위젯만, 부서 스코프면 전체
  const widgets = useMemo(() => {
    return WIDGET_LIST.filter((w) => {
      if (scope === 'DEPARTMENT') return true;
      return w.roles.length === 0 || w.roles.includes(scopeRef);
    });
  }, [scope, scopeRef]);

  const byCategory = useMemo(() => {
    const m = new Map<WidgetCategory, typeof WIDGET_LIST>();
    for (const w of widgets) { const a = m.get(w.category) ?? []; a.push(w); m.set(w.category, a); }
    return [...m.entries()];
  }, [widgets]);

  const toggle = (id: string) => setEnabled((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    if (!effRef) { toast.error(tAttr(scope === 'DEPARTMENT' ? '부서명을 입력하세요.' : '역할을 선택하세요.')); return; }
    // enabled 위젯을 세로 스택으로 레이아웃 구성
    let y = 0;
    const lg = WIDGET_LIST.filter((w) => enabled.has(w.id)).map((w) => {
      const item = { i: w.id, x: 0, y, w: w.defaultW, h: w.defaultH, ...(w.id === 'stat-bar' ? { static: true } : {}) };
      y += w.defaultH;
      return item;
    });
    const config = { version: 1, layouts: { lg, md: [], sm: [] }, hiddenWidgets: [], widgetSettings: {} };
    try {
      await apiClient.put('/api/v1/dashboard/templates', { scope, scopeRef: effRef, config });
      // 🔴 보간 문장 — 역할 라벨은 표시어라 번역하고, 부서명(effRef)은 사용자 입력 값이라 그대로 넣는다
      setMsg(tfAttr('{대상} 템플릿 저장됨 ({수}개 위젯)', {
        대상: scope === 'ROLE' ? tAttr(ROLES.find((r) => r.v === effRef)?.l ?? effRef) : effRef,
        수: enabled.size,
      }));
      reload();
    } catch (e: any) { setMsg(e?.message ?? tAttr('저장 실패')); }
  };

  const remove = async () => {
    if (!confirm(tAttr('이 템플릿을 삭제하시겠습니까? (해당 대상은 시스템 기본값 사용)'))) return;
    try { await apiClient.del(`/api/v1/dashboard/templates?scope=${scope}&scopeRef=${encodeURIComponent(effRef)}`); setMsg(tAttr('삭제됨')); reload(); }
    catch (e: any) { setMsg(e?.message ?? tAttr('실패')); }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900 mb-1"><T k="대시보드 템플릿 관리" /></h1>
      <p className="text-sm text-gray-500 mb-5"><T k="역할·부서별 기본 대시보드 위젯 구성을 관리합니다. (개인이 편집한 대시보드는 개인 설정 우선)" /></p>

      {msg && <div className="mb-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2">{msg}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1"><T k="대상 유형" /></label>
          <div className="flex gap-1.5">
            {(['ROLE', 'DEPARTMENT'] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={`px-3 py-2 rounded-xl text-sm font-medium ${scope === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}><T k={s === 'ROLE' ? '역할' : '부서'} /></button>
            ))}
          </div>
        </div>
        {scope === 'ROLE' ? (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1"><T k="역할" /></label>
            <select value={scopeRef} onChange={(e) => setScopeRef(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
              {ROLES.map((r) => <option key={r.v} value={r.v}>{tAttr(r.l)}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1"><T k="부서명 (예: 원무과, 검진센터)" /></label>
            <input value={deptInput} onChange={(e) => setDeptInput(e.target.value)} placeholder={tAttr('부서명 입력')} className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>
        )}
        <div className="ml-auto flex gap-2">
          {templates.some((t) => t.scope === scope && t.scopeRef === effRef) && <button onClick={remove} className="px-3 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50"><T k="삭제" /></button>}
          <button onClick={save} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><T k="템플릿 저장" /></button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3"><T k="포함 위젯 선택" /> <span className="text-gray-400 font-normal">({enabled.size}<Unit>개</Unit> <T k="선택@개수" />)</span></h3>
        <div className="space-y-4">
          {byCategory.map(([cat, list]) => (
            <div key={cat}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5"><T k={CATEGORY_LABELS[cat] ?? cat} /></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {list.map((w) => (
                  <label key={w.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm ${enabled.has(w.id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={enabled.has(w.id)} onChange={() => toggle(w.id)} className="w-4 h-4" />
                    <T className="flex-1" k={w.name} />
                    <span className="text-[10px] text-gray-400">{w.roles.length ? w.roles.join(',') : 'ALL'}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2"><T k="저장된 템플릿" /></h3>
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => { setScope(t.scope as 'ROLE' | 'DEPARTMENT'); if (t.scope === 'DEPARTMENT') setDeptInput(t.scopeRef); else setScopeRef(t.scopeRef); }}
              className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 hover:bg-gray-50">
              {t.scope === 'ROLE' ? tAttr(ROLES.find((r) => r.v === t.scopeRef)?.l ?? t.scopeRef) : `${tAttr('부서')}:${t.scopeRef}`} · <Tf k="{수}위젯" params={{ 수: t.config?.layouts?.lg?.length ?? 0 }} />
            </button>
          ))}
          {loadFailed
            ? <p className="text-xs text-red-600"><T k="템플릿 목록 조회 실패 — 저장된 템플릿이 있는지 확인할 수 없습니다" /></p>
            : !templates.length && <p className="text-xs text-gray-400"><T k="저장된 템플릿 없음 (시스템 기본값 사용 중)" /></p>}
        </div>
      </div>
    </div>
  );
}
