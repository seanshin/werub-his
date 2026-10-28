'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { SCREEN_REGISTRY, SCREEN_BY_CODE, SCREEN_CODE_CONFLICTS, type ScreenEntry } from './Sidebar';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 충돌 코드 집합 — 중복된 번호는 "첫 항목으로 이동"이 아니라 **이동 거부**(다른 화면으로 보내지 않는다).
const CONFLICT_CODES = new Set(SCREEN_CODE_CONFLICTS.map((c) => c.code));

const HOTKEY_STORAGE = 'hr.screenjump.hotkey';
const RECENT_STORAGE = 'hr.screenjump.recent';
const FAV_STORAGE = 'hr.screenjump.favorites';
const DEFAULT_HOTKEY = 'g';
const keyLabel = (k: string) => (k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k);
const load = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };

// 화면번호 빠른 이동 — 지정 단축키로 입력칸 포커스 → 코드 입력 후 Enter (+ 최근/즐겨찾기)
export function ScreenJump() {
  const router = useRouter();
  const { user } = useAuthStore();
  const role = user?.role ?? '';
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(false);
  const [hotkey, setHotkey] = useState(DEFAULT_HOTKEY);
  const [capturing, setCapturing] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // 🔴 토스트·속성은 티를 그릴 자리가 없다 — 미등록이면 한국어 원문 그대로(지어내지 않는다)
  const tAttr = useTAttr();

  useEffect(() => {
    setHotkey(localStorage.getItem(HOTKEY_STORAGE) || DEFAULT_HOTKEY);
    setRecent(load(RECENT_STORAGE));
    setFavorites(load(FAV_STORAGE));
  }, []);

  const allowed = useMemo(() => SCREEN_REGISTRY.filter((e) => role === 'ADMIN' || e.roles.includes(role)), [role]);
  // 🔴 종전 byCode 는 **마지막 항목이 앞을 덮어써서**, 제안 목록(즐겨찾기·최근)이 보여주는 화면과
  //    jump() 의 `find`(첫 항목)가 서로 다른 화면을 가리킬 수 있었다. 이제 정본 맵(SCREEN_BY_CODE) 하나만 쓴다.
  const byCode = useMemo(() => {
    const m: Record<string, ScreenEntry> = {};
    for (const e of allowed) if (SCREEN_BY_CODE[e.code] === e) m[e.code] = e;
    return m;
  }, [allowed]);
  const suggestions = useMemo(() => {
    const q = code.trim();
    if (!q) return [];
    return allowed.filter((e) => e.code.startsWith(q) || e.label.includes(q)).slice(0, 6);
  }, [code, allowed]);

  const favEntries = favorites.map((c) => byCode[c]).filter(Boolean);
  const recentEntries = recent.map((c) => byCode[c]).filter(Boolean).filter((e) => !favorites.includes(e.code));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (capturing) {
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        e.preventDefault();
        if (e.key === 'Escape') { setCapturing(false); return; }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') { toast.error(tAttr('해당 키는 단축키로 사용할 수 없습니다.')); setCapturing(false); return; }
        // 수정자 조합은 단일 키로 저장하면 브라우저 단축키(Cmd+G 등)를 가로채게 된다 — 거절.
        if (e.metaKey || e.ctrlKey || e.altKey) { toast.error(tAttr('수정자 키(Cmd/Ctrl/Alt) 조합은 화면번호 단축키로 쓸 수 없습니다.')); return; }
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        localStorage.setItem(HOTKEY_STORAGE, k);
        setHotkey(k); setCapturing(false);
        toast.success(`${tAttr('화면번호 단축키')}: ${keyLabel(k)}`);
        return;
      }
      // 🔴 수정자 확인 없이 'g' 만 보던 탓에 Cmd+G / Ctrl+G(브라우저 '다음 찾기')까지 가로챘다.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (pressed === hotkey || (hotkey === 'g' && e.key === 'ㅎ')) {
        e.preventDefault(); inputRef.current?.focus(); setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey, capturing]);

  const jump = (c: string) => {
    const target = c.trim();
    if (!target) return;
    // 🔴 중복 번호는 조용히 첫 항목으로 보내면 **사람을 다른 화면에 떨어뜨린다** — 거부하고 사실을 말한다.
    if (CONFLICT_CODES.has(target)) {
      const c = SCREEN_CODE_CONFLICTS.find((x) => x.code === target);
      toast.error(`화면번호 ${target}이(가) ${c?.hrefs.length ?? 2}개 화면에 중복 지정되어 있어 이동하지 않습니다(${c?.hrefs.join(', ')}). 관리자에게 알려주세요.`);
      return;
    }
    const entry = SCREEN_BY_CODE[target];
    if (!entry) { toast.error(`화면번호 ${target}을(를) 찾을 수 없습니다.`); return; }
    if (role !== 'ADMIN' && !entry.roles.includes(role)) { toast.error(`'${entry.label}' 화면 접근 권한이 없습니다.`); return; }
    const next = [target, ...recent.filter((x) => x !== target)].slice(0, 5);
    setRecent(next); localStorage.setItem(RECENT_STORAGE, JSON.stringify(next));
    router.push(entry.href);
    setCode(''); setOpen(false); inputRef.current?.blur();
  };

  const toggleFav = (c: string) => {
    const next = favorites.includes(c) ? favorites.filter((x) => x !== c) : [...favorites, c].slice(0, 8);
    setFavorites(next); localStorage.setItem(FAV_STORAGE, JSON.stringify(next));
  };

  const Row = ({ e }: { e: ScreenEntry }) => (
    <div className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-sm group">
      <button onMouseDown={(ev) => { ev.preventDefault(); jump(e.code); }} className="flex items-center gap-2 flex-1 text-left min-w-0">
        <span className="text-[11px] tabular-nums text-blue-600 font-semibold w-10">{e.code}</span>
        <T k={e.label} className="flex-1 truncate text-gray-800" />
        <T k={e.section} className="text-[10px] text-gray-400" />
      </button>
      <button onMouseDown={(ev) => { ev.preventDefault(); toggleFav(e.code); }} title={tAttr('즐겨찾기')} className={`text-sm ${favorites.includes(e.code) ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`}>★</button>
    </div>
  );

  const showLists = open && !code.trim() && (favEntries.length > 0 || recentEntries.length > 0);

  return (
    <div className="relative">
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-blue-200">
        <span className="text-gray-400 text-sm font-semibold">#</span>
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => { setCode(e.target.value.replace(/[^0-9]/g, '')); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Enter') jump(suggestions[0]?.code ?? code); if (e.key === 'Escape') { setCode(''); inputRef.current?.blur(); } }}
          inputMode="numeric"
          placeholder={tAttr('화면번호')}
          className="w-20 bg-transparent text-sm outline-none placeholder:text-gray-400"
          aria-label={tAttr('화면번호로 이동')}
        />
        <button type="button" onClick={() => setCapturing((v) => !v)} title={tAttr('화면번호 단축키 지정 (클릭 후 원하는 키 입력)')}
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${capturing ? 'bg-blue-600 text-white border-blue-600 animate-pulse' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}>
          {capturing ? <T k="키 입력…" /> : keyLabel(hotkey)}
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-72 bg-white rounded-xl shadow-lg border border-gray-100 py-1 max-h-72 overflow-y-auto">
          {suggestions.map((e) => <Row key={e.code + e.href} e={e} />)}
        </div>
      )}

      {open && code.trim() && suggestions.length === 0 && (
        <div className="absolute z-50 mt-1 w-72 bg-white rounded-xl shadow-lg border border-gray-100 px-3 py-3 text-xs text-gray-400">
          <T k="일치하는 화면이 없습니다" />
        </div>
      )}

      {showLists && (
        <div className="absolute z-50 mt-1 w-72 bg-white rounded-xl shadow-lg border border-gray-100 py-1 max-h-80 overflow-y-auto">
          {favEntries.length > 0 && (
            <>
              <p className="px-3 py-1 text-[10px] font-semibold text-amber-500 uppercase tracking-wide">★ <T k="즐겨찾기" /></p>
              {favEntries.map((e) => <Row key={'f' + e.code} e={e} />)}
            </>
          )}
          {recentEntries.length > 0 && (
            <>
              <p className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide"><T k="최근 이동" /></p>
              {recentEntries.map((e) => <Row key={'r' + e.code} e={e} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
