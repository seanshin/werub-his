'use client';

import { use, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useAuthStore } from '@/stores/auth-store';
import PatientInfoPanel from './_components/PatientInfoPanel';
import type { TelehealthSession, PatientSummary, UserRole } from './_components/types';
import { T } from '@/components/ui/i18n-text';
import { VideoLinkStatus, deriveVideoLinkView, useBrowserOnline, usePopupWindowState } from '@/components/telehealth/VideoLinkStatus';

const DoctorChart = dynamic(() => import('./_components/DoctorChart'));
const NurseChart = dynamic(() => import('./_components/NurseChart'));
const PharmacistChart = dynamic(() => import('./_components/PharmacistChart'));

export default function VideoSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const [showChart, setShowChart] = useState(true);
  const actualRole = (useAuthStore(s => s.user?.role) ?? 'DOCTOR') as UserRole;
  const isAdmin = actualRole === 'ADMIN';
  const [adminViewRole, setAdminViewRole] = useState<'DOCTOR' | 'NURSE' | 'PHARMACIST'>('DOCTOR');
  const userRole = isAdmin ? actualRole : actualRole; // 실제 역할 유지
  const viewRole = isAdmin ? adminViewRole : actualRole; // 차트 표시용 역할

  const { data, isError, error, refetch } = useQuery({
    queryKey: ['telehealth-session', sessionId],
    queryFn: () => apiClient.get<{ data: TelehealthSession }>(`/api/v1/telehealth/sessions/${sessionId}`),
    refetchInterval: 5000,
  });
  const session = (data?.data as { data?: TelehealthSession })?.data ?? data?.data as TelehealthSession | undefined;
  const patientId = session?.patient?.id;

  const { data: summaryData, isError: summaryIsError, error: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ['patient-summary-tele', patientId],
    queryFn: () => apiClient.get<{ data: PatientSummary }>(`/api/v1/patients/${patientId}/summary`),
    enabled: !!patientId,
  });
  const summary = (summaryData?.data as { data?: PatientSummary })?.data ?? summaryData?.data as PatientSummary | null;

  const startMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/telehealth/sessions/${sessionId}/start`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['telehealth-session', sessionId] }); toast.success('진료를 시작합니다.'); },
  });
  const endMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/telehealth/sessions/${sessionId}/end`, { notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['telehealth-session', sessionId] }); toast.success('진료가 종료되었습니다.'); },
  });

  const isActive = session?.status === 'IN_PROGRESS';
  const isWaiting = session?.status === 'WAITING' || session?.status === 'SCHEDULED';

  // Jitsi 화상
  const roomName = session?.roomId ?? `hr-${sessionId.slice(0, 8)}`;
  const jitsiBase = process.env.NEXT_PUBLIC_JITSI_URL || '/meet';
  const [videoOpened, setVideoOpened] = useState(false);
  // 🔴 window.open 반환값 — null 이면 팝업 차단. 부른 사실만으로 '진행 중'이라 말하지 않는다(VideoLinkStatus)
  const [videoWindow, setVideoWindow] = useState<Window | null>(null);
  const online = useBrowserOnline();
  const windowState = usePopupWindowState(videoWindow, videoOpened);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [showConsentDialog, setShowConsentDialog] = useState(false);

  // 권한 없는 역할 차단 — 모든 hook 호출 이후(React #300 방지)
  if (userRole === 'LAB_TECH' || userRole === 'STAFF') {
    return (
      <div className="h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-4xl">🚫</p>
          <p className="text-lg font-bold text-gray-900"><T k="원격진료 참여 권한이 없습니다" /></p>
          <p className="text-sm text-gray-500">{userRole === 'LAB_TECH' ? '검사실' : '직원'} 계정은 원격진료에 참여할 수 없습니다.</p>
          <Link href="/telehealth" className="inline-block px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><T k="목록으로" /></Link>
        </div>
      </div>
    );
  }

  const buildJitsiUrl = (token?: string) => {
    const base = jitsiBase.startsWith('http') ? jitsiBase : `${typeof window !== 'undefined' ? window.location.origin : ''}${jitsiBase}`;
    return token ? `${base}/${roomName}?jwt=${token}` : `${base}/${roomName}`;
  };
  const openVideoCall = async () => {
    try {
      const res = await apiClient.get<{ data: { token: string } }>(`/api/v1/telehealth/sessions/${sessionId}/jitsi-token`);
      const jitsiToken = (res?.data as { data?: { token?: string } })?.data?.token ?? (res?.data as { token?: string })?.token;
      setVideoWindow(window.open(buildJitsiUrl(jitsiToken), 'telehealth-video', 'width=800,height=600'));
      setVideoOpened(true);
    } catch {
      setVideoWindow(window.open(buildJitsiUrl(), 'telehealth-video', 'width=800,height=600'));
      setVideoOpened(true);
    }
  };
  const copyPatientLink = async () => {
    try {
      const res = await apiClient.get<{ data: { token: string } }>(`/api/v1/telehealth/sessions/${sessionId}/patient-token`);
      const token = (res?.data as { data?: { token?: string } })?.data?.token ?? (res?.data as { token?: string })?.token;
      navigator.clipboard.writeText(buildJitsiUrl(token));
      toast.success('환자용 화상 링크가 복사되었습니다.');
    } catch {
      navigator.clipboard.writeText(buildJitsiUrl());
      toast.success('화상 링크가 복사되었습니다.');
    }
  };
  const openSecondMonitor = () => {
    if (!patientId) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') ?? '' : '';
    window.open(`/patients/${patientId}#auth=${encodeURIComponent(token)}`, '_blank');
  };

  // 역할 배지
  const roleBadge: Record<string, { label: string; cls: string }> = {
    DOCTOR: { label: '의사', cls: 'bg-blue-100 text-blue-700' },
    NURSE: { label: '간호사', cls: 'bg-emerald-100 text-emerald-700' },
    PHARMACIST: { label: '약사', cls: 'bg-purple-100 text-purple-700' },
    ADMIN: { label: '관리자', cls: 'bg-gray-100 text-gray-600' },
  };
  const badge = isAdmin
    ? { label: `관리자 (${roleBadge[viewRole]?.label ?? '의사'} 뷰)`, cls: 'bg-gray-100 text-gray-600' }
    : roleBadge[userRole] ?? roleBadge.DOCTOR;

  const chartProps = { session: session!, summary, patientId, sessionId, notes, setNotes, isActive };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* 녹화 동의 다이얼로그 */}
      {showConsentDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3"><T k="⏺ 원격진료 녹화 동의" /></h3>
            <div className="text-sm text-gray-600 space-y-2 mb-4">
              <p><T k="원격진료 내용을 녹화하려면 환자의 동의가 필요합니다." /></p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
                <p className="font-bold text-amber-800 mb-1"><T k="의료법 제17조 및 개인정보보호법" /></p>
                <ul className="text-amber-700 space-y-0.5 list-disc pl-4">
                  <li><T k="녹화 영상은 의무기록의 일부로 보존됩니다" /></li>
                  <li><T k="보존 기간: 진료기록 10년 (의료법 시행규칙)" /></li>
                  <li><T k="환자 본인 또는 법정 대리인의 동의가 필요합니다" /></li>
                  <li><T k="동의 없이 녹화할 수 없습니다" /></li>
                </ul>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowConsentDialog(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"><T k="취소" /></button>
              <button onClick={() => { setRecordingConsent(true); setShowConsentDialog(false); toast.success('녹화 동의 확인됨'); }} className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700"><T k="환자 동의 확인" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 헤더 */}
      <div className="bg-white border-b px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/telehealth" className="p-1.5 hover:bg-gray-100 rounded-lg">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <div>
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              📹 화상진료 — {session?.patient?.familyName}{session?.patient?.givenName}
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${badge.cls}`}><T k={badge.label} /></span>
            </h2>
            <p className="text-[10px] text-gray-400">{session?.patient?.mrn} | {session?.doctor?.department} {session?.doctor?.familyName}{session?.doctor?.givenName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 관리자 역할 전환 */}
          {isAdmin && (
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              {([
                { key: 'DOCTOR' as const, label: '의사', icon: '🩺' },
                { key: 'NURSE' as const, label: '간호사', icon: '💉' },
                { key: 'PHARMACIST' as const, label: '약사', icon: '💊' },
              ]).map(r => (
                <button key={r.key} onClick={() => setAdminViewRole(r.key)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${adminViewRole === r.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {r.icon} {r.label}
                </button>
              ))}
            </div>
          )}
          {patientId && (
            <button onClick={openSecondMonitor} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200"><T k="🖥️ 두번째 모니터" /></button>
          )}
          <button onClick={() => setShowChart(!showChart)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${showChart ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={showChart ? '차트 접기' : '차트 펼치기'} />
          </button>
          {isWaiting && (userRole === 'DOCTOR' || userRole === 'ADMIN') && (
            <button onClick={() => startMut.mutate()} disabled={startMut.isPending} className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"><T k="진료 시작" /></button>
          )}
          {isActive && (userRole === 'DOCTOR' || userRole === 'ADMIN') && (
            <button onClick={() => endMut.mutate()} disabled={endMut.isPending} className="px-4 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 disabled:opacity-50"><T k="진료 종료" /></button>
          )}
        </div>
      </div>

      {/* 화상 연결 바 */}
      <div className="bg-gray-900 px-6 py-3 flex items-center justify-between shrink-0">
        {isActive ? (
          <>
            <VideoLinkStatus view={deriveVideoLinkView({ online, window: windowState })} text={(k) => <T k={k} />} />
            <div className="flex items-center gap-2">
              <button onClick={openVideoCall} className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700">
                📹 <T k={videoOpened ? '화상 창 다시 열기' : '화상 연결 시작'} />
              </button>
              {(userRole === 'DOCTOR' || userRole === 'ADMIN') && (
                <button onClick={copyPatientLink} className="px-3 py-2 bg-gray-700 text-gray-300 text-xs rounded-lg hover:bg-gray-600"><T k="📋 링크 복사" /></button>
              )}
              {(userRole === 'DOCTOR' || userRole === 'ADMIN') && (
                !recordingConsent ? (
                  <button onClick={() => setShowConsentDialog(true)} className="px-3 py-2 bg-gray-700 text-gray-300 text-xs rounded-lg hover:bg-gray-600"><T k="⏺ 녹화 동의" /></button>
                ) : (
                  <span className="px-3 py-2 bg-red-900/50 text-red-300 text-xs rounded-lg flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" /><T k="녹화 동의 완료" />
                  </span>
                )
              )}
            </div>
          </>
        ) : isWaiting ? (
          <div className="flex items-center gap-3 w-full justify-center">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
            <span className="text-white text-sm font-medium"><T k="대기 중 — &ldquo;진료 시작&rdquo; 버튼을 누르세요" /></span>
            {session?.chiefComplaint && <span className="text-blue-400 text-xs bg-blue-900/30 px-2 py-1 rounded">주호소: {session.chiefComplaint}</span>}
          </div>
        ) : (
          <span className="text-gray-500 text-sm w-full text-center"><T k="진료가 종료되었습니다." /></span>
        )}
      </div>

      {/* 역할별 차트 */}
      {showChart && session && (
        <div className="flex-1 bg-white border-t overflow-hidden">
          <div className="h-full flex">
            {/* 🔴 환자 요약(알레르기·투약 포함) 조회 실패를 빈 패널로 넘기지 않는다 */}
            {summaryIsError && (
              <div className="w-64 shrink-0 border-r p-3">
                <QueryErrorFallback error={summaryError} onRetry={refetchSummary} size="compact" />
              </div>
            )}
            {!summaryIsError && <PatientInfoPanel session={session} summary={summary} role={viewRole as UserRole} />}
            {(viewRole === 'DOCTOR') && <DoctorChart {...chartProps} />}
            {viewRole === 'NURSE' && <NurseChart {...chartProps} />}
            {viewRole === 'PHARMACIST' && <PharmacistChart {...chartProps} />}
          </div>
        </div>
      )}
    </div>
  );
}
