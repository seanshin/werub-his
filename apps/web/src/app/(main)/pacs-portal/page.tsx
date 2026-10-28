'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { openPacsViewer } from '@/lib/pacs';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState } from '@/components/ui/display';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

/**
 * PACS 주치의 포털 — **HIS 계정이 아니라 PACS(OpenPACS) 계정으로 따로 로그인하는 유일한 화면.**
 *
 * 🔴 왜 아직 HIS 프록시(`/api/v1/pacs/*`)로 이관하지 못했는가 (2026-08-18 실측 결론):
 *    이 화면이 쓰는 `GET /api/v1/my-patients` 는 "내 환자"를 **PACS 쪽 로그인 신원**으로 판정한다.
 *    HIS 프록시에는 대응 EP 가 없고, HIS 가 대신 부르려면 "이 HIS 의사의 환자"를 **HIS 가 정의**해
 *    넘기는 설계가 먼저 있어야 한다(주치의? 오더 발행의? 진료과?). 그건 코드가 아니라 결정이다.
 *    → 이관(EP 교체)도 통폐합(`/workstation/reading` 은 판독의가 **쓰는** 큐라 대체 불가)도 아닌
 *      **현행 유지**가 결론이다. 대신 화면이 사실을 말하게 한다.
 *
 * 🔴 화면이 말해야 하는 사실:
 *    1) 왜 또 로그인해야 하는지 (지금까지는 이유 없이 로그인 창만 떴다)
 *    2) PACS 자체가 닿지 않으면 **로그인해도 실패한다**는 것 (HIS 프록시 health 로 확인)
 *    3) 조회 실패는 "영상 없음"이 아니다 (401/5xx 를 빈 목록으로 삼키지 않는다)
 */
const PACS_API = '/pacs-api/api/v1';
/** 판독 상태 필터 라벨 — 표시 전용(값은 `status` 코드) */
const STATUS_FILTER_LABEL: Record<'all' | 'unread' | 'completed', string> = { all: '전체', unread: '미판독', completed: '판독완료' };

interface Study {
  study_instance_uid: string;
  patient_id: string;
  patient_name: string;
  modality: string;
  study_description: string;
  study_date: string;
  accession_number: string;
  read_status: string;
  report_id?: string;
  findings?: string;
  impression?: string;
  urgency?: string;
  viewer_url: string;
  report_url?: string;
}

interface Report {
  id: string;
  findings: string;
  impression: string;
  recommendation: string;
  urgency: string;
  status: string;
  author_name: string;
  signed_at: string;
}

