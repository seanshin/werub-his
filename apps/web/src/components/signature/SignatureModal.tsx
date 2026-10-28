'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { signHash } from '@/lib/crypto/signer';
import {
  loadKeyFromStore,
  hasStoredKey,
  decryptPrivateKey,
  decryptPrivateKeyWithBiometric,
  type StoredKey,
} from '@/lib/crypto/key-manager';
import {
  authenticateBiometric,
} from '@/lib/crypto/webauthn';
import { T } from '@/components/ui/i18n-text';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentType: string;
  documentId: string;
  documentTitle: string;
  patientName?: string;
  patientId?: string;
  /** 🔴 (M1) 세 번째 인자 = 실제 서명값 — 종전 호출부는 서명 **행 id** 를 서명값으로 넘겨 임상 경로 검증이 늘 실패했다 */
  onSignComplete?: (signatureId: string, documentHash: string, signatureValue: string) => void;
}

interface CertInfo {
  id: string;
  serialNumber: string;
  status: string;
  algorithm: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SignatureModal({
  isOpen,
  onClose,
  documentType,
  documentId,
  documentTitle,
  patientName,
  patientId,
  onSignComplete,
}: SignatureModalProps) {
  const { user } = useAuthStore();
  const [pin, setPin] = useState('');
  const [keyAvailable, setKeyAvailable] = useState<boolean | null>(null);
  const [signState, setSignState] = useState<'idle' | 'signing' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [storedKeyData, setStoredKeyData] = useState<StoredKey | null>(null);
  const [showPinFallback, setShowPinFallback] = useState(false);

  // Fetch cert info
  const { data: certData } = useQuery({
    queryKey: ['my-certificate'],
    queryFn: () => apiClient.get<{ data: CertInfo | null }>('/api/v1/blockchain-cert/my'),
    enabled: isOpen,
  });
  const cert = certData?.data ?? null;

  // 🔴 (2026-10-13 A2) 서명 대상 해시는 서버가 문서 원장에서 계산한다 — 종전엔 `종류:id:제목` 문자열을 해시해
  //    서명이 문서 내용에 묶이지 않았다. 받지 못하면 서명하지 않는다(지어 채우지 않는다).
  //    문서 id 도 서버 정본을 쓴다(퇴원요약: 입원 id → 요약 id).
  const contentQ = useQuery({
    queryKey: ['document-content-hash', documentType, documentId],
    queryFn: () => apiClient.get<{ data: { documentId: string; hash: string; canon: string } }>(`/api/v1/document-sign/content-hash/${documentType}/${documentId}`),
    enabled: isOpen && !!documentId,
    staleTime: 0,
    gcTime: 0,
  });
  const docHash = contentQ.data?.data?.hash ?? null;
  const signDocumentId = contentQ.data?.data?.documentId ?? null;

  // Check key availability and load stored key data
  const checkKey = useCallback(async () => {
    const exists = await hasStoredKey();
    setKeyAvailable(exists);
  }, []);

  // Load stored key when cert is available
  useEffect(() => {
    if (isOpen && cert) {
      loadKeyFromStore(cert.id).then((key) => {
        setStoredKeyData(key);
      });
    }
  }, [isOpen, cert]);

  useEffect(() => {
    if (isOpen) {
      checkKey();
      setPin('');
      setSignState('idle');
      setErrorMsg('');
      setShowPinFallback(false);
    }
  }, [isOpen, checkKey]);

  // 🔴 (2026-10-13 결함 발굴 U2) 두 경로 모두 서명자 = 인증서 주인(로그인 직원 — /blockchain-cert/my) → signerType 'STAFF'.
  //    종전엔 문서에 환자가 있으면 'PATIENT' 로 보내 의사 본인 인증서가 "환자 소유 아님"으로 거부됐다. patientId 는 문서의 환자.
  // Biometric sign handler
  const handleBiometricSign = async () => {
    if (!cert || !docHash || !signDocumentId) return;
    const storedKey = storedKeyData;
    if (!storedKey || !storedKey.credentialId || !storedKey.rawAesKey) return;

    setSignState('signing');
    try {
      await authenticateBiometric(storedKey.credentialId); // Touch ID 본인확인
      const privateKey = await decryptPrivateKeyWithBiometric(
        storedKey.encryptedPrivateKey,
        storedKey.iv,
        storedKey.rawAesKey!,
        storedKey.algorithm,
      );

      const signature = await signHash(privateKey, docHash, storedKey.algorithm);

      const res = await apiClient.post<{ data: { signature: { id: string } } }>('/api/v1/document-sign/sign', {
        documentType,
        documentId: signDocumentId,
        patientId,
        documentHash: docHash,
        signatureValue: signature,
        signatureAlgorithm: storedKey.algorithm,
        certificateId: cert.id,
        signerRole: 'PRIMARY',
        signerType: 'STAFF',
        signerUserId: user?.id,
      });

      setSignState('success');
      toast.success('전자서명이 완료되었습니다.');
      onSignComplete?.(res.data.signature.id, docHash, signature);
    } catch (err) {
      setSignState('error');
      const msg = err instanceof Error ? err.message : '생체인증 서명에 실패했습니다.';
      setErrorMsg(msg);
      toast.error(msg);
    }
  };

  // PIN sign mutation
  const signMutation = useMutation({
    mutationFn: async () => {
      if (!cert) throw new Error('인증서가 없습니다.');
      if (!docHash || !signDocumentId) throw new Error('서버에서 문서 내용 해시를 받지 못해 서명하지 않았습니다.');
      if (pin.length !== 6) throw new Error('PIN 6자리를 입력해주세요.');

      setSignState('signing');

      // Load key from IndexedDB
      const storedKey = await loadKeyFromStore(cert.id);
      if (!storedKey) throw new Error('로컬 개인키가 없습니다. 키 복원이 필요합니다.');

      // Decrypt private key with PIN
      let privateKey;
      try {
        privateKey = await decryptPrivateKey(
          storedKey.encryptedPrivateKey,
          pin,
          storedKey.salt,
          storedKey.iv,
          storedKey.algorithm,
        );
      } catch {
        throw new Error('PIN이 올바르지 않습니다.');
      }

      // Sign the hash
      const signature = await signHash(privateKey, docHash, storedKey.algorithm);

      // Submit to server
      const res = await apiClient.post<{ data: { signature: { id: string } } }>('/api/v1/document-sign/sign', {
        documentType,
        documentId: signDocumentId,
        patientId,
        documentHash: docHash,
        signatureValue: signature,
        signatureAlgorithm: storedKey.algorithm,
        certificateId: cert.id,
        signerRole: 'PRIMARY',
        signerType: 'STAFF',
        signerUserId: user?.id,
      });

      return { signatureId: res.data.signature.id, hash: docHash, signatureValue: signature };
    },
    onSuccess: (result) => {
      setSignState('success');
      toast.success('전자서명이 완료되었습니다.');
      onSignComplete?.(result.signatureId, result.hash, result.signatureValue);
    },
    onError: (err) => {
      setSignState('error');
      const msg = err instanceof Error ? err.message : '서명에 실패했습니다.';
      setErrorMsg(msg);
      toast.error(msg);
    },
  });

  if (!isOpen) return null;

  // No cert state
  const noCert = cert === null;
  const certInactive = cert !== null && cert.status !== 'ACTIVE';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/cert/icons/sign-complete.svg" alt="" width={32} height={32} />
            <T k="전자서명" />
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 transition-colors"
          >
            {'\u2715'}
          </button>
        </div>

        <div className="px-6 py-5">
          {/* No cert */}
          {noCert && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-red-500">{'\u26A0'}</span>
              </div>
              <p className="font-bold text-gray-900 mb-2"><T k="인증서 없음" /></p>
              <p className="text-sm text-gray-500 mb-4">
                <T k="전자서명을 하려면 먼저 인증서를 발급받아야 합니다." />
              </p>
              <a
                href="/settings/my-certificate"
                className="inline-block px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <T k="인증서 설정으로 이동" />
              </a>
            </div>
          )}

