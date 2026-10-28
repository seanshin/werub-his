'use client';

import { useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

import { EmptyState, Unit, genderText } from '@/components/ui/display';
import { ageOf } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

const CHANNEL_LABEL: Record<string, string> = { SMS: 'SMS', EMAIL: '이메일', PUSH: '앱 푸시', KAKAO: '카카오톡', PHONE: '전화' };

interface CrmPatient {
  id: string; familyName: string; givenName: string; mrn: string;
  dateOfBirth: string; gender: string; phone: string | null; email: string | null;
  nationality: string | null; tags: string[]; crmScore: number | null; churnRisk: string | null;
  // 응답에 이미 실려 오지만 화면에 없던 값(2026-07 UI 미노출 감사 §5-1)
  rfmSegment: string | null; preferredChannel: string | null; lastContactAt: string | null;
}

interface CrmProfile {
  patient: CrmPatient;
  visitCount: number;
  lastVisitAt: string | null;
  communications: CommLog[];
  consents: { channel: string; type: string; consented: boolean }[];
  checkups: { id: string; scheduledDate: string; status: string; program: { name: string } | null }[];
  hasAbnormalFindings: boolean;
}

interface CommLog {
  id: string; channel: string; direction: string; type: string;
  subject: string | null; content: string | null; status: string; createdAt: string;
}

const CHAN_ICON: Record<string, string> = {
  SMS: '💬', PUSH: '🔔', CALL: '📞', EMAIL: '📧', PORTAL: '🌐', VISIT: '🏥',
};

export default function CrmConsultationPage() {
  const tAttr = useTAttr();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CrmPatient[]>([]);
  const [profile, setProfile] = useState<CrmProfile | null>(null);
  const [logContent, setLogContent] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await apiClient.fetch<{ data: CrmPatient[] }>('/api/v1/crm/proxy/patient-search', {
        params: { q: searchQuery },
      });
      setSearchResults(res.data);
    } catch { /* */ }
  }, [searchQuery]);

  const selectPatient = async (patientId: string) => {
    try {
      const res = await apiClient.fetch<{ data: CrmProfile }>(`/api/v1/crm/patients/${patientId}/profile`);
      setProfile(res.data);
    } catch { /* */ }
  };

  const saveLog = async () => {
    if (!profile || !logContent.trim()) return;
    setSaving(true);
    try {
      await apiClient.fetch('/api/v1/crm/communications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: profile.patient.id,
          channel: 'CALL',
          direction: 'INBOUND',
          type: 'MANUAL',
          subject: '전화 상담',
          content: logContent,
          status: 'DELIVERED',
        }),
      });
      setLogContent('');
      selectPatient(profile.patient.id);
    } catch { /* */ }
    setSaving(false);
  };

  // 정본 계산 — 자체 구현은 생일 전이면 한 살 많았다
  const calcAge = (dob: string) => ageOf(dob) ?? '?';

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="CRM 상담" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="환자 검색 → 상담 → 예약 대행 → 소통 이력 기록" /></p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 좌측: 환자 검색 + 프로필 */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3"><T k="환자 검색" /></h3>
            <div className="flex gap-2">
              <input value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder={tAttr('이름, MRN, 전화번호로 검색...')}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
              <button onClick={handleSearch} className="px-4 py-2.5 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700"><T k="검색" /></button>
            </div>

            {searchResults.length > 0 && (
              <div className="mt-3 space-y-2">
                {searchResults.map(p => (
                  <button key={p.id} onClick={() => selectPatient(p.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${profile?.patient.id === p.id ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">{p.familyName}{p.givenName}</span>
                      <span className="text-xs text-gray-400">{p.mrn}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {calcAge(p.dateOfBirth)}세 {genderText(p.gender)} | {p.phone ?? '-'}
                      {p.churnRisk && <span className={`ml-2 ${p.churnRisk === 'HIGH' ? 'text-red-500' : p.churnRisk === 'MEDIUM' ? 'text-amber-500' : 'text-gray-400'}`}>이탈:{p.churnRisk}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {profile && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3"><T k="환자 CRM 프로필" /></h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-400"><T k="이름" /></span><span className="font-medium">{profile.patient.familyName}{profile.patient.givenName}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">MRN</span><span>{profile.patient.mrn}</span></div>
                <div className="flex justify-between"><span className="text-gray-400"><T k="연락처" /></span><span>{profile.patient.phone ?? '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400"><T k="나이/성별" /></span><span>{calcAge(profile.patient.dateOfBirth)}세 {genderText(profile.patient.gender)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400"><T k="마지막 방문" /></span><span>{profile.lastVisitAt?.slice(0, 10) ?? '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400"><T k="방문 횟수" /></span><span>{profile.visitCount}<Unit>회</Unit></span></div>
                <div className="flex justify-between"><span className="text-gray-400"><T k="CRM 점수" /></span><span>{profile.patient.crmScore ?? '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400"><T k="이탈 위험" /></span>
                  <span className={profile.patient.churnRisk === 'HIGH' ? 'text-red-600 font-bold' : profile.patient.churnRisk === 'MEDIUM' ? 'text-amber-600' : 'text-emerald-600'}>
                    {profile.patient.churnRisk ?? '-'}
                  </span>
                </div>
                {/* RFM 세그먼트·선호 채널·마지막 접촉 — 응답에 있으나 화면에 없던 값.
                    선호 채널은 캠페인 발송 채널 선택의 근거, 마지막 접촉은 재연락 판단 근거다. */}
                <div className="flex justify-between"><span className="text-gray-400"><T k="RFM 세그먼트" /></span>
                  <span className={profile.patient.rfmSegment ? 'font-medium text-gray-900' : 'text-gray-400'}>
                    {profile.patient.rfmSegment ?? <T k="미산출" />}
                  </span>
                </div>
                <div className="flex justify-between"><span className="text-gray-400"><T k="선호 채널" /></span>
                  <span className={profile.patient.preferredChannel ? 'font-medium text-gray-900' : 'text-gray-400'}>
                    <T k={CHANNEL_LABEL[profile.patient.preferredChannel ?? ''] ?? profile.patient.preferredChannel ?? '미지정'} />
                  </span>
                </div>
                <div className="flex justify-between"><span className="text-gray-400"><T k="마지막 접촉" /></span>
                  <span className={profile.patient.lastContactAt ? '' : 'text-gray-400'}>
                    {profile.patient.lastContactAt?.slice(0, 10) ?? <T k="접촉 이력 없음" />}
                  </span>
                </div>
                <div className="flex justify-between"><span className="text-gray-400"><T k="이상 소견" /></span>
                  <span className={profile.hasAbnormalFindings ? 'text-red-600 font-bold' : 'text-emerald-600'}>
                    <T k={profile.hasAbnormalFindings ? '있음' : '없음'} />
                  </span>
                </div>
                {profile.consents.length > 0 && (
                  <div className="flex justify-between"><span className="text-gray-400"><T k="동의" /></span>
                    <span className="text-xs">{profile.consents.filter(c => c.consented).map(c => c.channel).join(', ') || <T k="없음" />}</span>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-3 border-t pt-2"><T k="의료법에 따라 진료 기록, 진단명, 검사 수치는 CRM에서 조회할 수 없습니다." /></p>
            </div>
          )}
        </div>

        {/* 우측: 예약 대행 + 소통 이력 */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3"><T k="예약 대행" /></h3>
            {!profile ? (
              <p className="text-sm text-gray-400 py-4 text-center"><T k="좌측에서 환자를 선택하세요" /></p>
            ) : (
              <div className="space-y-3">
                <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  <option value="">{tAttr('진료과 선택')}</option>
                  <option>{tAttr('내과')}</option><option>{tAttr('외과')}</option><option>{tAttr('정형외과')}</option><option>{tAttr('피부과')}</option>
                  <option>{tAttr('이비인후과')}</option><option>{tAttr('안과')}</option><option>{tAttr('산부인과')}</option><option>{tAttr('가정의학과')}</option>
                </select>
                <input type="date" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  <option value="">{tAttr('시간 선택')}</option>
                  <option>09:00</option><option>09:30</option><option>10:00</option><option>10:30</option>
                  <option>11:00</option><option>14:00</option><option>14:30</option><option>15:00</option>
                </select>
                <div className="flex gap-2">
                  <button className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700"><T k="예약 생성" /></button>
                  <button className="flex-1 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700"><T k="검진 예약" /></button>
                </div>
                <button className="w-full px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-xl hover:bg-gray-200"><T k="당일 접수 대행" /></button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3"><T k="소통 이력" /></h3>
            {!profile ? (
              <p className="text-sm text-gray-400 py-4 text-center"><T k="환자를 선택하면 소통 이력이 표시됩니다" /></p>
            ) : (
              <>
                <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
                  {profile.communications.length === 0 && (
                    <EmptyState icon="🔔" title="소통 이력이 없습니다" />
                  )}
                  {profile.communications.map(log => (
                    <div key={log.id} className="flex items-start gap-2 text-xs">
                      <span className="text-gray-400 whitespace-nowrap">{log.createdAt?.slice(0, 16).replace('T', ' ')}</span>
                      <span>{CHAN_ICON[log.channel] ?? log.channel}</span>
                      <span className={log.direction === 'INBOUND' ? 'text-blue-600' : 'text-gray-600'}>
                        {log.subject ?? log.content?.slice(0, 40) ?? '-'}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3">
                  <textarea value={logContent} onChange={e => setLogContent(e.target.value)} rows={2}
                    placeholder={tAttr('상담 내용 기록...')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" />
                  <button onClick={saveLog} disabled={saving || !logContent.trim()}
                    className="mt-2 px-4 py-2 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 disabled:opacity-30">
                    <T k={saving ? '저장 중...' : '상담 기록 저장'} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
