'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

// ── 화면 내 액션 핫키 프레임워크 (브라우저 안전 전제: in-screen-action-hotkeys.plan.md §0) ──

export interface HotkeySpec {
  combo: string;            // 'F2' | 'F8' | 'mod+Enter' | 'alt+n' | '?' | '/'
  label: string;            // 도움말/힌트 표기 ('접수완료')
  onTrigger: () => void;
  when?: () => boolean;     // 활성 조건(미충족 시 무시)
  allowInInput?: boolean;   // 입력 필드 포커스 중에도 동작(예: mod+Enter 저장)
  group?: string;           // 도움말 그룹(화면명 등)
}

interface Registered extends HotkeySpec { id: number }

// 브라우저/OS가 가로채 우회 불가 → 등록 거부(§0-1)
// Mac F-키는 Fn 필요(불편) → 기본 스킴에서 제외. alt+d/e/f/방향키는 브라우저 예약.
const RESERVED = new Set([
  'mod+t', 'mod+w', 'mod+n', 'mod+shift+t', 'mod+tab', 'mod+l', 'mod+q', 'mod+r',
  'mod+1', 'mod+2', 'mod+3', 'mod+4', 'mod+5', 'mod+6', 'mod+7', 'mod+8', 'mod+9',
  'f1', 'f3', 'f5', 'f6', 'f11', 'f12',
  'alt+d', 'alt+e', 'alt+f', 'alt+home', 'alt+left', 'alt+right',
]);

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modLabel = isMac ? '⌘' : 'Ctrl';

/** ARIA aria-keyshortcuts 형식 ('mod+Enter' → 'Control+Enter Meta+Enter', 'alt+n' → 'Alt+N') */
export function ariaKeyshortcuts(combo: string): string {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const keyTok = key === 'enter' ? 'Enter' : key === 'esc' ? 'Escape' : key.length === 1 ? key.toUpperCase() : key.toUpperCase();
  if (mods.includes('mod')) {
    const others = mods.filter((m) => m !== 'mod').map((m) => m[0].toUpperCase() + m.slice(1));
    const base = [...others, keyTok].join('+');
    return `Control+${base} Meta+${base}`;
  }
  return [...mods.map((m) => m[0].toUpperCase() + m.slice(1)), keyTok].join('+');
}

/** combo 표시용 라벨 ('mod+Enter' → '⌘+Enter') */
export function comboLabel(combo: string): string {
  return combo.split('+').map((p) => {
    const k = p.trim().toLowerCase();
    if (k === 'mod') return modLabel;
    if (k === 'alt') return isMac ? '⌥' : 'Alt';
    if (k === 'shift') return '⇧';
    if (k === 'enter') return 'Enter';
    if (k === 'esc') return 'Esc';
    if (k.length === 1) return k.toUpperCase();
    return p.toUpperCase();
  }).join('+');
}

/** KeyboardEvent ↔ combo 매칭 */
function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  const key = parts[parts.length - 1];
  const needMod = parts.includes('mod');
  const needAlt = parts.includes('alt');
  const needShift = parts.includes('shift');
  const mod = e.metaKey || e.ctrlKey;
  if (needMod !== mod) return false;
  if (needAlt !== e.altKey) return false;
  // shift: '?'처럼 키 자체에 포함된 경우는 별도 처리
  if (key !== '?' && needShift !== e.shiftKey) return false;

  const ek = e.key;
  if (key === '?') return ek === '?';
  if (key === '/') return ek === '/';
  if (key === 'enter') return ek === 'Enter';
  if (key === 'esc') return ek === 'Escape';
  if (/^f\d{1,2}$/.test(key)) return ek.toLowerCase() === key; // F2 등(레거시 지원, 권장X)
  if (key.length === 1) {
    // alt(Option) 조합은 Mac에서 특수문자가 입력되므로 e.code 로 매칭(키 위치 기준)
    if (needAlt) {
      if (/[a-z]/.test(key)) return e.code === 'Key' + key.toUpperCase();
      if (/[0-9]/.test(key)) return e.code === 'Digit' + key;
    }
    return ek.toLowerCase() === key;
  }
  return false;
}

