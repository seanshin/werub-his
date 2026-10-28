'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import SignatureModal from './SignatureModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlockchainSignatureData {
  certificateId: string;
  signatureValue: string;
  signatureAlgorithm: string;
  documentHash: string;
}

interface SmartSignButtonProps {
  documentType: string;
  documentId: string;
  documentTitle?: string;
  patientName?: string;
  patientId?: string;
  onSign: () => void | Promise<void>;
  onBlockchainSign?: (data: BlockchainSignatureData) => void | Promise<void>;
  /**
   * 🔴 (2026-10-13 A2) 전자서명 전에 화면의 입력을 원장에 저장한다 — 서명 해시는 서버가 **저장된 내용**으로 계산한다.
   * 진료기록처럼 서명 순간에 저장하는 화면은 이것이 없으면 저장 **전** 내용에 서명하게 된다. false 를 돌려주면 열지 않는다.
   */
  prepare?: () => Promise<boolean | void>;
  disabled?: boolean;
  variant?: 'primary' | 'small' | 'outline';
  label?: string;
  className?: string;
}

interface CertInfo {
  id: string;
  serialNumber: string;
  status: string;
  algorithm: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Variant styles
// ---------------------------------------------------------------------------

const VARIANT_STYLES = {
  primary:
    'min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  small:
    'min-h-[44px] px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  outline:
    'min-h-[44px] px-5 py-2.5 rounded-xl border-2 border-blue-600 text-blue-600 font-medium hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export { SmartSignButton };
export default function SmartSignButton({
  documentType,
  documentId,
  documentTitle,
  patientName,
  patientId,
  onSign,
  onBlockchainSign,
  prepare,
  disabled = false,
  variant = 'primary',
  label,
  className = '',
}: SmartSignButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);

  // Check if user has an active blockchain certificate
  const { data: certData, isLoading } = useQuery({
    queryKey: ['my-certificate'],
    queryFn: () =>
      apiClient.get<{ data: CertInfo | null }>('/api/v1/blockchain-cert/my'),
    staleTime: 60_000,
  });

  const cert = certData?.data ?? null;
  const hasActiveCert = cert !== null && cert.status === 'ACTIVE';

  const handleClick = async () => {
    if (hasActiveCert) {
      if (prepare) {
        try {
          if ((await prepare()) === false) return;
        } catch (e) {
          toast.error(e instanceof Error && e.message ? e.message : '서명 전 저장에 실패해 서명 창을 열지 않았습니다');
          return;
        }
      }
      // Open SignatureModal for blockchain signing
      setModalOpen(true);
    } else {
      // Fallback: direct sign without blockchain
      await onSign();
      toast.info('전자인증서를 설정하면 법적 효력이 강화됩니다');
    }
  };

  const handleSignComplete = async (_signatureId: string, documentHash: string, signatureValue: string) => {
    // After blockchain sign completes, call onBlockchainSign if provided
    if (onBlockchainSign && cert) {
      try {
        await onBlockchainSign({
          certificateId: cert.id,
          // 🔴 (M1) 종전엔 서명 행 id 를 서명값으로 넘겼다 — 서버 공개키 검증이 늘 실패해 임상 경로 서명 기록이 0건이었다
          signatureValue,
          signatureAlgorithm: cert.algorithm,
          documentHash,
        });
      } catch (e) {
        console.error('onBlockchainSign callback failed:', e);
      }
    }
    // Always call the main onSign
    await onSign();
    setModalOpen(false);
  };

  const buttonLabel =
    label ?? (hasActiveCert ? '전자서명' : '서명');

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isLoading}
        className={`${VARIANT_STYLES[variant]} inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}
      >
        {hasActiveCert && (
          <svg
            className="w-4 h-4"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M8 1C5.79 1 4 2.79 4 5V7H3C2.45 7 2 7.45 2 8V14C2 14.55 2.45 15 3 15H13C13.55 15 14 14.55 14 14V8C14 7.45 13.55 7 13 7H12V5C12 2.79 10.21 1 8 1ZM8 2.5C9.38 2.5 10.5 3.62 10.5 5V7H5.5V5C5.5 3.62 6.62 2.5 8 2.5ZM8 10C8.83 10 9.5 10.67 9.5 11.5C9.5 12.33 8.83 13 8 13C7.17 13 6.5 12.33 6.5 11.5C6.5 10.67 7.17 10 8 10Z"
              fill="currentColor"
            />
          </svg>
        )}
        {buttonLabel}
      </button>

      {/* Signature Modal */}
      {hasActiveCert && (
        <SignatureModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          documentType={documentType}
          documentId={documentId}
          documentTitle={documentTitle ?? documentType}
          patientName={patientName}
          patientId={patientId}
          onSignComplete={handleSignComplete}
        />
      )}
    </>
  );
}
