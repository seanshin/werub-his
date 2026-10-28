'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { Unit, genderText } from '@/components/ui/display';
import { stayDays, AI_ORIGIN_TEXT, localeTimeText, vitalItemFlags, worseVitalFlag, type VitalItemFlag } from '@hospital-run/shared';
import { useSearchParams } from 'next/navigation';
import { HOSPITAL } from '@/components/homepage/hospital-facts';
import { TestPatientPanel } from '@/lib/dev-test-accounts';
import { BuildModeBanner } from '@/lib/his-mode';

// 브라우저에서는 상대경로 사용
const API_URL = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL || '');

interface QuickReply { label: string; value: string; icon?: string }
interface DeptCard { name: string; reason: string; priority: number; confidence: number }
interface DateOption { date: string; dayName: string; label: string; value: string }
interface TimeSlot { time: string; label: string; value: string }
interface TimePeriod { period: string; slots: TimeSlot[] }
interface BookingResult { department: string; doctor: string; date: string; time: string; patient: string; mrn: string; reason: string }

interface MedicalInsight {
  /** 🔴 AI 출처 3상태(shared `AI_PROPOSAL_SOURCES` 어휘) — `UNAVAILABLE` 이면 `answer` 가 없다(지어내지 않는다) */
  source?: 'AI' | 'FALLBACK' | 'UNAVAILABLE';
  /** 미가용 사유 코드(서버 `MEDICAL_ASK_UNAVAILABLE_REASONS`) — 화면은 문장으로 옮기지 않고 사실만 말한다 */
  reason?: string;
  answer?: string;
  category?: string;
  disclaimer?: string;
}

interface DeptCardsPayload {
  departments: DeptCard[];
  quickReplies?: QuickReply[];
  medicalInsight?: MedicalInsight;
}

interface ConfirmBookingPayload {
  department: string;
  doctor?: string;
  visitType: string;
  reason: string;
  quickReplies?: QuickReply[];
  medicalInsight?: MedicalInsight;
}

interface DatePickerPayload {
  department?: string;
  dates: DateOption[];
}

interface TimePickerPayload {
  dateLabel?: string;
  times: TimePeriod[];
}

interface BookingCompletePayload extends BookingResult {
  nextBooking?: { department: string; quickReplies: QuickReply[] };
  questionnaire?: { token: string; url: string };
}

interface FollowUpPayload {
  questions: FollowUpQuestion[];
}

type UiPayload = DeptCardsPayload | ConfirmBookingPayload | DatePickerPayload | TimePickerPayload | BookingCompletePayload | FollowUpPayload | QuickReply[] | Record<string, unknown>;

interface UiDirective {
  type: string;
  payload: UiPayload;
}

interface RichData {
  type: 'ENCOUNTER_LIST' | 'LAB_TABLE' | 'MED_LIST' | 'BILLING_LIST' | 'HOSPITAL_INFO' | 'VITAL_LIST' | 'APPOINTMENT_LIST' | 'ADMISSION_INFO' | 'ESCALATION';
  items?: any[];
  summary?: string;
}

interface Message {
  role: 'user' | 'agent';
  content: string;
  uiDirective?: UiDirective;
  richData?: RichData;
  enhancedContent?: string | null;
  enhancedLoading?: boolean;
  enhancedModels?: string[];
}

interface BookingPatient {
  id: string;
  familyName: string;
  givenName: string;
  mrn: string;
  gender?: string;
}

interface FollowUpQuestion {
  text?: string;
  options?: string[];
}

interface CommonSymptom { label: string; icon: string; value: string }

export default function BookingPageWrapper() {
  return <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}><BookingPage /></Suspense>;
}

