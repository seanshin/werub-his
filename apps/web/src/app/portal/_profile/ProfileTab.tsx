'use client';
import { useState, useEffect } from 'react';
import { portalDateText } from '../_shared/portal-date';
import { genderText } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PatientInfo, PortalItem } from '../_types';
import { fmt } from '../_helpers';
import { Icon, EmptyState, SkeletonCard, InfoRow } from '../_shared';
import { QrImage } from '@/components/ui/QrImage';
import { buildPatientQr } from '@hospital-run/shared';
import { ICONS } from '../_icons';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { isAccountRequired, mayCallAccountFeature, useAccountFeature } from '../_auth/session-check';
import { PT, usePortalTAttr } from '../_shared/PT';

interface ProfileTabProps {
  patient: PatientInfo;
  onLogout: () => void;
}

export default function ProfileTab({ patient, onLogout }: ProfileTabProps) {
  const tAttr = usePortalTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-profile'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/portal/profile'),
  });
  // 🔴 (A1) 계정 없는 세션은 계정 전용 기능을 부르지 않는다 — 능력표 false 면 처음부터 안내
  const nidAllowed = useAccountFeature('nationalId');
  const { data: nidData, refetch: refetchNid, isError: nidIsErr, error: nidQueryError } = useQuery({
    queryKey: ['portal-nid'],
    queryFn: () =>
      apiClient
        .get<{ data: Record<string, unknown> }>('/api/v1/patient-auth/profile/national-id/masked'),
    enabled: mayCallAccountFeature(nidAllowed),
  });
  const nidNeedsAccount = nidAllowed === false || (nidIsErr && isAccountRequired(nidQueryError));
  const nidIsError = nidIsErr && !nidNeedsAccount;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ phone: '', email: '', address: '' });
  const [nidEditing, setNidEditing] = useState(false);
  const [nidForm, setNidForm] = useState({ nationalId: '', password: '' });
  const [nidError, setNidError] = useState('');
  const profile: PortalItem | undefined = ((data?.data as unknown as PortalItem)?.data ?? data?.data) as PortalItem | undefined;
  const nidRaw = nidData?.data as unknown as PortalItem | undefined;
  const nidRawData = nidRaw?.data as PortalItem | undefined;
  const maskedNid = (nidRawData?.masked ?? nidRaw?.masked ?? null) as string | null;

  if (isLoading) return <SkeletonCard lines={6} />;
  // 🔴 (포털 A6) 실패면 재시도·세션 만료 안내가 있는 공용 실패 화면 — 빈 상태로 말하지 않는다
  if (isError && !profile) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />;
  if (!profile) return <EmptyState icon="👤" title="정보를 불러올 수 없습니다." />;

  const startEdit = () => {
    setForm({ phone: String(profile.phone ?? ''), email: String(profile.email ?? ''), address: String(profile.address ?? '') });
    setEditing(true);
  };
  const saveEdit = async () => {
    try {
      await apiClient.put('/api/v1/portal/profile', form);
      setEditing(false);
      refetch();
    } catch {
      alert('저장에 실패했습니다.');
    }
  };
  const saveNid = async () => {
    setNidError('');
    const clean = nidForm.nationalId.replace(/-/g, '');
    if (clean.length !== 13) {
      setNidError('13자리를 입력해 주세요.');
      return;
    }
    if (!nidForm.password) {
      setNidError('비밀번호를 입력해 주세요.');
      return;
    }
    try {
      const res = await apiClient.put<{ data?: Record<string, unknown>; error?: { message?: string } }>(
        '/api/v1/patient-auth/profile/national-id',
        { nationalId: clean, password: nidForm.password },
      );
      if (res.error) {
        setNidError(res.error.message ?? '저장에 실패했습니다.');
        return;
      }
      setNidEditing(false);
      setNidForm({ nationalId: '', password: '' });
      refetchNid();
    } catch (e: unknown) {
      setNidError(e instanceof Error ? e.message : '저장에 실패했습니다.');
    }
  };

  return (
    <div className="space-y-3">
      {/* ── 기본 정보 ── */}
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-900"><PT k="내 정보" /></h3>
        {!editing && (
          <button onClick={startEdit} className="text-xs text-blue-600 hover:underline">
            <PT k="수정" />
          </button>
        )}
      </div>
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <InfoRow label={tAttr('이름')} value={`${String(profile.familyName ?? '')}${String(profile.givenName ?? '')}`} />
        <InfoRow label={tAttr('등록번호')} value={String(profile.mrn ?? '')} />
        <InfoRow label={tAttr('생년월일')} value={fmt(profile.dateOfBirth as string)} />
        <InfoRow label={tAttr('성별')} value={genderText(profile.gender as string | null | undefined)} />
        <InfoRow label={tAttr('보험')} value={String(profile.insuranceType ?? '')} />

        {/* 주민등록번호 */}
        <div className="border-t pt-3">
          {nidEditing ? (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500"><PT k="주민등록번호" /></label>
                <input
                  value={nidForm.nationalId}
                  onChange={e => {
                    const v = e.target.value.replace(/[^0-9-]/g, '');
                    setNidForm(f => ({ ...f, nationalId: v }));
                  }}
                  placeholder="000000-0000000"
                  maxLength={14}
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5 font-mono tracking-wider"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500"><PT k="비밀번호 확인" /></label>
                <input
                  type="password"
                  value={nidForm.password}
                  onChange={e => setNidForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={tAttr('본인 확인용 비밀번호')}
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5"
                />
              </div>
              {nidError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">{nidError}</p>}
              <div className="flex gap-2">
                <button onClick={saveNid} className="flex-1 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                  <PT k="저장" />
                </button>
                <button
                  onClick={() => {
                    setNidEditing(false);
                    setNidError('');
                  }}
                  className="flex-1 py-2 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center">
              {/* 🔴 조회 실패를 '미등록'이라고 말하지 않는다 — 등록 여부를 모르는 것이다 */}
              {nidNeedsAccount ? (
                <div className="flex-1"><AccountRequiredNote /></div>
              ) : nidIsError ? (
                <QueryErrorFallback error={nidQueryError} onRetry={refetchNid} size="compact" className="flex-1" />
              ) : (
              <div className="flex justify-between flex-1 text-sm">
                <span className="text-gray-500"><PT k="주민등록번호" /></span>
                <span className="text-gray-900 font-medium font-mono">{String(maskedNid ?? '미등록')}</span>
              </div>
              )}
              {!nidNeedsAccount && <button
                onClick={() => setNidEditing(true)}
                className="ml-3 text-[10px] text-blue-600 bg-blue-50 px-2 py-1 rounded-md hover:bg-blue-100"
              >
                {maskedNid ? '변경' : '등록'}
              </button>}
            </div>
          )}
        </div>

        <div className="border-t pt-3">
          {editing ? (
            <>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-500"><PT k="연락처" /></label>
                  <input
                    value={form.phone}
                    maxLength={20}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500"><PT k="이메일" /></label>
                  <input
                    value={form.email}
                    maxLength={200}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500"><PT k="주소" /></label>
                  <input
                    value={form.address}
                    maxLength={500}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={saveEdit} className="flex-1 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                  <PT k="저장" />
                </button>
                <button onClick={() => setEditing(false)} className="flex-1 py-2 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200">
                  취소
                </button>
              </div>
            </>
          ) : (
            <>
              <InfoRow label={tAttr('연락처')} value={String(profile.phone ?? '-')} />
              <InfoRow label={tAttr('이메일')} value={String(profile.email ?? '-')} />
              <InfoRow label={tAttr('주소')} value={String(profile.address ?? '-')} />
            </>
          )}
        </div>
      </div>

      {/* ── 내 QR 코드 ── */}
      <MyQrSection profile={profile} />

      {/* ── 내 인증서 ── */}
      <CertificateSection />

      {/* ── 내 기록 열람 이력 ── */}
      <AuditLogSection />

      {/* ── 보호자/가족 ── */}
      <FamilySection />

      {/* ── 가족 계정 전환 ── */}
      <FamilyAccountSection />

      {/* ── 화면 설정 (접근성) ── */}
      <AccessibilitySettings />

      {/* ── 로그아웃 ── */}
      <div className="pt-4">
        <button
          onClick={onLogout}
          className="w-full py-3 bg-gray-100 text-gray-600 text-sm font-medium rounded-xl hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <PT k="로그아웃" />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MyQrSection — 본인 확인/접수용 QR 코드
   ═══════════════════════════════════════════════════════════════ */

function MyQrSection({ profile }: { profile: PortalItem }) {
  const tAttr = usePortalTAttr();
  const [zoom, setZoom] = useState(false);

  // 확대 모달: Esc 키로 닫기
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoom]);

  const name = `${String(profile.familyName ?? '')}${String(profile.givenName ?? '')}`;
  const mrn = String(profile.mrn ?? '');

  /**
   * 🔴 2026-08-18 봉합: 이 QR 은 **환자 본인 화면**인데도 `api.qrserver.com` 으로
   *    MRN·성명·생년월일·성별을 URL 쿼리에 담아 보내고 있었다(외부 접근 로그에 PHI 잔존).
   *    이제 브라우저 안에서 생성하고(`QrImage`), 페이로드는 발급 정본 `buildPatientQr`(MRN 만)로
   *    통일한다 — PatientHeader(팔찌)·BCMA·접수 스캔이 같은 형식을 쓴다.
   */
  const qrData = buildPatientQr(mrn);

  if (!mrn) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
        <Icon d={ICONS.user} cls="w-4 h-4 text-blue-500" /><PT k="내 QR 코드" />
      </h3>
      <div className="bg-white rounded-xl border p-4 flex flex-col items-center">
        <button
          onClick={() => setZoom(true)}
          aria-label={tAttr('QR 코드 확대')}
          className="rounded-xl border border-gray-100 p-2 hover:border-blue-300 transition-colors"
        >
          <QrImage value={qrData} size={160} alt={`${name} 본인확인 QR 코드`} className="block" />
        </button>
        <p className="text-sm font-semibold text-gray-900 mt-3">{name}</p>
        <p className="text-xs text-gray-500 font-mono mt-0.5">{mrn}</p>
        <p className="text-[11px] text-gray-400 mt-2 text-center leading-relaxed">
          접수·수납 창구에서 본인 확인용으로 제시하세요.
          <br />
          탭하면 크게 볼 수 있습니다.
        </p>
      </div>

      {/* 확대 모달 */}
      {zoom && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
          aria-label={tAttr('QR 코드 확대')}
          onClick={() => setZoom(false)}
        >
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center max-w-xs w-full" onClick={e => e.stopPropagation()}>
            <QrImage value={qrData} size={280} alt={`${name} 본인확인 QR 코드`} className="block" />
            <p className="text-base font-bold text-gray-900 mt-4">{name}</p>
            <p className="text-sm text-gray-500 font-mono mt-1">{mrn}</p>
            <p className="text-xs text-gray-400 mt-1">
              {fmt(profile.dateOfBirth as string)} · {genderText(profile.gender as string | null | undefined)}
            </p>
            <button
              autoFocus
              onClick={() => setZoom(false)}
              className="w-full mt-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200"
            >
              <PT k="닫기" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AccessibilitySettings
   ═══════════════════════════════════════════════════════════════ */

function AccessibilitySettings() {
  const tAttr = usePortalTAttr();
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('portal-font-size') as 'normal' | 'large' | 'xlarge') || 'normal';
    return 'normal';
  });
  const [highContrast, setHighContrast] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('portal-high-contrast') === 'true';
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('portal-font-lg', 'portal-font-xl', 'portal-high-contrast');
    if (fontSize === 'large') root.classList.add('portal-font-lg');
    if (fontSize === 'xlarge') root.classList.add('portal-font-xl');
    if (highContrast) root.classList.add('portal-high-contrast');
    localStorage.setItem('portal-font-size', fontSize);
    localStorage.setItem('portal-high-contrast', String(highContrast));
  }, [fontSize, highContrast]);

  const sizes: { key: 'normal' | 'large' | 'xlarge'; label: string; cls: string }[] = [
    { key: 'normal', label: '가', cls: 'text-sm' },
    { key: 'large', label: '가', cls: 'text-base' },
    { key: 'xlarge', label: '가', cls: 'text-xl' },
  ];

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2"><PT k="화면 설정" /></h3>
      <div className="bg-white rounded-xl border p-4 space-y-4">
        {/* 글자 크기 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700"><PT k="글자 크기" /></span>
          <div className="flex gap-1.5">
            {sizes.map(s => (
              <button
                key={s.key}
                onClick={() => setFontSize(s.key)}
                aria-label={`글자 크기 ${s.key === 'normal' ? '보통' : s.key === 'large' ? '크게' : '매우 크게'}`}
                className={`w-9 h-9 rounded-lg flex items-center justify-center font-medium transition-colors ${
                  fontSize === s.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                } ${s.cls}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t" />

        {/* 고대비 모드 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700"><PT k="고대비 모드" /></span>
          <button
            onClick={() => setHighContrast(v => !v)}
            role="switch"
            aria-checked={highContrast}
            aria-label={tAttr('고대비 모드 토글')}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              highContrast ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                highContrast ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CertificateSection
   ═══════════════════════════════════════════════════════════════ */

function CertificateSection() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-cert'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/cert/my'),
  });

  const raw = data?.data;
  const certs = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];

  const statusLabel: Record<string, { text: string; cls: string }> = {
    PENDING: { text: '승인 대기중', cls: 'bg-amber-100 text-amber-700' },
    ACTIVE: { text: '활성', cls: 'bg-emerald-100 text-emerald-700' },
    EXPIRED: { text: '만료', cls: 'bg-gray-100 text-gray-600' },
    REVOKED: { text: '폐기', cls: 'bg-red-100 text-red-600' },
    SUSPENDED: { text: '정지', cls: 'bg-orange-100 text-orange-700' },
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
        <Icon d={ICONS.shield} cls="w-4 h-4 text-blue-500" />
        <PT k="내 인증서" />
      </h3>
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
      ) : isLoading ? (
        <SkeletonCard lines={2} />
      ) : certs.length === 0 ? (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs text-blue-800 leading-relaxed">등록된 전자서명 인증서가 없습니다. 이 앱에서는 인증서를 발급하지 않으며, 동의서 서명은 이름 입력으로 기록됩니다.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {certs.map((c: PortalItem) => {
            const cStatus = String(c.status ?? '');
            const st = statusLabel[cStatus] ?? { text: cStatus, cls: 'bg-gray-100 text-gray-600' };
            return (
              <div key={String(c.id)} className={`rounded-xl border p-3 ${cStatus === 'ACTIVE' ? 'bg-emerald-50 border-emerald-200' : 'bg-white'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${st.cls}`}>{st.text}</span>
                  <span className="text-[10px] text-gray-500 font-mono">{String(c.serialNumber ?? '')}</span>
                </div>
                <div className="text-xs text-gray-600 space-y-0.5">
                  <p>알고리즘: {String(c.algorithm ?? '')}</p>
                  <p>발급일: {fmt(c.issuedAt as string)}</p>
                  <p>만료일: {fmt(c.expiresAt as string)}</p>
                </div>
                {cStatus === 'ACTIVE' && <p className="text-[10px] text-gray-500 mt-1.5">동의서 서명에는 적용되지 않습니다(이름 입력으로 기록).</p>}
                {cStatus === 'PENDING' && <p className="text-[10px] text-amber-600 mt-1.5">관리자 승인을 기다리고 있습니다.</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AuditLogSection
   ═══════════════════════════════════════════════════════════════ */

function AuditLogSection() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-audit-log'],
    queryFn: () =>
      apiClient
        .get<{ data: unknown }>('/api/v1/portal/audit-log'),
  });

  const raw = data?.data;
  const auditData = (raw as unknown as PortalItem)?.data ?? raw;
  const btgAccesses = ((auditData as PortalItem)?.btgAccesses ?? []) as PortalItem[];
  const recordAccesses = ((auditData as PortalItem)?.recordAccesses ?? []) as PortalItem[];
  const allLogs = [
    ...btgAccesses.map((b: PortalItem) => ({
      id: String(b.id ?? ''),
      at: String(b.accessedAt ?? ''),
      by: String(b.accessedBy ?? ''),
      dept: String(b.department ?? ''),
      action: String(b.reason ?? '긴급 접근 (BTG)'),
      isBtg: true,
    })),
    ...recordAccesses.map((r: PortalItem) => ({
      id: String(r.id ?? ''),
      at: String(r.timestamp ?? ''),
      by: String(r.userName ?? ''),
      dept: String(r.department ?? ''),
      action: String(r.action ?? '기록 열람'),
      isBtg: false,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
        <Icon d={ICONS.document} cls="w-4 h-4 text-purple-500" />
        <PT k="내 기록 열람 이력" />
      </h3>
      {/* 🔴 조회 실패를 "열람 기록이 없습니다"로 말하면 안심시키는 거짓말이 된다 */}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
      ) : isLoading ? (
        <SkeletonCard lines={3} />
      ) : allLogs.length === 0 ? (
        <div className="bg-gray-50 rounded-xl border p-3 text-xs text-gray-500">열람 기록이 없습니다.</div>
      ) : (
        <div className="bg-white rounded-xl border divide-y max-h-48 overflow-y-auto">
          {allLogs.slice(0, 20).map(log => (
            <div key={log.id} className={`px-3 py-2 flex items-center justify-between ${log.isBtg ? 'bg-red-50' : ''}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {portalDateText(log.at, 'monthDayTime2')}
                </span>
                <span className="text-xs text-gray-800 truncate">
                  {log.by} ({log.dept})
                </span>
              </div>
              <span className={`text-[10px] whitespace-nowrap ml-2 ${log.isBtg ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                {log.isBtg ? 'BTG' : log.action}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FamilySection
   ═══════════════════════════════════════════════════════════════ */

function FamilySection() {
  const allowed = useAccountFeature('family');
  const { data, refetch, isError: isErr, error } = useQuery({
    queryKey: ['portal-family'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/patient-auth/profile/family'),
    enabled: mayCallAccountFeature(allowed),
  });
  const needsAccount = allowed === false || (isErr && isAccountRequired(error));
  const isError = isErr && !needsAccount;
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ relationship: '', name: '', phone: '', isEmergencyContact: false });

  const raw = data?.data;
  const members = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];

  const save = async () => {
    if (!form.name || !form.relationship) return;
    try {
      await apiClient.post('/api/v1/patient-auth/profile/family', form);
      setAdding(false);
      setForm({ relationship: '', name: '', phone: '', isEmergencyContact: false });
      refetch();
    } catch {
      alert('저장에 실패했습니다.');
    }
  };
  const remove = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await apiClient.del(`/api/v1/patient-auth/profile/family/${id}`);
      refetch();
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold text-gray-900"><PT k="보호자/가족" /></h3>
        {!adding && !needsAccount && (
          <button onClick={() => setAdding(true)} className="text-xs text-blue-600 hover:underline">
            <PT k="+ 추가" />
          </button>
        )}
      </div>
      {adding && (
        <div className="bg-white rounded-xl border p-4 mb-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500"><PT k="관계" /></label>
              <select
                value={form.relationship}
                onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5"
              >
                <option value=""><PT k="선택" /></option>
                <option value="SPOUSE"><PT k="배우자" /></option>
                <option value="PARENT"><PT k="부모" /></option>
                <option value="CHILD"><PT k="자녀" /></option>
                <option value="SIBLING"><PT k="형제자매" /></option>
                <option value="OTHER"><PT k="기타" /></option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500"><PT k="이름" /></label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500"><PT k="연락처" /></label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isEmergencyContact}
                  onChange={e => setForm(f => ({ ...f, isEmergencyContact: e.target.checked }))}
                  className="rounded"
                />
                <PT k="비상연락처" />
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
              <PT k="저장" />
            </button>
            <button onClick={() => setAdding(false)} className="flex-1 py-2 bg-gray-100 text-gray-600 text-xs rounded-lg">
              취소
            </button>
          </div>
        </div>
      )}
      {needsAccount ? (
        <AccountRequiredNote />
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
      ) : members.length === 0 && !adding ? (
        <div className="bg-gray-50 rounded-xl border p-3 text-xs text-gray-500 text-center">등록된 보호자가 없습니다.</div>
      ) : (
        <div className="space-y-1.5">
          {members.map((m: PortalItem) => {
            const rel: Record<string, string> = { SPOUSE: '배우자', PARENT: '부모', CHILD: '자녀', SIBLING: '형제자매', OTHER: '기타' };
            const mRelationship = String(m.relationship ?? '');
            const mId = String(m.id ?? '');
            return (
              <div key={mId} className="bg-white rounded-xl border p-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{rel[mRelationship] ?? mRelationship}</span>
                    <p className="text-sm font-medium text-gray-900">{String(m.name ?? '')}</p>
                    {!!m.isEmergencyContact && (
                      <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full whitespace-nowrap"><PT k="비상" /></span>
                    )}
                  </div>
                  {m.phone != null && <p className="text-xs text-gray-500 mt-0.5">{String(m.phone)}</p>}
                </div>
                <button onClick={() => remove(m.id as string)} className="text-xs text-gray-400 hover:text-red-500">
                  <PT k="삭제" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FamilyAccountSection
   ═══════════════════════════════════════════════════════════════ */

function FamilyAccountSection() {
  const allowed = useAccountFeature('familyAccounts');
  const { data, isLoading, isError: isErr, error, refetch } = useQuery({
    queryKey: ['portal-family-accounts'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/patient-auth/profile/family-accounts'),
    enabled: mayCallAccountFeature(allowed),
  });
  const needsAccount = allowed === false || (isErr && isAccountRequired(error));
  const isError = isErr || needsAccount;

  const raw = data?.data;
  const accounts = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];

  const relLabel: Record<string, string> = { SPOUSE: '배우자', PARENT: '부모', CHILD: '자녀', SIBLING: '형제자매', OTHER: '기타' };

  const switchAccount = async (accountId: string) => {
    if (!confirm('해당 가족 계정으로 전환하시겠습니까?')) return;
    try {
      const res = await apiClient.post<{ data: { accessToken: string } }>(
        `/api/v1/patient-auth/profile/family-accounts/${accountId}/switch`,
        {},
      );
      const resData = res.data as PortalItem | undefined;
      const resOuter = res as unknown as PortalItem;
      const token = (resData?.accessToken ?? (resOuter?.data as PortalItem | undefined)?.accessToken) as string | undefined;
      if (token) {
        apiClient.setToken(token as string);
        window.location.reload();
      } else {
        alert('계정 전환에 실패했습니다.');
      }
    } catch {
      alert('계정 전환에 실패했습니다.');
    }
  };

  // 🔴 조회 실패로 섹션이 사라지면 "가족 계정 없음"으로 읽힌다
  if (isError) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2"><PT k="가족 계정" /></h3>
        {needsAccount ? <AccountRequiredNote /> : <QueryErrorFallback error={error} onRetry={refetch} size="compact" />}
      </div>
    );
  }
  if (isLoading) return null;
  if (!accounts.length) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
        <Icon d={ICONS.user} cls="w-4 h-4 text-blue-500" />
        <PT k="가족 계정" />
      </h3>
      <div className="bg-white rounded-xl border p-4">
        <p className="text-xs text-gray-500 mb-3">등록된 가족 계정으로 전환하여 가족의 진료 정보를 확인할 수 있습니다.</p>
        <div className="space-y-2">
          {accounts.map((acc: PortalItem) => {
            const accId = String(acc.id ?? '');
            const accName = String(acc.name ?? '');
            const accFamilyName = String(acc.familyName ?? '');
            const accGivenName = String(acc.givenName ?? '');
            const accRelationship = String(acc.relationship ?? '');
            return (
            <div key={accId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <Icon d={ICONS.user} cls="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{accName || `${accFamilyName}${accGivenName}`}</p>
                  <p className="text-[10px] text-gray-500">{relLabel[accRelationship] ?? accRelationship}</p>
                </div>
              </div>
              <button
                onClick={() => switchAccount(accId)}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <PT k="전환" />
              </button>
            </div>
          ); })}
        </div>
      </div>
    </div>
  );
}

/** 등록번호·보호자 세션 — 계정 전용 기능 안내(조회 실패·세션 만료가 아니다) */
function AccountRequiredNote() {
  return (
    <p className="bg-gray-50 rounded-xl border px-3 py-2 text-xs text-gray-600" data-portal-account-required>
      <PT k="휴대폰 번호로 가입한 계정으로 로그인하면 이용할 수 있습니다." />
      {/* 🔴 (2026-10-19 포털 B7) 막다른 안내였다 — 가입 화면으로 바로 잇는다. 가입은 본인확인을 거치고(서버),
          지금 등록번호 세션은 먼저 끝낸다(한 브라우저에 두 신원을 남기지 않는다) */}
      {' '}<a href="/portal?signup=1" data-portal-account-signup className="font-medium text-blue-600 underline"
        onClick={(e) => { e.preventDefault(); void apiClient.post('/api/v1/portal/auth/logout').catch(() => null).finally(() => { apiClient.setToken(null); window.location.assign('/portal?signup=1'); }); }}>
        <PT k="계정 만들기" />
      </a>
    </p>
  );
}
