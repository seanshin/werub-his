'use client';

import { useState } from 'react';
import { SITE_INFO, isDialable } from '@/lib/site-info';
import type { ClinicHours } from '@/lib/clinic-hours';
import { ClinicHoursNotice } from '@/components/homepage/ClinicHoursNotice';
import Link from 'next/link';
import { ContentRenderer } from '@/components/homepage/ContentRenderer';
import { DoctorAvatar } from '@/components/homepage/DoctorAvatar';

interface DoctorProfile {
  id: string; userId: string; position: string | null;
  education: string[]; career: string[]; certifications: string[];
  introduction: string | null; photoUrl: string | null; scheduleNote: string | null;
  user: { id: string; familyName: string; givenName: string; department: string; specialty: string | null };
}

interface Props {
  content: string;
  specialties: string[];
  procedures: string[];
  equipment: string[];
  diseases: string[];
  tests: string[];
  highlights: { title: string; desc: string }[];
  schedule?: { weekday?: string; saturday?: string; note?: string };
  doctors: DoctorProfile[];
  departmentName: string;
  phone: string;
  /** 병원 공통 진료시간(CMS 정본) — 진료과별 schedule 이 없을 때의 기준값 */
  hospitalHours: ClinicHours;
}

type TabKey = 'intro' | 'diseases' | 'doctors' | 'guide';