function BookingPage() {
  const searchParams = useSearchParams();
  const autoIntent = searchParams.get('intent');  // 예: '건강검진을 받고 싶어요'
  const autoDept = searchParams.get('dept');       // 예: '내과'
  const autoSent = useRef(false);

  // Auth state
  const [authed, setAuthed] = useState(false);
  const [patient, setPatient] = useState<BookingPatient | null>(null);
  // 🔴 컨시어지 데이터 조회용 포털 JWT — 종전엔 /portal/auth 가 주는 token 을 버리고 무인증으로
  //    portal EP 를 불러 8개 인텐트 전부 401/404 로 조용히 죽어 있었다(카드가 영영 안 붙음).
  const [chatToken, setChatToken] = useState<string | null>(null);
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Chat state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [commonSymptoms, setCommonSymptoms] = useState<CommonSymptom[]>([]);
  const [showSymptomChips, setShowSymptomChips] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // URL 파라미터로 자동 전송 (인증 후)
  useEffect(() => {
    if (!authed || autoSent.current || initializing || loading) return;
    const msg = autoIntent || (autoDept ? `${autoDept} 진료를 예약하고 싶어요` : null);
    if (msg && sessionId) {
      autoSent.current = true;
      setTimeout(() => sendMessage(msg), 500);
    }
  }, [authed, initializing, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  /*
   * 포털에서 넘어온 경우 자동 로그인.
   *
   * 🔴 W9(저장소 규약 위반 + 실동작 결함): 여기가 `(homepage)` 인데 `apiClient` 를 쓰고 있었다
   *    (규약: (homepage) 는 apiClient 금지 → fetch 직접 사용).
   *    게다가 apiClient.getToken() 이 읽는 것은 localStorage `accessToken` = **직원 로그인 토큰**이고,
   *    환자 포털이 저장하는 토큰 키는 `portal-token` 이다. 즉
   *      - 포털에서 넘어온 환자는 토큰이 없다고 판정돼 자동 로그인이 한 번도 동작하지 않았고
   *      - 반대로 HIS 에 로그인한 직원이 공개 예약 페이지를 열면 직원 토큰이 /portal/profile 로 전송됐다.
   *    → 공개 화면은 포털 토큰만, fetch 로 보낸다.
   */
  useEffect(() => {
    if (authed) return;
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('portal-token');
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/portal/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return; // 토큰 만료 시 수동 인증
        const json = await res.json();
        const p = (json?.data ?? json) as BookingPatient | undefined;
        if (p?.mrn) {
          setPatient(p);
          setChatToken(token);
          setAuthed(true);
          startBookingSession(p);
        }
      } catch { /* 네트워크 실패 시 수동 인증 */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 자주 묻는 증상 로드
  const loadCommonSymptoms = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/booking/common-symptoms`);
      const data = await res.json();
      if (data.data?.length) setCommonSymptoms(data.data);
    } catch {
      setCommonSymptoms([
        { label: '두통', icon: '🤕', value: '머리가 아파요' },
        { label: '복통', icon: '🤢', value: '배가 아파요' },
        { label: '기침/감기', icon: '🤧', value: '기침이 나고 감기 증상이 있어요' },
        { label: '발열', icon: '🌡️', value: '열이 나요' },
        { label: '허리통증', icon: '💪', value: '허리가 아파요' },
        { label: '관절통', icon: '🦵', value: '관절이 아파요' },
        { label: '피부 문제', icon: '🩹', value: '피부에 발진이 있어요' },
        { label: '어지러움', icon: '😵', value: '어지러워요' },
        { label: '소화불량', icon: '😣', value: '소화가 안 돼요' },
        { label: '건강검진', icon: '🩺', value: '건강검진을 받고 싶어요' },
        { label: '원격진료', icon: '📹', value: '원격진료(비대면 진료)를 예약하고 싶어요' },
      ]);
    }
  }, []);

  // 본인 인증
  const handleAuth = async () => {
    if (!mrn.trim() || !dob) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/portal/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mrn: mrn.trim(), dateOfBirth: dob }),
      });
      if (!res.ok) throw new Error('auth failed');
      const json = await res.json();
      const pt = json.data?.data ?? json.data ?? json;
      setPatient(pt);
      setChatToken(json.token ?? null); // /portal/auth 는 JWT 를 함께 준다 — 버리면 컨시어지 조회가 전부 401
      setAuthed(true);
      startBookingSession(pt);
    } catch {
      setAuthError('환자 정보를 찾을 수 없습니다. MRN과 생년월일을 확인해주세요.');
    }
    setAuthLoading(false);
  };

  // 예약 세션 시작
  const startBookingSession = async (p: BookingPatient) => {
    setInitializing(true);
    loadCommonSymptoms();
    const hour = new Date().getHours();
    const greeting = hour < 12 ? '좋은 아침이에요' : hour < 18 ? '안녕하세요' : '좋은 저녁이에요';
    const fallbackMsg = `${greeting}, ${p.familyName}${p.givenName}님!\n\n어떤 증상으로 내원하실 것인가요?\n\n편하게 증상을 말씀해주시면, 적합한 진료과를 추천해드리겠습니다.`;

    // 1단계: 세션 생성
    let sid: string | null = null;
    try {
      const url = `${API_URL}/api/v1/booking/session`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId: p.id, mrn: p.mrn }) });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      sid = data.data?.id ?? null;
    } catch (e) {
      console.error('세션 생성 에러:', e);
    }

    if (!sid) {
      setMessages([{ role: 'agent', content: `${fallbackMsg}\n\n⚠️ ${AI_ORIGIN_TEXT} 세션 연결에 실패했습니다. 증상을 입력하시면 재시도합니다.\n(URL: ${API_URL || window.location.origin}/api/v1/booking/session)` }]);
      setInitializing(false);
      return;
    }
    setSessionId(sid);

    // 2단계: MRN 전송으로 환자 식별
    try {
      const msgRes = await fetch(`${API_URL}/api/v1/booking/session/${sid}/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: p.mrn }),
      });
      if (!msgRes.ok) throw new Error(`메시지 전송 실패: ${msgRes.status}`);
      const msgData = await msgRes.json();
      let resp = (msgData.data?.response as string ?? '')
        .replace(/✅ 기존 환자 발견[\s\S]*?어떤 증상으로 내원하셨나요\?/, '')
        .replace('내원하셨나요?', '내원하실 것인가요?')
        .replace('내원하셨나요', '내원하실 것인가요')
        .trim();
      if (!resp) resp = '어떤 증상으로 내원하실 것인가요?\n\n편하게 증상을 말씀해주시면, 적합한 진료과를 추천해드리겠습니다.';
      setMessages([{ role: 'agent', content: `${greeting}, ${p.familyName}${p.givenName}님!\n\n${resp}` }]);
    } catch (e) {
      console.error('MRN 전송 에러:', e);
      setMessages([{ role: 'agent', content: fallbackMsg }]);
    }
    setInitializing(false);
  };

  // 메시지 전송
  const sendMessage = async (text?: string) => {
    const userMsg = (text ?? input).trim();
    if (!userMsg || loading) return;

    // sessionId 없으면 자동 생성
    let sid = sessionId;
    if (!sid) {
      try {
        const res = await fetch(`${API_URL}/api/v1/booking/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json();
        sid = data.data?.id ?? null;
        if (sid) setSessionId(sid);
      } catch (e) {
        console.error('세션 자동 생성 실패:', e);
      }
    }
    if (!sid) {
      setMessages(prev => [...prev, { role: 'user', content: userMsg }, { role: 'agent', content: '⚠️ 서버 연결에 실패했습니다. 페이지를 새로고침 해주세요.' }]);
      setInput('');
      return;
    }

    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setLoading(true);
    setShowSymptomChips(false);

    // 증상/의료 관련 메시지인지 판단 (enhanced 호출 여부)
    const isActionRequest = /예약|확인|취소|변경|안내|해줘|해주세요|할게|할래|할께|하겠|네|아니|좋아|선택|접수/.test(userMsg);
    const hasSymptom = /아프|아파|아픈|아픔|아퍼|통증|열이|열나|기침|두통|복통|어지|구토|설사|호흡곤란|발열|쑤시|찌릿|지끈|욱신|뻐근|쓰리|당기|부종|가려|간지|출혈|답답|메스꺼|구역질|혈변|혈뇨|흉통|경련|마비|저림/.test(userMsg);
    const isSymptomQuery = hasSymptom && !isActionRequest;

    try {
      // 1단계: 항상 WeRU.B 챗봇에 먼저 전달 (WeRU.B가 맥락을 보고 응답)
      const res = await fetch(`${API_URL}/api/v1/booking/session/${sid}/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      });
      if (!res.ok) throw new Error(`서버 응답: ${res.status} ${res.statusText}`);
      const data = await res.json();
      let agentResp = (data.data?.response as string ?? '응답을 처리할 수 없습니다.')
        .replace('내원하셨나요?', '내원하실 것인가요?');
      const uiDirective = data.data?.uiDirective ?? null;

      // 2단계: WeRU.B 응답 후, 데이터 조회가 필요한 인텐트인지 후처리 판단
      // WeRU.B가 맥락을 처리한 뒤, 응답 내용에서 데이터 보강이 필요한지 확인
      let richData: RichData | undefined;
      if (patient && !isActionRequest) {
        const postIntent = detectPostResponseIntent(userMsg, agentResp);
        if (postIntent) {
          richData = await fetchConciergeData(postIntent, API_URL, chatToken);
        }
      }

      // 일반 응답 먼저 표시 + enhanced 로딩 상태
      setMessages(prev => [...prev, {
        role: 'agent',
        content: agentResp,
        uiDirective,
        richData,
        enhancedContent: isSymptomQuery ? null : undefined,
        enhancedLoading: isSymptomQuery,
      }]);

      // 3단계: 고품질 응답 (증상 관련일 때만, 비동기 병렬)
      if (isSymptomQuery) {
        fetch(`${API_URL}/api/v1/booking/enhanced`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userMsg, sessionId: sid }),
        })
          .then(r => r.ok ? r.json() : { data: { answer: '정밀 분석 연결에 실패했습니다.', error: true } })
          .then(enhData => {
            const enhanced = enhData?.data;
            const enhText = enhanced?.answer ?? enhanced?.result
              ?? (enhanced?.stages ? enhanced.stages.map((s: any, i: number) => `${i + 1}. ${s.model ?? ''}: ${s.result ?? ''}`).join('\n')
              : enhanced?.differential_diagnosis ? enhanced.differential_diagnosis.map((d: any, i: number) => `${i + 1}. ${d.diagnosis_ko ?? d.diagnosis} (${d.icd10 ?? ''}) — ${d.probability ?? ''}`).join('\n')
              : '정밀 분석 결과를 처리할 수 없습니다.');
            const models = enhanced?.models_used ?? enhanced?.stages?.map((s: any) => s.model).filter(Boolean) ?? [];
            setMessages(prev => prev.map((m, i) => i === prev.length - 1 && m.enhancedLoading
              ? { ...m, enhancedContent: enhText || '분석 결과 없음', enhancedLoading: false, enhancedModels: models }
              : m
            ));
          })
          .catch(() => {
            setMessages(prev => prev.map((m, i) => i === prev.length - 1 && m.enhancedLoading
              ? { ...m, enhancedContent: '정밀 분석 서비스에 연결할 수 없습니다.', enhancedLoading: false }
              : m
            ));
          });
      }
    } catch (e) {
      console.error('메시지 전송 에러:', e);
      setMessages(prev => [...prev, { role: 'agent', content: `⚠️ 연결 오류: ${e instanceof Error ? e.message : '알 수 없는 오류'}. 다시 시도해주세요.` }]);
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  // Quick reply 클릭
  const handleQuickReply = (value: string) => {
    if (!value) {
      inputRef.current?.focus();
      return;
    }
    // 포털 이동
    if (value === '포털' || value === '포털로 이동') {
      window.location.href = '/portal';
      return;
    }
    sendMessage(value);
  };

  // ── 로그인 화면 ──
  if (!authed) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[70vh]">
        {/* 좌측 — 이미지 + 안내 */}
        <div className="hidden lg:flex relative bg-gradient-to-br from-teal-700 to-emerald-800 items-center justify-center overflow-hidden">
          <img src="/images/homepage/facilities/facility-operating-room.png" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
          <div className="relative z-10 text-center px-12">
            <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-12 w-auto mx-auto mb-6" style={{ filter: 'brightness(0) invert(1)' }} />
            <h2 className="text-2xl font-bold text-white leading-relaxed">정확한 진단으로<br />오늘의 병을 치료합니다</h2>
            <p className="text-teal-200 mt-4 text-sm">{AI_ORIGIN_TEXT} 컨시어지가 진료과와 시간을 안내해 드립니다</p>
          </div>
        </div>

        {/* 우측 — 예약 폼 */}
        <div className="flex items-center justify-center p-6 lg:p-12 bg-gray-50">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
            <div className="text-center mb-6">
              <div className="lg:hidden mb-4">
                <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-10 w-auto mx-auto" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">온라인 진료 예약</h1>
              <p className="text-sm text-gray-500 mt-1">본인 확인 후 {AI_ORIGIN_TEXT} 컨시어지가 안내합니다</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">환자 등록번호</label>
                <input type="text" value={mrn} onChange={e => setMrn(e.target.value)} placeholder="진료카드에 적힌 번호"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">생년월일</label>
                <input type="date" value={dob} onChange={e => setDob(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAuth()}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              {authError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{authError}</p>}
              <button onClick={handleAuth} disabled={authLoading || !mrn.trim() || !dob}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {authLoading ? '확인 중...' : '본인 확인 후 예약'}
              </button>
            </div>

            {/* 시드 환자 자동입력 — 개발 전용(운영 빌드에서는 모듈째 치환된다) */}
            {TestPatientPanel && (
              <TestPatientPanel
                className="mt-5 pt-4 border-t border-gray-100"
                onPick={(m, d) => { setMrn(m); setDob(d); }}
              />
            )}
          </div>
          <p className="text-center text-xs text-gray-400 mt-4">개인정보는 안전하게 처리됩니다.</p>
        </div>
        </div>
      </div>
    );
  }

  // ── 예약 채팅 화면 ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex flex-col items-center justify-center px-4 py-6">
      <BuildModeBanner className="w-full max-w-6xl mb-3 rounded-lg border" />
      <div className="w-full max-w-6xl">
        <div className="text-center mb-4">
          <h1 className="text-xl font-bold text-gray-900">위루비병원</h1>
          <p className="text-sm text-gray-500">온라인 진료 예약</p>
        </div>

        {/* 환자 정보 카드 */}
        {patient && (
          <div className="bg-white rounded-xl border border-blue-200 px-4 py-3 mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-sm font-bold text-blue-700">{patient.familyName}</span>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{patient.familyName}{patient.givenName}</p>
                <p className="text-[10px] text-gray-500">{patient.mrn} · {genderText(patient.gender)}</p>
              </div>
            </div>
            <button onClick={() => { setAuthed(false); setPatient(null); setMessages([]); setSessionId(null); setShowSymptomChips(true); }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors">로그아웃</button>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {/* 헤더 */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-3 flex items-center gap-2">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
            <span className="text-white font-semibold text-sm">{AI_ORIGIN_TEXT} 컨시어지</span>
            {loading && (
              <span className="ml-auto flex items-center gap-1.5 text-white/70 text-xs">
                <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-pulse" />
                응답 중...
              </span>
            )}
          </div>

          {/* 메시지 영역 */}
          <div ref={scrollRef} className="h-[600px] overflow-y-auto p-5 space-y-3 bg-gray-50/30">
            {initializing && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 border-2 border-blue-200 rounded-full" />
                  <div className="absolute inset-0 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <p className="text-sm text-gray-400">{AI_ORIGIN_TEXT} 컨시어지를 준비하고 있습니다...</p>
              </div>
            )}

            {!initializing && messages.map((msg, i) => (
              <div key={i}>
                {/* 사용자 메시지 */}
                {msg.role === 'user' && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-blue-600 text-white rounded-br-md">
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                )}

                {/* WeRU.B 응답: 일반(좌) + 고품질(우) 나란히 */}
                {msg.role === 'agent' && (
                  <div className="space-y-2">
                    {/* 일반 + 고품질 좌우 배치 */}
                    <div className={`flex gap-2 items-start ${(msg.enhancedContent !== undefined || msg.enhancedLoading) ? '' : 'justify-start'}`}>
                      {/* 일반 응답 (좌측) */}
                      <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-white text-gray-800 rounded-bl-md shadow-sm border border-gray-100 ${(msg.enhancedContent !== undefined || msg.enhancedLoading) ? 'flex-1 min-w-0' : 'max-w-[85%]'}`}>
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                        {msg.richData && <ConciergeRichCard data={msg.richData} />}
                      </div>

                      {/* 고품질 응답 (우측) — 로딩 중 */}
                      {msg.enhancedLoading && (
                        <div className="flex-1 min-w-0 rounded-2xl px-3 py-2.5 text-sm bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-200 shadow-sm">
                          <p className="text-[9px] font-semibold text-violet-600 mb-1.5 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-pulse" /> {AI_ORIGIN_TEXT} 정밀 분석
                          </p>
                          <div className="flex items-center gap-2 text-xs text-violet-400">
                            <div className="flex gap-0.5">
                              <span className="w-1.5 h-1.5 bg-violet-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-1.5 h-1.5 bg-violet-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-1.5 h-1.5 bg-violet-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                            <span>처리 중...</span>
                          </div>
                          <p className="text-[9px] text-violet-300 mt-1.5">멀티모델 파이프라인 (~20초)</p>
                        </div>
                      )}

                      {/* 고품질 응답 (우측) — 완료 */}
                      {msg.enhancedContent && (
                        <div className="flex-1 min-w-0 rounded-2xl px-3 py-2.5 text-sm bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-200 shadow-sm">
                          <p className="text-[9px] font-semibold text-violet-600 mb-1 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-violet-500 rounded-full" /> {AI_ORIGIN_TEXT} 정밀 분석
                          </p>
                          <div className="whitespace-pre-wrap text-violet-900 text-xs leading-relaxed">{msg.enhancedContent}</div>
                          <p className="text-[11px] text-violet-500 mt-1.5">{AI_ORIGIN_TEXT} 참고 — 최종 진단은 의사 상담</p>
                        </div>
                      )}
                    </div>

                    {/* UI 디렉티브 (하단 전폭) */}
                    {msg.uiDirective && (
                      <div className="ml-1">
                        <UiDirectiveRenderer
                          directive={msg.uiDirective}
                          onSelect={handleQuickReply}
                          isLast={i === messages.length - 1}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* 증상 칩 버튼 */}
            {!initializing && showSymptomChips && commonSymptoms.length > 0 && messages.length > 0 && !loading && (
              <div className="mt-3">
                <p className="text-xs text-gray-400 mb-2 ml-1">자주 묻는 증상을 선택하거나, 직접 입력해보세요</p>
                <div className="flex flex-wrap gap-1.5">
                  {commonSymptoms.map((s, i) => (
                    <button key={i} onClick={() => sendMessage(s.value)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-all shadow-sm">
                      <span>{s.icon}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 타이핑 인디케이터 */}
            {!initializing && loading && (
              <div className="flex justify-start">
                <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-gray-100">
                  <div className="flex items-center gap-1.5">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-gray-400 ml-2">{AI_ORIGIN_TEXT}가 분석 중입니다</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 입력 영역 */}
          <div className="border-t border-gray-100 p-3 bg-white">
            <div className="flex gap-2">
              <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && sendMessage()}
                placeholder="무엇이든 물어보세요... (예약, 검사결과, 투약, 병원안내)"
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 focus:bg-white transition-colors"
                disabled={loading} />
              <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-all active:scale-95">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">위루비병원 v1.1.0 · 개인정보처리방침</p>
      </div>
    </div>
  );
}

// ── UI 디렉티브 렌더러 ──
// ── 의료 WeRU.B 분석 카드 ──
function MedicalInsightCard({ insight }: { insight?: MedicalInsight }) {
  const [expanded, setExpanded] = useState(false);
  // 🔴 (2026-09-21) 종전엔 `answer` 가 없으면 카드가 **통째로 사라졌다** — 상류가 401/404 로 늘 실패해도
  //    화면은 침묵했고, 환자는 "참고 안내가 원래 없는 것"으로 읽었다. 미가용은 침묵이 아니라 한 줄로 말한다(출처 3상태).
  //    답은 지어내지 않는다 — 진료과 추천은 별개 경로(트리아지)라 그대로 유효하다.
  if (insight?.source === 'UNAVAILABLE') {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2" data-medical-insight="unavailable">
        <p className="text-[11px] text-gray-500">
          💡 {AI_ORIGIN_TEXT} 참고 안내를 지금은 얻지 못했습니다 — 위 진료과 추천은 그대로 유효합니다.
        </p>
      </div>
    );
  }
  if (!insight?.answer) return null;

  const categoryLabel: Record<string, string> = {
    emergency: '응급 분석',
    diagnosis: '감별진단 참고',
    clinical: '임상 참고',
    general: '건강 참고',
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-amber-600 text-xs">💡</span>
            <span className="text-xs font-semibold text-amber-800">
              AI {categoryLabel[insight.category ?? 'general'] ?? '의료 분석'}
            </span>
          </div>
          <svg className={`w-3.5 h-3.5 text-amber-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-amber-200">
          <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{insight.answer}</p>
          {insight.disclaimer && (
            <p className="text-[10px] text-amber-600 mt-2 leading-tight">{insight.disclaimer}</p>
          )}
        </div>
      )}
      {!expanded && (
        <p className="text-[10px] text-amber-600 mt-1">탭하여 상세 분석 보기</p>
      )}
    </div>
  );
}

function UiDirectiveRenderer({ directive, onSelect, isLast }: { directive: UiDirective; onSelect: (v: string) => void; isLast: boolean }) {
  if (!isLast) return null; // 마지막 메시지의 디렉티브만 인터랙티브

  switch (directive.type) {
    case 'QUICK_REPLIES': {
      const replies: QuickReply[] = Array.isArray(directive.payload) ? directive.payload as QuickReply[] : (directive.payload as unknown as Record<string, unknown>)?.quickReplies as QuickReply[] ?? [];
      return (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {replies.map((r, i) => (
            <button key={i} onClick={() => onSelect(r.value)}
              className="px-3 py-1.5 bg-white border border-blue-200 rounded-full text-xs text-blue-700 hover:bg-blue-50 hover:border-blue-400 transition-all shadow-sm active:scale-95">
              {r.icon && <span className="mr-1">{r.icon}</span>}
              {r.label}
            </button>
          ))}
        </div>
      );
    }

    case 'DEPT_CARDS': {
      const { departments, quickReplies, medicalInsight } = directive.payload as DeptCardsPayload;
      return (
        <div className="space-y-2 mt-1">
          <div className="grid gap-1.5">
            {departments.map((d, i) => (
              <button key={i} onClick={() => onSelect(i === 0 ? '네' : d.name)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all active:scale-[0.98] ${
                  i === 0
                    ? 'bg-blue-50 border-blue-300 hover:bg-blue-100'
                    : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      i === 0 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                    }`}>{d.priority}</span>
                    <div>
                      <p className={`text-sm font-semibold ${i === 0 ? 'text-blue-900' : 'text-gray-800'}`}>{d.name}</p>
                      <p className="text-[10px] text-gray-500">{d.reason}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs font-bold ${d.confidence >= 80 ? 'text-green-600' : d.confidence >= 60 ? 'text-yellow-600' : 'text-gray-500'}`}>
                      {d.confidence}%
                    </div>
                    {i === 0 && <span className="text-[9px] text-blue-500">추천</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {/* 의료 WeRU.B 분석 */}
          <MedicalInsightCard insight={medicalInsight} />
          {quickReplies && (
            <div className="flex flex-wrap gap-1.5">
              {quickReplies.map((r, i) => (
                <button key={i} onClick={() => onSelect(r.value)}
                  className={`px-3 py-1.5 rounded-full text-xs transition-all shadow-sm active:scale-95 ${
                    i === 0
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    case 'CONFIRM_BOOKING': {
      const { department, doctor, visitType, reason, quickReplies, medicalInsight } = directive.payload as ConfirmBookingPayload;
      return (
        <div className="space-y-2 mt-1">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-blue-800 mb-2">예약 정보 확인</p>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div><span className="text-gray-500">진료과</span> <span className="font-medium text-gray-800 ml-1">{department}</span></div>
              {doctor && <div><span className="text-gray-500">담당의</span> <span className="font-medium text-gray-800 ml-1">{doctor}</span></div>}
              <div><span className="text-gray-500">유형</span> <span className="font-medium text-gray-800 ml-1">{visitType === 'FOLLOW_UP' ? '재진' : '초진'}</span></div>
              <div className="col-span-2"><span className="text-gray-500">사유</span> <span className="font-medium text-gray-800 ml-1">{reason}</span></div>
            </div>
          </div>
          {/* 의료 WeRU.B 분석 */}
          <MedicalInsightCard insight={medicalInsight} />
          {quickReplies && (
            <div className="flex gap-2">
              {quickReplies.map((r, i) => (
                <button key={i} onClick={() => onSelect(r.value)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${
                    i === 0
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    case 'DATE_PICKER': {
      const { dates } = directive.payload as DatePickerPayload;
      return (
        <div className="space-y-2 mt-1">
          <div className="grid grid-cols-3 gap-1.5">
            {dates.map((d, i) => (
              <button key={i} onClick={() => onSelect(d.value)}
                className="flex flex-col items-center px-2 py-2.5 bg-white border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-300 transition-all active:scale-95">
                <span className="text-[10px] text-gray-400">{d.dayName}</span>
                <span className="text-sm font-semibold text-gray-800">{d.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    case 'TIME_PICKER': {
      const { times } = directive.payload as TimePickerPayload;
      return (
        <div className="space-y-2 mt-1">
          {times.map((period, pi) => (
            <div key={pi}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1 ml-0.5">{period.period}</p>
              <div className="grid grid-cols-4 gap-1.5">
                {period.slots.map((s, si) => (
                  <button key={si} onClick={() => onSelect(s.value)}
                    className="px-2 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-all active:scale-95">
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    case 'BOOKING_COMPLETE': {
      const p = directive.payload as BookingCompletePayload;
      return (
        <div className="mt-1 space-y-2">
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-sm font-bold text-green-800">예약이 확정되었습니다</p>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">진료과</span><span className="font-semibold text-gray-800">{p.department}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">담당의</span><span className="font-semibold text-gray-800">{p.doctor} 선생님</span></div>
              <div className="flex justify-between"><span className="text-gray-500">예약일시</span><span className="font-semibold text-gray-800">{p.date} {p.time}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">환자</span><span className="font-semibold text-gray-800">{p.patient} ({p.mrn})</span></div>
              {p.reason && <div className="flex justify-between"><span className="text-gray-500">사유</span><span className="font-medium text-gray-700">{p.reason}</span></div>}
            </div>
            <div className="mt-3 pt-2 border-t border-green-200">
              <p className="text-[10px] text-green-600">예약일에 내원하셔서 접수해주세요. 건강한 하루 되세요!</p>
            </div>
          </div>
          {/* 문진표 링크 */}
          {p.questionnaire && (
            <a href={p.questionnaire.url} target="_blank" rel="noopener noreferrer"
              className="block w-full text-center py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-all active:scale-[0.98]">
              📋 사전 문진표 작성하기 (내원 전 미리 작성)
            </a>
          )}
          {/* 다음 예약 안내 */}
          {p.nextBooking && (
            <div className="flex gap-2">
              {p.nextBooking.quickReplies.map((r, i) => (
                <button key={i} onClick={() => onSelect(r.value)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${
                    i === 0
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    case 'FOLLOW_UP_QUESTIONS': {
      const { questions } = directive.payload as FollowUpPayload;
      return (
        <div className="space-y-1.5 mt-1">
          {questions.map((q: FollowUpQuestion, i: number) => (
            <div key={i}>
              {q.options && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {q.options.map((opt: string, oi: number) => (
                    <button key={oi} onClick={() => onSelect(opt)}
                      className="px-3 py-1.5 bg-white border border-blue-200 rounded-full text-xs text-blue-700 hover:bg-blue-50 hover:border-blue-400 transition-all shadow-sm active:scale-95">
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'SHOW_DEPT_RECOMMENDATION':
    case 'AUTO_FILL_FORM':
    case 'SHOW_PATIENT_CARD':
    case 'SHOW_SEARCH_RESULTS':
    case 'NAVIGATE':
      return null; // 기존 디렉티브는 무시

    default:
      return null;
  }
}

// ══════════════════════════════════════════════
// WeRU.B 환자 컨시어지 — 인텐트 분류 + 데이터 핸들러
// ══════════════════════════════════════════════

type ConciergeIntent = 'HISTORY' | 'LAB_RESULT' | 'MEDICATION' | 'BILLING' | 'HOSPITAL_INFO' | 'VITAL' | 'BOOKING' | 'ADMISSION';

/**
 * 후처리 인텐트 감지: WeRU.B 응답 후, 사용자 메시지에서 데이터 보강이 필요한지 판단.
 * WeRU.B가 대화 맥락을 처리한 뒤에 호출되므로, "예약할께"는 WeRU.B가 예약 흐름으로 처리하고
 * 여기서는 순수 데이터 조회 질문만 감지.
 */
function detectPostResponseIntent(userMsg: string, aiResponse: string): ConciergeIntent | null {
  // 명시적 데이터 조회 의도 — 단독 키워드가 아닌 "~조회/확인/알려줘" 패턴
  if (/진료.*(내역|이력|기록)|치료.*받았|그동안.*진료/.test(userMsg)) return 'HISTORY';
  if (/검사.*(결과|나왔|확인)|혈액.*검사|피검사|검진.*결과/.test(userMsg)) return 'LAB_RESULT';
  // "약" 단독은 제외 — "복용약/처방약/먹는약" 등 명시적 투약 조회만
  if (/복용.*약|처방.*약|먹는.*약|투약.*정보|약.*목록|현재.*약|처방전/.test(userMsg)) return 'MEDICATION';
  if (/(진료비|수납).*(내역|확인|얼마)|미수납|영수증/.test(userMsg)) return 'BILLING';
  if (/진료.*시간|오시는.*길|주차.*안내|면회.*시간|몇.*층|층별.*안내/.test(userMsg)) return 'HOSPITAL_INFO';
  if (/혈압|맥박|체온|바이탈|활력.*징후|체중|BMI|산소.*포화/.test(userMsg)) return 'VITAL';
  if (/예약.*(확인|현황|조회)|다음.*예약|내.*예약/.test(userMsg)) return 'BOOKING';
  if (/입원.*(정보|현황|상태)|병실|주치의|퇴원/.test(userMsg)) return 'ADMISSION';

  // WeRU.B 응답에서 데이터 보강이 도움될지 판단
  if (/진료 내역|진료 기록/.test(aiResponse) && /확인|조회|보여/.test(userMsg)) return 'HISTORY';

  return null;
}

/** 인텐트별 데이터 조회 (WeRU.B 응답에 Rich Card 첨부) */
async function fetchConciergeData(
  intent: ConciergeIntent,
  apiUrl: string,
  token: string | null,
): Promise<RichData | undefined> {
  // 병원 안내는 인증 불필요
  if (intent === 'HOSPITAL_INFO') return { type: 'HOSPITAL_INFO' };
  /**
   * 🔴 portal EP 는 전부 인증 + 토큰 스코프(req.portalPatientId)다.
   *    종전엔 무인증으로 `?patientId=` 를 붙여 불렀는데 — ①토큰이 없어 전부 401
   *    ②patientId 쿼리는 서버가 읽지도 않는다(토큰 스코프) ③prescriptions·vitals·admission
   *    은 **존재하지 않는 EP**(404) — 8개 인텐트 카드가 개통 이래 한 번도 붙은 적이 없다.
   */
  if (!token) return undefined;
  const get = async (path: string) => {
    const res = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return res.json();
  };
  try {
    switch (intent) {
      case 'HISTORY': {
        const data = await get('/api/v1/portal/encounters?limit=10');
        const items = (data?.data ?? []) as Record<string, unknown>[];
        return items.length > 0 ? { type: 'ENCOUNTER_LIST', items: items.slice(0, 8) } : undefined;
      }
      case 'LAB_RESULT': {
        const data = await get('/api/v1/portal/lab-results?limit=10');
        const items = (data?.data ?? []) as Record<string, unknown>[];
        return items.length > 0 ? { type: 'LAB_TABLE', items: items.slice(0, 10), summary: `총 ${items.length}건` } : undefined;
      }
      case 'MEDICATION': {
        // 처방 원본이 아니라 포털 정본 「현재 복용약」(portal/medications) — prescriptions EP 는 없다
        const data = await get('/api/v1/portal/medications');
        const items = (data?.data ?? []) as Record<string, unknown>[];
        return items.length > 0 ? { type: 'MED_LIST', items: items.slice(0, 10) } : undefined;
      }
      case 'BILLING': {
        const data = await get('/api/v1/portal/billings?limit=10');
        const items = (data?.data ?? []) as Record<string, unknown>[];
        return items.length > 0 ? { type: 'BILLING_LIST', items: items.slice(0, 8) } : undefined;
      }
      case 'BOOKING': {
        const data = await get('/api/v1/portal/appointments?limit=5');
        const items = (data?.data ?? []) as Record<string, unknown>[];
        return items.length > 0 ? { type: 'APPOINTMENT_LIST', items } : undefined;
      }
      case 'VITAL':
      case 'ADMISSION':
        // 🔴 포털에 활력·입원 조회 EP 가 없다 — 없는 것을 부르는 척하지 않는다(카드 없이 텍스트 응답만)
        return undefined;
    }
  } catch { /* 데이터 조회 실패 시 Rich Card 없이 WeRU.B 응답만 표시 */ }
  return undefined;
}

/**
 * 병원 공통 안내 응답.
 *
 * 🔴 W9(P15 날조 / P12 정본이 둘, 운영 실측 2026-08-14): 이 함수가 CMS 정본과 다른 답을 지어내고 있었다.
 *   - 주차: "주차 시간 제한 없이 무료" ← CMS `PARKING/parking-guide` 정본은
 *           "최초 30분 무료, 이후 10분당 500원". 환자에게 돈이 드는 것을 공짜라고 말했다(가장 해로운 건).
 *   - 면회: "일반병동 18:00~20:00 / 중환자실 14:00~14:30, 19:00~19:30" ←
 *           CMS `GENERAL/visiting-hours` 정본은 "평일·주말 14:00~20:00, 환자당 2인 이내".
 *           헛걸음을 유발하는 정면 모순이라 챗봇이 시간을 단정하지 않게 한다.
 *   - 진료시간: 09:00~18:00 · 점심 12:30~14:00 ← CMS `GENERAL/operating-hours` 는 09:00~17:30 · 12:30~13:30.
 *   → 확실한 것(주소·대표전화)만 답하고, 자주 바뀌는 사실은 정본 상수 또는 해당 안내 페이지로 넘긴다.
 *     챗봇이 자기 버전의 병원 사실을 갖지 않게 하는 것이 핵심이다.
 */
function getHospitalInfoResponse(msg: string): string {
  const contact = `📞 ${HOSPITAL.phone}`;
  if (/진료.*시간|영업.*시간|휴진/.test(msg)) {
    // 🔴 T6(2026-09-15): 진료시간을 코드 상수(CLINIC_HOURS)로 단정하던 자리 — 병원이 CMS 에서 바꿔도 챗봇은 옛 시간을 말했다.
    //    주차·면회와 같은 방식으로 정본 안내 페이지(CMS `GENERAL/operating-hours`)로 넘긴다.
    return `🏥 ${HOSPITAL.name} 외래 진료시간\n\n진료시간은 병원이 관리하는 안내 페이지에서 확인해 주세요.\n진료과마다 요일별 진료가 다를 수 있어 예약 시 확인해 주세요.\n\n자세히: /care/schedule\n\n${contact}`;
  }
  if (/주차/.test(msg)) {
    return '🅿️ 주차 안내\n\n지하 1~3층 주차장을 운영합니다.\n주차 요금·할인(외래/입원 진료 시, 장애인·국가유공자 감면)은 안내 페이지에서 확인해 주세요.\n\n자세히: /guide/parking';
  }
  if (/면회/.test(msg)) {
    return '🏥 면회 안내\n\n면회 시간과 인원 제한은 감염관리 상황에 따라 달라집니다.\n최신 기준은 면회 안내 페이지에서 확인해 주세요.\n\n자세히: /guide/visiting\n' + contact;
  }
  if (/오시는.*길|위치|찾아가|교통/.test(msg)) {
    return `📍 오시는 길\n\n${HOSPITAL.address}\n\n🚗 가상공항에서: 평화로(1135) 이용 약 45분\n🚌 공항리무진 000번 → 가상관광단지 → 택시 10분\n\n자세히: /about/directions\n\n${contact}`;
  }
  if (/몇.*층|층별/.test(msg)) {
    return '🏥 층별 안내\n\n층별 시설 안내는 시설 안내 페이지에서 확인해 주세요.\n\n자세히: /about/facility';
  }
  if (/전화|연락/.test(msg)) {
    return `📞 연락처\n\n대표전화: ${HOSPITAL.phone}\n응급실 직통: ${HOSPITAL.emergencyPhone}\n서울사무소: ${HOSPITAL.seoulOffice}`;
  }
  return `🏥 ${HOSPITAL.name}\n\n📍 ${HOSPITAL.address}\n${contact}\n\n진료시간: /care/schedule\n\n궁금하신 사항을 구체적으로 물어봐주세요.\n(진료시간, 주차, 면회, 오시는 길, 층별 안내 등)`;
}

// ── Rich Response 카드 컴포넌트 ──
function ConciergeRichCard({ data }: { data: RichData }) {
  if (data.type === 'ENCOUNTER_LIST' && data.items) {
    return (
      <div className="mt-3 space-y-2">
        {data.items.map((e: any, i: number) => {
          const date = e.date || e.createdAt || e.appointmentDate || '';
          const dateStr = date ? new Date(date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '-';
          const doctor = e.doctor ? `${e.doctor.familyName || ''}${e.doctor.givenName || ''}` : '';
          const dept = e.departmentName || e.department || e.doctor?.department || '';
          const reason = e.chiefComplaint || e.reason || '';
          const status = e.status === 'SIGNED' ? '완료' : e.status === 'DRAFT' ? '작성중' : e.status === 'SCHEDULED' ? '예정' : '';
          return (
            <div key={e.id || i} className="flex items-center gap-3 p-2.5 bg-blue-50 rounded-xl border border-blue-100">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-xs font-bold text-blue-700 flex-shrink-0">{dateStr}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-900">{dept} {doctor && `· ${doctor}`}</p>
                {reason && <p className="text-[11px] text-gray-500 truncate">{reason}</p>}
              </div>
              {status && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${status === '완료' ? 'bg-green-100 text-green-700' : status === '예정' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{status}</span>}
            </div>
          );
        })}
      </div>
    );
  }

  if (data.type === 'LAB_TABLE' && data.items) {
    return (
      <div className="mt-3">
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 overflow-hidden">
          <div className="px-3 py-2 bg-emerald-100 flex items-center justify-between">
            <span className="text-[10px] font-bold text-emerald-800">검사 결과</span>
            {data.summary && <span className="text-[10px] text-emerald-600">{data.summary}</span>}
          </div>
          <div className="divide-y divide-emerald-100">
            {data.items.slice(0, 8).map((o: any, i: number) => {
              const name = (Array.isArray(o.items) && o.items.length ? o.items.slice(0, 3).map((t: any) => t.testName).filter(Boolean).join(', ') : '') || o.prescription?.medicationCode?.nameKo || o.testName || `검사 ${i + 1}`;
              const date = o.completedAt || o.updatedAt || '';
              const dateStr = date ? new Date(date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '';
              return (
                <div key={o.id || i} className="flex items-center justify-between px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{name}</p>
                    {dateStr && <p className="text-[10px] text-gray-400">{dateStr}</p>}
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">완료</span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">⚠️ 상세 결과 해석은 담당 의사와 상담하세요.</p>
      </div>
    );
  }

  if (data.type === 'MED_LIST' && data.items) {
    return (
      <div className="mt-3 space-y-2">
        {data.items.slice(0, 6).map((p: any, i: number) => {
          const medName = p.medicationCode?.nameKo || p.instructions || `처방 ${i + 1}`;
          const dosage = [p.dosage, p.frequency, p.route].filter(Boolean).join(' · ');
          return (
            <div key={p.id || i} className="p-2.5 bg-purple-50 rounded-xl border border-purple-100">
              <p className="text-xs font-bold text-gray-900">{medName}</p>
              {dosage && <p className="text-[10px] text-purple-600 mt-0.5">{dosage}</p>}
              {p.duration && <p className="text-[10px] text-gray-400">{p.duration}일분</p>}
            </div>
          );
        })}
        <p className="text-[10px] text-gray-400">💡 복용 관련 문의는 약사 또는 담당 의사에게 상담하세요.</p>
      </div>
    );
  }

  if (data.type === 'BILLING_LIST' && data.items) {
    return (
      <div className="mt-3">
        <div className="bg-amber-50 rounded-xl border border-amber-100 overflow-hidden">
          <div className="px-3 py-2 bg-amber-100">
            <span className="text-[10px] font-bold text-amber-800">수납 내역</span>
          </div>
          <div className="divide-y divide-amber-100">
            {data.items.slice(0, 6).map((b: any, i: number) => {
              const date = b.createdAt || b.date || '';
              const dateStr = date ? new Date(date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '';
              const total = b.totalAmount || b.patientCopay || 0;
              const status = b.status === 'PAID' ? '완료' : b.status === 'PENDING' ? '미수납' : (b.status || '');
              return (
                <div key={b.id || i} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <p className="text-xs font-medium text-gray-800">{dateStr}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-900">{Number(total ?? 0).toLocaleString()}<Unit>원</Unit></span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status === '완료' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (data.type === 'VITAL_LIST' && data.items) {
    const latest = data.items[0];
    if (!latest) return null;
    // 🔴 (2026-10-01) 화면 고유 임계(SBP≥140·SpO2<94…)를 걷어내고 임계 정본(shared 코드 기본값)으로 판정한다.
    //    공개(환자) 화면이라 직원용 개정 임계 EP 를 부르지 않는다 — 기본값 기준이다. `?? 0` 폴백은 미측정을 정상으로 접었다.
    const n = (x: unknown) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
    const pf = vitalItemFlags({ systolicBp: n(latest.systolicBp), diastolicBp: n(latest.diastolicBp), heartRate: n(latest.heartRate), temperature: n(latest.temperature), spo2: n(latest.spo2) });
    const off = (f: VitalItemFlag) => f === 'CRITICAL' || f === 'WARNING';
    const vitals = [
      { label: '혈압', value: latest.systolicBp ? `${latest.systolicBp}/${latest.diastolicBp}` : null, unit: 'mmHg', warn: off(worseVitalFlag(pf.systolicBp, pf.diastolicBp)) },
      { label: '맥박', value: latest.heartRate, unit: 'bpm', warn: off(pf.heartRate) },
      { label: '체온', value: latest.temperature, unit: '°C', warn: off(pf.temperature) },
      { label: 'SpO2', value: latest.spo2, unit: '%', warn: off(pf.spo2) },
      { label: '체중', value: latest.weight, unit: 'kg', warn: false },
      { label: 'BMI', value: latest.bmi, unit: '', warn: Number(latest.bmi ?? 0) >= 30 },
    ].filter(v => v.value != null);
    return (
      <div className="mt-3 bg-rose-50 rounded-xl border border-rose-100 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[10px] font-bold text-rose-800">바이탈 정보</span>
          {latest.measuredAt && <span className="text-[10px] text-rose-500">{new Date(latest.measuredAt).toLocaleDateString('ko-KR')}</span>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {vitals.map((v: { label: string; value: any; unit: string; warn: boolean }) => (
            <div key={v.label} className={`text-center p-1.5 rounded-lg ${v.warn ? 'bg-red-100' : 'bg-white'}`}>
              <p className="text-[10px] text-gray-400">{v.label}</p>
              <p className={`text-xs font-bold ${v.warn ? 'text-red-600' : 'text-gray-900'}`}>{v.value}{v.unit && <span className="text-[9px] text-gray-400 ml-0.5">{v.unit}</span>}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (data.type === 'APPOINTMENT_LIST' && data.items) {
    return (
      <div className="mt-3 space-y-2">
        {data.items.slice(0, 5).map((a: any, i: number) => {
          const date = a.scheduledAt || a.appointmentDate || '';
          const dateStr = date ? new Date(date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' }) : '-';
          const timeStr = date ? localeTimeText(new Date(date), 'ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
          const doctor = a.doctor ? `${a.doctor.familyName || ''}${a.doctor.givenName || ''}` : '';
          const dept = a.doctor?.department || '';
          const statusMap: Record<string, { label: string; color: string }> = {
            SCHEDULED: { label: '예정', color: 'bg-blue-100 text-blue-700' },
            CHECKED_IN: { label: '접수', color: 'bg-emerald-100 text-emerald-700' },
            COMPLETED: { label: '완료', color: 'bg-gray-100 text-gray-600' },
            CANCELLED: { label: '취소', color: 'bg-red-100 text-red-600' },
          };
          const st = statusMap[a.status] ?? { label: a.status, color: 'bg-gray-100 text-gray-600' };
          return (
            <div key={a.id || i} className="flex items-center gap-3 p-2.5 bg-indigo-50 rounded-xl border border-indigo-100">
              <div className="w-12 h-12 bg-indigo-100 rounded-lg flex flex-col items-center justify-center flex-shrink-0">
                <p className="text-[10px] text-indigo-500">{dateStr}</p>
                <p className="text-xs font-bold text-indigo-700">{timeStr}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-900">{dept} {doctor && `· ${doctor}`}</p>
                {a.reason && <p className="text-[10px] text-gray-500 truncate">{a.reason}</p>}
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.color}`}>{st.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (data.type === 'ADMISSION_INFO' && (data.items?.[0] || (data as any).item)) {
    const a = data.items?.[0] || (data as any).item;
    if (!a) return null;
    const days = stayDays(a.admitDate) ?? 0; // 재원일수 정본(max(1,ceil))
    const doc = a.attendingDoctor || a.admittingDoctor;
    return (
      <div className="mt-3 bg-cyan-50 rounded-xl border border-cyan-100 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-cyan-800">입원 정보</span>
          <span className="text-[10px] bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded-full">{days}일차</span>
        </div>
        <div className="text-xs text-gray-700 space-y-0.5">
          {a.bed && <p>병실: {a.bed.ward?.name ?? ''} {a.bed.roomNumber ?? ''}-{a.bed.bedNumber ?? ''}</p>}
          {doc && <p>주치의: {doc.familyName}{doc.givenName} ({doc.department ?? ''})</p>}
          {a.admitReason && <p>입원 사유: {a.admitReason}</p>}
          {a.dietType && <p>식이: {a.dietType}</p>}
        </div>
      </div>
    );
  }

  return null;
}
