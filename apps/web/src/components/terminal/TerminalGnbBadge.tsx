'use client';

import { useTerminalStore } from '@/stores/terminal-store';

// GNB 액티브 유저 배지 + 세션 대기 리스트 탭 (설계 §6.3)
// 공용 단말 의료진 오인 차단 — 화면 주권자를 강조 노출.
export function TerminalGnbBadge() {
  const { profile, sessionPool, activeUserId, setActive, lockScreen } = useTerminalStore();

  if (!profile?.registered) return null; // 미등록 단말이면 비표시(비침습)

  const active = sessionPool.find((s) => s.userId === activeUserId);
  const isPublic = profile.mode === 'PUBLIC';
  const waiting = sessionPool.filter((s) => s.userId !== activeUserId);

  return (
    <div className="flex items-center gap-2 whitespace-nowrap text-sm">
      {/* 액티브 유저 배지 */}
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${
          isPublic ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
        }`}
        title={isPublic ? '공용 단말' : '전용 단말'}
      >
        <span className="h-2 w-2 rounded-full bg-current" />
        {active ? `${active.name} · ${active.role}` : profile.mode === 'PUBLIC' ? '공용 단말' : '전용 단말'}
      </span>

      {/* 공용 단말 — 세션 대기 리스트 탭 */}
      {isPublic && waiting.length > 0 && (
        <div className="flex items-center gap-1">
          {waiting.map((s) => (
            <button
              key={s.userId}
              onClick={() => setActive(s.userId)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap"
              title="클릭 시 데일리 PIN 전환"
            >
              {s.name} {s.role}
            </button>
          ))}
        </div>
      )}

      {/* 명시적 잠금(이탈 시뮬) */}
      {isPublic && (
        <button
          onClick={() => lockScreen('manual')}
          className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
        >
          잠금
        </button>
      )}
    </div>
  );
}