interface Ctx { register: (s: HotkeySpec) => () => void; list: () => Registered[] }
const HotkeyCtx = createContext<Ctx | null>(null);

export function useHotkeys(specs: HotkeySpec[]) {
  const ctx = useContext(HotkeyCtx);
  // specs는 매 렌더 생성될 수 있으므로 ref로 최신 유지, 등록은 combo 집합 기준
  const ref = useRef(specs);
  ref.current = specs;
  const key = specs.map((s) => s.combo).join('|');
  useEffect(() => {
    if (!ctx) return;
    const unregs = ref.current.map((_, i) =>
      ctx.register({
        get combo() { return ref.current[i].combo; },
        get label() { return ref.current[i].label; },
        get when() { return ref.current[i].when; },
        get allowInInput() { return ref.current[i].allowInInput; },
        get group() { return ref.current[i].group; },
        onTrigger: () => ref.current[i].onTrigger(),
      } as HotkeySpec),
    );
    return () => unregs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, key]);
}

export function HotkeyProvider({ children }: { children: React.ReactNode }) {
  const regs = useRef<Registered[]>([]);
  const idRef = useRef(0);
  const [showHelp, setShowHelp] = useState(false);

  const register = useCallback((s: HotkeySpec) => {
    const norm = s.combo.toLowerCase();
    if (RESERVED.has(norm)) {
      console.warn(`[hotkey] 예약키 등록 거부: ${s.combo} (${s.label})`);
      return () => {};
    }
    const id = ++idRef.current;
    regs.current = [...regs.current, { ...s, id }];
    return () => { regs.current = regs.current.filter((r) => r.id !== id); };
  }, []);

  const list = useCallback(() => regs.current, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 한글 IME 조합 중 무시(§0-4)
      if (e.isComposing || e.keyCode === 229) return;

      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

      // 도움말 토글(?)  — 입력 중 아닐 때
      if (!typing && e.key === '?') { e.preventDefault(); setShowHelp((v) => !v); return; }
      if (e.key === 'Escape' && showHelp) { setShowHelp(false); return; }

      for (const r of regs.current) {
        if (!matches(r.combo, e)) continue;
        if (typing && !r.allowInInput) continue; // 입력 중엔 명시 허용만
        if (r.when && !r.when()) continue;
        e.preventDefault();
        r.onTrigger();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showHelp]);

  const ctxVal = useMemo<Ctx>(() => ({ register, list }), [register, list]);

  return (
    <HotkeyCtx.Provider value={ctxVal}>
      {children}
      {showHelp && <HotkeyHelp specs={regs.current} onClose={() => setShowHelp(false)} />}
    </HotkeyCtx.Provider>
  );
}

function HotkeyHelp({ specs, onClose }: { specs: Registered[]; onClose: () => void }) {
  const groups = new Map<string, Registered[]>();
  for (const s of specs) { const g = s.group ?? '현재 화면'; const a = groups.get(g) ?? []; a.push(s); groups.set(g, a); }
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-sm font-bold text-gray-900"><T k="⌨️ 단축키 도움말" /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-4 space-y-4">
          {specs.length === 0 && <EmptyState icon="📋" title="이 화면에 등록된 단축키가 없습니다." />}
          {[...groups.entries()].map(([g, list]) => (
            <div key={g}>
              <p className="text-xs font-semibold text-gray-400 mb-1.5"><T k={g} /></p>
              <div className="space-y-1">
                {list.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700"><T k={s.label} /></span>
                    <kbd className="text-[11px] font-semibold bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-gray-600">{comboLabel(s.combo)}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span><T k="이 도움말 열기/닫기" /></span>
              <kbd className="text-[11px] font-semibold bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">?</kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
