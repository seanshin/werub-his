'use client';

import { useState, useEffect, useCallback } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import {
  generateKeyPair,
  encryptPrivateKey,
  encryptPrivateKeyWithBiometric,
  exportPublicKeyPem,
  saveKeyToStore,
  loadKeyFromStore,
  hasStoredKey,
  deleteKeyFromStore,
  decryptPrivateKey,
  decryptPrivateKeyWithBiometric,
  type KeyAlgorithm,
  type StoredKey,
  type AuthMethod,
} from '@/lib/crypto/key-manager';
import { hashDocument, signHash, verifySignature } from '@/lib/crypto/signer';
import {
  createBackupFile,
  parseBackupFile,
  hrkbToStoredKey,
  getBackupFilename,
} from '@/lib/crypto/key-backup';
import {
  isPlatformAuthAvailable,
  registerBiometric,
  authenticateBiometric,
} from '@/lib/crypto/webauthn';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 **역할별 전자서명 안내(가이드 5종·FAQ)와 보안 정책 문구는 등재하지 않았다.**
 *    "마약류 투약 시 이중 확인 서명", "블록체인 앵커링으로 법적 증빙", "PIN 5회 실패 → 10분 잠금"
 *    같은 문장은 **법적 효력·안전 절차를 서술**한다. AI 초안 번역이 여기서 틀리면 직원이
 *    제도를 오해한 채 서명한다 — 사람 검수 후에 등재한다. 화면 크롬(제목·버튼·라벨·표 머리글)만 배선했다.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 서버(`/api/v1/blockchain-cert/my`)가 돌려주는 BlockchainCertificate 행의 필드명 그대로.
 * 🔴 종전 인터페이스는 `renewedFromId`(모델은 `previousCertId`)와 `signatureCount`(**스키마에 없음**)를
 *    선언해, 갱신 이력은 영영 표시되지 않고 서명 횟수는 항상 0으로 보였다(P11 — FE↔서버 계약 불일치).
 */
interface CertInfo {
  id: string;
  serialNumber: string;
  status: string;
  algorithm: string;
  issuedAt: string;
  expiresAt: string;
  previousCertId?: string | null;
  keyCustody?: string;
  pinFailCount?: number;
  pinLockedUntil?: string | null;
}

interface SignHistory {
  id: string;
  documentType: string;
  documentId: string;
  signedAt: string;
}

// ---------------------------------------------------------------------------
// PIN Input Component
// ---------------------------------------------------------------------------

function PinInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2"><T k={label} /></label>
      <div className="flex gap-2 justify-center">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`w-10 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-bold ${
              value.length > i
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-gray-50 text-gray-300'
            }`}
          >
            {value.length > i ? '\u2022' : ''}
          </div>
        ))}
      </div>
      <input
        type="password"
        inputMode="numeric"
        maxLength={6}
        pattern="[0-9]*"
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(v);
        }}
        disabled={disabled}
        className="sr-only"
        autoFocus
      />
      <div className="grid grid-cols-3 gap-2 mt-4 max-w-[200px] mx-auto">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((key, i) => {
          if (key === null) return <div key={i} />;
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (key === 'del') {
                  onChange(value.slice(0, -1));
                } else if (value.length < 6) {
                  onChange(value + String(key));
                }
              }}
              className="h-10 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {key === 'del' ? '\u232b' : key}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key Setup Wizard
// ---------------------------------------------------------------------------

