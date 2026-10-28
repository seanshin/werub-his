'use client';

// 큰 화면(board) 레이아웃 편집기 — 표시 패널 on/off·순서를 개인 저장(localStorage).
// TabSettingsModal 패턴(순서 이동·저장·초기화) 재사용. 서버 동기화는 P1.5.

import { useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { usePatientTabStore } from '@/stores/patient-tab-store';
import { BOARD_ALL_PANELS, getDefaultPreset, type BoardPanelKey } from './board-constants';
import { PANEL_REGISTRY } from './panel-registry';
import { T, useTAttr } from '@/components/ui/i18n-text';

const SUIT_HINT: Record<string, string> = {
  wide: '넓은 표 — 넓은 화면 권장',
  list: '목록형',
};

export function BoardLayoutEditor({ onClose }: { onClose: () => void }) {
  const tAttr = useTAttr();
  const role = useAuthStore((s) => s.user?.role);
  const boardLayout = usePatientTabStore((s) => s.boardLayout);
  const setBoardLayout = usePatientTabStore((s) => s.setBoardLayout);
  const resetBoardLayout = usePatientTabStore((s) => s.resetBoardLayout);

  const [selected, setSelected] = useState<BoardPanelKey[]>(
    (boardLayout ?? getDefaultPreset(role)).filter((k): k is BoardPanelKey => k in PANEL_REGISTRY),
  );

  const available = BOARD_ALL_PANELS.filter((k) => !selected.includes(k));

  const add = useCallback((k: BoardPanelKey) => setSelected((p) => [...p, k]), []);
  const remove = useCallback((k: BoardPanelKey) => setSelected((p) => p.filter((x) => x !== k)), []);
  const moveUp = useCallback((k: BoardPanelKey) => setSelected((p) => {
    const i = p.indexOf(k); if (i <= 0) return p;
    const n = [...p]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n;
  }), []);
  const moveDown = useCallback((k: BoardPanelKey) => setSelected((p) => {
    const i = p.indexOf(k); if (i < 0 || i >= p.length - 1) return p;
    const n = [...p]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n;
  }), []);

  const save = () => {
    setBoardLayout(selected);
    // 서버 동기화(로밍 단말) — 실패해도 로컬은 유지
    apiClient.put('/api/v1/chart-templates/my-settings/board-layout', { panels: selected }).catch(() => {});
    onClose();
  };
  const reset = () => {
    resetBoardLayout();
    apiClient.put('/api/v1/chart-templates/my-settings/board-layout', { panels: null }).catch(() => {});
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[82vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900"><T k="큰 화면 패널 설정" /></h2>
            <p className="text-xs text-gray-400 mt-0.5"><T k="표시할 패널과 순서를 지정합니다 · 내 계정에 저장(이 기기)" /></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 flex items-center justify-center">✕</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 overflow-y-auto">
          {/* 표시 중 (순서) */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">표시 중 · 위→아래 = 좌→우 순서 ({selected.length})</h3>
            <ul className="space-y-1.5">
              {selected.map((k, i) => (
                <li key={k} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-100">
                  <span className="flex-1 text-sm font-medium text-blue-900"><T k={PANEL_REGISTRY[k].label} /></span>
                  <button onClick={() => moveUp(k)} disabled={i === 0} title={tAttr("위로")} className="w-6 h-6 rounded text-blue-500 hover:bg-blue-100 disabled:opacity-30">▲</button>
                  <button onClick={() => moveDown(k)} disabled={i === selected.length - 1} title={tAttr("아래로")} className="w-6 h-6 rounded text-blue-500 hover:bg-blue-100 disabled:opacity-30">▼</button>
                  <button onClick={() => remove(k)} title={tAttr("제거")} className="w-6 h-6 rounded text-gray-400 hover:bg-red-50 hover:text-red-500">✕</button>
                </li>
              ))}
              {selected.length === 0 && <li className="text-xs text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg"><T k="오른쪽에서 패널을 추가하세요" /></li>}
            </ul>
          </div>

          {/* 추가 가능 */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="추가 가능" /></h3>
            <ul className="space-y-1.5">
              {available.map((k) => (
                <li key={k}>
                  <button onClick={() => add(k)} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-left">
                    <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs">＋</span>
                    <span className="flex-1 text-sm text-gray-700"><T k={PANEL_REGISTRY[k].label} /></span>
                    {SUIT_HINT[PANEL_REGISTRY[k].suitability] && (
                      <span className="text-[10px] text-gray-400">{SUIT_HINT[PANEL_REGISTRY[k].suitability]}</span>
                    )}
                  </button>
                </li>
              ))}
              {available.length === 0 && <li className="text-xs text-gray-400 py-4 text-center"><T k="모든 패널이 표시 중입니다" /></li>}
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100">
          <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600"><T k="역할 기본값으로 초기화" /></button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-xl hover:bg-gray-100"><T k="취소" /></button>
            <button onClick={save} disabled={selected.length === 0} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-40"><T k="저장" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
