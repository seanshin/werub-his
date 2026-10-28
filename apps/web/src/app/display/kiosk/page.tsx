'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';

/**
 * 무인 접수 키오스크 — **공개 단말**(대기실·로비).
 *
 * 🔴 2026-08-14 W9 — 이 화면은 하지 않은 일을 했다고 말하고 있었다(P16·P15).
 *    ① `cd-upload` → `접수 시작` 버튼이 **어떤 API 도 부르지 않고** 곧장 결과 화면으로 넘어가
 *       "CT 1건(156장) 업로드됨 · PACS에 등록되었습니다 · 주치의에게 자동 알림이 전송됩니다" 를 띄웠다.
 *       숫자 156 은 코드에 박힌 상수였고, 실제로는 CD 를 읽지도 저장하지도 알리지도 않았다.
 *       환자는 접수가 끝난 줄 알고 CD 를 들고 돌아간다 — **영상 없이 진료를 보게 된다.**
 *       (서버에 CD 접수 EP 가 없다. PACS 는 별도 프로젝트라 여기서 만들 수 없다 → **안내로 정직화**한다.)
 *    ② `ticket` 의 진료과 8개 버튼은 **하드코딩 목록에 onClick 조차 없었다** — 눌러도 아무 일이 없다.
 *    ③ 머리글이 다른 병원 이름('가상대학교병원')을 하드코딩하고 있었다.
 */
type KioskStep = 'home' | 'checkin' | 'checkin-result' | 'payment' | 'payment-result' | 'ticket' | 'cd-upload';

interface CheckinResult {
  checkedIn: boolean; already?: boolean; patientName?: string;
  department?: string; doctorName?: string | null; queueNumber?: number; message?: string;
}

