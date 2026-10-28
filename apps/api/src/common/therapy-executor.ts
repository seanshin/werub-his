import { ForbiddenException } from '@nestjs/common';
import { canExecuteTherapy, type ClinicalProfession } from '@hospital-run/shared';

/**
 * 치료 시행(시작·완료) 직종 게이트 — 정본 shared `canExecuteTherapy`(2026-09-29).
 * LAB_TECH 는 임상병리사와 공유하므로 컨트롤러 @Roles 만으로는 가를 수 없다 — 서비스가 직종을 본다.
 * userId 가 없으면(내부 호출) 검사하지 않는다 — 사람 요청 경로는 컨트롤러가 반드시 넘긴다.
 */
export async function assertTherapyExecutor(
  prisma: { user: { findUnique: (a: { where: { id: string }; select: { role: true; profession: true } }) => Promise<{ role: string; profession: string | null } | null> } },
  userId: string | undefined,
  allowed: readonly ClinicalProfession[],
): Promise<void> {
  if (!userId) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, profession: true } });
  if (!canExecuteTherapy(u?.role, u?.profession, allowed)) {
    throw new ForbiddenException({
      code: 'THERAPY_PROFESSION_REQUIRED',
      message: '치료 시행 기록은 치료 직종(물리·작업·언어치료사 등)만 남깁니다 — 직종이 지정되지 않았다면 관리자에게 요청하세요.',
    });
  }
}