export function DeptTabs(props: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('intro');

  const TABS: { key: TabKey; label: string; show: boolean }[] = [
    { key: 'intro', label: '진료과 소개', show: true },
    { key: 'diseases', label: '주요 질환·검사', show: props.diseases.length > 0 || props.tests.length > 0 || props.procedures.length > 0 },
    { key: 'doctors', label: `의료진 (${props.doctors.length})`, show: props.doctors.length > 0 },
    { key: 'guide', label: '진료 안내', show: true },
  ];

  return (
    <>
      {/* 탭 네비게이션 */}
      <div className="sticky top-[68px] z-30 bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 lg:px-8">
          <nav className="flex gap-0 overflow-x-auto scrollbar-hide" role="tablist">
            {TABS.filter(t => t.show).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`px-5 py-4 text-sm font-semibold whitespace-nowrap border-b-2 transition ${
                  activeTab === tab.key
                    ? 'text-blue-700 border-blue-600'
                    : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10">
        {activeTab === 'intro' && <IntroTab {...props} />}
        {activeTab === 'diseases' && <DiseasesTab {...props} />}
        {activeTab === 'doctors' && <DoctorsTab doctors={props.doctors} departmentName={props.departmentName} />}
        {activeTab === 'guide' && <GuideTab {...props} />}
      </div>
    </>
  );
}

/* ========== 진료과 소개 탭 ========== */
function IntroTab({ content, specialties, highlights }: Props) {
  return (
    <div className="space-y-8">
      {/* 소개 */}
      <section className="bg-white border border-gray-100 rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <span className="w-1 h-6 bg-blue-600 rounded-full" />
          진료과 소개
        </h2>
        <ContentRenderer content={content} className="text-sm text-gray-700 leading-relaxed" />
      </section>

      {/* 하이라이트 */}
      {highlights.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1 h-6 bg-blue-600 rounded-full" />
            주요 특장점
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {highlights.map((h, i) => (
              <div key={i} className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0">{i + 1}</span>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">{h.title}</h3>
                    <p className="text-xs text-gray-600 mt-1 leading-relaxed">{h.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 세부 전문분야 */}
      {specialties.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1 h-6 bg-blue-600 rounded-full" />
            세부 전문분야
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {specialties.map(s => (
              <div key={s} className="flex items-center gap-2.5 p-3 bg-white border border-gray-100 rounded-xl hover:border-blue-200 hover:bg-blue-50/30 transition">
                <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-medium text-gray-700">{s}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ========== 주요 질환·검사 탭 ========== */
function DiseasesTab({ diseases, tests, procedures, equipment }: Props) {
  return (
    <div className="space-y-8">
      {/* 주요 질환 */}
      {diseases.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1 h-6 bg-rose-500 rounded-full" />
            주요 질환
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {diseases.map(d => (
              <div key={d} className="bg-white border border-gray-100 rounded-xl p-4 hover:border-rose-200 hover:bg-rose-50/30 transition">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-rose-400 rounded-full flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-800">{d}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 주요 검사 */}
      {tests.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1 h-6 bg-amber-500 rounded-full" />
            주요 검사
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tests.map(t => (
              <div key={t} className="bg-white border border-gray-100 rounded-xl p-4 hover:border-amber-200 hover:bg-amber-50/30 transition">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-amber-400 rounded-full flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-800">{t}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 주요 시술/수술 */}
      {procedures.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1 h-6 bg-emerald-500 rounded-full" />
            주요 시술/수술
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {procedures.map(p => (
              <div key={p} className="bg-white border border-gray-100 rounded-xl p-4 hover:border-emerald-200 hover:bg-emerald-50/30 transition">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" /></svg>
                  <span className="text-sm font-medium text-gray-800">{p}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 보유 장비 */}
      {equipment.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1 h-6 bg-violet-500 rounded-full" />
            보유 장비
          </h2>
          <div className="flex flex-wrap gap-2">
            {equipment.map(e => (
              <span key={e} className="text-sm bg-violet-50 text-violet-700 border border-violet-200 px-4 py-2 rounded-xl font-medium">{e}</span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ========== 의료진 탭 ========== */
function DoctorsTab({ doctors, departmentName }: { doctors: DoctorProfile[]; departmentName: string }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <span className="w-1 h-6 bg-blue-600 rounded-full" />
          의료진 ({doctors.length}명)
        </h2>
        <Link href={`/care/doctors?department=${encodeURIComponent(departmentName)}`} className="text-sm text-blue-600 hover:underline font-medium">
          전체보기 →
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {doctors.map(doc => {
          const docName = `${doc.user.familyName}${doc.user.givenName}`;
          return (
            <Link key={doc.id} href={`/care/doctors/${doc.userId}`}
              className="group bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-lg hover:border-blue-200 transition-all duration-300">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0">
                  <DoctorAvatar name={docName} size={64} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-bold text-gray-900 group-hover:text-blue-700 transition">{docName}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{doc.position ?? '전문의'}</p>
                  {doc.user.specialty && <p className="text-xs text-blue-600 font-medium mt-1">{doc.user.specialty}</p>}
                  {doc.scheduleNote && <p className="text-[11px] text-gray-400 mt-1.5">🕐 {doc.scheduleNote}</p>}
                </div>
              </div>
              {/* 주요 경력 */}
              {(doc.certifications.length > 0 || doc.education.length > 0) && (
                <div className="mt-4 pt-3 border-t border-gray-50">
                  {doc.certifications.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {doc.certifications.slice(0, 3).map(c => (
                        <span key={c} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full whitespace-nowrap">{c}</span>
                      ))}
                    </div>
                  )}
                  {doc.education.length > 0 && (
                    <p className="text-[11px] text-gray-400 mt-1.5 line-clamp-1">{doc.education[0]}</p>
                  )}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ========== 진료 안내 탭 ========== */
function GuideTab({ schedule, phone, departmentName, hospitalHours }: Props) {
  /*
   * 🔴 W9(P12/P1): 이 탭 하나에 서로 다른 진료시간이 세 벌 있었다.
   *    - 평일 09:00~18:00 (하드코딩 폴백) / 점심 12:30~14:00 (하드코딩)
   *    - 바로 아래 '전화 예약' 칸은 평일 08:30~17:30
   *    - CMS 정본(GENERAL/operating-hours, /care/schedule)은 평일 09:00~17:30 · 점심 12:30~13:30
   *    또 진료과 metadata.schedule 이 없는 16개 과에서도 폴백값을 '이 과의 진료시간'처럼 단정했다
   *    (P1 — 모르는 것을 아는 것처럼). → 병원 공통값은 CMS 정본에서 받고, 과별 값이 없으면 그렇다고 밝힌다.
   */
  const usesDeptSchedule = !!(schedule?.weekday || schedule?.saturday);
  // 🔴 T6: 병원 공통값은 CMS 에서 읽은 것만(조회 실패·미등록이면 null — 코드 상수로 채우지 않는다)
  const hospitalKnown = hospitalHours.source === 'cms';
  const weekday = schedule?.weekday ?? hospitalHours.weekday;
  const saturday = schedule?.saturday ?? hospitalHours.saturday;
  // 24시간 운영(응급의학과)에는 점심시간 개념이 없다 — 응급실 안내에 '점심 휴진'을 띄우면 위험하다.
  const is24h = /24\s*시간/.test(weekday ?? '');

  return (
    <div className="space-y-8">
      {/* 진료 시간 */}
      <section className="bg-white border border-gray-100 rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
          <span className="w-1 h-6 bg-blue-600 rounded-full" />
          진료 시간
          {!usesDeptSchedule && <span className="text-[11px] font-medium text-gray-400">· 병원 공통 진료시간</span>}
        </h2>
        {!usesDeptSchedule && !hospitalKnown ? (
          <ClinicHoursNotice hours={hospitalHours} phone={SITE_INFO.phone} className="text-sm text-gray-600" />
        ) : (
        <div className={`grid grid-cols-1 gap-4 ${is24h ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          <div className="bg-blue-50 rounded-xl p-4 text-center">
            <p className="text-xs text-blue-600 font-semibold mb-1">평일</p>
            <p className="text-lg font-bold text-blue-800">{weekday ?? '안내 없음'}</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4 text-center">
            <p className="text-xs text-blue-600 font-semibold mb-1">토요일</p>
            <p className="text-lg font-bold text-blue-800">{saturday ?? '안내 없음'}</p>
          </div>
          {!is24h && hospitalHours.lunch && (
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 font-semibold mb-1">점심시간</p>
              <p className="text-lg font-bold text-gray-700">{hospitalHours.lunch}</p>
            </div>
          )}
        </div>
        )}
        {!usesDeptSchedule && hospitalKnown && (
          <p className="text-xs text-gray-500 mt-3">
            {departmentName} 별도 진료시간은 등록돼 있지 않아 병원 공통 진료시간을 안내합니다. 정확한 요일별 진료 여부는 예약 시 확인해 주세요.
          </p>
        )}
        {schedule?.note && (
          <p className="text-xs text-gray-500 mt-3 bg-amber-50 border border-amber-100 rounded-lg p-3">
            ⚠️ {schedule.note}
          </p>
        )}
      </section>

      {/* 예약 방법 */}
      <section className="bg-white border border-gray-100 rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
          <span className="w-1 h-6 bg-blue-600 rounded-full" />
          예약 방법
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 text-center hover:shadow-md transition">
            <div className="w-12 h-12 mx-auto bg-blue-100 rounded-2xl flex items-center justify-center mb-3">
              <span className="text-xl">💻</span>
            </div>
            <h3 className="text-sm font-bold text-gray-900 mb-1">온라인 예약</h3>
            <p className="text-xs text-gray-500 mb-3">24시간 인터넷 예약</p>
            <Link href="/booking" className="text-xs text-blue-600 font-semibold hover:underline">예약하기 →</Link>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 text-center hover:shadow-md transition">
            <div className="w-12 h-12 mx-auto bg-emerald-100 rounded-2xl flex items-center justify-center mb-3">
              <span className="text-xl">📞</span>
            </div>
            <h3 className="text-sm font-bold text-gray-900 mb-1">전화 예약</h3>
            {hospitalHours.weekday && <p className="text-xs text-gray-500 mb-3">평일 {hospitalHours.weekday}</p>}
            {/*
              🔴 W9: 진료과 metadata.phone 은 운영 22건 중 21건이 "내선 2100" 형태다. 여기서
                 `phone.replace(/[^0-9-]/g,'')` 로 tel:2100 링크를 만들어, 방문자가 눌러도 아무 데도
                 걸리지 않았다(= 전화 예약 경로가 끊긴 채 '전화 예약'이라고 안내). 내선은 대표전화를
                 걸어 연결하는 번호이므로, 걸 수 있는 대표전화를 링크로 주고 내선은 안내로만 적는다.
            */}
            {isDialable(phone) ? (
              <a href={`tel:${phone.replace(/[^0-9+]/g, '')}`} className="text-xs text-emerald-600 font-semibold">{phone}</a>
            ) : (
              <div className="space-y-0.5">
                <a href={`tel:${SITE_INFO.phone}`} className="block text-xs text-emerald-600 font-semibold">{SITE_INFO.phone}</a>
                {phone && <p className="text-[11px] text-gray-400">연결 후 {phone}</p>}
              </div>
            )}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 text-center hover:shadow-md transition">
            <div className="w-12 h-12 mx-auto bg-amber-100 rounded-2xl flex items-center justify-center mb-3">
              <span className="text-xl">🏥</span>
            </div>
            <h3 className="text-sm font-bold text-gray-900 mb-1">방문 접수</h3>
            <p className="text-xs text-gray-500 mb-3">1층 원무과 접수처</p>
            <span className="text-xs text-amber-600 font-semibold">당일 접수 가능</span>
          </div>
        </div>
      </section>

      {/* 진료 절차 */}
      <section className="bg-white border border-gray-100 rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
          <span className="w-1 h-6 bg-blue-600 rounded-full" />
          진료 절차
        </h2>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-0">
          {['접수', '대기', '진료', '검사/처방', '수납'].map((step, i) => (
            <div key={step} className="flex items-center gap-3 sm:flex-1">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                <span className="text-sm font-medium text-gray-700">{step}</span>
              </div>
              {i < 4 && (
                <svg className="hidden sm:block w-6 h-6 text-gray-300 mx-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 진료 전 준비사항 */}
      <section className="bg-amber-50 border border-amber-100 rounded-2xl p-6 lg:p-8">
        <h2 className="text-base font-bold text-amber-900 mb-3">진료 전 준비사항</h2>
        <ul className="space-y-2">
          {[
            '신분증(주민등록증, 건강보험증)을 지참해주세요',
            '타 병원 진료기록, 검사결과, 영상 CD가 있으면 가져오세요',
            '복용 중인 약 목록을 준비해주세요',
            '초진의 경우 예약 시간 20분 전에 도착해주세요',
          ].map(item => (
            <li key={item} className="text-sm text-amber-800 flex items-start gap-2">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full mt-1.5 flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