function KeySetupWizard({ onComplete }: { onComplete: () => void }) {
  const tAttr = useTAttr();
  const { user } = useAuthStore();
  const [step, setStep] = useState<1 | 2 | 3 | 'done'>(1);
  const [algorithm, setAlgorithm] = useState<KeyAlgorithm>('ECDSA-P256');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [backupBlob, setBackupBlob] = useState<Blob | null>(null);

  // Biometric state
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('PIN');
  const [biometricRegistered, setBiometricRegistered] = useState(false);
  const [biometricData, setBiometricData] = useState<{
    credentialId: string;
  } | null>(null);

  // Check biometric availability on mount
  useEffect(() => {
    isPlatformAuthAvailable().then(setBiometricAvailable);
  }, []);

  const handleBiometricRegister = async () => {
    if (!user) return;
    try {
      const userName = `${user.familyName}${user.givenName}`;
      const result = await registerBiometric(user.id ?? 'user', userName);
      // WebAuthn은 본인확인 게이트만. credentialId만 저장.
      setBiometricData({ credentialId: result.credentialId });
      setBiometricRegistered(true);
      setAuthMethod('BIOMETRIC');
      toast.success(tAttr('생체인증이 등록되었습니다.'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tAttr('생체인증 등록에 실패했습니다.'));
    }
  };

  const handleIssue = async () => {
    if (authMethod === 'PIN') {
      if (pin.length !== 6) {
        toast.error(tAttr('PIN은 6자리 숫자를 입력해주세요.'));
        return;
      }
      if (pin !== pinConfirm) {
        toast.error(tAttr('PIN이 일치하지 않습니다.'));
        return;
      }
    } else if (!biometricData) {
      toast.error(tAttr('생체인증을 먼저 등록해주세요.'));
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Generate key pair
      const keyPair = await generateKeyPair(algorithm);

      // 2. Export public key PEM
      const publicKeyPem = await exportPublicKeyPem(keyPair.publicKey);

      // 3. Encrypt private key
      let encrypted: ArrayBuffer;
      let salt: ArrayBuffer;
      let iv: ArrayBuffer;

      let rawAesKey: ArrayBuffer | undefined;
      if (authMethod === 'BIOMETRIC' && biometricData) {
        const result = await encryptPrivateKeyWithBiometric(keyPair.privateKey);
        encrypted = result.encrypted;
        salt = result.salt;
        iv = result.iv;
        rawAesKey = result.rawAesKey;
      } else {
        const result = await encryptPrivateKey(keyPair.privateKey, pin);
        encrypted = result.encrypted;
        salt = result.salt;
        iv = result.iv;
      }

      // 4. Export public key as JWK for storage
      const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

      // 5. Issue certificate via API
      // 🔴 종전 FE 는 `publicKeyPem` 으로 보냈고 서버는 `publicKey` 를 읽어 **공개키가 빈 값으로 발급**될 수
      //    있었다(계약 불일치·P11). 서버는 현재 둘 다 흡수하지만, 정본 키는 `publicKey` 다.
      const res = await apiClient.post<{ data: CertInfo }>('/api/v1/blockchain-cert/issue', {
        publicKey: publicKeyPem,
        algorithm,
      });

      const certId = res.data.id;

      // 6. Save encrypted private key to IndexedDB
      const storedKey: StoredKey = {
        id: certId,
        encryptedPrivateKey: encrypted,
        publicKey: publicKeyJwk,
        algorithm,
        salt,
        iv,
        createdAt: new Date().toISOString(),
        authMethod,
        ...(authMethod === 'BIOMETRIC' && biometricData
          ? { credentialId: biometricData.credentialId, rawAesKey }
          : {}),
      };
      await saveKeyToStore(storedKey);

      // 7. Create backup file
      const ownerName = user ? `${user.familyName}${user.givenName}` : 'unknown';
      const blob = createBackupFile(storedKey, ownerName);
      setBackupBlob(blob);

      setStep('done');
      toast.success(tAttr('인증서가 성공적으로 발급되었습니다.'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tAttr('인증서 발급에 실패했습니다.'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadBackup = () => {
    if (!backupBlob) return;
    const ownerName = user ? `${user.familyName}${user.givenName}` : 'unknown';
    const filename = getBackupFilename(ownerName);
    const url = URL.createObjectURL(backupBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(tAttr('백업 파일이 다운로드되었습니다.'));
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 max-w-lg mx-auto">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                step === 'done' || (typeof step === 'number' && s <= step)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {step === 'done' || (typeof step === 'number' && s < step) ? '\u2713' : s}
            </div>
            {s < 3 && (
              <div
                className={`w-12 h-0.5 ${
                  step === 'done' || (typeof step === 'number' && s < step) ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Algorithm selection */}
      {step === 1 && (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/onboard/onboard-step1.svg" alt={tAttr('키 생성')} width={200} height={120} className="mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 text-center mb-2"><T k="알고리즘 선택" /></h3>
          <p className="text-sm text-gray-500 text-center mb-6"><T k="전자서명에 사용할 암호화 알고리즘을 선택하세요." /></p>
          <div className="space-y-3">
            {([
              {
                value: 'ECDSA-P256' as const,
                label: 'ECDSA P-256 (권장)',
                desc: '빠른 서명 속도, 짧은 키 길이. 최신 표준.',
              },
              {
                value: 'RSA-2048' as const,
                label: 'RSA-2048',
                desc: '광범위한 호환성. 전통적 알고리즘.',
                // (라벨/설명은 아래 렌더에서 <T> 를 탄다)
              },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setAlgorithm(opt.value)}
                className={`w-full p-4 rounded-xl border-2 text-left transition-colors ${
                  algorithm === opt.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className="font-medium text-gray-900"><T k={opt.label} /></p>
                <p className="text-xs text-gray-500 mt-0.5"><T k={opt.desc} /></p>
              </button>
            ))}
          </div>
          <button
            onClick={() => setStep(2)}
            className="w-full mt-6 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            <T k="다음" />
          </button>
        </div>
      )}

      {/* Step 2: Authentication setup (Biometric or PIN) */}
      {step === 2 && (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/onboard/onboard-step2.svg" alt={tAttr('본인 인증 설정')} width={200} height={120} className="mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 text-center mb-2"><T k="본인 인증 설정" /></h3>
          <p className="text-sm text-gray-500 text-center mb-6">
            <T k="개인키를 보호할 인증 방식을 설정하세요. 서명 시 매번 인증합니다." />
          </p>

          {/* Biometric availability notice */}
          {biometricAvailable !== null && (
            <div className={`rounded-xl p-3 mb-4 text-xs ${
              biometricAvailable
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                : 'bg-gray-50 border border-gray-200 text-gray-500'
            }`}>
              <T k={biometricAvailable
                ? 'Touch ID / Face ID가 이 기기에서 지원됩니다.'
                : '이 기기에서 생체인증을 사용할 수 없어 PIN을 설정합니다.'} />
            </div>
          )}

          {/* Biometric registration */}
          {biometricAvailable && !biometricRegistered && (
            <div className="mb-6">
              <button
                onClick={handleBiometricRegister}
                className="w-full py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a48.667 48.667 0 0 0-1.109 8.308M12 10.5a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75h-.008a.75.75 0 0 1-.75-.75v-.008a.75.75 0 0 1 .75-.75H12Zm0 0a2.25 2.25 0 0 0-2.25 2.25c0 1.29.238 2.526.672 3.665M12 10.5c1.076 0 2.1.18 3.06.51" />
                </svg>
                <T k="Touch ID / Face ID로 설정" />
              </button>
              <button
                onClick={() => setAuthMethod('PIN')}
                className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                <T k="또는 PIN으로 설정" />
              </button>
            </div>
          )}

          {/* Biometric registered success */}
          {biometricRegistered && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6 text-center">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <span className="text-xl text-emerald-600">{'\u2713'}</span>
              </div>
              <p className="text-sm font-medium text-emerald-800"><T k="생체인증이 등록되었습니다" /></p>
              <p className="text-xs text-emerald-600 mt-1"><T k="서명 시 Touch ID / Face ID로 인증합니다" /></p>
            </div>
          )}

          {/* PIN fallback (shown when biometric not available or user chose PIN) */}
          {(authMethod === 'PIN' && !biometricRegistered) && (
            <div className="space-y-6">
              <PinInput value={pin} onChange={setPin} label="PIN 입력 (6자리)" />
              {pin.length === 6 && (
                <PinInput value={pinConfirm} onChange={setPinConfirm} label="PIN 확인" />
              )}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => {
                setStep(1);
                setPin('');
                setPinConfirm('');
              }}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              <T k="이전" />
            </button>
            <button
              onClick={() => {
                if (authMethod === 'BIOMETRIC' && biometricRegistered) {
                  setStep(3);
                  return;
                }
                if (pin.length !== 6) {
                  toast.error(tAttr('PIN은 6자리를 입력해주세요.'));
                  return;
                }
                if (pin !== pinConfirm) {
                  toast.error(tAttr('PIN이 일치하지 않습니다.'));
                  return;
                }
                setStep(3);
              }}
              disabled={
                authMethod === 'BIOMETRIC'
                  ? !biometricRegistered
                  : pin.length !== 6 || pinConfirm.length !== 6
              }
              className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <T k="다음" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Issue & Backup */}
      {step === 3 && (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/onboard/onboard-step3.svg" alt={tAttr('백업')} width={200} height={120} className="mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 text-center mb-2"><T k="인증서 발급" /></h3>
          <p className="text-sm text-gray-500 text-center mb-6">
            <T k="설정을 확인하고 인증서를 발급합니다." />
          </p>
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 mb-6">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500"><T k="알고리즘" /></span>
              <span className="font-medium text-gray-900">{algorithm}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500"><T k="인증 방식" /></span>
              <span className="font-medium text-emerald-600">
                <T k={authMethod === 'BIOMETRIC' ? '생체인증 (Touch ID / Face ID)' : 'PIN (6자리)'} />
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500"><T k="저장 위치" /></span>
              <span className="font-medium text-gray-900"><T k="브라우저 (IndexedDB)" /></span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              disabled={isProcessing}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <T k="이전" />
            </button>
            <button
              onClick={handleIssue}
              disabled={isProcessing}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <T k={isProcessing ? '발급 중...' : '인증서 발급'} />
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/onboard/onboard-complete.svg" alt={tAttr('완료')} width={200} height={120} className="mx-auto mb-4" />
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl text-emerald-600">{'\u2713'}</span>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2"><T k="인증서 발급 완료" /></h3>
          <p className="text-sm text-gray-500 mb-6">
            <T k="백업 파일을 안전한 곳에 보관하세요. 브라우저 데이터가 삭제되면 복원에 필요합니다." />
          </p>
          <div className="space-y-3">
            <button
              onClick={handleDownloadBackup}
              className="w-full py-2.5 rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors"
            >
              <T k="백업 파일 다운로드 (.hrkb)" />
            </button>
            <button
              onClick={onComplete}
              className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              <T k="완료" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key Restore Section
// ---------------------------------------------------------------------------

function KeyRestoreSection({ certId, onRestore }: { certId: string; onRestore: () => void }) {
  const tAttr = useTAttr();
  const [isRestoring, setIsRestoring] = useState(false);

  const handleFileRestore = async (file: File) => {
    setIsRestoring(true);
    try {
      const hrkb = await parseBackupFile(file);
      const storedKey = hrkbToStoredKey(hrkb, certId);
      await saveKeyToStore(storedKey);
      toast.success(tAttr('키가 복원되었습니다.'));
      onRestore();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tAttr('키 복원에 실패했습니다.'));
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
      <h3 className="font-bold text-amber-800 mb-2 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/cert/icons/key-restore.svg" alt={tAttr('키 복원')} width={32} height={32} />
        <T k="키 복원 필요" />
      </h3>
      <p className="text-sm text-amber-700 mb-4">
        <T k="서버에 인증서가 등록되어 있지만, 이 브라우저에 개인키가 없습니다. 백업 파일(.hrkb)로 복원해주세요." />
      </p>
      <label
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors cursor-pointer ${
          isRestoring ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        <input
          type="file"
          accept=".hrkb"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileRestore(file);
          }}
        />
        <T k={isRestoring ? '복원 중...' : '백업 파일 선택'} />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MyCertificatePage() {
  const tAttr = useTAttr();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [keyExists, setKeyExists] = useState<boolean | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  // Check IndexedDB key
  const checkKey = useCallback(async () => {
    const exists = await hasStoredKey();
    setKeyExists(exists);
  }, []);

  useEffect(() => {
    checkKey();
  }, [checkKey]);

  // Fetch cert from server
  const { data: certData, isLoading: certLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-certificate'],
    queryFn: () => apiClient.get<{ data: CertInfo | null }>('/api/v1/blockchain-cert/my'),
  });

  // 발급 가능 여부 — sign 단독 전환 시 자체발급 비활성(서명 시 sign 자동 발급).
  const { data: capData } = useQuery({
    queryKey: ['cert-capability'],
    queryFn: () => apiClient.get<{ data: { selfIssuanceEnabled: boolean; issuer: string; message: string | null } }>('/api/v1/blockchain-cert/capability'),
  });
  const selfIssuanceDisabled = capData?.data?.selfIssuanceEnabled === false;
  const capMessage = capData?.data?.message ?? '전자서명 인증서는 서명 시 sign 에서 자동 발급·관리됩니다.';

  // API returns array — take first ACTIVE cert, or first cert
  const rawCert = certData?.data;
  const certArr: CertInfo[] = Array.isArray(rawCert) ? rawCert : (rawCert as unknown as Record<string, unknown>)?.data as CertInfo[] ?? (rawCert ? [rawCert as CertInfo] : []);
  const cert = certArr.find(c => c.status === 'ACTIVE') ?? certArr[0] ?? null;
  const hasCert = cert !== null;

  // Sign history
  const { data: historyData } = useQuery({
    queryKey: ['sign-history'],
    queryFn: () =>
      apiClient.get<{ data: SignHistory[] }>('/api/v1/document-sign/my-history', { limit: 10 }),
    enabled: hasCert,
  });

  // Test sign
  const testSignMutation = useMutation({
    mutationFn: async () => {
      if (!cert) throw new Error('인증서가 없습니다.');
      const storedKey = await loadKeyFromStore(cert.id);
      if (!storedKey) throw new Error('로컬 키가 없습니다. 복원이 필요합니다.');

      let privateKey: CryptoKey;

      if (storedKey.authMethod === 'BIOMETRIC' && storedKey.credentialId && storedKey.rawAesKey) {
        // Touch ID 본인확인 → 성공해야만 키 접근
        await authenticateBiometric(storedKey.credentialId);
        // 저장된 AES 키로 개인키 복호화
        privateKey = await decryptPrivateKeyWithBiometric(
          storedKey.encryptedPrivateKey,
          storedKey.iv,
          storedKey.rawAesKey,
          storedKey.algorithm,
        );
      } else {
        // PIN fallback
        const testPin = prompt(tAttr('PIN을 입력하세요 (6자리)'));
        if (!testPin || testPin.length !== 6) throw new Error('PIN 입력이 취소되었습니다.');
        // 🔴 "PIN 5회 실패 → 10분 잠금 · 10회 → 자동 정지"는 화면·문서에만 있던 정책이었다 —
        //    `pin-fail`/`pin-success` EP 호출처가 FE·BE 전역 0건이라 카운터가 오르지 않았다(P16).
        //    이 화면의 PIN 경로부터 실제로 보고한다(다른 서명 화면 배선은 별도 배치).
        try {
          privateKey = await decryptPrivateKey(
            storedKey.encryptedPrivateKey,
            testPin,
            storedKey.salt,
            storedKey.iv,
            storedKey.algorithm,
          );
        } catch (e) {
          await apiClient.post('/api/v1/blockchain-cert/pin-fail', { certId: cert.id }).catch(() => undefined);
          queryClient.invalidateQueries({ queryKey: ['my-certificate'] });
          throw e instanceof Error ? new Error(`PIN이 올바르지 않습니다 (${e.message})`) : new Error('PIN이 올바르지 않습니다');
        }
        await apiClient.post('/api/v1/blockchain-cert/pin-success', { certId: cert.id }).catch(() => undefined);
        queryClient.invalidateQueries({ queryKey: ['my-certificate'] });
      }

      const hash = await hashDocument('테스트 서명 문서');
      const signature = await signHash(privateKey, hash, storedKey.algorithm);

      // Verify locally
      const pubKey = await crypto.subtle.importKey(
        'jwk',
        storedKey.publicKey,
        storedKey.algorithm === 'ECDSA-P256'
          ? { name: 'ECDSA', namedCurve: 'P-256' }
          : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      const valid = await verifySignature(pubKey, signature, hash, storedKey.algorithm);
      if (!valid) throw new Error('서명 검증 실패');
      return true;
    },
    onSuccess: () => toast.success(tAttr('서명 테스트 성공! 키가 정상 동작합니다.')),
    onError: (err) => toast.error(err instanceof Error ? err.message : tAttr('서명 테스트 실패')),
  });

  // Backup download
  const handleBackup = async () => {
    if (!cert) return;
    const storedKey = await loadKeyFromStore(cert.id);
    if (!storedKey) {
      toast.error(tAttr('로컬 키가 없습니다.'));
      return;
    }
    const ownerName = user ? `${user.familyName}${user.givenName}` : 'unknown';
    const blob = createBackupFile(storedKey, ownerName);
    const filename = getBackupFilename(ownerName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(tAttr('백업 파일이 다운로드되었습니다.'));
  };

  // Suspend cert
  const suspendMutation = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/blockchain-cert/${cert?.id}/suspend`),
    onSuccess: () => {
      toast.success(tAttr('인증서가 정지되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['my-certificate'] });
    },
    onError: () => toast.error(tAttr('인증서 정지에 실패했습니다.')),
  });

  // Renew cert (rekey: 새 키쌍 생성 → 생체인증/PIN → 공개키 전송)
  const [isRekeying, setIsRekeying] = useState(false);
  const handleRekey = async () => {
    if (!cert) return;

    try {
      setIsRekeying(true);
      const algo = (cert.algorithm === 'RSA-2048' ? 'RSA-2048' : 'ECDSA-P256') as KeyAlgorithm;
      const keyPair = await generateKeyPair(algo);
      const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
      const pubPem = await exportPublicKeyPem(keyPair.publicKey);

      // Check if biometric is available for this rekey
      const canUseBiometric = await isPlatformAuthAvailable();

      let encrypted: ArrayBuffer;
      let salt: ArrayBuffer;
      let iv: ArrayBuffer;
      let rekeyAuthMethod: AuthMethod = 'PIN';
      let rekeyCredentialId: string | undefined;
      let rekeyRawAesKey: ArrayBuffer | undefined;

      if (canUseBiometric) {
        try {
          const userName = user ? `${user.familyName}${user.givenName}` : 'unknown';
          const bioResult = await registerBiometric(user?.id ?? 'user', userName);
          const encResult = await encryptPrivateKeyWithBiometric(keyPair.privateKey);
          encrypted = encResult.encrypted;
          salt = encResult.salt;
          iv = encResult.iv;
          rekeyAuthMethod = 'BIOMETRIC';
          rekeyCredentialId = bioResult.credentialId;
          rekeyRawAesKey = encResult.rawAesKey;
        } catch {
          const pinInput = prompt('생체인증이 취소되었습니다. PIN 6자리를 입력하세요:');
          if (!pinInput || pinInput.length < 4) { toast.error(tAttr('PIN을 입력하세요')); return; }
          const pinResult = await encryptPrivateKey(keyPair.privateKey, pinInput);
          encrypted = pinResult.encrypted;
          salt = pinResult.salt;
          iv = pinResult.iv;
        }
      } else {
        const pinInput = prompt('키 교체를 위해 새 PIN 6자리를 입력하세요:');
        if (!pinInput || pinInput.length < 4) { toast.error(tAttr('PIN을 입력하세요')); return; }
        const pinResult = await encryptPrivateKey(keyPair.privateKey, pinInput);
        encrypted = pinResult.encrypted;
        salt = pinResult.salt;
        iv = pinResult.iv;
      }

      // 서버에 공개키 전송 (키 교체) → 새 인증서 반환
      const res = await apiClient.post<{ data: { id: string } }>(`/api/v1/blockchain-cert/${cert.id}/renew`, { publicKey: pubPem });
      const newCertId = (res as unknown as Record<string, unknown>)?.data
        ? ((res as unknown as Record<string, unknown>).data as Record<string, unknown>)?.id as string ?? cert.id
        : cert.id;

      // 새 cert.id로 키 저장
      await saveKeyToStore({
        id: newCertId,
        encryptedPrivateKey: encrypted,
        publicKey: pubJwk,
        algorithm: algo,
        salt,
        iv,
        createdAt: new Date().toISOString(),
        authMethod: rekeyAuthMethod,
        ...(rekeyAuthMethod === 'BIOMETRIC'
          ? { credentialId: rekeyCredentialId, rawAesKey: rekeyRawAesKey }
          : {}),
      });
      toast.success(tAttr('키 교체 완료! 새 키가 브라우저에 저장되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['my-certificate'] });
      checkKey();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tAttr('키 교체에 실패했습니다.'));
    } finally {
      setIsRekeying(false);
    }
  };

  // Error
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  // Loading
  if (certLoading || keyExists === null) {
    return (
      <div>
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900"><T k="내 전자서명 인증서" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="전자서명 인증서 관리 및 키 설정" /></p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-100 rounded w-1/3" />
            <div className="h-4 bg-gray-50 rounded w-1/2" />
            <div className="h-32 bg-gray-50 rounded" />
          </div>
        </div>
      </div>
    );
  }

  // Show wizard if no cert
  if (!hasCert || showWizard) {
    return (
      <div>
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900"><T k="내 전자서명 인증서" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="전자서명 인증서 관리 및 키 설정" /></p>
        </div>
        {selfIssuanceDisabled ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/cert/icons/cert-active.svg" alt={tAttr('sign 발급')} width={56} height={56} className="mx-auto mb-4 opacity-80" />
            <h3 className="text-lg font-bold text-gray-900 mb-2"><T k="sign 전자서명 서비스에서 발급·관리" /></h3>
            {/* capMessage 는 서버 설정값(관리자 문구) — FE 카탈로그 대상이 아니다 */}
            <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">{capMessage}</p>
            <p className="text-xs text-gray-400 mt-4"><T k="별도 발급 절차가 필요 없습니다. 문서 서명 시 자동으로 인증서가 발급됩니다." /></p>
            {/* 🔴 이 화면은 HIS 자체발급(blockchainCertificate)만 조회한다. sign 발급분(users.sign_cert_serial)은
                조회 경로가 없어 **보유 여부를 알 수 없다** — "없음"이라고 말하지 않는다(P1). */}
            <div className="mt-5 mx-auto max-w-md rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left">
              <p className="text-[12px] font-semibold text-gray-700"><T k="내 sign 인증서 정보는 여기서 확인할 수 없습니다" /></p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                이 화면은 HIS 자체발급 인증서만 조회합니다. sign 에서 발급된 내 인증서(일련번호·상태)를 조회하는
                경로가 아직 없어 <b>보유 여부를 표시하지 못합니다</b> — 미발급이라는 뜻이 아닙니다.
                확인이 필요하면 관리자에게 <span className="font-mono">/admin/blockchain-cert</span>(sign 인증서 현황) 조회를 요청하세요.
              </p>
            </div>
          </div>
        ) : (
          <KeySetupWizard
            onComplete={() => {
              setShowWizard(false);
              queryClient.invalidateQueries({ queryKey: ['my-certificate'] });
              checkKey();
            }}
          />
        )}
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    ACTIVE: 'bg-emerald-50 text-emerald-700',
    PENDING: 'bg-gray-50 text-gray-500', // 간소화 — 발급 즉시 ACTIVE이므로 PENDING은 레거시
    SUSPENDED: 'bg-red-50 text-red-700',
    EXPIRED: 'bg-gray-100 text-gray-500',
    REVOKED: 'bg-red-50 text-red-700',
  };

  const statusLabel: Record<string, string> = {
    ACTIVE: '활성',
    PENDING: '승인 대기',
    // 🔴 '정지'는 이미 'Suspend'(동작 버튼)로 등재돼 있다 — 여기는 **상태**라 문맥 키로 가른다
    SUSPENDED: '정지@상태',
    EXPIRED: '만료',
    REVOKED: '폐지',
  };

  // 만료일이 2090년 이후면 운영상 '사실상 무기한'(자체발급 기본 2099-12-31) — 값 자체는 감추지 않는다.
  const isEffectivelyPerpetual = !!cert.expiresAt && new Date(cert.expiresAt).getFullYear() >= 2090;
  const pinLockedUntil = cert.pinLockedUntil ?? null;
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900"><T k="내 전자서명 인증서" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="전자서명 인증서 관리 및 키 설정" /></p>
      </div>

      {/* Key restore warning */}
      {!keyExists && (
        <div className="mb-6">
          <KeyRestoreSection certId={cert.id} onRestore={checkKey} />
        </div>
      )}

      {/* Certificate card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <div className="flex items-start gap-4">
          {/* 인증서 상태 아이콘 */}
          <div className="flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/images/cert/icons/cert-${cert.status === 'ACTIVE' ? 'active' : cert.status === 'SUSPENDED' ? 'suspended' : cert.status === 'REVOKED' ? 'revoked' : 'expired'}.svg`}
              alt={tAttr(statusLabel[cert.status] ?? cert.status)}
              width={48}
              height={48}
            />
          </div>

          <div className="flex-1">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900"><T k="전자서명 인증서" /></h3>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">S/N: {cert.serialNumber}</p>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                  statusColor[cert.status] ?? 'bg-gray-100 text-gray-500'
                }`}
              >
                <T k={statusLabel[cert.status] ?? cert.status} />
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500"><T k="알고리즘" /></p>
                <p className="text-sm font-medium text-gray-900">{cert.algorithm}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500"><T k="발급일" /></p>
                <p className="text-sm font-medium text-gray-900">
                  {kdate(new Date(cert.issuedAt))}
                </p>
              </div>
              <div>
                {/* 🔴 상수 '무기한' 을 찍던 자리 — 서버가 주는 실제 만료일을 쓴다(직원 자체발급=2099-12-31). */}
                <p className="text-xs text-gray-500"><T k="유효기간(만료일)" /></p>
                <p className="text-sm font-medium text-gray-900">
                  {cert.expiresAt ? kdate(new Date(cert.expiresAt)) : '—'}
                  {isEffectivelyPerpetual && <span className="ml-1 text-xs font-normal text-gray-400"><T k="(사실상 무기한)" /></span>}
                </p>
              </div>
              <div>
                {/* 🔴 'signatureCount' 는 스키마에 없어 항상 0 이었다 — 없는 값을 0으로 말하지 않는다. */}
                <p className="text-xs text-gray-500"><T k="개인키 보관" /></p>
                <p className="text-sm font-medium text-gray-900"><T k={KEY_CUSTODY_LABEL[cert.keyCustody ?? ''] ?? cert.keyCustody ?? '—'} /></p>
              </div>
            </div>

            {cert.previousCertId && (
              <p className="text-xs text-gray-400 mt-3"><T k="이전 인증서에서 키 교체됨" /></p>
            )}
            {/* PIN 정책 상태 — 실제 카운터/잠금 시각(서버 값) */}
            {(cert.pinFailCount ?? 0) > 0 && (
              <p className="text-xs text-amber-700 mt-2">
                <T k="PIN 실패" /> {cert.pinFailCount}<Unit>회</Unit>
                {pinLockedUntil && new Date(pinLockedUntil) > new Date() && ` · ${kdate(pinLockedUntil, 'datetimeSec')} 까지 잠김`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Key status */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-bold text-gray-700 mb-3"><T k="로컬 키 상태" /></h3>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={keyExists ? '/images/cert/icons/pin-unlock.svg' : '/images/cert/icons/pin-lock.svg'}
            alt={tAttr(keyExists ? '키 사용 가능' : '키 없음')}
            width={24}
            height={24}
          />
          <span className="text-sm text-gray-700">
            <T k={keyExists
              ? '개인키가 이 브라우저에 안전하게 저장되어 있습니다.'
              : '개인키가 이 브라우저에 없습니다. 복원이 필요합니다.'} />
          </span>
        </div>
      </div>

      {/* Actions — 🔴 '인증서 정지'는 ADMIN 전용 EP 인데 전 역할에 노출돼 의사·간호사·약사는 항상 403 이었다. */}
      <div className={`grid grid-cols-2 ${isAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-3 mb-6`}>
        <button
          onClick={() => testSignMutation.mutate()}
          disabled={!keyExists || testSignMutation.isPending}
          className="py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/icons/sign-complete.svg" alt="" width={16} height={16} className="inline mr-1" />
          <T k={testSignMutation.isPending ? '테스트 중...' : '서명 테스트'} />
        </button>
        <button
          onClick={handleBackup}
          disabled={!keyExists}
          className="py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/icons/key-backup.svg" alt="" width={16} height={16} className="inline mr-1" />
          <T k="키 백업" />
        </button>
        <button
          onClick={handleRekey}
          disabled={isRekeying}
          className="py-2.5 rounded-xl border border-blue-200 text-sm font-medium text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/icons/key-generate.svg" alt="" width={16} height={16} className="inline mr-1" />
          <T k={isRekeying ? '키 교체 중...' : '키 교체'} />
        </button>
        {isAdmin && (
          <button
            onClick={() => {
              if (confirm(tAttr('인증서를 정지하시겠습니까? 정지된 인증서로는 서명할 수 없습니다.'))) {
                suspendMutation.mutate();
              }
            }}
            disabled={cert.status !== 'ACTIVE' || suspendMutation.isPending}
            className="py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            <T k="인증서 정지" />
          </button>
        )}
      </div>
      {!isAdmin && (
        <p className="-mt-3 mb-6 text-[11px] text-gray-400">
          <T k="인증서 정지·폐기는 관리자 권한입니다. 분실·유출이 의심되면 관리자에게 요청하거나 ‘키 교체’로 새 키를 발급하세요." />
        </p>
      )}

      {/* Sign history */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-700"><T k="최근 서명 이력" /></h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="문서 유형" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="문서 ID" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="서명 일시" /></th>
            </tr>
          </thead>
          <tbody>
            {(historyData?.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-gray-400 text-sm">
                  <T k="서명 이력이 없습니다." />
                </td>
              </tr>
            ) : (
              (historyData?.data ?? []).map((h) => (
                <tr key={h.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-5 py-3 text-gray-900">{h.documentType}</td>
                  <td className="px-5 py-3 text-gray-500 font-mono text-xs">{h.documentId}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {kdate(h.signedAt, 'datetimeSec')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 안내 가이드 (역할별) */}
      <CertGuideSection role={user?.role} />
    </div>
  );
}

/** BlockchainCertificate.keyCustody — 개인키 수탁 출처(HSM 기획 Phase 4) */
const KEY_CUSTODY_LABEL: Record<string, string> = {
  SOFTWARE: '소프트웨어(브라우저)',
  CLIENT_SE: '클라이언트 보관(HIS 미수탁)',
  HSM: 'HSM',
  EXTERNAL_SIGN: '외부 서명서비스(sign)',
};

function CertGuideSection({ role }: { role?: string }) {
  const [open, setOpen] = useState(false);

  const roleGuide: Record<string, { title: string; items: string[] }> = {
    DOCTOR: {
      title: '의사 전자서명 가이드',
      items: [
        '진료 완료 후 「서명 완료」 버튼 클릭 시 생체인증(Touch ID/Face ID) 또는 PIN 입력으로 전자서명이 적용됩니다.',
        '진단서, 처방전, 수술기록, 퇴원요약 등 법적 문서에 서명이 기록됩니다.',
        '동의서는 담당의 + 환자/보호자(필수), 확인자(선택)로 서명하며, 서명 시각이 내부 원장에 기록됩니다(외부 블록체인 아님).',
        '서명은 인증서 공개키로 검증됩니다. 서명 대상은 문서 식별 정보(유형·번호·제목)라 서명 후 문서 내용 변경까지 증명하지는 않습니다.',
        '인쇄물 하단에 서명자·서명 일시·공개키 검증 상태가 표시됩니다(검증 QR 코드는 아직 없습니다).',
      ],
    },
    NURSE: {
      title: '간호사 전자서명 가이드',
      items: [
        '동의서 서명 시 동의서 설명 확인자 역할로 전자서명을 합니다.',
        '간호기록, 투약확인 등에 서명이 적용됩니다.',
        '마약류 투약 시 이중 확인 서명이 필요합니다.',
        '낙상/욕창 재평가 기록에도 서명이 포함됩니다.',
        '생체인증 또는 PIN은 서명할 때마다 입력합니다.',
      ],
    },
    PHARMACIST: {
      title: '약사 전자서명 가이드',
      items: [
        '조제 검수 완료 시 약사 확인 서명이 적용됩니다.',
        '마약류 처방 2차 확인에 전자서명이 사용됩니다.',
        '불출 확인, 조제 완료 등 약국 워크플로우에 서명이 기록됩니다.',
        '서명된 조제 기록은 서명자·시각과 함께 전자서명 원장에 남습니다(외부 블록체인 앵커링은 하지 않습니다).',
      ],
    },
    LAB_TECH: {
      title: '검사자 전자서명 가이드',
      items: [
        '검사기록지 서명 시 전자서명이 적용됩니다.',
        '검사 결과 보고서에 서명이 기록됩니다.',
        '병리 판독 서명도 전자서명 원장에 기록됩니다.',
        '서명값은 인증서 공개키로 검증할 수 있습니다(문서 내용 변경 여부는 증명하지 않습니다).',
      ],
    },
    ADMIN: {
      title: '관리자 전자서명 가이드',
      items: [
        '관리자도 본인 인증서를 설정하여 문서에 서명할 수 있습니다.',
        '「관리자 → 전자인증서」에서 전체 인증서를 관리할 수 있습니다.',
        '퇴직/보안사고 시 직원 인증서를 폐기할 수 있습니다.',
        '감사 로그에서 모든 서명/폐기 이력을 확인할 수 있습니다.',
        '⚠ 관리자도 직원의 개인키에는 접근할 수 없습니다.',
      ],
    },
  };

  const guide = roleGuide[role ?? 'DOCTOR'] ?? roleGuide.DOCTOR;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors"
      >
        <span className="text-sm font-bold text-gray-700"><T k="전자서명 안내" /></span>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-5">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm font-bold text-blue-900 mb-2"><T k={guide.title} /></p>
            <ul className="space-y-1.5">
              {guide.items.map((item, i) => (
                <li key={i} className="text-xs text-blue-700 flex gap-2">
                  <span className="text-blue-400 flex-shrink-0">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-bold text-gray-700 mb-3"><T k="작동 방식" /></p>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg font-bold whitespace-nowrap">1. 키 생성</span>
              <span className="text-gray-300">→</span>
              <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg font-bold whitespace-nowrap">2. 생체인증/PIN</span>
              <span className="text-gray-300">→</span>
              <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg font-bold whitespace-nowrap">3. 문서 서명</span>
              <span className="text-gray-300">→</span>
              <span className="px-3 py-1.5 bg-violet-50 text-violet-700 rounded-lg font-bold whitespace-nowrap">4. 블록체인 기록</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-bold text-gray-700 mb-1">개인키 보호</p>
              <ul className="text-[11px] text-gray-500 space-y-0.5">
                <li>• 브라우저에서만 생성·저장 (서버 전송 없음)</li>
                <li>• 생체인증 (Touch ID/Face ID) 또는 PIN + AES-256 암호화</li>
                <li>• .hrkb 백업 파일로 복원 가능</li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-bold text-gray-700 mb-1">인증 보안</p>
              <ul className="text-[11px] text-gray-500 space-y-0.5">
                <li>• 생체인증: Touch ID/Face ID로 간편 서명</li>
                {/* 🔴 잠금 정책은 서버에 구현돼 있으나 보고하는 화면이 없어 실제로는 동작하지 않았다.
                    현재 실제 적용 범위만 적는다(하지 않은 것을 했다고 적지 않는다). */}
                <li>• PIN 5회 실패 → 10분 잠금, 10회 → 인증서 자동 정지</li>
                <li className="text-amber-600">↳ 현재 <b>이 화면의 ‘서명 테스트’ PIN</b>에만 집계됩니다. 다른 서명 화면의 PIN 실패는 아직 집계되지 않습니다.</li>
                <li>• PIN 분실 → 새 키 생성 (기존 폐기)</li>
              </ul>
            </div>
          </div>

          <div>
            <p className="text-sm font-bold text-gray-700 mb-2"><T k="자주 묻는 질문" /></p>
            <div className="space-y-2">
              {[
                { q: '다른 컴퓨터에서도 서명할 수 있나요?', a: '키 백업 파일(.hrkb)이 있으면 복원하여 사용 가능합니다.' },
                { q: '인증서에 유효기간이 있나요?', a: '있습니다. 발급 시 만료일이 지정되며 인증서 카드의 ‘유효기간(만료일)’이 정본입니다. 직원 자체발급 인증서는 2099-12-31 로 설정되어 사실상 무기한입니다.' },
                { q: 'PIN을 잊어버리면?', a: '새 키를 생성하면 됩니다. 생체인증을 사용하면 PIN이 필요 없습니다. 기존 서명은 계속 유효합니다.' },
              ].map((faq, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs font-bold text-gray-800">Q. {faq.q}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">A. {faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