          {/* Cert inactive */}
          {certInactive && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-amber-500">{'\u26A0'}</span>
              </div>
              <p className="font-bold text-gray-900 mb-2"><T k="인증서 비활성" /></p>
              <p className="text-sm text-gray-500">
                현재 인증서 상태: {cert.status}. 활성 인증서가 필요합니다.
              </p>
            </div>
          )}

          {/* Active cert - signing flow */}
          {cert && cert.status === 'ACTIVE' && (
            <>
              {/* Document info */}
              <div className="bg-gray-50 rounded-xl p-4 mb-5">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500"><T k="문서 유형" /></span>
                    <span className="font-medium text-gray-900">{documentType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500"><T k="문서 제목" /></span>
                    <span className="font-medium text-gray-900 text-right max-w-[200px] truncate">
                      {documentTitle}
                    </span>
                  </div>
                  {patientName && (
                    <div className="flex justify-between">
                      <span className="text-gray-500"><T k="환자" /></span>
                      <span className="font-medium text-gray-900">{patientName}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500"><T k="서명자" /></span>
                    <span className="font-medium text-gray-900">
                      {user ? `${user.familyName}${user.givenName}` : '-'}
                    </span>
                  </div>
                </div>
                {docHash && (
                  <div className="mt-3 pt-3 border-t border-gray-200" data-sign-content-hash>
                    <p className="text-xs text-gray-400"><T k="SHA-256 — 서버가 계산한 문서 내용 해시" /></p>
                    <p className="text-xs font-mono text-gray-500 break-all">{docHash}</p>
                  </div>
                )}
                {contentQ.isError && (
                  <div className="mt-3 pt-3 border-t border-gray-200" data-sign-content-hash-error>
                    <p className="text-xs text-red-600"><T k="문서 내용 해시를 받지 못했습니다 — 서명할 수 없습니다. 문서를 저장했는지 확인한 뒤 다시 여세요." /></p>
                  </div>
                )}
              </div>

              {/* Cert info */}
              <div className="flex items-center gap-2 mb-5 text-xs text-gray-500">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>
                  인증서: {cert.serialNumber.slice(0, 12)}... ({cert.algorithm})
                </span>
              </div>

              {/* Key not available */}
              {keyAvailable === false && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                  <p className="text-xs text-amber-700">
                    <T k="로컬 키가 없습니다. 설정 페이지에서 키를 복원해주세요." />
                  </p>
                </div>
              )}

              {/* Success state */}
              {signState === 'success' && (
                <div className="text-center py-4">
                  <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-2xl text-emerald-600">{'\u2713'}</span>
                  </div>
                  <p className="font-bold text-emerald-800"><T k="서명 완료@결과" /></p>
                  <button
                    onClick={onClose}
                    className="mt-4 px-6 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <T k="닫기" />
                  </button>
                </div>
              )}

              {/* Error state */}
              {signState === 'error' && (
                <div className="mb-4">
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                    <p className="text-xs text-red-700">{errorMsg}</p>
                  </div>
                  <button
                    onClick={() => {
                      setSignState('idle');
                      setPin('');
                      setErrorMsg('');
                    }}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    <T k="다시 시도" />
                  </button>
                </div>
              )}

              {/* Authentication input */}
              {(signState === 'idle' || signState === 'signing') && keyAvailable && (
                <div>
                  {/* Biometric signing */}
                  {storedKeyData?.authMethod === 'BIOMETRIC' && !showPinFallback && (
                    <div className="text-center">
                      <button
                        onClick={handleBiometricSign}
                        disabled={signState === 'signing' || !docHash}
                        className="w-full py-4 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                      >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a48.667 48.667 0 0 0-1.109 8.308M12 10.5a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75h-.008a.75.75 0 0 1-.75-.75v-.008a.75.75 0 0 1 .75-.75H12Zm0 0a2.25 2.25 0 0 0-2.25 2.25c0 1.29.238 2.526.672 3.665M12 10.5c1.076 0 2.1.18 3.06.51" />
                        </svg>
                        {signState === 'signing' ? <T k="인증 중..." /> : <T k="Touch ID / Face ID로 서명" />}
                      </button>
                      <button
                        onClick={() => setShowPinFallback(true)}
                        className="mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <T k="또는 PIN 입력" />
                      </button>
                    </div>
                  )}

                  {/* PIN input (default for PIN auth or fallback) */}
                  {(storedKeyData?.authMethod !== 'BIOMETRIC' || showPinFallback) && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-3">
                        <T k="PIN 입력 (6자리)" />
                      </label>
                      <div className="flex gap-2 justify-center mb-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div
                            key={i}
                            className={`w-10 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-bold ${
                              pin.length > i
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 bg-gray-50 text-gray-300'
                            }`}
                          >
                            {pin.length > i ? '\u2022' : ''}
                          </div>
                        ))}
                      </div>

                      {/* Number pad */}
                      <div className="grid grid-cols-3 gap-2 max-w-[200px] mx-auto mb-5">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((key, i) => {
                          if (key === null) return <div key={i} />;
                          return (
                            <button
                              key={i}
                              type="button"
                              disabled={signState === 'signing' || !docHash}
                              onClick={() => {
                                if (key === 'del') {
                                  setPin((p) => p.slice(0, -1));
                                } else if (pin.length < 6) {
                                  setPin((p) => p + String(key));
                                }
                              }}
                              className="h-10 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50"
                            >
                              {key === 'del' ? '\u232b' : key}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        onClick={() => signMutation.mutate()}
                        disabled={pin.length !== 6 || signState === 'signing' || !docHash}
                        className="w-full py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {signState === 'signing' ? <T k="서명 중..." /> : <T k="전자서명" />}
                      </button>

                      {showPinFallback && (
                        <button
                          onClick={() => setShowPinFallback(false)}
                          className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <T k="생체인증으로 돌아가기" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
