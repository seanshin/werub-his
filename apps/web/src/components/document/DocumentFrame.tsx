'use client';

import { useEffect, useState } from 'react';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { createPortal } from 'react-dom';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import type { DocumentMeta } from './lib/documentMeta';
import { watermarkOf } from './lib/documentMeta';
import { useQuery } from '@tanstack/react-query';
import { HospitalProfileProvider, profileFromConfig } from './lib/hospitalProfile';

/** 발급 문서 서버 PDF(헤드리스) — 인증 blob fetch 후 새 탭 */
async function downloadServerPdf(issueNo: string) {
  try {
    const token = apiClient.getToken();
    const res = await fetch(`/api/v1/documents/pdf/${encodeURIComponent(issueNo)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    toast.error('PDF 생성에 실패했습니다');
  }
}

interface DocumentFrameProps {
  title: string;
  meta?: DocumentMeta;
  watermark?: 'COPY' | 'REISSUE' | 'VOID' | 'DRAFT' | null;
  onDownloadPdf?: () => void;
  onIssue?: () => void;       // 발급(BE) — 지정 시 "발급" 버튼 노출
  issued?: boolean;          // 발급 완료 여부
  issuing?: boolean;
  children: React.ReactNode;  // 양식 본문(.doc-page 들을 포함)
}

/**
 * 공통 문서 프레임 (설계 §2.1·§12.5).
 * - 화면: .doc-screen 안에 A4 캔버스 미리보기 + 액션바.
 * - 인쇄: body 직하 Portal(.doc-print-root)에 동일 본문 렌더 → @media print 격리.
 * 양식 본문(children)은 순수 컴포넌트라 화면/인쇄 양쪽 렌더 안전.
 */
export function DocumentFrame({ title, meta, watermark, onDownloadPdf, onIssue, issued, issuing, children }: DocumentFrameProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const wm = watermark ?? watermarkOf(meta?.status);
  // (C6) 서식 머리 기관 정보 — 설정 원장 행만(source='db') · 기본값으로 떨어진 값은 '미설정' · 조회 실패는 '확인 불가'
  const cfgQ = useQuery({
    queryKey: ['doc-hospital-config'],
    queryFn: () => apiClient.get<{ data: Array<{ key: string; value: unknown; source?: string }> }>('/api/v1/config'),
    staleTime: 300_000,
    retry: false,
  });
  const cfgRows = Array.isArray(cfgQ.data?.data) ? cfgQ.data!.data : [];
  const hospital = profileFromConfig(Object.fromEntries(cfgRows.filter((r) => r.source === 'db').map((r) => [r.key, r.value])), cfgQ.isError);
  const body = (
    <HospitalProfileProvider value={hospital}>
      {wm ? <div className="doc-watermark">{wm === 'DRAFT' ? '미발급' : wm}</div> : null}
      {children}
    </HospitalProfileProvider>
  );

  return (
    <>
      {/* 화면 미리보기 */}
      <div className="doc-screen">
        <div className="doc-no-print" style={{ maxWidth: '210mm', margin: '0 auto 12px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {onIssue && (
            <button onClick={onIssue} disabled={issued || issuing} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm disabled:bg-gray-300">
              {issued ? '✅ 발급완료' : issuing ? '발급 중…' : '🧾 발급'}
            </button>
          )}
          <button onClick={() => sanctionedPrint()} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm">🖨 인쇄</button>
          <button
            onClick={() => {
              if (onDownloadPdf) return onDownloadPdf();
              if (meta?.issueNo) void downloadServerPdf(meta.issueNo); // 서버 PDF(헤드리스, 인증)
              else sanctionedPrint(); // 미발급 시 클라이언트 인쇄
            }}
            className="px-3 py-1.5 rounded-lg border text-sm"
            title={meta?.issueNo ? '서버 PDF 다운로드' : '발급 후 서버 PDF 가능(미발급은 인쇄)'}
          >📄 PDF</button>
        </div>
        <div aria-label={title}>{body}</div>
      </div>

      {/* 인쇄 전용 Portal (body 직하) */}
      {mounted && createPortal(<div className="doc-print-root">{body}</div>, document.body)}
    </>
  );
}