export default function KioskPage() {
  const [step, setStep] = useState<KioskStep>('home');
  const [patientId, setPatientId] = useState('');
  const [dob, setDob] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [bill, setBill] = useState<{ patientName?: string; totalOutstanding?: number; count?: number } | null>(null);
  const [payResult, setPayResult] = useState<{ patientName?: string; totalPaid?: number; paidCount?: number } | null>(null);

  const reset = () => { setStep('home'); setPatientId(''); setDob(''); setMessage(''); setResult(null); setBill(null); setPayResult(null); };

  /**
   * 🔴 **무인 로비 키오스크에 유휴 타임아웃이 없었다**(2026-09-02).
   *    결과 화면에는 환자명·미납 건수·미납 총액이 큰 글씨로 남는데, `reset()` 은 버튼을 눌러야만 돌았다.
   *    환자가 그냥 자리를 뜨면 **다음 사람이 앞사람의 이름과 미납액을 읽는다.**
   *    같은 스코프의 접수 스테이션은 4초 자동 해제, 태블릿은 KioskLock 으로 이미 처리한다 — 여기만 빠졌다.
   */
  const IDLE_SEC = 30;
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  useEffect(() => {
    const showsPersonalData = step === 'checkin-result' || step === 'payment' || step === 'payment-result' || step === 'ticket';
    if (!showsPersonalData) { setIdleLeft(null); return; }
    setIdleLeft(IDLE_SEC);
    const t = setInterval(() => {
      setIdleLeft((n) => {
        if (n == null) return null;
        if (n <= 1) { reset(); return null; }
        return n - 1;
      });
    }, 1000);
    const bump = () => setIdleLeft(IDLE_SEC);
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    return () => { clearInterval(t); window.removeEventListener('pointerdown', bump); window.removeEventListener('keydown', bump); };
  }, [step]);

  const fetchBilling = async () => {
    if (!patientId || !dob) { setMessage('등록번호와 생년월일을 입력해 주세요.'); return; }
    setMessage(''); setLoading(true);
    try {
      const res = await fetch('/api/v1/kiosk/billing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mrn: patientId.trim(), dob: dob.trim() }) });
      const json = await res.json();
      if (!res.ok) { setMessage(json?.error?.message ?? '조회 실패'); return; }
      setBill(json.data);
    } catch { setMessage('네트워크 오류'); } finally { setLoading(false); }
  };

  const handlePay = async (method: string) => {
    setLoading(true); setMessage('');
    try {
      const res = await fetch('/api/v1/kiosk/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mrn: patientId.trim(), dob: dob.trim(), method }) });
      const json = await res.json();
      if (!res.ok) { setMessage(json?.error?.message ?? '결제 실패'); return; }
      setPayResult(json.data); setStep('payment-result');
    } catch { setMessage('네트워크 오류'); } finally { setLoading(false); }
  };

  const handleCheckin = async () => {
    if (!patientId || !dob) { setMessage('등록번호와 생년월일을 입력해 주세요.'); return; }
    setMessage(''); setLoading(true);
    try {
      const res = await fetch('/api/v1/kiosk/check-in', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mrn: patientId.trim(), dob: dob.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setMessage(json?.error?.message ?? '접수에 실패했습니다. 접수 창구를 이용해 주세요.'); return; }
      setResult(json.data as CheckinResult);
      setStep('checkin-result');
    } catch {
      setMessage('네트워크 오류. 접수 창구를 이용해 주세요.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center p-8 select-none">
      {/* Home */}
      {step === 'home' && (
        <div className="text-center max-w-lg w-full">
          <div className="mb-8">
            {/* 🔴 다른 병원 이름이 하드코딩돼 있었다 — 공개 단말이 소속을 잘못 말하면 안내 전체의 신뢰가 깨진다 */}
            <h1 className="text-4xl font-black text-blue-800 mb-2">Hospital RUN</h1>
            <p className="text-xl text-gray-500">무인 접수 키오스크</p>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <button onClick={() => setStep('checkin')} className="bg-blue-600 hover:bg-blue-700 text-white text-2xl font-bold py-8 rounded-2xl shadow-lg transition-transform active:scale-95">
              📋 진료 접수
            </button>
            <button onClick={() => setStep('payment')} className="bg-green-600 hover:bg-green-700 text-white text-2xl font-bold py-8 rounded-2xl shadow-lg transition-transform active:scale-95">
              💳 수납 / 결제
            </button>
            <button onClick={() => setStep('ticket')} className="bg-purple-600 hover:bg-purple-700 text-white text-2xl font-bold py-8 rounded-2xl shadow-lg transition-transform active:scale-95">
              🎫 번호표 출력
            </button>
            <button onClick={() => setStep('cd-upload')} className="bg-indigo-600 hover:bg-indigo-700 text-white text-2xl font-bold py-8 rounded-2xl shadow-lg transition-transform active:scale-95">
              💿 외부 영상 CD 접수
            </button>
          </div>
          <p className="mt-8 text-sm text-gray-400">도움이 필요하시면 안내 데스크를 방문해 주세요</p>
        </div>
      )}

      {/* Check-in */}
      {step === 'checkin' && (
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">진료 접수</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">등록번호 (MRN)</label>
              <input
                type="text" value={patientId} onChange={(e) => setPatientId(e.target.value)}
                placeholder="진료카드에 적힌 번호" autoFocus
                className="w-full text-2xl text-center border-2 border-gray-200 rounded-xl p-4 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">생년월일 (8자리)</label>
              <input
                type="text" value={dob} onChange={(e) => setDob(e.target.value)}
                placeholder="19850512" maxLength={8}
                className="w-full text-2xl text-center border-2 border-gray-200 rounded-xl p-4 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>
            {message && <p className="text-red-500 text-center text-sm">{message}</p>}
            <button onClick={handleCheckin} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xl font-bold py-4 rounded-xl transition-colors">{loading ? "조회 중..." : "접수 확인"}</button>
            <button onClick={reset} className="w-full text-gray-500 hover:text-gray-700 py-2">← 처음으로</button>
          </div>
        </div>
      )}

      {/* Check-in Result */}
      {step === 'checkin-result' && result && (
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          {result.checkedIn ? (
            <>
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-4xl">✓</span></div>
              <h2 className="text-2xl font-bold text-green-700 mb-2">{result.already ? '이미 접수됨' : '접수 완료'}</h2>
              <p className="text-gray-600 mb-6">{result.patientName} 님</p>
              <div className="bg-blue-50 rounded-xl p-6 mb-6">
                <p className="text-sm text-blue-600 mb-1">대기 번호</p>
                <p className="text-6xl font-black text-blue-800">{result.queueNumber}</p>
                <p className="text-sm text-blue-600 mt-2">{result.department}{result.doctorName ? ` | ${result.doctorName} 선생님` : ''}</p>
              </div>
              <p className="text-sm text-gray-400 mb-4">번호표가 출력됩니다. 호출 시 진료실로 입장해 주세요.</p>
            </>
          ) : (
            <>
              <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-4xl">ℹ️</span></div>
              <h2 className="text-2xl font-bold text-amber-700 mb-2">접수 안내</h2>
              <p className="text-gray-600 mb-6">{result.patientName} 님</p>
              <p className="text-lg text-gray-700 mb-6">{result.message}</p>
            </>
          )}
          <button onClick={reset} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-lg font-semibold py-3 rounded-xl">완료</button>
        </div>
      )}

      {/* Payment */}
      {step === 'payment' && (
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">수납 / 결제</h2>
          {!bill ? (
            <>
              <div className="bg-gray-50 rounded-xl p-6 mb-4">
                <p className="text-gray-500 mb-3">등록번호와 생년월일을 입력해 주세요</p>
                <input type="text" value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="진료카드에 적힌 번호"
                  className="w-full text-xl text-center border-2 border-gray-200 rounded-xl p-3 focus:border-green-500 mb-2" />
                <input type="text" value={dob} onChange={(e) => setDob(e.target.value)} placeholder="생년월일 8자리" maxLength={8}
                  className="w-full text-xl text-center border-2 border-gray-200 rounded-xl p-3 focus:border-green-500" />
              </div>
              {message && <p className="text-red-500 text-sm mb-2">{message}</p>}
              <button onClick={fetchBilling} disabled={loading} className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xl font-bold py-4 rounded-xl mb-2">{loading ? '조회 중...' : '미납 조회'}</button>
            </>
          ) : bill.count === 0 ? (
            <div className="bg-blue-50 rounded-xl p-6 mb-4">
              <p className="text-xl font-semibold text-blue-700">{bill.patientName} 님</p>
              <p className="text-lg text-gray-700 mt-2">미납 내역이 없습니다.</p>
            </div>
          ) : (
            <>
              <div className="bg-green-50 rounded-xl p-4 mb-4">
                <p className="text-sm text-green-600">{bill.patientName} 님 · 미납 {bill.count}<Unit>건</Unit></p>
                <p className="text-sm text-green-600 mt-2">결제 금액</p>
                <p className="text-4xl font-bold text-green-800">₩ {(bill.totalOutstanding ?? 0).toLocaleString()}</p>
                <p className="text-xs text-green-600 mt-1">본인부담금</p>
              </div>
              {message && <p className="text-red-500 text-sm mb-2">{message}</p>}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button onClick={() => handlePay('CARD')} disabled={loading} className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white py-4 rounded-xl font-semibold">카드 결제</button>
                <button onClick={() => handlePay('SIMPLE')} disabled={loading} className="bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white py-4 rounded-xl font-semibold">간편결제</button>
              </div>
            </>
          )}
          <button onClick={reset} className="w-full text-gray-500 hover:text-gray-700 py-2">← 처음으로</button>
        </div>
      )}

      {/* Payment Result */}
      {step === 'payment-result' && payResult && (
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-4xl">✓</span></div>
          <h2 className="text-2xl font-bold text-green-700 mb-2">결제 완료</h2>
          <p className="text-gray-600 mb-6">{payResult.patientName} 님</p>
          <div className="bg-green-50 rounded-xl p-6 mb-6">
            <p className="text-sm text-green-600 mb-1">결제 금액 ({payResult.paidCount}<Unit>건</Unit>)</p>
            <p className="text-4xl font-black text-green-800">₩ {(payResult.totalPaid ?? 0).toLocaleString()}</p>
          </div>
          {/* 🔴 영수증 출력 경로가 이 단말에 없다 — 출력된다고 말하지 않는다.
              (같은 화면의 CD 접수 탭이 이미 "이 단말에서는 접수되지 않습니다"로 정직하게 처리한다) */}
          <p className="text-sm text-gray-400 mb-4">영수증은 수납 창구에서 발급받으실 수 있습니다.</p>
          <button onClick={reset} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-lg font-semibold py-3 rounded-xl">완료</button>
        </div>
      )}

      {/* CD 접수 — 🔴 단말이 영상을 읽을 수 없다. 접수됐다고 말하지 않고, 사람이 받는 곳으로 안내한다 */}
      {step === 'cd-upload' && (
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-4xl">💿</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">외부 영상 CD 접수</h2>
          <div className="bg-indigo-50 rounded-xl p-5 mb-6 text-left">
            <p className="text-lg font-semibold text-indigo-800 mb-2">이 단말에서는 접수되지 않습니다</p>
            <p className="text-sm text-indigo-700 leading-relaxed">
              타 병원 영상 CD 는 <b>영상의학과 접수 창구</b>에 직접 제출해 주세요.
              등록·판독 연계는 담당 직원이 확인 후 진행합니다.
            </p>
          </div>
          <p className="text-xs text-gray-400 mb-4">CD 를 단말에 넣지 마세요 — 회수되지 않습니다.</p>
          <button onClick={reset} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-lg font-semibold py-3 rounded-xl">확인</button>
        </div>
      )}

      {/* 번호표 — 🔴 종전 진료과 8개 버튼은 하드코딩 목록에 onClick 이 없었다(눌러도 아무 일 없음) */}
      {step === 'ticket' && (
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-3">번호표 출력</h2>
          <div className="bg-blue-50 rounded-xl p-5 mb-6 text-left">
            <p className="text-lg font-semibold text-blue-800 mb-2">진료 접수에서 함께 발급됩니다</p>
            <p className="text-sm text-blue-700 leading-relaxed">
              대기 번호는 예약·접수 정보에 따라 배정되므로, 등록번호와 생년월일로 <b>진료 접수</b>를 진행하시면
              같은 화면에서 번호가 안내됩니다.
            </p>
          </div>
          <button onClick={() => setStep('checkin')} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xl font-bold py-4 rounded-xl mb-2">진료 접수로 이동</button>
          <button onClick={reset} className="w-full text-gray-500 hover:text-gray-700 py-2">← 처음으로</button>
        </div>
      )}
    </div>
  );
}
