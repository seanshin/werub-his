'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { PT, usePortalTAttr } from '../_shared/PT';

// 🔴 영상 조회·업로드는 HIS 프록시(`/api/v1/portal/imaging/*`)로만 한다 — 직접 호출은 HIS 인증·감사를
//    우회하고, 실패를 삼키면 환자에게 "영상 없음"으로 보인다(W9 에서 서버는 이미 정직해졌는데
//    화면이 옛 경로를 계속 불러 그 성과가 도달하지 않고 있었다 · 2026-08-18).
//    업로드도 서버 멀티파트 중계(`POST /api/v1/portal/imaging/upload`)로 이관 — 대상 환자는
//    **서버가 세션에서 정한다**(종전엔 브라우저가 URL 에 patientId 를 실어 보냈다).

const EXPORT_PURPOSES: { value: string; label: string }[] = [
  { value: 'SELF_VIEW', label: '개인 열람' },
  { value: 'SECOND_OPINION', label: '2차 소견' },
  { value: 'TRANSFER', label: '전원(타병원 제출)' },
  { value: 'PERSONAL_ARCHIVE', label: '개인 보관' },
];

interface Study {
  study_instance_uid: string;
  study_date: string;
  modality: string;
  description: string;
  instances: number;
  read_status: string;
  report_summary?: string;
  viewer_url: string;
}

interface UploadResult {
  success: boolean;
  message: string;
  studyUid?: string;
}

