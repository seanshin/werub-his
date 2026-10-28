/**
 * 진찰료 코드 고르기 — 요양기관 종별 정본(`billing.institution.grade`)을 따른다(2026-10-20).
 * 청구 생성·계산 패널·예상 진료비·원격진료 청구·외래 FFS 견적이 같은 함수를 쓴다(🔴 종전엔 다섯 곳이 상급종합 코드 AA157/AA257 고정).
 * 표 정본은 shared `CONSULTATION_FEE_CODES_BY_GRADE` · 미설정 = 의원(시스템 기본 · 개시 점검이 미설정을 드러낸다) · 모르는 값 = null.
 */
import { consultationFeeCodes } from '@hospital-run/shared';

export const INSTITUTION_GRADE_KEY = 'billing.institution.grade';

interface ConfigReader {
  systemConfig: { findUnique(args: { where: { key: string }; select: { value: true } }): Promise<{ value: unknown } | null> };
}

/** 종별 설정 행의 값(없으면 null) */
export async function readInstitutionGrade(prisma: ConfigReader): Promise<unknown> {
  const row = await prisma.systemConfig.findUnique({ where: { key: INSTITUTION_GRADE_KEY }, select: { value: true } });
  return row?.value ?? null;
}

/** 초진·재진 진찰료 코드 — 종별 설정값을 받아 고른다 · 모르는 값(표 밖)이면 null */
export function consultationCodeFor(grade: unknown, isInitial: boolean): string | null {
  const codes = consultationFeeCodes(grade);
  return codes ? (isInitial ? codes.initial : codes.followUp) : null;
}
