'use client';

import { HOSPITAL_CONTACT, telHref } from '@/lib/hospital-contact';
import { portalDateText } from '../_shared/portal-date';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import type { PatientInfo, PortalData, MainTab } from '../_types';
import { Icon } from '../_shared';
import { NotificationSettings } from '../_shared/NotificationCenter';
import { ICONS } from '../_icons';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { PT, usePortalTAttr } from '../_shared/PT';

interface MoreTabProps {
  patient: PatientInfo;
  data: PortalData;
  onNavigate: (tab: MainTab, segment?: string) => void;
  onLogout: () => void;
}

export default function MoreTab({ patient, data, onNavigate, onLogout }: MoreTabProps) {
  const [showGuardian, setShowGuardian] = useState(false);
  const [showNotifSettings, setShowNotifSettings] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('portal-font-size') || 'normal';
    return 'normal';
  });
  const [highContrast, setHighContrast] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('portal-high-contrast') === 'true';
    return false;
  });
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('portal-dark-mode') === 'true';
    return false;
  });

  const handleFontSize = (size: string) => {
    const root = document.documentElement;
    root.classList.remove('portal-font-lg', 'portal-font-xl');
    if (size === 'large') root.classList.add('portal-font-lg');
    if (size === 'xlarge') root.classList.add('portal-font-xl');
    localStorage.setItem('portal-font-size', size);
    setFontSize(size);
  };

  const handleHighContrast = () => {
    const root = document.documentElement;
    const next = !highContrast;
    if (next) root.classList.add('portal-high-contrast');
    else root.classList.remove('portal-high-contrast');
    localStorage.setItem('portal-high-contrast', String(next));
    setHighContrast(next);
  };

  const handleDarkMode = () => {
    const root = document.documentElement;
    const next = !darkMode;
    if (next) root.classList.add('portal-dark');
    else root.classList.remove('portal-dark');
    localStorage.setItem('portal-dark-mode', String(next));
    setDarkMode(next);
  };

  const sections = [
    {
      title: '진료 관련',
      items: [
        { label: '예약/대기', desc: '진료 예약 관리', icon: ICONS.calendar, tab: 'care' as MainTab, segment: 'appointments' },
        { label: '진료이력', desc: '과거 진료 기록', icon: ICONS.stethoscope, tab: 'care' as MainTab, segment: 'encounters' },
        { label: '문진표', desc: '사전 문진 작성', icon: ICONS.clipboard, tab: 'care' as MainTab, segment: 'questionnaire', badge: data.questionnaires.filter(q => q.status !== 'COMPLETED' && new Date(q.expiresAt) > new Date()).length },
        { label: '동의서', desc: '법정 동의서', icon: ICONS.document, tab: 'care' as MainTab, segment: 'consent' },
        { label: '비대면진료', desc: '텍스트 상담 · 결과 설명', icon: ICONS.stethoscope, tab: 'care' as MainTab, segment: 'messages' },
        { label: '화상진료', desc: '실시간 영상 진료', icon: ICONS.video, tab: 'services' as MainTab, segment: 'telehealth' },
      ],
    },
    {
      title: '서류 / 수납',
      items: [
        { label: '수납내역', desc: '진료비 납부', icon: ICONS.creditCard, tab: 'services' as MainTab, segment: 'billing', badge: data.billings.filter(b => b.status !== 'PAID').length },
        { label: '서류발급', desc: '증명서/진단서', icon: ICONS.document, tab: 'services' as MainTab, segment: 'documents' },
        { label: `${AI_ORIGIN_TEXT} 예약`, desc: `${AI_ORIGIN_TEXT} 도우미 예약`, icon: ICONS.sparkles, href: '/booking' },
      ],
    },
    {
      title: '병원 안내',
      items: [
        { label: '병원안내', desc: '위치/진료시간', icon: ICONS.building, tab: 'services' as MainTab, segment: 'hospital-info' },
        { label: '병원전화', desc: '대표번호 연결', icon: ICONS.phone, href: telHref(HOSPITAL_CONTACT.main) },
        { label: '자주 묻는 질문', desc: 'FAQ', icon: ICONS.question },
      ],
    },
  ];

  const patientName = `${patient.familyName}${patient.givenName}`;

  return (
    <div className="space-y-5">
      {/* 섹션별 그리드 */}
      {sections.map(section => (
        <div key={section.title}>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">{section.title}</h3>
          <div className="grid grid-cols-3 gap-2">
            {section.items.map(item => {
              const inner = (
                <div className="flex flex-col items-center gap-1.5 py-1 relative">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                    <Icon d={item.icon} cls="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-gray-900">{item.label}</p>
                    <p className="text-[10px] text-gray-500 leading-tight">{item.desc}</p>
                  </div>
                  {(item as { badge?: number }).badge != null && (item as { badge?: number }).badge! > 0 && (
                    <span className="absolute top-0 right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {(item as { badge?: number }).badge}
                    </span>
                  )}
                </div>
              );

              if ((item as { href?: string }).href) {
                return (
                  <a key={item.label} href={(item as { href: string }).href}
                    className="bg-white rounded-2xl border border-gray-100 p-3 hover:shadow-sm transition-all text-center">
                    {inner}
                  </a>
                );
              }
              if (item.tab) {
                return (
                  <button key={item.label} onClick={() => onNavigate(item.tab!, item.segment)}
                    className="bg-white rounded-2xl border border-gray-100 p-3 hover:shadow-sm transition-all">
                    {inner}
                  </button>
                );
              }
              return (
                <div key={item.label} className="bg-white rounded-2xl border border-gray-100 p-3 opacity-60 cursor-not-allowed">
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* 설정 / 계정 */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1"><PT k="설정 / 계정" /></h3>
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100">
          {/* 내 정보 */}
          <button onClick={() => onNavigate('profile')} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <Icon d={ICONS.user} cls="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-gray-900">{patientName} 님</p>
              <p className="text-[10px] text-gray-500">{patient.mrn} · 내 정보 관리</p>
            </div>
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>

          {/* 보호자 관리 */}
          <button onClick={() => setShowGuardian(true)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
            <Icon d={ICONS.user} cls="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-700 flex-1 text-left"><PT k="보호자 관리" /></span>
            <span className="text-[10px] text-gray-400"><PT k="위임 열람" /></span>
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>

          {/* 알림 설정 — F-1 */}
          <button onClick={() => setShowNotifSettings(true)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
            <Icon d={ICONS.bell} cls="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-700 flex-1 text-left"><PT k="알림 설정" /></span>
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>

          {/* 인증서 관리 */}
          <button onClick={() => onNavigate('care', 'consent')} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
            <Icon d={ICONS.lock} cls="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-700 flex-1 text-left"><PT k="인증서 관리" /></span>
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>

          {/* 접근성: 글씨 크기 */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm text-gray-700"><PT k="글씨 크기" /></span>
            </div>
            <div className="flex gap-1">
              {[
                { key: 'normal', label: '보통' },
                { key: 'large', label: '크게' },
                { key: 'xlarge', label: '아주 크게' },
              ].map(opt => (
                <button key={opt.key} onClick={() => handleFontSize(opt.key)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    fontSize === opt.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 접근성: 고대비 */}
          <button onClick={handleHighContrast} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
            <Icon d={ICONS.shield} cls="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-700 flex-1 text-left"><PT k="고대비 모드" /></span>
            <div className={`w-9 h-5 rounded-full transition-colors flex items-center ${highContrast ? 'bg-blue-600 justify-end' : 'bg-gray-300 justify-start'}`}>
              <div className="w-4 h-4 bg-white rounded-full shadow mx-0.5" />
            </div>
          </button>

          {/* 다크모드 */}
          <button onClick={handleDarkMode} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
            </svg>
            <span className="text-sm text-gray-700 flex-1 text-left"><PT k="다크 모드" /></span>
            <div className={`w-9 h-5 rounded-full transition-colors flex items-center ${darkMode ? 'bg-blue-600 justify-end' : 'bg-gray-300 justify-start'}`}>
              <div className="w-4 h-4 bg-white rounded-full shadow mx-0.5" />
            </div>
          </button>
        </div>
      </div>

      {/* 로그아웃 */}
      <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 py-3 text-sm text-red-500 hover:text-red-600 transition-colors">
        <Icon d={ICONS.logout} cls="w-4 h-4" />
        <PT k="로그아웃" />
      </button>

      {showGuardian && <GuardianManager onClose={() => setShowGuardian(false)} />}
      <NotificationSettings open={showNotifSettings} onClose={() => setShowNotifSettings(false)} />
    </div>
  );
}

/* ── 보호자 위임 관리 (등록/전환/이력) ── */
const SCOPE_LABELS: Record<string, string> = { appointments: '예약', encounters: '진료', labs: '검사', billing: '수납', documents: '서류', imaging: '영상' };
function scopeText(scope?: Record<string, boolean> | null): string {
  if (!scope) return '전체';
  const on = Object.entries(scope).filter(([, v]) => v).map(([k]) => SCOPE_LABELS[k] ?? k);
  return on.length ? on.join('/') : '제한';
}

function GuardianManager({ onClose }: { onClose: () => void }) {
  const tAttr = usePortalTAttr();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'list' | 'request' | 'audit' | 'btg'>('list');
  const [form, setForm] = useState({ dependentMrn: '', relationship: '부모', legalBasis: 'MINOR_PARENT' });
  const [btgForm, setBtgForm] = useState({ dependentMrn: '', reason: '' });
  const [busy, setBusy] = useState(false);

  const { data, isError: relIsError, error: relError, refetch: refetchRel } = useQuery({
    queryKey: ['portal-guardians'],
    queryFn: () => apiClient.get<{ data: { asGuardian: any[]; asDependent: any[] } }>('/api/v1/portal/guardians'),
  });
  const rel = ((data?.data as any)?.data ?? data?.data) as { asGuardian: any[]; asDependent: any[] } | undefined;
  const dependents = rel?.asGuardian ?? [];   // 내가 보호자 → 피부양자
  const guardians = rel?.asDependent ?? [];   // 나를 보는 보호자

  const { data: auditData, isError: auditIsError, error: auditError, refetch: refetchAudit } = useQuery({
    queryKey: ['portal-guardian-audit'],
    queryFn: () => apiClient.get<{ data: any[] }>('/api/v1/portal/guardians/audit-log'),
    enabled: tab === 'audit',
  });
  const audits = ((auditData?.data as any)?.data ?? auditData?.data ?? []) as any[];

  // 원래 토큰 보관 후 보호자 토큰으로 교체 → 보호자 모드 진입
  const applyGuardianToken = (token: string, dependent: { name: string; scope: Record<string, boolean> }, guardianshipId: string, btg = false) => {
    const origAccess = localStorage.getItem('accessToken');
    const origPortal = localStorage.getItem('portal-token');
    if (origAccess) localStorage.setItem('portal-token-original', origAccess);
    if (origPortal) localStorage.setItem('portal-token-original-pt', origPortal);
    apiClient.setToken(token);
    if (origPortal !== null) localStorage.setItem('portal-token', token);
    localStorage.setItem('guardian-mode', JSON.stringify({ name: dependent.name, scope: dependent.scope, guardianshipId, btg }));
    window.location.reload();
  };

  const switchTo = async (g: any) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiClient.post<{ data: { token: string; dependent: { name: string; scope: Record<string, boolean> } } }>(`/api/v1/portal/guardians/switch/${g.id}`, {});
      const d = ((res?.data as any)?.data ?? res?.data) as { token: string; dependent: { name: string; scope: Record<string, boolean> } };
      if (!d?.token) { alert('전환에 실패했습니다.'); setBusy(false); return; }
      applyGuardianToken(d.token, d.dependent, g.id);
    } catch { alert('전환에 실패했습니다.'); setBusy(false); }
  };

  // Break-the-Glass 긴급 열람
  const emergencySwitch = async () => {
    if (!btgForm.dependentMrn.trim() || btgForm.reason.trim().length < 5 || busy) return;
    if (!confirm('긴급 열람은 관리자에게 즉시 통보되며 24시간 후 자동 종료됩니다. 사후 서류 제출이 필요할 수 있습니다. 계속하시겠습니까?')) return;
    setBusy(true);
    try {
      const res = await apiClient.post<{ data: { token: string; guardianshipId: string; dependent: { name: string; scope: Record<string, boolean> }; oversight?: { notifiedAdmins: number; adminCount: number } } }>('/api/v1/portal/guardians/break-the-glass', btgForm);
      const d = ((res?.data as any)?.data ?? res?.data) as { token: string; guardianshipId: string; dependent: { name: string; scope: Record<string, boolean> }; oversight?: { notifiedAdmins: number; adminCount: number } };
      if (!d?.token) { alert('긴급 열람에 실패했습니다.'); setBusy(false); return; }
      // 🔴 "관리자에게 즉시 통보됩니다"는 실제로 통보가 남았을 때만 사실이다.
      //    통보가 0건이면(관리자 부재·기록 실패) 그 사실을 숨기지 않는다 — 열람은 진행하되 사람이 알게 한다.
      if (d.oversight && d.oversight.notifiedAdmins === 0) {
        alert('⚠️ 긴급 열람은 시작되었지만 관리자 통보가 남지 않았습니다.\n병원 원무과(대표전화)로 즉시 알려주세요. 열람 기록은 감사 로그에 남습니다.');
      }
      applyGuardianToken(d.token, d.dependent, d.guardianshipId, true);
    } catch (e: unknown) {
      // 🔴 ApiError 에는 response 가 없다 — 종전엔 서버 사유가 늘 일반 문구로 덮였다(2026-09-29 외국인 등록에서 발견·같은 형태 봉합)
      alert(extractErrorMessage(e) || '긴급 열람에 실패했습니다.');
      setBusy(false);
    }
  };

  const submitRequest = async () => {
    if (!form.dependentMrn.trim() || busy) return;
    setBusy(true);
    try {
      await apiClient.post('/api/v1/portal/guardians/request', form);
      alert('보호자 등록 요청이 접수되었습니다. 병원 승인 후 이용할 수 있습니다.');
      setForm({ dependentMrn: '', relationship: '부모', legalBasis: 'MINOR_PARENT' });
      queryClient.invalidateQueries({ queryKey: ['portal-guardians'] });
      setTab('list');
    } catch (e: unknown) {
      alert(extractErrorMessage(e) || '요청에 실패했습니다.');
    }
    setBusy(false);
  };

  const removeRel = async (id: string) => {
    if (!confirm('보호자 관계를 해제하시겠습니까?')) return;
    try { await apiClient.del(`/api/v1/portal/guardians/${id}`); queryClient.invalidateQueries({ queryKey: ['portal-guardians'] }); } catch { alert('해제에 실패했습니다.'); }
  };

  const fmtD = (d: string) => portalDateText(d, 'monthDayTimeShort');
  const statusBadge = (g: any) => g.isApproved
    ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap"><PT k="승인완료" /></span>
    : g.rejectedReason
      ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 whitespace-nowrap"><PT k="거절" /></span>
      : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap"><PT k="승인 대기" /></span>;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900"><PT k="보호자 관리" /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none"><span className="sr-only"><PT k="닫기" /></span>✕</button>
        </div>

        <div className="flex border-b border-gray-100">
          {[{ k: 'list', l: '관계' }, { k: 'request', l: '등록 요청' }, { k: 'audit', l: '열람 이력' }, { k: 'btg', l: '긴급' }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k as typeof tab)}
              className={`flex-1 py-2.5 text-xs font-medium ${tab === t.k ? (t.k === 'btg' ? 'text-red-600 border-b-2 border-red-600' : 'text-blue-600 border-b-2 border-blue-600') : (t.k === 'btg' ? 'text-red-400' : 'text-gray-400')}`}>{t.l}</button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {tab === 'list' && (
            <>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2"><PT k="내 피부양자 (내가 보호자)" /></p>
                {relIsError ? <QueryErrorFallback error={relError} onRetry={refetchRel} size="compact" /> : dependents.length === 0 ? <p className="text-[11px] text-gray-400">등록된 피부양자가 없습니다.</p> : (
                  <div className="space-y-2">
                    {dependents.map((g: any) => (
                      <div key={g.id} className="border border-gray-200 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-gray-900">{g.dependent?.patient?.familyName}{g.dependent?.patient?.givenName} 님 <span className="text-[10px] text-gray-400 font-normal">({g.relationship})</span></p>
                          {statusBadge(g)}
                        </div>
                        <p className="text-[10px] text-gray-500">열람 범위: {scopeText(g.accessScope)}{g.expiresAt ? ` · ~${portalDateText(g.expiresAt, 'date')}` : ''}</p>
                        <div className="flex gap-2 mt-2">
                          {g.isApproved && (
                            <button onClick={() => switchTo(g)} disabled={busy}
                              className="flex-1 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"><PT k="전환하여 열람" /></button>
                          )}
                          <button onClick={() => removeRel(g.id)} className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50"><PT k="해제" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2"><PT k="내 보호자 (나를 열람)" /></p>
                {relIsError ? <QueryErrorFallback error={relError} onRetry={refetchRel} size="compact" /> : guardians.length === 0 ? <p className="text-[11px] text-gray-400">등록된 보호자가 없습니다.</p> : (
                  <div className="space-y-2">
                    {guardians.map((g: any) => (
                      <div key={g.id} className="border border-gray-200 rounded-xl p-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{g.guardian?.patient?.familyName}{g.guardian?.patient?.givenName} 님 <span className="text-[10px] text-gray-400">({g.relationship})</span></p>
                          <p className="text-[10px] text-gray-500">열람 범위: {scopeText(g.accessScope)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {statusBadge(g)}
                          <button onClick={() => removeRel(g.id)} className="text-[11px] text-red-500"><PT k="해제" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'request' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block"><PT k="피부양자 환자번호 (MRN)" /></label>
                <input value={form.dependentMrn} onChange={e => setForm({ ...form, dependentMrn: e.target.value })}
                  placeholder={tAttr('진료카드에 적힌 번호')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-200" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block"><PT k="관계" /></label>
                <div className="grid grid-cols-4 gap-1.5">
                  {['부모', '자녀', '배우자', '기타'].map(r => (
                    <button key={r} onClick={() => setForm({ ...form, relationship: r })}
                      className={`py-2 text-xs rounded-lg border ${form.relationship === r ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>{r}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block"><PT k="법적 근거" /></label>
                <select value={form.legalBasis} onChange={e => setForm({ ...form, legalBasis: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                  <option value="MINOR_PARENT">미성년 자녀의 친권자</option>
                  <option value="PATIENT_CONSENT">환자 본인 동의</option>
                  <option value="INCAPACITATED">의식불명/의사무능력</option>
                  <option value="DECEASED">사망 환자 유족</option>
                  <option value="POA">위임장 기반 대리인</option>
                </select>
              </div>
              <p className="text-[10px] text-amber-600">⚠️ 허위 서류 제출 시 법적 처벌을 받을 수 있습니다. 병원에서 서류 확인 후 승인됩니다.</p>
              <button onClick={submitRequest} disabled={!form.dependentMrn.trim() || busy}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50">{busy ? '요청 중...' : '등록 요청'}</button>
            </div>
          )}

          {tab === 'audit' && (
            <div className="space-y-2">
              <p className="text-[11px] text-gray-500">내 정보를 열람한 보호자 활동 이력입니다.</p>
              {auditIsError ? <QueryErrorFallback error={auditError} onRetry={refetchAudit} size="compact" /> : audits.length === 0 ? <p className="text-[11px] text-gray-400">열람 이력이 없습니다.</p> : audits.map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between border-b border-gray-50 py-2">
                  <span className="text-xs text-gray-700">{(a.action ?? '').replace('GUARDIAN_', '').replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-gray-400">{a.accessedAt ? fmtD(a.accessedAt) : ''}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'btg' && (
            <div className="space-y-3">
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[11px] text-red-700 space-y-1">
                <p className="font-bold">🚨 긴급 열람 (Break-the-Glass)</p>
                <p>응급 상황에서 승인 전 환자 정보를 즉시 열람합니다. 진료/검사 정보만 24시간 열람 가능하며, 관리자에게 즉시 통보되고 사후 서류 제출이 필요합니다.</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block"><PT k="환자번호 (MRN)" /></label>
                <input value={btgForm.dependentMrn} onChange={e => setBtgForm({ ...btgForm, dependentMrn: e.target.value })}
                  placeholder={tAttr('진료카드에 적힌 번호')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block"><PT k="긴급 열람 사유 (필수)" /></label>
                <textarea value={btgForm.reason} onChange={e => setBtgForm({ ...btgForm, reason: e.target.value })} rows={3}
                  placeholder="예: 의식불명 상태로 응급실 내원, 기저질환/복용약 확인 필요" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-red-200" />
              </div>
              <button onClick={emergencySwitch} disabled={!btgForm.dependentMrn.trim() || btgForm.reason.trim().length < 5 || busy}
                className="w-full py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 hover:bg-red-700">
                {busy ? '처리 중...' : '긴급 열람 시작'}
              </button>
              <p className="text-[10px] text-gray-400 text-center">의료법 제21조 · 모든 긴급 열람은 감사 기록으로 보존됩니다</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
