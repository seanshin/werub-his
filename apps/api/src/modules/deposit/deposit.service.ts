import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateDepositDto } from './dto/deposit.dto';

@Injectable()
export class DepositService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 예치금 등록
   */
  async create(dto: CreateDepositDto, processedBy: string) {
    return this.prisma.deposit.create({
      data: {
        patientId: dto.patientId,
        amount: dto.amount,
        balance: dto.amount,
        depositType: dto.depositType,
        paymentMethod: dto.paymentMethod,
        admissionId: dto.admissionId,
        note: dto.note,
        processedBy,
      },
    });
  }

  /**
   * 환자별 예치금 목록
   */
  async findByPatient(patientId: string) {
    const deposits = await this.prisma.deposit.findMany({
      where: { patientId },
      orderBy: { depositedAt: 'desc' },
    });
    return deposits;
  }

  /**
   * 예치금 환불
   */
  async refund(id: string, processedBy: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.refundedAt) throw new BadRequestException('Already refunded');
    if (deposit.balance <= 0) throw new BadRequestException('No balance to refund');

    return this.prisma.deposit.update({
      where: { id },
      data: {
        refundedAt: new Date(),
        balance: 0,
        processedBy,
      },
    });
  }

  /**
   * 예치금 사용 (수납 결제 시 차감)
   */
  async useDeposit(id: string, amount: number) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.refundedAt) throw new BadRequestException('Deposit already refunded');
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    if (amount > deposit.balance) throw new BadRequestException('Insufficient deposit balance');

    return this.prisma.deposit.update({
      where: { id },
      data: {
        balance: deposit.balance - amount,
      },
    });
  }
}
