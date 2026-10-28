'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { SCREEN_REGISTRY } from './Sidebar';
import { useAuthStore } from '@/stores/auth-store';
import { useAiChatStore, canUseAiChat } from '@/stores/ai-chat-store';
import { useSmartSearchStore } from '@/stores/smart-search-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface SearchResult {
  type: 'screen' | 'patient' | 'medication' | 'diagnosis' | 'procedure';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  screen:     { label: '화면', color: 'bg-indigo-100 text-indigo-700', icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2' },
  patient:    { label: '환자', color: 'bg-blue-100 text-blue-700',    icon: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0' },
  medication: { label: '약품', color: 'bg-teal-100 text-teal-700',    icon: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5m14 0H5' },
  diagnosis:  { label: '진단', color: 'bg-violet-100 text-violet-700', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25' },
  procedure:  { label: '수가', color: 'bg-amber-100 text-amber-700',  icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192' },
};

export function SmartSearchBar() {
  const router = useRouter();
  const { user } = useAuthStore();
  const openWith = useAiChatStore((s) => s.openWith);
  // 어시스턴트 EP 허용 역할에만 "묻기" 동선을 보인다 — 아니면 열자마자 403 초대다
  const canAsk = canUseAiChat(user?.role);
  // 열림 상태는 스토어 — TopBar 검색 버튼도 이 모달을 연다(검색 정본 한 벌)
  const open = useSmartSearchStore((s) => s.open);
  const setOpen = useSmartSearchStore((s) => s.setOpen);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 🔴 부제(subtitle)·placeholder 는 문자열 자리라 티를 그릴 수 없다 — 미등록이면 원문 그대로
  const tAttr = useTAttr();

  // Cmd+K / Ctrl+K 단축키
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!useSmartSearchStore.getState().open);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // 포커스
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
      setSelectedIdx(-1);
    }
  }, [open]);

  const role = useAuthStore((s) => s.user?.role) ?? '';

  /**
   * 화면 매칭 — **번호와 이름 둘 다**(사람 요구 2026-08-26: "화면명 찾아서 이동. 단, 권한이 없으면 이동 불가").
   *
   * 🔴 **권한 없는 화면은 목록에 넣지 않는다.** 넣고 눌렀을 때 막으면 그 화면의 **존재를 알려주는 셈**이고
   *    (민감 진료과 화면은 존재 자체가 정보다), 사용자는 자기 오타로 읽는다.
   *    권한 판정은 `ScreenJump` 와 **같은 정본**(`SCREEN_REGISTRY` + 역할 포함)을 쓴다 — 갈리면 두 곳이 다르게 막는다.
   */
  const screenResults = useCallback((q: string): SearchResult[] => {
    const t = q.trim();
    if (!t) return [];
    const permitted = SCREEN_REGISTRY.filter((e) => role === 'ADMIN' || e.roles.includes(role));

    // ① 화면번호 — 숫자만 입력한 경우
    if (/^\d{1,4}$/.test(t)) {
      return permitted
        .filter((e) => e.code.startsWith(t))
        .slice(0, 5)
        .map((e) => ({ type: 'screen' as const, id: e.code, title: e.label, subtitle: `${tAttr('화면번호')} ${e.code} · ${tAttr(e.section)}`, href: e.href }));
    }

    // ② 화면명 — 이름·섹션·경로로 찾는다. 이름이 먼저 시작하는 것을 위로
    const q2 = t.toLowerCase();
    const hit = permitted.filter(
      (e) =>
        e.label.toLowerCase().includes(q2) ||
        e.section.toLowerCase().includes(q2) ||
        e.href.toLowerCase().includes(q2),
    );
    return hit
      .sort((a, b) => {
        const ai = a.label.toLowerCase().startsWith(q2) ? 0 : 1;
        const bi = b.label.toLowerCase().startsWith(q2) ? 0 : 1;
        return ai - bi || a.label.localeCompare(b.label);
      })
      .slice(0, 6)
      .map((e) => ({ type: 'screen' as const, id: e.code, title: e.label, subtitle: `${tAttr('화면')} ${e.code} · ${tAttr(e.section)}`, href: e.href }));
  }, [role, tAttr]);

  const search = useCallback(async (q: string) => {
    const screens = screenResults(q);
    // 화면 결과는 1글자부터 나온다(번호는 1자리도 유효). 나머지 통합 검색은 2글자부터.
    if (q.length < 2) { setResults(screens); return; }
    setIsSearching(true);
    try {
      const [patients, meds, diags, procs] = await Promise.allSettled([
        apiClient.get<any>('/api/v1/patients', { q, limit: 5 }),
        apiClient.get<any>('/api/v1/codes/medication', { q, limit: 3 }),
        apiClient.get<any>('/api/v1/codes/diagnosis', { q, limit: 3 }),
        apiClient.get<any>('/api/v1/codes/procedure', { q, limit: 3 }),
      ]);

      const r: SearchResult[] = [];
      if (patients.status === 'fulfilled') {
        (patients.value.data ?? []).forEach((p: any) => r.push({
          type: 'patient', id: p.id,
          title: `${p.familyName}${p.givenName}`,
          subtitle: `${p.mrn} · ${p.phone ?? ''}`,
          href: `/patients/${p.id}`,
        }));
      }
      if (meds.status === 'fulfilled') {
        (meds.value.data ?? []).forEach((m: any) => r.push({
          type: 'medication', id: m.id,
          title: m.nameKo,
          subtitle: `${m.code} · ${m.ingredient ?? ''}`,
          href: '/admin/codes',
        }));
      }
      if (diags.status === 'fulfilled') {
        (diags.value.data ?? []).forEach((d: any) => r.push({
          type: 'diagnosis', id: d.id,
          title: d.nameKo,
          subtitle: `${d.codeSystem} ${d.code}`,
          href: '/admin/codes',
        }));
      }
      if (procs.status === 'fulfilled') {
        (procs.value.data ?? []).forEach((p: any) => r.push({
          type: 'procedure', id: p.id,
          title: p.nameKo,
          subtitle: `${p.code} · ${p.unitPrice?.toLocaleString() ?? '-'}원`,
          href: '/admin/codes',
        }));
      }
      setResults([...screens, ...r]);
      setSelectedIdx(-1);
    } finally {
      setIsSearching(false);
    }
  }, [screenResults]);

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIdx >= 0 && results[selectedIdx]) {
      // 🔴 종전에는 닫기만 하고 이동하지 않았다(2026-09-04 실측) — 선택했으면 간다
      router.push(results[selectedIdx].href);
      setOpen(false);
    } else if (e.key === 'Enter' && selectedIdx < 0 && canAsk && query.trim()) {
      // 결과 미선택 Enter = 어시스턴트에게 묻기(옴니박스)
      openWith(query.trim());
      setOpen(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
      >
        {/* 검색 입력 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tAttr('환자, 약품, 진단코드, 화면명·번호 검색...')}
            className="flex-1 text-sm outline-none bg-transparent"
          />
          {isSearching && (
            <svg className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          <kbd className="hidden sm:inline-flex items-center text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">ESC</kbd>
        </div>

        {/* 결과 */}
        {results.length > 0 && (
          <div className="max-h-80 overflow-y-auto py-1">
            {results.map((r, i) => {
              const tc = TYPE_CONFIG[r.type];
              return (
                <Link
                  key={`${r.type}-${r.id}-${i}`}
                  href={r.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/50 transition-colors ${
                    i === selectedIdx ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={tc.icon} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.title}</p>
                    <p className="text-xs text-gray-500 truncate">{r.subtitle}</p>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap ${tc.color}`}>
                    <T k={tc.label} />
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {/* 옴니박스 — 검색을 어시스턴트의 입구로(기획 §2.4). EP 허용 역할에게만 */}
        {canAsk && query.trim().length >= 2 && (
          <button
            onClick={() => { openWith(query.trim()); setOpen(false); }}
            className="flex w-full items-center gap-3 border-t border-gray-100 px-4 py-3 text-left transition-colors hover:bg-violet-50/60"
          >
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100">
              <svg className="h-3.5 w-3.5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
              {AI_ORIGIN_TEXT} 어시스턴트에게 묻기: <b className="text-gray-900">{query.trim()}</b>
            </span>
            <kbd className="hidden flex-shrink-0 items-center rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 sm:inline-flex">Enter</kbd>
          </button>
        )}

        {query.length >= 2 && results.length === 0 && !isSearching && (
          <div className="py-8 text-center">
            <T k="검색 결과가 없습니다." className="text-sm text-gray-400" />
          </div>
        )}

        {query.length < 2 && (
          <div className="px-4 py-4 text-center">
            <T k="2자 이상 입력하면 환자, 약품, 진단코드를 통합 검색합니다." className="text-xs text-gray-400" />
            <div className="flex items-center justify-center gap-2 mt-2">
              <kbd className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">Cmd</kbd>
              <span className="text-[10px] text-gray-300">+</span>
              <kbd className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">K</kbd>
              <T k="로 언제든 열 수 있습니다" className="text-[10px] text-gray-400 ml-1" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
