import dynamic from 'next/dynamic';

/**
 * 시드 로그인 패널 진입점 — **운영(REAL) 번들에서 사라져야 한다.**
 *
 * 🔴 `process.env.NEXT_PUBLIC_HIS_MODE` 는 빌드 시 리터럴로 치환되므로 아래 비교는 상수로 접히고,
 *    false 쪽에서는 `import()` 가 도달 불가가 되어 청크가 생성되지 않는다.
 *    조건부 **렌더**만 하면 계정 목록과 공용 비밀번호는 번들에 그대로 남아 검색된다(2026-08-24 실측).
 *    운영 빌드 산출물에 남지 않는지는 가드(`test/ui/no-test-accounts-in-prod.spec.ts`)가 직접 뒤진다.
 *
 * 🔴 **여기서는 shared 의 `allowsSeedLogin()` 을 부르지 못한다.** 함수 호출은 상수로 접히지 않아
 *    모듈이 번들에 남는다. 그래서 리터럴 비교를 쓰되, 이 리터럴 집합이 shared 정본
 *    `HIS_MODES` 와 어긋나지 않는지는 가드가 대조한다(정본이 둘이 되지 않게).
 *
 * 🔴 기본값은 **REAL**(=꺼짐)이다. 변수가 없으면 노출되지 않는다 — 위험한 쪽이 명시적 옵트인이다.
 *    켜는 자리: 로컬 `apps/web/.env.development` · 배포 `deploy.sh --mode rehearsal`.
 */
export const BUILD_HIS_MODE =
  process.env.NEXT_PUBLIC_HIS_MODE === 'DEV' ? 'DEV'
  : process.env.NEXT_PUBLIC_HIS_MODE === 'REHEARSAL' ? 'REHEARSAL'
  : 'REAL';

/** 빌드 상한이 시드 로그인을 허용하는가. 런타임 토글은 여기서 **더 좁히기만** 한다. */
export const SHOW_TEST_ACCOUNTS =
  process.env.NEXT_PUBLIC_HIS_MODE === 'DEV' || process.env.NEXT_PUBLIC_HIS_MODE === 'REHEARSAL';

export const TestAccountPanel = SHOW_TEST_ACCOUNTS
  ? dynamic(() => import('@/components/dev/TestAccountPanel'), { ssr: false })
  : null;

/**
 * 시드 **환자** 패널(포털 로그인·인터넷예약 본인확인) — 같은 상수 분기를 쓴다.
 *
 * 🔴 2026-08-25 — 이 두 화면은 종전에 조건 없이 하드코딩돼 **운영 배포본에도 노출**됐다.
 *    직원 계정만 막고 환자 자격(MRN+생년월일)은 열어두면 같은 결함이 반쪽만 닫힌 것이다.
 */
export const TestPatientPanel = SHOW_TEST_ACCOUNTS
  ? dynamic(() => import('@/components/dev/TestPatientPanel'), { ssr: false })
  : null;
