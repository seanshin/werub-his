'use client';

import { useEffect, useState } from 'react';
import { useTerminalStore } from '@/stores/terminal-store';
import { TerminalGnbBadge } from '@/components/terminal/TerminalGnbBadge';
import { DoubleGateLock } from '@/components/terminal/DoubleGateLock';
import { getDeviceUuid, setDeviceUuid, issueDailyPin } from '@/lib/terminal';
import { useAuthStore } from '@/stores/auth-store';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

const SEED_TERMINALS = [
  { uuid: 'TERM-NS-3F-01', label: '간호 스테이션(공용)' },
  { uuid: 'TERM-ER-01', label: '응급실(공용)' },
  { uuid: 'TERM-ADMIN-01', label: '원무과(공용)' },
  { uuid: 'TERM-OFFICE-IM-01', label: '교수 진료실(전용)' },
];

// D3 데모/관리 — 제로 트러스트 단말 보안 (terminal-zero-trust 설계 §6.3)
// 운영 전역 마운트(GNB/잠금 앱전체)는 게이트(앱·법무) 후. 여기선 컴포넌트 실증.
export default function TerminalSecurityPage() {
  const tAttr = useTAttr();
  const { profile, lock, refreshProfile, addToPool, lockScreen, loading } = useTerminalStore();
  const user = useAuthStore((s) => s.user);
  const [deviceUuid, setDevice] = useState('');
  const [pin, setPin] = useState<{ pin: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setDevice(getDeviceUuid());
    void refreshProfile();
  }, [refreshProfile]);

  const pickTerminal = (uuid: string) => {
    setDeviceUuid(uuid);
    setDevice(uuid);
    setPin(null);
    void refreshProfile();
  };

  const seedActive = () => {
    if (user) addToPool({ userId: user.id, name: `${user.familyName}${user.givenName}`, role: user.role });
  };

  /**
   * 🔴 이 버튼은 **데모가 아니다** — 2026-08-14(W7).
   *
   * `POST /terminal/daily-pin` 은 설계상 **출근 통합**이다(단말 앞에서 PIN 을 발급받는 행위가
   * 곧 출근). 그런데 이 화면은 그것을 "동작 데모" 섹션에 넣고 아무 경고도 하지 않아,
   * 누를 때마다 **법정 근태기록(AttendanceRecord CLOCK_IN)이 생성되고 ERP 웹훅까지** 나갔다.
   * 실측 `method='PIN'` 근태 **8건**이 이미 적재됐고 그중 `admin@hospital.example.org` 은
   * **2026-07-08 19:26 출근** — 저녁 출근이라는 명백한 오염이다.
   *
   * 기능을 없애는 대신 **화면이 사실을 말하게** 한다: 무엇이 기록되는지 밝히고 확인을 받는다.
   * (이미 오염된 8건은 코드로 되돌릴 수 없다 — 인사 데이터 교정으로 이연)
   */
  const doIssuePin = async () => {
    setMsg('');
    if (!confirm(
      tAttr('데일리 PIN 을 발급하면 오늘자 출근 기록(CLOCK_IN)이 함께 생성되고 ERP 로 전송됩니다.') + '\n' +
      tAttr('이미 오늘 출근 기록이 있으면 중복 생성되지는 않습니다.') + '\n\n' +
      tAttr('본인의 실제 출근으로 기록해도 괜찮습니까?'),
    )) return;
    try {
      const r = await issueDailyPin();
      setPin(r);
    } catch {
      setMsg('PIN 발급 실패(권한/세션 확인)');
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900"><T k="제로 트러스트 단말 보안 (D3 데모)" /></h1>
        <TerminalGnbBadge />
      </div>

      {/* 단말 선택 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700"><T k="단말 지정 (X-Device-UUID)" /></h2>
        <p className="mb-3 break-all text-xs text-gray-400"><T k="현재" />: {deviceUuid || '—'}</p>
        <div className="flex flex-wrap gap-2">
          {SEED_TERMINALS.map((t) => (
            <button
              key={t.uuid}
              onClick={() => pickTerminal(t.uuid)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                deviceUuid === t.uuid ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
              }`}
            >
              <T k={t.label} />
            </button>
          ))}
        </div>
      </section>

      {/* 보안 프로파일 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700"><T k="보안 프로파일 (effectiveProfile = f(mode, role))" /></h2>
        {loading && <p className="text-sm text-gray-400"><T k="조회 중…" /></p>}
        {profile && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Row k="단말 모드" v={profile.mode} />
            <Row k="직군" v={profile.roleClass} />
            <Row k="UI" v={profile.ui.join(', ')} />
            <Row k="잠금 타임아웃" v={`${profile.lockTimeoutSec}s`} />
            <Row k="임상기능" v={profile.clinicalFeatures ? '노출' : '비노출'} />
            <Row k="고위험 step-up" v={profile.stepUpHighRisk ? '필수' : '—'} />
            <Row k="전담자" v={profile.dedicated ? '예' : '아니오'} />
            <Row k="등록단말" v={profile.registered ? '예' : '미등록(보수적 PUBLIC)'} />
          </dl>
        )}
      </section>

      {/* 액션 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-700"><T k="단말 동작 확인" /></h2>
        {/* 🔴 종전 제목은 "동작 데모" 였다 — PIN 발급이 실제 근태기록을 남기는데 데모라고 불렀다 */}
        <p className="mb-3 text-xs text-amber-700">
          <T k="⚠️ ‘데일리 PIN 발급’은 시연이 아니라" /> <strong><T k="실제 동작" /></strong><T k="입니다 — 오늘자 출근 기록이 생성되고 ERP 로 전송됩니다." />
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={seedActive} className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white">
            <T k="내 세션 풀 추가" />
          </button>
          <button onClick={doIssuePin} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white">
            <T k="데일리 PIN 발급 (출근 기록)" />
          </button>
          <button onClick={() => lockScreen('manual')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
            <T k="화면 잠금" />
          </button>
        </div>
        {pin && (
          <p className="mt-3 text-sm">
            <T k="발급 PIN" />: <span className="font-mono text-lg font-bold tracking-widest">{pin.pin}</span>{' '}
            <span className="text-gray-400">(<T k="만료" /> {kdate(new Date(pin.expiresAt), 'time')})</span>
          </p>
        )}
        {msg && <p className="mt-2 text-sm text-red-600"><T k={msg} /></p>}
        <p className="mt-3 text-xs text-gray-400">
          <T k="잠금 후 좌측 PIN 패드(사번+PIN)로 해제, 우측 대기 세션으로 빠른 전환을 확인하세요. 화면 잠금·세션 풀은 이 화면에서만 마운트되어 다른 화면에는 적용되지 않습니다." />
        </p>
      </section>

      {/* 이중 게이트 잠금 오버레이 */}
      {lock.state === 'LOCKED' && <DoubleGateLock />}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-gray-500"><T k={k} /></dt>
      <dd className="font-medium text-gray-900"><T k={v} /></dd>
    </>
  );
}
