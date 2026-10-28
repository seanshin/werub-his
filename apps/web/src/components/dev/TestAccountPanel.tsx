'use client';

import { useState } from 'react';
import { ACCOUNT_TABS, DOT_COLORS, HOVER_COLORS, TEST_PASSWORD } from '@/lib/test-accounts';

/**
 * 테스트 계정 자동입력 패널 — **개발/스테이징 전용**.
 *
 * 🔴 이 파일과 `@/lib/test-accounts` 는 운영 번들에 들어가면 안 된다.
 *    운영 로그인 화면에 병원 직원 계정 이메일과 **공용 비밀번호가 그대로 노출**되고 있었다
 *    (iOS 앱 요청서 WEB-SEC-01 · 2026-08-24 실측 확인 — `/login` 과 `/staff/login` 두 곳).
 *
 * 부르는 쪽은 반드시 `NEXT_PUBLIC_SHOW_TEST_ACCOUNTS === 'true'` 상수 비교로 감싼
 * `dynamic(() => import(...))` 를 쓴다. 그래야 빌드 시 상수가 접혀 **청크 자체가 생성되지 않는다**
 * (조건부 렌더만 하면 데이터는 번들에 남아 검색된다 — 숨긴 것과 없는 것은 다른 사실이다).
 *
 * 같은 목록이 두 벌로 갈라져 있었다(`/login` 인라인 74항목 vs `lib` 87항목). 정본은 `lib` 하나다.
 */
export default function TestAccountPanel({
  onPick,
  variant = 'vertical',
}: {
  onPick: (email: string, password: string) => void;
  variant?: 'vertical' | 'chips';
}) {
  const [activeTab, setActiveTab] = useState('main');
  const currentTab = ACCOUNT_TABS.find((t) => t.key === activeTab) ?? ACCOUNT_TABS[0];

  const accounts = (
    <div
      id={`tabpanel-${currentTab.key}`}
      role="tabpanel"
      aria-labelledby={`tab-${currentTab.key}`}
      className={
        variant === 'vertical'
          ? 'grid grid-cols-2 gap-1.5 flex-1 min-w-0 max-h-[220px] overflow-y-auto pr-1 content-start'
          : 'grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto pr-1'
      }
    >
      {currentTab.accounts.map((a) => (
        <button
          key={a.email}
          type="button"
          aria-label={`${a.label} 계정으로 입력`}
          onClick={() => onPick(a.email, TEST_PASSWORD)}
          className={`flex items-center gap-2 px-2.5 py-1.5 bg-white border border-gray-100 rounded-lg text-left transition-colors h-fit ${HOVER_COLORS[a.color] ?? ''}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_COLORS[a.color] ?? 'bg-gray-400'}`} aria-hidden="true" />
          <p className="text-[11px] font-medium text-gray-600 truncate">{a.label}</p>
        </button>
      ))}
    </div>
  );

  if (variant === 'chips') {
    return (
      <section className="w-full max-w-md bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-100 shadow-sm p-4">
        <p className="text-xs font-medium text-gray-500 mb-2">테스트 계정 (개발 전용 · 클릭 시 자동 입력)</p>
        <div className="flex flex-wrap gap-1 mb-2" role="tablist">
          {ACCOUNT_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                activeTab === t.key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {accounts}
      </section>
    );
  }

  return (
    <div className="mt-8">
      <p className="text-xs font-medium text-gray-500 mb-2" id="test-accounts-label">테스트 계정 (개발 전용 · 클릭하면 자동 입력)</p>
      <div className="flex gap-3">
        <div
          className="flex flex-col gap-0.5 w-24 flex-shrink-0 border-r border-gray-100 pr-2"
          role="tablist"
          aria-orientation="vertical"
          aria-labelledby="test-accounts-label"
        >
          {ACCOUNT_TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`tabpanel-${tab.key}`}
              id={`tab-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={`text-left px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition border-l-2 ${
                activeTab === tab.key
                  ? 'bg-gray-100 text-gray-800 border-gray-800 font-semibold'
                  : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {accounts}
      </div>
    </div>
  );
}
