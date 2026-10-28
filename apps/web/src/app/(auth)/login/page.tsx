'use client';

import { Fragment, useEffect, useState } from 'react';
import { AI_ORIGIN_TEXT, HIS_VERSION, USER_ROLE_LABEL } from '@hospital-run/shared';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '@/stores/auth-store';
import { MutationError } from '@hospital-run/shared';
import { TestAccountPanel } from '@/lib/dev-test-accounts';
import { toInternalPath } from '@/lib/safe-redirect';
import { BuildModeBanner } from '@/lib/his-mode';

const loginSchema = z.object({
  email: z.string().min(1, '이메일을 입력하세요').email('올바른 이메일 형식이 아닙니다'),
  password: z.string().min(1, '비밀번호를 입력하세요'),
});
type LoginForm = z.infer<typeof loginSchema>;

/**
 * 로그인 뒤 첫 화면 — 역할 기본 진입점(부서 분기에 해당하지 않을 때).
 * 🔴 좌측 안내의 "로그인 뒤 첫 화면"도 이 표에서 그린다 — 안내문을 따로 적으면 이동 규칙을 바꿀 때 갈라진다.
 */
const ROLE_HOME: Record<string, string> = { ADMIN: '/command-center', NURSE: '/command-center', DOCTOR: '/command-center', LAB_TECH: '/diagnostics-board', PHARMACIST: '/pharmacy', EXECUTIVE: '/executive', RECEPTIONIST: '/reception', NUTRITION: '/nutrition', ADMIN_STAFF: '/inventory', MEDICAL_RECORDS: '/medical-records/search' };
const FALLBACK_HOME = '/dashboard';
/** 첫 화면 이름 — 사이드바 메뉴 이름과 같게 */
const HOME_LABEL: Record<string, string> = {
  '/command-center': '통합 상황판', '/diagnostics-board': '검사·영상 보드', '/pharmacy': '약국', '/executive': '경영 대시보드',
  '/reception': '접수', '/nutrition': '급식', '/inventory': '자재/재고', '/medical-records/search': '기록 검색', '/dashboard': '대시보드',
};
/** 역할보다 먼저 보는 부서 분기(아래 onSubmit 과 같은 순서) */
const DEPT_HOME: { when: string; label: string }[] = [
  { when: '고객관리(CRM) 역할·부서', label: 'CRM 대시보드' },
  { when: '건강검진센터 소속', label: '건강검진센터' },
  { when: '검사실·영상실·기초검사·치료실 소속', label: '워크스테이션' },
];

/** 역할 기본 진입점을 화면별로 묶는다 — 표에 없는 역할은 대시보드 */
function homeGroups(): { label: string; roles: string[] }[] {
  const by = new Map<string, string[]>();
  for (const role of Object.keys(USER_ROLE_LABEL)) {
    if (role === 'CRM_MANAGER' || role === 'CRM_STAFF') continue; // 부서 분기(CRM)가 먼저 잡는다
    const home = ROLE_HOME[role] ?? FALLBACK_HOME;
    by.set(home, [...(by.get(home) ?? []), USER_ROLE_LABEL[role]]);
  }
  return [...by.entries()].map(([path, roles]) => ({ label: HOME_LABEL[path] ?? path, roles }));
}

/**
 * 시스템 규모 — CLAUDE.md System Scale 표(릴리즈 시점 동결)와 같은 값.
 * 🔴 손으로 적은 숫자는 낡는다 — `test/ui/login-facts-freshness.spec.ts` 가 `system-scale.lock.json`(약품·진단은 표의 운영 행)과 기계 대조한다.
 */
const SCALE: { value: string; label: string; note: string }[] = [
  { value: '231', label: '업무 모듈', note: '진료·진료지원·간호·원무·경영' },
  { value: '3,500', label: 'API', note: '내부 /api/v1 · 외부 FHIR R4' },
  { value: '474', label: '화면', note: '직원·환자 포털·전광판·태블릿' },
  { value: String(Object.keys(USER_ROLE_LABEL).length), label: '역할', note: '역할별 최소 권한' },
  { value: '24,022', label: '약품 코드', note: '성분·마약류/향정 구분' },
  { value: '18,184', label: '진단 코드', note: 'KCD-8 · 챕터 분류 전량' },
];