export default function PatientImagingPage() {
  const tAttr = usePortalTAttr();
  const [token, setToken] = useState('');
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // 🔴 2026-08-18: 종전에는 `portal-token`·`portal-patient-id` 를 읽어 로그인 여부를 판정했는데,
  //    이 두 키는 **저장소 어디에서도 기록되지 않는다**(포털 로그인은 apiClient.setToken →
  //    localStorage `accessToken`). 그래서 로그인한 환자에게도 이 화면은 항상
  //    "포털 로그인이 필요합니다"만 보여주고 있었다 — 목록 이관도 이 화면까지 닿지 못했다.
  useEffect(() => {
    const t = apiClient.getToken() ?? localStorage.getItem('accessToken');
    if (t) setToken(t);
  }, []);

  useEffect(() => {
    if (token) fetchStudies();
  }, [token]);

  const fetchStudies = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<{ data: { studies?: Study[] } }>('/api/v1/portal/imaging/studies?limit=50');
      const payload = (res?.data ?? {}) as { studies?: Study[] };
      setStudies(payload.studies ?? []);
    } catch (e: unknown) {
      // 🔴 조회 실패를 빈 목록으로 바꾸지 않는다 — "영상이 없다"와 "불러오지 못했다"는 다른 사실이다
      setStudies([]);
      setLoadError((e as { message?: string })?.message ?? '영상 목록을 불러오지 못했습니다.');
    }
    setLoading(false);
  };

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUploading(true);
    setUploadResult(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      // multipart 는 apiClient(Content-Type: application/json 고정)를 못 쓴다 — 원본 fetch 로
      // HIS 프록시를 부른다(Content-Type 은 브라우저가 boundary 와 함께 붙인다).
      const res = await fetch('/api/v1/portal/imaging/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        credentials: 'include',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // 🔴 실패를 성공으로 바꾸지 않는다 — 서버가 실패를 말하면 화면도 실패를 말한다.
        setUploadResult({ success: false, message: body?.error?.message ?? `업로드에 실패했습니다 (HTTP ${res.status}).` });
      } else {
        const data = (body?.data ?? {}) as { study_instance_uid?: string };
        setUploadResult({
          success: true,
          message: '영상이 성공적으로 업로드되었습니다.',
          studyUid: data.study_instance_uid,
        });
        fetchStudies();
        form.reset();
      }
    } catch {
      setUploadResult({ success: false, message: '업로드 요청을 보내지 못했습니다. 네트워크를 확인해 주세요.' });
    }
    setUploading(false);
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <p className="text-gray-500 mb-4"><PT k="포털 로그인이 필요합니다" /></p>
          <Link href="/portal" className="text-blue-600 underline"><PT k="포털로 이동" /></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/portal" className="text-sm text-blue-600 hover:underline"><PT k="← 포털 홈" /></Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1"><PT k="내 의료영상" /></h1>
          <p className="text-sm text-gray-500">검사 영상을 확인하고 외부 영상을 업로드할 수 있습니다</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setExportOpen(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <PT k="내보내기" />
          </button>
          <button
            onClick={() => setUploadMode(!uploadMode)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${uploadMode ? 'bg-gray-200 text-gray-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          >
            {uploadMode ? '목록 보기' : '영상 업로드'}
          </button>
        </div>
      </div>

      {exportOpen && <ImagingExportModal onClose={() => setExportOpen(false)} />}

      {/* Upload Form */}
      {uploadMode && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4"><PT k="외부 영상 업로드" /></h2>
          <p className="text-sm text-gray-500 mb-4">
            타 병원에서 촬영한 영상(DICOM 파일)을 업로드하면 주치의가 확인할 수 있습니다.
          </p>
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><PT k="검사 종류" /></label>
              <select name="modality" className="w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="CT">CT</option>
                <option value="MRI">MRI</option>
                <option value="XR">X-ray</option>
                <option value="US"><PT k="초음파" /></option>
                <option value="MG"><PT k="유방촬영" /></option>
                <option value="NM"><PT k="핵의학" /></option>
                <option value="OTHER"><PT k="기타" /></option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><PT k="검사 설명" /></label>
              <input type="text" name="description" placeholder="예: 복부 CT (2026-05-20 타병원)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><PT k="촬영 병원" /></label>
              <input type="text" name="referring_hospital" placeholder="예: 가상중앙병원"
                className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><PT k="DICOM 파일 (CD/USB에서 복사)" /></label>
              <input type="file" name="files" multiple accept=".dcm,.DCM,.zip"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm" required />
              <p className="text-xs text-gray-400 mt-1">DICOM 파일(.dcm) 또는 ZIP 파일을 선택해 주세요. 최대 500MB</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><PT k="메모 (선택)" /></label>
              <textarea name="note" rows={2} placeholder={tAttr('주치의에게 전달할 메모')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            </div>
            <button type="submit" disabled={uploading}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50">
              {uploading ? '업로드 중...' : '업로드'}
            </button>
          </form>
          {uploadResult && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${uploadResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {uploadResult.message}
            </div>
          )}
        </div>
      )}

      {/* Study List */}
      {!uploadMode && (
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-12 text-gray-400">로딩 중...</div>
          ) : loadError ? (
            /* 🔴 조회 실패를 "영상 없음"으로 말하지 않는다 — 환자가 자기 영상이 사라졌다고 읽는다 */
            <div className="text-center py-12">
              <p className="text-4xl mb-2">⚠️</p>
              <p className="text-red-600 text-sm">{loadError}</p>
              <p className="text-gray-400 text-xs mt-1">영상이 없는 것이 아니라 불러오지 못했습니다.</p>
              <button onClick={fetchStudies} className="mt-3 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg"><PT k="다시 시도" /></button>
            </div>
          ) : studies.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-2">🩻</p>
              <p><PT k="등록된 영상이 없습니다" /></p>
            </div>
          ) : (
            studies.map((s) => (
              <div key={s.study_instance_uid} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded">{s.modality}</span>
                      <span className="text-sm font-semibold text-gray-900">{s.description}</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {s.study_date?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')} | {s.instances}장
                    </p>
                    {s.report_summary && (
                      <p className="text-xs text-gray-600 mt-1 bg-gray-50 rounded px-2 py-1">{s.report_summary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                      s.read_status === 'completed' || s.read_status === 'final' ? 'bg-green-100 text-green-700' :
                      s.read_status === 'unread' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {s.read_status === 'completed' || s.read_status === 'final' ? '판독완료' :
                       s.read_status === 'unread' ? '미판독' : s.read_status}
                    </span>
                    <a href={s.viewer_url} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-700">
                      <PT k="뷰어" />
                    </a>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

type ExportPhase = 'select' | 'pending' | 'ready' | 'error';

function ImagingExportModal({ onClose }: { onClose: () => void }) {
  const [purpose, setPurpose] = useState('SELF_VIEW');
  const [phase, setPhase] = useState<ExportPhase>('select');
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState('');
  const [downloading, setDownloading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startExport = async () => {
    setPhase('pending');
    setMessage('PACS에 내보내기를 요청하는 중...');
    try {
      const res = await apiClient.post<{ data: { requestId: string; status: string } }>(
        '/api/v1/portal/imaging/export/request', { purpose });
      const id = res.data.requestId;
      setRequestId(id);
      setMessage('영상 패키지를 준비하는 중입니다... (최대 5분)');
      const deadline = Date.now() + 5 * 60 * 1000;
      pollRef.current = setInterval(async () => {
        if (Date.now() > deadline) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase('error'); setMessage('준비가 지연됩니다. 잠시 후 다시 시도해 주세요.');
          return;
        }
        try {
          const st = await apiClient.get<{ data: { status: string } }>(`/api/v1/portal/imaging/export/${id}`);
          if (st.data.status === 'ready') {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase('ready'); setMessage('패키지가 준비되었습니다.');
          } else if (st.data.status === 'expired' || st.data.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase('error'); setMessage('요청이 만료되었거나 오류가 발생했습니다.');
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch (e) {
      setPhase('error');
      setMessage((e as { message?: string })?.message || '내보내기 요청에 실패했습니다.');
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const res = await fetch(`/api/v1/portal/imaging/export/${requestId}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || '다운로드에 실패했습니다.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `imaging-export-${requestId.slice(0, 8)}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMessage('다운로드가 시작되었습니다. 받은 파일은 안전하게 보관·삭제해 주세요.');
    } catch (e) {
      setMessage((e as Error).message);
    }
    setDownloading(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-1"><PT k="영상·판독 내보내기" /></h2>
        <p className="text-sm text-gray-500 mb-4">내 영상과 판독문을 암호화된 패키지(ZIP)로 안전하게 내려받습니다.</p>

        {phase === 'select' && (
          <>
            <label className="block text-sm font-medium text-gray-700 mb-1"><PT k="목적" /></label>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-4 text-sm">
              {EXPORT_PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm">취소</button>
              <button onClick={startExport} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><PT k="요청" /></button>
            </div>
          </>
        )}

        {phase === 'pending' && (
          <div className="text-center py-6">
            <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm text-gray-600">{message}</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="py-2">
            <p className="text-sm text-green-700 bg-green-50 rounded-lg p-3 mb-4">{message}</p>
            <button onClick={download} disabled={downloading}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {downloading ? '다운로드 중...' : '복호화 패키지 다운로드'}
            </button>
            <button onClick={onClose} className="w-full mt-2 py-2 text-sm text-gray-500"><PT k="닫기" /></button>
          </div>
        )}

        {phase === 'error' && (
          <div className="py-2">
            <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3 mb-4">{message}</p>
            <button onClick={onClose} className="w-full py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm"><PT k="닫기" /></button>
          </div>
        )}
      </div>
    </div>
  );
}