export default function PacsPortalPage() {
  // 오류 문구는 **설정 시점에** 번역해 상태에 담는다(표시 전용 상태 — 서버로 보내지 않는다).
  //    PACS 가 준 `detail` 은 서버 문장이라 번역하지 않는다(§12-G).
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [pacsToken, setPacsToken] = useState('');
  const [status, setStatus] = useState<'unread' | 'completed' | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedStudy, setSelectedStudy] = useState<Study | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportError, setReportError] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  /** 세션이 끊겨 로그인 화면으로 돌아왔다는 사실 — 조용히 되돌리면 사용자는 "왜?"를 모른다 */
  const [sessionExpired, setSessionExpired] = useState(false);
  const [pdfError, setPdfError] = useState('');

  useEffect(() => {
    const t = localStorage.getItem('pacs-token');
    if (t) setPacsToken(t);
  }, []);

  /**
   * PACS 가용성은 **HIS 프록시로** 확인한다(브라우저가 PACS 를 직접 두드리지 않는다).
   * 이 값이 없으면 로그인 실패가 '비밀번호가 틀림'인지 'PACS 가 죽음'인지 구분할 수 없다.
   */
  const { data: healthRes, isError: healthFailed } = useQuery({
    queryKey: ['pacs-health'],
    queryFn: () => apiClient.get<{ data: { status?: string } }>('/api/v1/pacs/health'),
    refetchInterval: pollMs('slow'),
  });
  const pacsStatus: 'ok' | 'down' | 'unknown' =
    healthFailed ? 'down'
      : healthRes?.data?.status === 'ok' ? 'ok'
      : healthRes?.data?.status ? 'down'
      : 'unknown';

  const handleLogin = async () => {
    setLoginError('');
    setSessionExpired(false);
    try {
      const res = await fetch(`${PACS_API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const data = await res.json().catch(() => ({} as { access_token?: string; detail?: string }));
      if (res.ok && data.access_token) {
        setPacsToken(data.access_token);
        localStorage.setItem('pacs-token', data.access_token);
        return;
      }
      // 🔴 실패 사유를 뭉뚱그리지 않는다 — 자격 오류와 서버 장애는 사용자가 할 일이 다르다.
      if (res.status === 401 || res.status === 403) {
        setLoginError(tAttr('PACS 계정 또는 비밀번호가 맞지 않습니다. (HIS 계정과 다른 계정입니다)'));
      } else if (res.status >= 500 || res.status === 502 || res.status === 503) {
        setLoginError(tfAttr('영상 보관 시스템(PACS)이 응답하지 않습니다 (HTTP {상태}). 계정 문제가 아닙니다.', { 상태: res.status }));
      } else {
        setLoginError(data.detail
          ? tfAttr('로그인 실패 (HTTP {상태}) — {사유}', { 상태: res.status, 사유: data.detail })
          : tfAttr('로그인 실패 (HTTP {상태})', { 상태: res.status }));
      }
    } catch {
      setLoginError(tAttr('영상 보관 시스템(PACS)에 연결하지 못했습니다. 계정 문제가 아닙니다.'));
    }
  };

  const logout = (expired = false) => {
    setPacsToken('');
    localStorage.removeItem('pacs-token');
    setSelectedStudy(null);
    setReport(null);
    setSessionExpired(expired);
  };

  const { data: studies = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pacs-studies', status, search, pacsToken],
    queryFn: async () => {
      if (!pacsToken) return [];
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (search) params.set('search', search);
      params.set('page_size', '50');
      const res = await fetch(`${PACS_API}/my-patients?${params}`, {
        headers: { Authorization: `Bearer ${pacsToken}` },
      });
      if (!res.ok) {
        // 401 = PACS 세션 만료. 로그인 화면으로 돌리되 **왜 돌아왔는지 말한다**.
        if (res.status === 401) { logout(true); return []; }
        // 🔴 오류를 빈 배열로 삼키면 "영상이 없습니다"로 표시된다(과거 '상시 영상 없음' 실결함과 동형).
        throw new Error(tfAttr('PACS 조회 실패 ({상태}) — 영상이 없는 것이 아니라 불러오지 못했습니다.', { 상태: res.status }));
      }
      const data = await res.json();
      return data.studies || [];
    },
    enabled: !!pacsToken,
    refetchInterval: pollMs('normal'),
  });

  const fetchReport = async (studyUid: string) => {
    // 🔴 요청 전 이전 소견을 비운다 — 남겨두면 B 환자 헤더 아래 A 환자 소견이 표시된다(오귀속·P12).
    setReport(null);
    setReportError(false);
    setPdfError('');
    const res = await fetch(`${PACS_API}/my-patients/report/${studyUid}`, {
      headers: { Authorization: `Bearer ${pacsToken}` },
    });
    if (res.ok) setReport(await res.json());
    else setReportError(true);
  };

  /**
   * 판독지 PDF — 🔴 종전에는 `<a href={PACS_API}/…/pdf>` 였다. 앵커는 **Authorization 헤더를
   * 실을 수 없어** PACS 가 항상 401 을 돌려준다(실측: 이 경로는 무인증 401). 즉 개통 이래
   * 한 번도 열린 적이 없는 버튼이었다. 토큰을 실어 받아오고, 실패는 실패라고 말한다.
   */
  const openReportPdf = async (studyUid: string) => {
    setPdfError('');
    let res: Response;
    try {
      res = await fetch(`${PACS_API}/my-patients/report/${studyUid}/pdf`, {
        headers: { Authorization: `Bearer ${pacsToken}` },
      });
    } catch {
      setPdfError(tAttr('PACS 에 연결하지 못해 판독지를 받지 못했습니다.'));
      return;
    }
    if (res.status === 401) { logout(true); return; }
    if (res.status === 404) { setPdfError(tAttr('이 검사에는 판독지 파일이 없습니다.')); return; }
    if (!res.ok) { setPdfError(tfAttr('판독지를 받지 못했습니다 (HTTP {상태}). 판독지가 없는 것이 아닙니다.', { 상태: res.status })); return; }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/pdf')) {
      // PACS 가 PDF 가 아닌 것(오류 페이지·HTML)을 200 으로 주면 그대로 열지 않는다(저장형 XSS 경로).
      setPdfError(tAttr('PACS 가 PDF 가 아닌 응답을 보냈습니다 — 영상팀에 문의하세요.'));
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (!pacsToken) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
          <h1 className="text-xl font-bold text-gray-900 mb-1 text-center"><T k="PACS 주치의 포털" /></h1>
          <p className="text-sm text-gray-500 text-center mb-5"><T k="내 환자 영상 판독 결과 조회" /></p>

          {sessionExpired && (
            <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              <T k="PACS 세션이 만료되어 로그아웃되었습니다. 다시 로그인하세요." />
            </div>
          )}

          {/* 🔴 "왜 또 로그인?" 에 답한다 — 종전에는 이유 없이 로그인 창만 떴다. */}
          <div className="mb-4 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2.5 text-[11px] leading-relaxed text-blue-900">
            <p className="font-semibold mb-1"><T k="이 화면은 HIS 계정으로 로그인되지 않습니다" /></p>
            {/* 강조(<b>)가 문장 가운데 걸린 문장 — 노드 자리표시자로 한 키(어순은 번역문이 정한다). 키에 HTML 엔티티를 쓰지 않는다 */}
            <p>
              <Tf k="‘내 환자’ 목록을 {판정}하기 때문에, HIS 로그인만으로는 이 목록을 만들 수 없습니다. PACS 계정은 {발급처}이 발급합니다."
                params={{ 판정: <b><T k="PACS(영상보관시스템)가 자신의 로그인 계정으로 판정" /></b>, 발급처: <b><T k="영상팀(PACS 관리자)" /></b> }} />
            </p>
            <p className="mt-1">
              <Tf k="계정이 없다면 HIS 안의 {영상실} 또는 {차트영상} 에서 같은 영상·판독문을 볼 수 있습니다 (환자 단위 조회)."
                params={{ 영상실: <b><T k="영상실" /></b>, 차트영상: <b><T k="환자 차트 > 영상" /></b> }} />
            </p>
          </div>

          {/* PACS 자체가 닿지 않으면 로그인해도 실패한다 — 그 사실을 미리 말한다. */}
          {pacsStatus === 'down' && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              <Tf k="지금 영상 보관 시스템(PACS)에 연결되지 않습니다 — {경고} 영상팀에 문의하세요." params={{ 경고: <b><T k="로그인해도 실패합니다." /></b> }} />
            </div>
          )}

          <div className="space-y-3">
            <input type="text" placeholder={tAttr('PACS 사용자명')} value={loginForm.username}
              onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
              className="w-full border rounded-lg px-3 py-2" />
            <input type="password" placeholder={tAttr('PACS 비밀번호')} value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              className="w-full border rounded-lg px-3 py-2" />
            {loginError && <p className="text-red-500 text-xs">{loginError}</p>}
            <button onClick={handleLogin} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700"><T k="로그인" /></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="PACS 주치의 포털" /></h1>
          <p className="text-sm text-gray-500"><T k="내 환자 영상 판독 결과 조회 · PACS 계정으로 별도 로그인됨" /></p>
        </div>
        <button onClick={() => logout(false)}
          className="text-sm text-gray-500 hover:text-red-600"><T k="로그아웃" /></button>
      </div>

      {pacsStatus === 'down' && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <T k="영상 보관 시스템(PACS) 연결이 확인되지 않습니다 — 아래 목록이 최신이 아닐 수 있습니다." />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex rounded-lg border overflow-hidden">
          {(['all', 'unread', 'completed'] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium ${status === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <T k={STATUS_FILTER_LABEL[s]} />
            </button>
          ))}
        </div>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={tAttr('환자명 또는 번호 검색')} className="border rounded-lg px-3 py-1.5 text-sm w-60" />
      </div>

      {/* Study List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2 max-h-[70vh] overflow-y-auto">
          {isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : isLoading ? <p className="text-gray-400 text-center py-8"><T k="로딩 중..." /></p> : studies.length === 0 ? (
            <EmptyState
              icon="🩻"
              title="이 PACS 계정의 '내 환자' 영상이 없습니다"
              hint="목록 범위는 HIS 담당의가 아니라 PACS 로그인 계정으로 정해집니다"
            />
          ) : (studies as Study[]).map((s) => (
            <div key={s.study_instance_uid}
              onClick={() => { setSelectedStudy(s); setPdfError(''); if (s.read_status === 'completed') fetchReport(s.study_instance_uid); else { setReport(null); setReportError(false); } }}
              className={`p-3 rounded-xl border cursor-pointer transition ${selectedStudy?.study_instance_uid === s.study_instance_uid ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                  s.read_status === 'completed' ? 'bg-green-100 text-green-700' :
                  s.read_status === 'unread' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                }`}>
                  {s.read_status === 'completed' ? <T k="완료" /> : s.read_status === 'unread' ? <T k="미판독" /> : s.read_status}
                </span>
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold">{s.modality}</span>
                {s.urgency === 'urgent' && <span className="px-1.5 py-0.5 bg-red-500 text-white rounded text-[10px] font-bold"><T k="긴급" /></span>}
              </div>
              <p className="text-sm font-semibold text-gray-900">{s.patient_name} ({s.patient_id})</p>
              <p className="text-xs text-gray-500">{s.study_description} — {s.study_date?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}</p>
              {s.impression && <p className="text-xs text-gray-600 mt-1 truncate">{s.impression}</p>}
            </div>
          ))}
        </div>

        {/* Detail Panel */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 sticky top-4">
          {!selectedStudy ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-2">🩻</p>
              <p><T k="영상을 선택하세요" /></p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-gray-900">{selectedStudy.patient_name}</h3>
                  <p className="text-xs text-gray-500">{selectedStudy.patient_id} | {selectedStudy.modality} | {selectedStudy.study_description}</p>
                </div>
                {/*
                  🔴 뷰어는 공용 헬퍼로만 연다. PACS 가 준 `viewer_url` 을 그대로 열었을 때 그 값이
                     Orthanc 경로면 HIS 와 무관한 Basic 인증 창이 뜬다 — 소스 가드는 런타임 값을
                     볼 수 없다. 헬퍼는 HIS 프록시가 발급한 OHIF URL 을 연다.
                */}
                <button type="button" onClick={() => openPacsViewer(selectedStudy.study_instance_uid)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-700">
                  <T k="영상 뷰어" />
                </button>
              </div>

              {report ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-bold text-gray-500 mb-1"><T k="소견 (Findings)" /></p>
                    <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{report.findings || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 mb-1"><T k="인상 (Impression)" /></p>
                    <p className="text-sm text-gray-900 bg-blue-50 rounded-lg p-3 font-medium whitespace-pre-wrap">{report.impression || '-'}</p>
                  </div>
                  {report.recommendation && (
                    <div>
                      <p className="text-xs font-bold text-gray-500 mb-1"><T k="권고사항" /></p>
                      <p className="text-sm text-gray-800 bg-yellow-50 rounded-lg p-3">{report.recommendation}</p>
                    </div>
                  )}
                  <div className="text-xs text-gray-400 pt-2 border-t">
                    <Tf k="판독의: {판독의} | 서명: {서명}" params={{ 판독의: report.author_name, 서명: report.signed_at ? kdate(report.signed_at, 'datetimeSec') : '-' }} />
                  </div>
                  <button type="button" onClick={() => openReportPdf(selectedStudy.study_instance_uid)}
                    className="inline-block px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-lg font-medium hover:bg-gray-200">
                    <T k="판독지 PDF" />
                  </button>
                  {pdfError && <p className="text-xs text-red-600 mt-1">{pdfError}</p>}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 text-sm">
                  {reportError ? <T k="판독 결과를 불러오지 못했습니다 — 판독 결과가 없는 것이 아닙니다. 다시 선택해 재시도하세요" />
                    : selectedStudy.read_status === 'unread' ? <T k="아직 판독되지 않았습니다" />
                    : selectedStudy.read_status === 'completed' ? <T k="판독 결과를 불러오는 중..." />
                    : <Tf k="판독 상태: {상태}" params={{ 상태: selectedStudy.read_status }} />}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
