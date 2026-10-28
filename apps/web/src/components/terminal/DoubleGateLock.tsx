'use client';

import { useState } from 'react';
import { useTerminalStore } from '@/stores/terminal-store';
import { verifyDailyPin } from '@/lib/terminal';

// 이중 게이트 잠금화면 (설계 §6.3) — 좌: 데일리 PIN 복귀 / 우: 대기 세션 빠른 전환.
// 물리 이탈(BLE/안면 상실) 또는 명시적 전환 시 전체 덮음(z-50).
export function DoubleGateLock() {
  const { profile, lock, sessionPool, activeUserId, unlock, setActive } = useTerminalStore();
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (lock.state !== 'LOCKED') return null;

  const active = sessionPool.find((s) => s.userId === activeUserId);
  const waiting = sessionPool.filter((s) => s.userId !== activeUserId);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const r = await verifyDailyPin(employeeNumber, pin);
      if (r.valid) {
        setActive(r.userId); // 무새로고침 복귀/전환
        setPin('');
        setEmployeeNumber('');
        unlock();
      }
    } catch {
      setError('인증 실패 — 단말·사번·PIN을 확인하세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
      <div className="grid w-full max-w-3xl grid-cols-1 gap-px overflow-hidden rounded-2xl bg-gray-200 shadow-2xl md:grid-cols-2">
        {/* 좌: 데일리 PIN 복귀 */}
        <div className="bg-white p-8">
          <h3 className="mb-1 text-lg font-semibold text-gray-900">화면 잠금</h3>
          <p className="mb-6 text-sm text-gray-500">
            {active ? `${active.name} · ${active.role}` : '데일리 PIN으로 복귀'}
            {lock.reason && <span className="ml-1 text-gray-400">({lock.reason})</span>}
          </p>
          <div className="space-y-3">
            <input
              value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value)}
              placeholder="사번"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6자리 데일리 PIN"
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-300 px-3 py-3 text-center text-2xl tracking-[0.5em]"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={submit}
              disabled={busy || pin.length !== 6 || !employeeNumber}
              className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white disabled:opacity-40"
            >
              {busy ? '확인 중…' : '잠금 해제'}
            </button>
          </div>
        </div>

        {/* 우: 명시적 빠른 전환 */}
        <div className="bg-gray-50 p-8">
          <h3 className="mb-1 text-lg font-semibold text-gray-900">빠른 전환</h3>
          <p className="mb-6 text-sm text-gray-500">대기 중인 의료진 세션</p>
          <div className="space-y-2">
            {waiting.length === 0 && (
              <p className="text-sm text-gray-400">대기 세션 없음</p>
            )}
            {waiting.map((s) => (
              <button
                key={s.userId}
                onClick={() => {
                  setEmployeeNumber('');
                  setPin('');
                }}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left text-sm hover:bg-gray-50"
              >
                <span className="font-medium text-gray-800">{s.name}</span>
                <span className="text-xs text-gray-500">{s.role}</span>
              </button>
            ))}
            <button className="mt-2 w-full rounded-lg border border-dashed border-gray-300 py-2.5 text-sm text-gray-500 hover:bg-white">
              + 신규 사용자 로그인 (FIDO)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