const DOMAINS: { title: string; items: string }[] = [
  { title: '진료', items: '외래 · 입원 · 응급 · 수술 · 중환자실 · 회복실 · 원격진료' },
  { title: '진료지원', items: '약제 · 진단검사 · 영상 · 병리 · 수혈 · 재활치료' },
  { title: '간호', items: '간호기록 · 투약 · 근무조 교대 인수 · 조기경보 · 환자 교육' },
  { title: '원무·청구', items: '접수 · 예약 · 수납 · 건강보험 청구 · 본인부담 산정' },
  { title: '경영·운영', items: '통합 상황판 · 경영 대시보드 · 인사 · 자재 · 중앙공급' },
  { title: '환자 서비스', items: '환자 포털 · 모바일 앱 · 인터넷 예약 · 건강검진' },
];

const SAFETY: { title: string; body: string }[] = [
  { title: '안전 게이트 28종', body: '처방·투약·수술·퇴원 단계에서 차단·경고 · 기준은 관리 화면에서 운영' },
  { title: '감사 추적', body: '기록 변경과 환자 기록 열람을 원장에 남김 · 외부 앱 접근은 별도 기록' },
  { title: '접근 통제', body: '14개 역할 최소 권한 · 전자서명 · 생체 로그인(등록 기기)' },
  { title: '데이터 보호', body: '민감정보 AES-256 암호화 · 데이터 정합성 상시 점검' },
];

const ICON = {
  check: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  spark: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
  key: 'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z',
  grid: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  link: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244',
};

function SectionTitle({ icon, children }: { icon: keyof typeof ICON; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-200/80 mb-3">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={ICON[icon]} />
      </svg>
      {children}
    </h2>
  );
}

