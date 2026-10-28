import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DEFAULT_POLICY, validatePolicyAgainstLegal, LEGAL_FLOORS, VOUCHER_ERROR } from './voucher-legal.constants';
import { SetPolicyDto } from './dto/voucher.dto';

@Injectable()
export class VoucherPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /** 활성 정책(없으면 코드 기본값). foreignerOnly는 코드 강제로 항상 true 클램프. */
  async getActive() {
    const row = await this.prisma.voucherPolicy.findFirst({ where: { active: true }, orderBy: { version: 'desc' } });
    const p = row ?? DEFAULT_POLICY;
    return { ...p, foreignerOnly: LEGAL_FLOORS.FOREIGNER_ONLY_LOCKED ? true : (p as { foreignerOnly: boolean }).foreignerOnly };
  }

  async legalFloors() {
    return LEGAL_FLOORS;
  }

  /**
   * 새 정책 버전 생성(비활성). 법정 클램프 위반 시 거부.
   * foreignerOnly는 강제 true. 활성화는 별도 4-eyes(activate).
   */
  async createVersion(dto: SetPolicyDto, updatedBy: string) {
    const errs = validatePolicyAgainstLegal(dto);
    if (errs.length) throw new BadRequestException({ code: VOUCHER_ERROR.POLICY_BELOW_LEGAL_FLOOR, message: errs.join(', ') });

    const last = await this.prisma.voucherPolicy.findFirst({ orderBy: { version: 'desc' } });
    const version = (last?.version ?? 0) + 1;
    return this.prisma.voucherPolicy.create({
      data: {
        version,
        active: false,
        enabledForms: dto.enabledForms ?? DEFAULT_POLICY.enabledForms,
        serialPrefix: dto.serialPrefix ?? DEFAULT_POLICY.serialPrefix,
        validityMonths: dto.validityMonths,
        refundWindowMonths: dto.refundWindowMonths,
        balanceRefundRate: dto.balanceRefundRate,
        maxCommissionRate: dto.maxCommissionRate,
        domesticMaxCommissionRate: dto.domesticMaxCommissionRate ?? DEFAULT_POLICY.domesticMaxCommissionRate,
        maxHierarchyDepth: dto.maxHierarchyDepth ?? DEFAULT_POLICY.maxHierarchyDepth,
        prepaymentRequired: dto.prepaymentRequired ?? true,
        foreignerOnly: true, // 코드 강제(L1)
        allowedCategories: dto.allowedCategories ?? DEFAULT_POLICY.allowedCategories,
        anchorChainType: dto.anchorChainType ?? DEFAULT_POLICY.anchorChainType,
        anchorIntervalMin: dto.anchorIntervalMin ?? DEFAULT_POLICY.anchorIntervalMin,
        diffPolicy: dto.diffPolicy ?? DEFAULT_POLICY.diffPolicy,
        updatedBy,
      },
    });
  }

  /** 활성화(4-eyes: 승인자 != 작성자). 기존 활성 비활성화 → 단일 활성 보장. */
  async activateVersion(version: number, approverId: string) {
    const target = await this.prisma.voucherPolicy.findUnique({ where: { version } });
    if (!target) throw new BadRequestException('정책 버전을 찾을 수 없습니다');
    if (target.updatedBy && target.updatedBy === approverId)
      throw new BadRequestException('작성자와 승인자가 같을 수 없습니다(4-eyes)');
    return this.prisma.$transaction(async (tx) => {
      await tx.voucherPolicy.updateMany({ where: { active: true }, data: { active: false } });
      return tx.voucherPolicy.update({ where: { version }, data: { active: true, approvedBy: approverId } });
    });
  }

  async listVersions() {
    return this.prisma.voucherPolicy.findMany({ orderBy: { version: 'desc' }, take: 50 });
  }
}
