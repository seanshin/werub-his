import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Break-the-Glass Guard
 * 환자 리소스 접근 시 담당 의사/간호사 여부를 확인.
 * 비담당자는 403 + BTG_REQUIRED 에러 → 프론트에서 사유 입력 후 POST /break-the-glass 호출.
 *
 * 사용법: @UseGuards(BreakTheGlassGuard) + 라우트 파라미터에 patientId 필요
 *
 * ⚠️ 현재 상태(2026-07-04): 이 가드는 provider 등록만 되어 있고 **어떤 컨트롤러에도 배선되지 않음(미활성)**.
 *    임상데이터 접근은 현재 역할 기반(@Roles)만 강제. 전면 도입 여부는 설계 문서 참조:
 *    docs/01-plan/features/btg-care-team-scope.plan.md
 *    (활성화 시 checkAssignment의 간호사·care-team 미포함 확장 + FE X-BTG-Reason 플로우가 선결).
 */
@Injectable()
export class BreakTheGlassGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    const userRole = request.user?.role;

    if (!userId) return false;

    // ADMIN은 항상 통과
    if (userRole === 'ADMIN') return true;

    // patientId 추출 (URL 파라미터 또는 쿼리)
    const patientId = request.params?.patientId || request.query?.patientId || request.body?.patientId;
    if (!patientId) return true; // patientId가 없으면 Guard 적용 안함

    // BTG 헤더 확인 — 프론트에서 사유 제출 후 X-BTG-Reason 헤더로 재요청
    const btgReason = request.headers['x-btg-reason'];
    if (btgReason) {
      // BTG 접근 기록 후 통과
      await this.prisma.breakTheGlassAccess.create({
        data: {
          userId,
          patientId,
          reason: btgReason,
          accessedAt: new Date(),
          resourceType: this.extractResourceType(request.path),
        },
      });
      return true;
    }

    // 담당 여부 확인
    const isAssigned = await this.checkAssignment(userId, patientId);
    if (isAssigned) return true;

    // 비담당 → BTG 필요
    throw new ForbiddenException({
      code: 'BTG_REQUIRED',
      message: '비담당 환자 기록입니다. Break-the-Glass 사유를 입력해주세요.',
      patientId,
    });
  }

  private async checkAssignment(userId: string, patientId: string): Promise<boolean> {
    // 1. 최근 30일 내 해당 환자 진료 이력
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const encounter = await this.prisma.encounter.findFirst({
      where: { doctorId: userId, patientId, createdAt: { gte: thirtyDaysAgo } },
    });
    if (encounter) return true;

    // 2. 현재 입원 담당의
    const admission = await this.prisma.admission.findFirst({
      where: { admittingDoctorId: userId, patientId, status: 'ADMITTED' },
    });
    if (admission) return true;

    return false;
  }

  private extractResourceType(path: string): string {
    if (path.includes('encounter')) return 'encounter';
    if (path.includes('nursing')) return 'nursing';
    if (path.includes('discharge')) return 'discharge_summary';
    if (path.includes('problem')) return 'problem_list';
    if (path.includes('allerg')) return 'allergy';
    return 'patient';
  }
}