/** 좌측 안내 보기 — 간략히(기본)/상세 · 이 브라우저에 기억(저장 실패는 화면에 영향 없음) */
type InfoView = 'brief' | 'detail';
const INFO_VIEW_KEY = 'login.infoView';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [view, setView] = useState<InfoView>('brief');
  useEffect(() => {
    try { if (window.localStorage.getItem(INFO_VIEW_KEY) === 'detail') setView('detail'); } catch { /* 저장소를 못 읽으면 기본(간략히) */ }
  }, []);
  const chooseView = (v: InfoView) => {
    setView(v);
    try { window.localStorage.setItem(INFO_VIEW_KEY, v); } catch { /* 기억 못 해도 지금 화면은 바뀐다 */ }
  };
  const { login, isLoading } = useAuthStore();
  const router = useRouter();
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const redirectTo = searchParams?.get('redirect');

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setError('');
    try {
      await login(data.email, data.password);
      // redirect 파라미터가 있으면 해당 경로로 — 🔴 **내부 경로만** 허용한다.
      // 종전에는 검증 없이 `router.push(redirectTo)` 라 `/login?redirect=https://evil.example`
      // 처럼 외부로 튕길 수 있었다(로그인 직후라 사용자는 병원 사이트라 믿는다).
      const safeRedirect = toInternalPath(redirectTo);
      if (safeRedirect) { router.push(safeRedirect); return; }
      const dept = useAuthStore.getState().user?.department ?? '';
      const role = useAuthStore.getState().user?.role ?? '';
      const isCrm = role === 'CRM_MANAGER' || role === 'CRM_STAFF' || dept === 'CRM';
      const isCheckupDept = dept.startsWith('건강검진센터');
      const isWorkstationDept = dept.startsWith('검사실') || dept.startsWith('영상실') || dept.startsWith('기초검사') || dept.startsWith('영상의학과(') || dept.startsWith('치료실');
      // 역할 기본 진입점(부서 분기 미해당 시) — 표는 모듈 위 ROLE_HOME(좌측 안내와 같은 정본)
      router.push(isCrm ? '/crm' : isCheckupDept ? '/his-checkup' : isWorkstationDept ? '/workstation' : (ROLE_HOME[role] ?? FALLBACK_HOME));
    } catch (err: unknown) {
      const msg = (err as MutationError)?.message;
      setError(msg || '로그인에 실패했습니다.');
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left - 안내 패널 (넓은 화면) — 높이가 모자라면 패널 안에서 스크롤 */}
      <div className="hidden lg:block lg:w-1/2 lg:h-screen lg:sticky lg:top-0 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 relative overflow-hidden" role="complementary" aria-label="시스템 안내">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500/20 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-400/20 rounded-full translate-x-1/3 translate-y-1/3" />
        </div>

        <div className="relative z-10 h-full overflow-y-auto px-12 xl:px-16 py-12 text-white">
          {/* 머리 */}
          <div className="mb-8">
            <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-12 w-auto mb-5" style={{ filter: 'brightness(0) invert(1)' }} />
            <h1 className="text-3xl font-bold tracking-tight">위루비병원</h1>
            <p className="text-blue-200 text-lg mt-1">Care Today, Ready for Tomorrow</p>
            <p className="mt-4 text-sm leading-relaxed text-blue-100/90 max-w-xl">
              직원용 병원정보시스템(HIS)입니다. 진료·간호·진료지원·원무·경영 업무를 한 계정으로 처리하고,
              역할에 따라 보이는 메뉴와 쓸 수 있는 기능이 달라집니다.
            </p>
          </div>

          {/* 보기 탭 — 간략히 / 상세 */}
          <div role="tablist" aria-label="안내 보기" className="mb-6 inline-flex rounded-xl bg-white/10 p-1" data-login-view={view}>
            {([['brief', '간략히 보기'], ['detail', '상세 보기']] as const).map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => chooseView(v)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${view === v ? 'bg-white text-blue-700 shadow-sm' : 'text-blue-100 hover:bg-white/10'}`}>
                {label}
              </button>
            ))}
          </div>

          {view === 'brief' && (
            <div role="tabpanel" aria-label="간략히 보기" data-login-brief>
              {/* 규모 — 숫자만 */}
              <section className="mb-6" aria-label="시스템 규모 요약">
                <div className="grid grid-cols-3 gap-2">
                  {SCALE.map((s) => (
                    <div key={s.label} className="rounded-xl bg-white/10 px-3 py-2">
                      <p className="text-lg font-bold tabular-nums leading-tight">{s.value}</p>
                      <p className="text-[11px] text-blue-100/80">{s.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-blue-200/50 mt-2">{HIS_VERSION} 릴리즈 기준</p>
              </section>
              {/* 업무 영역 — 이름만 */}
              <section className="mb-6" aria-label="업무 영역 요약">
                <SectionTitle icon="grid">업무 영역</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {DOMAINS.map((d) => <span key={d.title} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium">{d.title}</span>)}
                </div>
              </section>
              {/* 안전·AI — 한 줄씩 */}
              <section className="mb-6" aria-label="안전과 AI 요약">
                <SectionTitle icon="check">안전 · 보안 · AI</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {SAFETY.map((x) => <span key={x.title} className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs">{x.title}</span>)}
                </div>
                <p className="mt-2 text-xs text-blue-100/85">{AI_ORIGIN_TEXT} 결과는 참고·<b>초안</b>입니다 — 최종 판단과 확정은 의료진이 합니다.</p>
              </section>
              {/* 로그인 — 꼭 필요한 두 줄 */}
              <section className="mb-2" aria-label="로그인 안내 요약">
                <SectionTitle icon="key">로그인</SectionTitle>
                <ul className="space-y-1 text-sm text-blue-100/90">
                  <li>· 병원에서 발급한 이메일·비밀번호로 로그인합니다(연속으로 틀리면 잠깁니다 — 전산 관리자 문의).</li>
                  <li>· 환자·보호자는 ‘환자 포털’·‘인터넷 예약’을 이용합니다.</li>
                </ul>
                <button type="button" onClick={() => chooseView('detail')} className="mt-3 text-xs text-blue-200 underline underline-offset-2 hover:text-white">
                  로그인 뒤 첫 화면·인증 기준·표준까지 상세 보기 →
                </button>
              </section>
            </div>
          )}

          {view === 'detail' && (<div role="tabpanel" aria-label="상세 보기" data-login-detail>
          {/* 규모 */}
          <section className="mb-8" aria-label="시스템 규모">
            <SectionTitle icon="grid">시스템 규모</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {SCALE.map((s) => (
                <div key={s.label} className="rounded-xl bg-white/10 px-3 py-2.5" data-login-scale={s.label}>
                  <p className="text-xl font-bold tabular-nums">{s.value}</p>
                  <p className="text-xs font-medium text-white/90">{s.label}</p>
                  <p className="text-[11px] text-blue-200/70 leading-snug mt-0.5">{s.note}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-blue-200/50 mt-2">{HIS_VERSION} 릴리즈 기준 · 약품·진단 코드는 운영 코드 마스터 행 수</p>
          </section>

          {/* 업무 영역 */}
          <section className="mb-8" aria-label="업무 영역">
            <SectionTitle icon="grid">업무 영역</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {DOMAINS.map((d) => (
                <div key={d.title} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                  <p className="text-sm font-semibold">{d.title}</p>
                  <p className="text-xs text-blue-100/80 leading-relaxed mt-0.5">{d.items}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 안전·보안 */}
          <section className="mb-8" aria-label="안전과 보안">
            <SectionTitle icon="check">안전 · 보안</SectionTitle>
            <ul className="space-y-2">
              {SAFETY.map((s) => (
                <li key={s.title} className="flex gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-300" aria-hidden="true" />
                  <span><span className="font-medium text-white">{s.title}</span> <span className="text-blue-100/80">— {s.body}</span></span>
                </li>
              ))}
            </ul>
          </section>

          {/* 임상 AI */}
          <section className="mb-8" aria-label="임상 AI">
            <SectionTitle icon="spark">임상 AI · {AI_ORIGIN_TEXT}</SectionTitle>
            <p className="text-sm text-blue-100/90 leading-relaxed">
              진료 요약·SOAP 초안·약물 상호작용 점검·간호기록 초안·앰비언트 스크라이브(AI 엔드포인트 75).
            </p>
            <p className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-xs text-blue-50 leading-relaxed">
              AI 결과는 AI 표기와 함께 참고·<b>초안</b>으로 제공됩니다 — 진단·처방 등 최종 판단과 확정은 의료진이 합니다.
            </p>
          </section>

          {/* 로그인 안내 */}
          <section className="mb-8" aria-label="로그인 안내">
            <SectionTitle icon="key">로그인 안내</SectionTitle>
            <ul className="space-y-1.5 text-sm text-blue-100/90">
              <li>· 직원 계정 — 병원에서 발급한 이메일과 비밀번호로 이 화면에서 로그인합니다.</li>
              <li>· 생체 로그인 — 기기를 등록한 직원은 아래 ‘스탭용’ 화면을 씁니다.</li>
              <li>· 비밀번호를 연속으로 틀리면 계정이 일정 시간 잠깁니다(횟수·시간은 원내 보안 설정). 잠김·분실은 전산 관리자에게 문의하세요.</li>
              <li>· 환자·보호자는 직원 로그인이 아니라 ‘환자 포털’·‘인터넷 예약’을 이용합니다.</li>
            </ul>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <p className="text-xs font-semibold text-white mb-1.5">로그인 뒤 첫 화면</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-login-home-guide>
                {DEPT_HOME.map((d) => (
                  <Fragment key={d.label}><dt className="text-blue-200/80">{d.when}</dt><dd className="text-white">{d.label}</dd></Fragment>
                ))}
                {homeGroups().map((g) => (
                  <Fragment key={g.label}><dt className="text-blue-200/80">{g.roles.join(' · ')}</dt><dd className="text-white">{g.label}</dd></Fragment>
                ))}
              </dl>
              <p className="text-[11px] text-blue-200/60 mt-1.5">위에서부터 먼저 맞는 것 · 다른 화면에서 로그인으로 넘어왔다면 그 화면으로 돌아갑니다.</p>
            </div>
          </section>

          {/* 인증 기준·표준·연동 */}
          <section className="mb-2" aria-label="인증 기준과 표준">
            <SectionTitle icon="link">인증 기준 · 표준 · 연동</SectionTitle>
            <div className="space-y-1.5 text-xs text-blue-100/80 leading-relaxed">
              <p><span className="text-white font-medium">설계 기준</span> — 전자의무기록(EMR) 인증기준 3대 영역(기능성·상호운용성·보안성) · JCI 6개 영역(IPSG·PCI·QPS·PCC·SQE·FMS). 인증 취득 여부와는 별개입니다.</p>
              <p><span className="text-white font-medium">코드 표준</span> — KCD-8 · ICD-10 · ICD-11 · 건강보험 EDI · DUR · NANDA·NIC·NOC 간호표준</p>
              <p><span className="text-white font-medium">연동</span> — FHIR R4 · SMART 외부 앱 · OpenPACS(Orthanc·OHIF) · ERP · Clinic(WeRU.B) SSO</p>
            </div>
          </section>
          </div>)}
          {/* 환자포털 / 인터넷 예약 링크 */}
          <div className="mt-8 pt-6 border-t border-white/10">
            <div className="flex items-center gap-3 flex-wrap">
              <a href="/portal" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl hover:bg-white/20 transition-colors">
                <svg className="w-4 h-4 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
                <span className="text-sm font-medium text-white">환자 포털</span>
              </a>
              <a href="/booking" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl hover:bg-white/20 transition-colors">
                <svg className="w-4 h-4 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
                <span className="text-sm font-medium text-white">인터넷 예약</span>
              </a>
              <a href="https://hospital.example.org" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-white/15 backdrop-blur-sm rounded-xl hover:bg-white/25 transition-colors border border-white/20">
                <svg className="w-4 h-4 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
                <span className="text-sm font-medium text-white">병원 홈페이지</span>
              </a>
              <a href="/staff/login"
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-400/20 backdrop-blur-sm rounded-xl hover:bg-emerald-400/30 transition-colors border border-emerald-300/30">
                <svg className="w-4 h-4 text-emerald-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" /></svg>
                <span className="text-sm font-medium text-white">스탭용 (생체로그인)</span>
              </a>
              <a href="/distributor"
                className="flex items-center gap-2 px-4 py-2.5 bg-amber-400/20 backdrop-blur-sm rounded-xl hover:bg-amber-400/30 transition-colors border border-amber-300/30">
                <svg className="w-4 h-4 text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
                <span className="text-sm font-medium text-white">검진권 해외딜러</span>
              </a>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <div className="w-6 h-6 bg-white/15 rounded-lg flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 12c0 4.14-3.36 7.5-7.5 7.5S4.5 16.14 4.5 12 7.86 4.5 12 4.5s7.5 3.36 7.5 7.5z" /></svg>
              </div>
              <span className="text-[11px] text-blue-200/50">WERUBYHOSP HIS {HIS_VERSION}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-gray-50 px-6" role="main">
        <div className="w-full max-w-sm">
          {/* Mobile Logo */}
          <div className="lg:hidden text-center mb-8">
            <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-10 w-auto mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900">위루비병원</h1>
          </div>

          {/* 개발·리허설 빌드면 시드(가상) 데이터임을 로그인 전에 말한다 — 실운영 빌드는 아무것도 그리지 않는다 */}
          <BuildModeBanner className="mb-6 rounded-xl border" />
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">로그인</h2>
            <p className="text-gray-500 mt-1">계정 정보를 입력해주세요</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" aria-label="로그인 폼">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                이메일
              </label>
              <input
                id="email"
                type="email"
                {...register('email')}
                aria-describedby={errors.email ? 'email-error' : undefined}
                aria-invalid={!!errors.email}
                className={`w-full px-4 py-3 border rounded-xl bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow ${errors.email ? 'border-red-300' : 'border-gray-200'}`}
                placeholder="name@hospital.example.org"
              />
              {errors.email && <p id="email-error" role="alert" className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  비밀번호
                </label>
              </div>
              <input
                id="password"
                type="password"
                {...register('password')}
                aria-describedby={errors.password ? 'password-error' : undefined}
                aria-invalid={!!errors.password}
                className={`w-full px-4 py-3 border rounded-xl bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow ${errors.password ? 'border-red-300' : 'border-gray-200'}`}
                placeholder="비밀번호를 입력하세요"
              />
              {errors.password && <p id="password-error" role="alert" className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
            </div>

            {error && (
              <div role="alert" aria-live="polite" className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm shadow-blue-600/25"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  로그인 중...
                </span>
              ) : '로그인'}
            </button>
          </form>

          {TestAccountPanel && (
            <TestAccountPanel onPick={(email, password) => { setValue('email', email); setValue('password', password); }} />
          )}

          {/* 모바일: 환자포털/인터넷예약/병원홈페이지 (lg에서는 좌측 패널에 표시) */}
          <div className="lg:hidden flex items-center justify-center gap-2 mt-8 pt-6 border-t border-gray-200">
            <a href="/portal" className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-700 rounded-xl text-xs font-medium hover:bg-blue-100 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
              환자 포털
            </a>
            <a href="/booking" className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-700 rounded-xl text-xs font-medium hover:bg-blue-100 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
              인터넷 예약
            </a>
            <a href="https://hospital.example.org" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-medium hover:bg-indigo-100 transition-colors border border-indigo-200">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
              병원 홈페이지
            </a>
            <a href="/staff/login" className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-medium hover:bg-emerald-100 transition-colors border border-emerald-200">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" /></svg>
              스탭용
            </a>
            <a href="/distributor" className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 text-amber-700 rounded-xl text-xs font-medium hover:bg-amber-100 transition-colors border border-amber-200">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
              검진권 해외딜러
            </a>
          </div>

          <p className="text-xs text-gray-400 text-center mt-8">
            WERUBYHOSP HIS {HIS_VERSION} &middot; 위루비병원
          </p>
        </div>
      </div>
    </div>
  );
}
