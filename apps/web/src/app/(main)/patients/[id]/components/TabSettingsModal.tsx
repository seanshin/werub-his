'use client';

import { useState, useCallback } from 'react';
import { usePatientTabStore } from '@/stores/patient-tab-store';
import { T } from '@/components/ui/i18n-text';

interface TabDef {
  key: string;
  label: string;
}

interface Props {
  baseTabs: TabDef[];
  onClose: () => void;
}

export default function TabSettingsModal({ baseTabs, onClose }: Props) {
  const { config, setConfig, resetConfig } = usePatientTabStore();
  const [primaryKeys, setPrimaryKeys] = useState<string[]>(config.primaryKeys);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>(config.hiddenKeys);

  const togglePrimary = useCallback((key: string) => {
    setPrimaryKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const toggleHidden = useCallback((key: string) => {
    if (key === 'overview') return; // 개요 탭은 항상 표시
    setHiddenKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const moveUp = useCallback((key: string) => {
    setPrimaryKeys((prev) => {
      const idx = prev.indexOf(key);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((key: string) => {
    setPrimaryKeys((prev) => {
      const idx = prev.indexOf(key);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const handleSave = () => {
    setConfig({ primaryKeys, hiddenKeys });
    onClose();
  };

  const handleReset = () => {
    resetConfig();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900"><T k="탭 설정" /></h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 주요 탭 (순서 변경) */}
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase mb-2"><T k="주요 탭 (항상 표시, 순서 변경 가능)" /></h3>
            <div className="space-y-1">
              {primaryKeys.map((key, idx) => {
                const tab = baseTabs.find((t) => t.key === key);
                if (!tab) return null;
                return (
                  <div key={key} className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
                    <span className="text-xs font-bold text-blue-400 w-4">{idx + 1}</span>
                    <span className="flex-1 text-sm font-medium text-gray-800">{tab.label}</span>
                    <button onClick={() => moveUp(key)} disabled={idx === 0}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">▲</button>
                    <button onClick={() => moveDown(key)} disabled={idx === primaryKeys.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">▼</button>
                    <button onClick={() => togglePrimary(key)}
                      className="p-1 text-gray-400 hover:text-red-500 text-xs"><T k="제거" /></button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 전체 탭 목록 (표시/숨기기 + 주요 탭 추가) */}
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase mb-2"><T k="전체 탭 (표시/숨기기)" /></h3>
            <div className="grid grid-cols-2 gap-1">
              {baseTabs.map((tab) => {
                const isHidden = hiddenKeys.includes(tab.key);
                const isPrimary = primaryKeys.includes(tab.key);
                return (
                  <div key={tab.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    isHidden ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-700'
                  }`}>
                    <label className="flex items-center gap-2 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleHidden(tab.key)}
                        disabled={tab.key === 'overview'}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className={isHidden ? 'line-through' : ''}>{tab.label}</span>
                    </label>
                    {!isHidden && !isPrimary && (
                      <button onClick={() => togglePrimary(tab.key)}
                        className="text-[10px] text-blue-600 hover:text-blue-800 whitespace-nowrap">
                        <T k="+주요" />
                      </button>
                    )}
                    {isPrimary && (
                      <span className="text-[10px] text-blue-500 whitespace-nowrap"><T k="주요" /></span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
          <button onClick={handleReset} className="text-xs text-gray-400 hover:text-gray-600">
            <T k="기본값으로 초기화" />
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              <T k="취소" />
            </button>
            <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
              <T k="저장" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
