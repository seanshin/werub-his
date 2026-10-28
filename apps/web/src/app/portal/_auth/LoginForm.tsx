'use client';
import { useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import type { PatientInfo, PortalItem, LoginResponse } from '../_types';
import { Icon } from '../_shared';
import { ICONS } from '../_icons';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { TestPatientPanel } from '@/lib/dev-test-accounts';
import { BuildModeBanner } from '@/lib/his-mode';
import { PT, usePortalTAttr } from '../_shared/PT';

interface LoginFormProps {
  onLogin: (patient: PatientInfo) => void;
  /** (2026-10-19 포털 B7) 등록번호 세션의 '계정 만들기'에서 왔으면 가입 화면으로 시작 */
  initialSignup?: boolean;
}

export default function LoginForm({ onLogin, initialSignup = false }: LoginFormProps) {
  const tAttr = usePortalTAttr();
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [showMrnMode, setShowMrnMode] = useState(false);
  const [showSignup, setShowSignup] = useState(initialSignup);
  const [signupStep, setSignupStep] = useState<'info' | 'consent'>('info');
  // 가입 경로가 열려 있는가 — 폼을 다 채운 뒤 막지 않는다(서버에 먼저 묻는다)
  const [signupAvail, setSignupAvail] = useState<{ available: boolean; alternative: string } | null>(null);
  const [signupForm, setSignupForm] = useState({ name: '', dateOfBirth: '', gender: 'MALE', phone: '', password: '', pin: '' });
  const [consentChecks, setConsentChecks] = useState<Record<string, boolean>>({
    PRIVACY: false, SENSITIVE: false, UNIQUE_ID: false, THIRD_PARTY: false, TREATMENT: false, HIE: false,
    MARKETING: false, RESEARCH: false, EMR_VIEW: false, TELEHEALTH: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── 휴대폰 로그인 (주 모드) ──
  async function handlePhoneLogin() {
    if (!loginPhone.trim() || !loginPassword) { setError('휴대폰 번호와 비밀번호를 입력해 주세요.'); return; }
    setLoading(true); setError('');
    try {
      const res = await apiClient.fetch<{ data: LoginResponse }>('/api/v1/patient-auth/login', {
        method: 'POST', body: JSON.stringify({ phone: loginPhone.trim(), password: loginPassword, deviceId: `web-${Date.now()}`, platform: 'Web' }),
      });
      const d = res.data;
      apiClient.setToken(d.accessToken);
      const profileRes = await apiClient.fetch<{ data: unknown }>('/api/v1/portal/profile');
      const p = (profileRes as PortalItem).data as PortalItem | undefined;
      const profile = (p?.data ?? p) as PatientInfo | undefined;
      if (profile) { onLogin(profile); }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '로그인에 실패했습니다.'); }
    finally { setLoading(false); }
  }

  // ── MRN 조회 ──
  async function handleLogin() {
    if (!mrn.trim() || !dob) { setError('등록번호와 생년월일을 입력해 주세요.'); return; }
    setLoading(true); setError('');
    try {
      // 포털 로그인은 인증 불필요 — 직접 fetch (apiClient의 기존 토큰 간섭 방지)
      const normalizedDob = dob.includes('T') ? dob.slice(0, 10) : dob;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const resp = await fetch(`${apiUrl}/api/v1/portal/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mrn: mrn.trim(), dateOfBirth: normalizedDob }),
      });
      if (!resp.ok) throw new Error('auth failed');
      const res = await resp.json();
      const p = res?.data ?? res;
      const token = res?.token ?? res?.data?.token;
      if (token) apiClient.setToken(token);
      if (p?.id) onLogin(p as PatientInfo);
      else setError('환자 정보를 찾을 수 없습니다.');
    } catch { setError('조회에 실패했습니다. 등록번호 또는 생년월일을 확인해 주세요.'); }
    finally { setLoading(false); }
  }

  // ── 회원가입 ──
  const REQUIRED_CONSENTS = ['PRIVACY', 'SENSITIVE', 'UNIQUE_ID', 'THIRD_PARTY', 'TREATMENT', 'HIE'];
  const allRequiredChecked = REQUIRED_CONSENTS.every(k => consentChecks[k]);

  function handleSignupNext() {
    const f = signupForm;
    if (!f.name || !f.dateOfBirth || !f.phone || !f.password || !f.pin) { setError('모든 항목을 입력해 주세요.'); return; }
    setError('');
    setSignupStep('consent');
  }

  /**
   * 가입 모달 열기 — **먼저 서버에 가입 경로가 열려 있는지 묻는다.**
   * 🔴 조회에 실패하면 "열려 있다"고 가정하지 않는다. 서버가 어차피 거절하므로
   *    닫힌 것으로 보고 대안을 안내한다(모르는 것을 되는 쪽으로 낙관하지 않는다).
   */
  async function openSignup() {
    setShowSignup(true); setSignupStep('info'); setSignupAvail(null);
    try {
      const r = await apiClient.get<{ data: { available: boolean; alternative: string } }>(
        '/api/v1/patient-auth/signup/availability',
      );
      const d = (r as { data?: { data?: { available: boolean; alternative: string } } })?.data?.data
        ?? (r as { data?: { available: boolean; alternative: string } })?.data;
      setSignupAvail(d ?? { available: false, alternative: '병원 창구에서 계정을 발급받으세요.' });
    } catch {
      setSignupAvail({ available: false, alternative: '가입 가능 여부를 확인하지 못했습니다. 병원 창구에서 계정을 발급받으세요.' });
    }
  }

  async function handleSignup() {
    if (!allRequiredChecked) { setError('필수 동의 항목을 모두 체크해주세요.'); return; }
    const f = signupForm;
    setLoading(true); setError('');
    try {
      await apiClient.fetch('/api/v1/patient-auth/signup', {
        method: 'POST', body: JSON.stringify({
          // 🔴 CI 는 본인확인기관이 발급하는 값이다. 화면이 지어내지 않는다.
          //    종전에는 `web-<전화번호>-<timestamp>` 를 CI 로 보내, 본인확인을 한 적이 없는데
          //    한 것으로 기록되고 같은 사람이 매번 다른 CI 를 갖게 됐다(중복 계정 탐지 무력화).
          //    본인확인 연동(요청서 EXT-ID-01) 전까지 서버가 이 경로를 닫는다.
          name: f.name, dateOfBirth: f.dateOfBirth,
          gender: f.gender, phone: f.phone, password: f.password, pin: f.pin,
          consents: {
            privacyCollect: consentChecks.PRIVACY, sensitiveHealth: consentChecks.SENSITIVE,
            uniqueId: consentChecks.UNIQUE_ID, thirdParty: consentChecks.THIRD_PARTY,
            treatment: consentChecks.TREATMENT, hie: consentChecks.HIE,
            marketing: consentChecks.MARKETING, research: consentChecks.RESEARCH,
            emrView: consentChecks.EMR_VIEW, telehealth: consentChecks.TELEHEALTH,
          },
        }),
      });
      // 가입 성공 (BE에서 블록체인 인증서 자동 발급)
      setShowSignup(false); setSignupStep('info');
      setLoginPhone(f.phone); setLoginPassword(f.password);
      setError(''); alert('가입이 완료되었습니다!\n블록체인 인증서가 자동 발급되었습니다.\n로그인해주세요.');
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '가입에 실패했습니다.'); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center px-4">
      {/* 🔴 로그인 전이라 런타임 토글을 알 수 없다 — 빌드 모드로만 말한다(리얼이면 아무것도 안 그린다) */}
      <BuildModeBanner className="w-full max-w-md mb-3 rounded-lg border" />
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          {/* 헤더 */}
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Icon d={ICONS.user} cls="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">위루비병원</h1>
            <p className="text-sm text-gray-500 mt-1"><PT k="환자 포털" /></p>
          </div>

          {showMrnMode ? (
            /* ── MRN 조회 모드 ── */
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><PT k="환자 등록번호" /></label>
                <input type="text" id="login-mrn" value={mrn} onChange={e => setMrn(e.target.value)} placeholder={tAttr('진료카드에 적힌 번호')}
                  aria-label={tAttr('환자 등록번호')}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyDown={e => e.key === 'Enter' && handleLogin()} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="login-dob"><PT k="생년월일" /></label>
                <input type="date" id="login-dob" value={dob} onChange={e => setDob(e.target.value)}
                  aria-label={tAttr('생년월일')}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyDown={e => e.key === 'Enter' && handleLogin()} />
              </div>
              {error && <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={handleLogin} disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm">
                {loading ? '조회 중...' : '조회'}
              </button>
              <button onClick={() => { setShowMrnMode(false); setError(''); }} className="w-full text-xs text-gray-500 hover:text-gray-700 py-1">
                &larr; 휴대폰 로그인으로 돌아가기
              </button>
            </div>
          ) : (
            /* ── 휴대폰 로그인 (주 모드) ── */
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><PT k="휴대폰 번호" /></label>
                <input type="tel" id="login-phone" value={loginPhone} onChange={e => setLoginPhone(e.target.value)} placeholder="010-0000-0000"
                  aria-label={tAttr('휴대폰 번호')}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="login-password"><PT k="비밀번호" /></label>
                <input type="password" id="login-password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder={tAttr('비밀번호')}
                  aria-label={tAttr('비밀번호')}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyDown={e => e.key === 'Enter' && handlePhoneLogin()} />
              </div>
              {error && <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={handlePhoneLogin} disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm">
                {loading ? '로그인 중...' : '로그인'}
              </button>

              {/* 보조 액션 */}
              <div className="flex items-center justify-between pt-1">
                <button onClick={() => openSignup()} className="text-xs text-blue-600 hover:underline">
                  <PT k="계정이 없으신가요? 회원가입" />
                </button>
                <button onClick={() => { setShowMrnMode(true); setError(''); }} className="text-xs text-gray-500 hover:text-blue-600 transition-colors">
                  등록번호로 간편 조회 &rarr;
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 pt-3 border-t flex justify-center gap-4">
            <Link href="/booking" className="text-xs text-blue-600 hover:underline">{AI_ORIGIN_TEXT} 예약 &rarr;</Link>
          </div>

          {/* ── 회원가입 모달 ── */}
          {showSignup && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setShowSignup(false); setSignupStep('info'); }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

                {/* 🔴 본인확인 연동 전에는 가입을 열지 않는다 — 그 사실과 대안을 먼저 말한다 */}
                {signupAvail?.available === false ? (
                  <>
                    <h3 className="text-lg font-bold text-gray-900 mb-1"><PT k="지금은 온라인 가입을 할 수 없습니다" /></h3>
                    <p className="text-sm text-gray-600 mt-3">
                      휴대폰 본인확인 서비스 연동 전이라, 이 화면에서는 본인 여부를 확인할 방법이 없습니다.
                      확인하지 않은 채 계정을 만들지 않습니다.
                    </p>
                    <p className="text-sm text-gray-800 mt-3 font-medium">{signupAvail.alternative}</p>
                    <button
                      onClick={() => { setShowSignup(false); setSignupStep('info'); }}
                      className="mt-5 w-full px-4 py-2.5 bg-gray-100 text-gray-700 text-sm rounded-lg"
                    ><PT k="닫기" /></button>
                  </>
                ) : (
                <>
                {/* Step 1: 정보 입력 */}
                {signupStep === 'info' && (
                  <>
                    <h3 className="text-lg font-bold text-gray-900 mb-1"><PT k="회원가입" /></h3>
                    <p className="text-xs text-gray-400 mb-4"><PT k="1단계: 기본 정보 입력" /></p>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="text-xs text-gray-500"><PT k="이름" /></label><input value={signupForm.name} onChange={e => setSignupForm(f => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="홍길동" /></div>
                        <div><label className="text-xs text-gray-500"><PT k="성별" /></label><select value={signupForm.gender} onChange={e => setSignupForm(f => ({ ...f, gender: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm"><option value="MALE"><PT k="남" /></option><option value="FEMALE"><PT k="여" /></option></select></div>
                      </div>
                      <div><label className="text-xs text-gray-500"><PT k="생년월일" /></label><input type="date" value={signupForm.dateOfBirth} onChange={e => setSignupForm(f => ({ ...f, dateOfBirth: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                      <div><label className="text-xs text-gray-500"><PT k="휴대폰" /></label><input type="tel" value={signupForm.phone} onChange={e => setSignupForm(f => ({ ...f, phone: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="010-0000-0000" /></div>
                      <div><label className="text-xs text-gray-500"><PT k="비밀번호 (영문+숫자+특수 8자+)" /></label><input type="password" value={signupForm.password} onChange={e => setSignupForm(f => ({ ...f, password: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                      <div><label className="text-xs text-gray-500"><PT k="PIN (6자리 숫자)" /></label><input type="password" value={signupForm.pin} onChange={e => setSignupForm(f => ({ ...f, pin: e.target.value }))} maxLength={6} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('숫자 6자리')} /></div>
                      {error && <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                      <div className="flex gap-2">
                        <button onClick={handleSignupNext} className="flex-1 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><PT k="다음: 동의서" /></button>
                        <button onClick={() => { setShowSignup(false); setSignupStep('info'); }} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-lg">취소</button>
                      </div>
                    </div>
                  </>
                )}

                {/* Step 2: 동의서 */}
                {signupStep === 'consent' && (
                  <>
                    <h3 className="text-lg font-bold text-gray-900 mb-1"><PT k="동의서 확인" /></h3>
                    <p className="text-xs text-gray-400 mb-4"><PT k="2단계: 법정 동의서 확인 및 동의" /></p>

                    {/* 전체 동의 */}
                    <label className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl mb-3 cursor-pointer border border-blue-200">
                      <input type="checkbox"
                        checked={Object.values(consentChecks).every(Boolean)}
                        onChange={e => {
                          const v = e.target.checked;
                          setConsentChecks(Object.fromEntries(Object.keys(consentChecks).map(k => [k, v])));
                        }}
                        className="rounded border-gray-300 text-blue-600" />
                      <span className="text-sm font-bold text-blue-800"><PT k="전체 동의" /></span>
                    </label>

                    {/* 필수 동의 6종 */}
                    <p className="text-[10px] font-bold text-red-600 mb-2"><PT k="필수 동의 (미동의 시 가입 불가)" /></p>
                    <div className="space-y-2 mb-4">
                      {[
                        { key: 'PRIVACY', label: '개인정보 수집·이용 동의', law: '개인정보보호법 제15조', detail: '수집: 성명, 생년월일, 연락처, 주소 | 목적: 진료, 수납 | 보유: 10년' },
                        { key: 'SENSITIVE', label: '민감정보(건강정보) 처리 동의', law: '개인정보보호법 제23조', detail: '처리: 병력, 진단명, 검사결과, 처방 | 목적: 진단·치료·예방' },
                        { key: 'UNIQUE_ID', label: '고유식별정보 처리 동의', law: '개인정보보호법 제24조', detail: '처리: 주민등록번호, 여권번호 | 목적: 본인 확인, 보험 청구' },
                        { key: 'THIRD_PARTY', label: '제3자 제공 동의', law: '개인정보보호법 제17조', detail: '제공: 건보공단, 심평원, 보험사 | 목적: 보험 청구, 진료비 정산' },
                        { key: 'TREATMENT', label: '진료 동의', law: '의료법 제24조의2', detail: '본원에서 의료행위를 받는 것에 동의합니다' },
                        { key: 'HIE', label: '진료정보교류(HIE) 동의', law: '의료법 제21조의2', detail: '다른 의료기관과 진료기록 전자 공유에 동의합니다' },
                      ].map(item => (
                        <label key={item.key} className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                          <input type="checkbox" checked={consentChecks[item.key]} onChange={e => setConsentChecks(c => ({ ...c, [item.key]: e.target.checked }))}
                            className="mt-0.5 rounded border-gray-300 text-blue-600" />
                          <div className="flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-gray-800">{item.label}</span>
                              <span className="text-[9px] text-red-500 font-bold"><PT k="(필수)" /></span>
                            </div>
                            <p className="text-[9px] text-blue-500">{item.law}</p>
                            <p className="text-[9px] text-gray-400">{item.detail}</p>
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* 선택 동의 4종 */}
                    <p className="text-[10px] font-bold text-gray-500 mb-2"><PT k="선택 동의" /></p>
                    <div className="space-y-2 mb-4">
                      {[
                        { key: 'MARKETING', label: '마케팅 수신 동의', detail: '건강검진 안내, 이벤트 등 SMS·Push·이메일 수신' },
                        { key: 'RESEARCH', label: '임상연구 정보 활용 동의', detail: '비식별 진료정보의 학술 연구 활용' },
                        { key: 'EMR_VIEW', label: '전자의무기록 열람 동의', detail: '포털/앱에서 본인 진료기록 전자 열람' },
                        { key: 'TELEHEALTH', label: '원격진료 사전 동의', detail: '화상/전화 진료 이용 사전 동의' },
                      ].map(item => (
                        <label key={item.key} className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                          <input type="checkbox" checked={consentChecks[item.key]} onChange={e => setConsentChecks(c => ({ ...c, [item.key]: e.target.checked }))}
                            className="mt-0.5 rounded border-gray-300 text-blue-600" />
                          <div>
                            <span className="text-xs font-medium text-gray-700">{item.label}</span>
                            <span className="text-[9px] text-gray-400 ml-1"><PT k="(선택)" /></span>
                            <p className="text-[9px] text-gray-400">{item.detail}</p>
                          </div>
                        </label>
                      ))}
                    </div>

                    <div className="bg-gray-50 rounded-lg p-2.5 mb-3">
                      <p className="text-[9px] text-gray-500 leading-relaxed">위 동의는 자발적 의사에 의한 것이며, 동의를 거부할 권리가 있습니다. 필수 동의 거부 시 서비스 이용이 제한됩니다. 동의 철회는 포털 설정에서 가능합니다.</p>
                    </div>

                    {error && <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>}

                    <div className="flex gap-2">
                      <button onClick={() => setSignupStep('info')} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-lg"><PT k="이전" /></button>
                      <button onClick={handleSignup} disabled={loading || !allRequiredChecked}
                        className="flex-1 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                        {loading ? '가입 중...' : allRequiredChecked ? '동의 후 가입' : '필수 동의를 체크해주세요'}
                      </button>
                    </div>
                  </>
                )}
                </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 시드 환자 자동입력 — 개발 전용(운영 빌드에서는 모듈째 치환된다) ── */}
        {TestPatientPanel && (
          <TestPatientPanel
            className="mt-4"
            onPick={(m, d) => { setMrn(m); setDob(d); setShowMrnMode(true); }}
          />
        )}

        {/* ── 외국인 검진권 구매자 셀프 등록 ── */}
        <div className="mt-3 text-center">
          <a href="/voucher-claim" className="text-[11px] text-gray-400 hover:text-blue-600 underline">
            검진권 등록 · Register checkup voucher (foreign buyers)
          </a>
        </div>
      </div>
    </div>
  );
}
