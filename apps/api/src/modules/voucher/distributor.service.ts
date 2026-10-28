import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VoucherPolicyService } from './voucher-policy.service';
import { VoucherLedgerService } from './voucher-ledger.service';
import { DistributorAuthService } from './distributor-auth.service';
import { IntegrationOutboxService, type HisEvent } from '../integration/integration-outbox.service';
import { VoucherEmailService, isVoucherEmailDelivered } from './voucher-email.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { commissionCapFor } from './voucher-legal.constants';
import { RegisterDistributorDto, UpdateDealerDto } from './dto/distributor.dto';

// 초기설정 인증코드(8자·혼동문자 제외) — 이메일로 딜러에 발송, 비밀번호 등록에 사용
function genSetupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 8; i++) c += alphabet[randomInt(alphabet.length)];
  return c;
}

interface DealerMaster { id: string; name: string; dealerType: string; tier: string; country: string; currency: string; commissionRate: number; licenseNumber: string | null; contractRef: string | null; taxId?: string | null; bankInfo?: unknown; status: string; parentId: string | null }

@Injectable()
export class DistributorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: VoucherPolicyService,
    private readonly ledger: VoucherLedgerService,
    private readonly auth: DistributorAuthService,
    private readonly outbox: IntegrationOutboxService,
    private readonly email: VoucherEmailService,
    private readonly audit: AuditService,
  ) {}

  /** 딜러 정보 수정(관리자) — 변경분 diff 감사로그 + ERP 거래처 동기화. 구조 필드(email/dealerType/tier)는 불변. */
  async updateDealer(id: string, dto: UpdateDealerDto, actorId: string) {
    const cur = await this.prisma.distributor.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('딜러를 찾을 수 없습니다');
    const data: Record<string, unknown> = {};
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const diff = (field: keyof typeof cur, newVal: unknown) => {
      if (newVal === undefined) return;
      const old = cur[field] as unknown;
      const oldCmp = old instanceof Date ? old.toISOString().slice(0, 10) : old;
      if (newVal !== oldCmp && JSON.stringify(newVal) !== JSON.stringify(old)) { data[field] = newVal; changes[field] = { old: oldCmp ?? null, new: newVal }; }
    };
    diff('name', dto.name);
    diff('taxId', dto.taxId);
    if (dto.commissionRate !== undefined) {
      const pol = await this.policy.getActive();
      const cap = commissionCapFor(pol, cur.dealerType);
      if (dto.commissionRate > cap) throw new BadRequestException({ code: 'COMMISSION_EXCEEDED', message: `${cur.dealerType === 'DOMESTIC' ? '국내' : '해외'} 수수료율 상한(${cap}%) 초과` });
      diff('commissionRate', dto.commissionRate);
    }
    if (cur.dealerType === 'DOMESTIC') diff('licenseNumber', dto.licenseNumber);
    else diff('contractRef', dto.contractRef);
    if (dto.licenseExpiry !== undefined) {
      const nv = dto.licenseExpiry || null;
      const ov = cur.licenseExpiry ? cur.licenseExpiry.toISOString().slice(0, 10) : null;
      if (nv !== ov) { data.licenseExpiry = nv ? new Date(nv) : null; changes.licenseExpiry = { old: ov, new: nv }; }
    }
    if (dto.bankInfo !== undefined && JSON.stringify(dto.bankInfo) !== JSON.stringify(cur.bankInfo)) {
      data.bankInfo = dto.bankInfo as object; changes.bankInfo = { old: cur.bankInfo, new: dto.bankInfo };
    }
    if (!Object.keys(data).length) return cur; // 변경 없음
    const upd = await this.prisma.distributor.update({ where: { id }, data });
    void this.audit.log({ userId: actorId, action: AuditAction.UPDATE, resourceType: 'VOUCHER_DISTRIBUTOR', resourceId: id, changes });
    await this.emitDealer('vendor.changed', upd, `voucher:dealer:${id}:UPDATE:${Date.now()}`);
    return upd;
  }

  /** 딜러 수정/상태변경 감사 로그 조회(관리자) */
  async auditLog(id: string) {
    return this.audit.findByResource('VOUCHER_DISTRIBUTOR', id);
  }

  /** 다음 딜러 관리번호(WGD-YYYY-NNNN·연도별 순번). 충돌 시 다음 빈 번호 탐색. */
  private async nextManagementNo(): Promise<string> {
    const year = new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const base = await this.prisma.distributor.count({ where: { createdAt: { gte: yearStart } } });
    for (let i = 0; i < 50; i++) {
      const candidate = `WGD-${year}-${String(base + 1 + i).padStart(4, '0')}`;
      const exists = await this.prisma.distributor.findUnique({ where: { managementNo: candidate } });
      if (!exists) return candidate;
    }
    return `WGD-${year}-${Date.now().toString().slice(-6)}`; // 폴백(매우 드문 경쟁)
  }

  /** 딜러 거래처 마스터를 ERP(finance)로 동기화 — HR staff-sync 대응. status별 ref로 멱등. */
  private async emitDealer(event: HisEvent, d: DealerMaster, ref: string) {
    const acct = await this.prisma.distributorAccount.findFirst({ where: { distributorId: d.id }, select: { email: true } });
    void this.outbox.enqueue('voucher', event, ref, {
      vendorType: 'VOUCHER_DEALER', dealerId: d.id, name: d.name,
      dealerType: d.dealerType, // DOMESTIC=국내 유치업자(원천징수 대상)/OVERSEAS=해외 딜러
      tier: d.tier, country: d.country, currency: d.currency, commissionRate: d.commissionRate,
      licenseNumber: d.licenseNumber ?? null, contractRef: d.contractRef ?? null,
      taxId: d.taxId ?? null, bankInfo: d.bankInfo ?? null,
      status: d.status, parentId: d.parentId ?? null, email: acct?.email ?? null,
    });
  }

  /** 딜러 등록(PENDING) + 포털 계정 생성. 계층 깊이 검증. */
  async register(dto: RegisterDistributorDto) {
    const pol = await this.policy.getActive();
    const cap = commissionCapFor(pol, dto.dealerType);
    if (dto.commissionRate > cap)
      throw new BadRequestException({ code: 'COMMISSION_EXCEEDED', message: `${dto.dealerType === 'DOMESTIC' ? '국내 유치업자' : '해외 딜러'} 수수료율은 ${cap}% 이하여야 합니다` });

    if (dto.parentId) {
      const depth = await this.depthOf(dto.parentId);
      if (depth + 1 >= pol.maxHierarchyDepth)
        throw new BadRequestException(`계층 깊이 초과(최대 ${pol.maxHierarchyDepth})`);
    }
    const exists = await this.prisma.distributorAccount.findUnique({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('이미 등록된 이메일');

    // 국내/해외 유형별 자격·국가·통화 분기
    const isDomestic = dto.dealerType === 'DOMESTIC';
    if (isDomestic) {
      if (!dto.licenseNumber) throw new BadRequestException({ code: 'LICENSE_REQUIRED', message: '국내 유치업자는 유치업 등록번호(L3)가 필수입니다' });
    } else {
      if (!dto.contractRef) throw new BadRequestException({ code: 'CONTRACT_REQUIRED', message: '해외 딜러는 병원 제휴계약 참조가 필수입니다' });
      if ((dto.country ?? '') === 'KR') throw new BadRequestException({ code: 'OVERSEAS_COUNTRY_INVALID', message: '해외 딜러의 국가는 KR이 아니어야 합니다' });
    }
    // 통화 기본값: 국내=KRW 강제, 해외=입력(기본 USD). 국가: 국내=KR 강제.
    const country = isDomestic ? 'KR' : (dto.country ?? 'XX');
    const currency = isDomestic ? 'KRW' : (dto.currency ?? 'USD');

    // 비밀번호 정책: dto.password 있으면 직접 설정(레거시·즉시 verified). 없으면 랜덤 비번 +
    // 인증코드 이메일 발송 → 딜러가 코드로 비밀번호 등록(setup)해야 로그인(emailVerifiedAt null).
    const useSetupCode = !dto.password;
    const initialPassword = dto.password ?? randomBytes(18).toString('base64url');
    const passwordHash = await this.auth.hashPassword(initialPassword);
    const setupCode = useSetupCode ? genSetupCode() : null;
    const setupCodeHash = setupCode ? await this.auth.hashPassword(setupCode) : null;
    const setupCodeExpiry = setupCode ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null; // 7일
    const managementNo = await this.nextManagementNo();

    const d = await this.prisma.$transaction(async (tx) => {
      const created = await tx.distributor.create({
        data: {
          managementNo, name: dto.name, parentId: dto.parentId, tier: dto.tier, dealerType: dto.dealerType, country, currency,
          licenseNumber: isDomestic ? dto.licenseNumber : null, contractRef: isDomestic ? null : dto.contractRef,
          taxId: dto.taxId ?? null, bankInfo: (dto.bankInfo ?? undefined) as object | undefined,
          licenseExpiry: dto.licenseExpiry ? new Date(dto.licenseExpiry) : null,
          commissionRate: dto.commissionRate, status: 'PENDING',
        },
      });
      await tx.distributorAccount.create({
        data: {
          distributorId: created.id, email: dto.email, passwordHash, locale: dto.locale ?? 'en',
          setupCodeHash, setupCodeExpiry, emailVerifiedAt: useSetupCode ? null : new Date(),
        },
      });
      return created;
    });
    // 인증코드 이메일(채널: Resend/시뮬) — 커밋 후
    if (useSetupCode && setupCode) {
      const sent = await this.email.sendDealerSetupCode(dto.email, dto.name, setupCode);
      // ERP 거래처 마스터 동기화(신규)
      await this.emitDealer('vendor.synced', d, `voucher:dealer:${d.id}`);
      // 🔴 `codeSent: true` 는 종전에 상수였다 — 차단·실패에도 "보냈다"고 답했다.
      return { ...d, setup: { emailedTo: dto.email, channel: sent.channel, codeSent: isVoucherEmailDelivered(sent.channel) } };
    }
    await this.emitDealer('vendor.synced', d, `voucher:dealer:${d.id}`);
    return d;
  }

  /** 초기설정 인증코드 재발송(관리자) — 만료/분실 시. 미인증 계정만. */
  async resendSetupCode(distributorId: string) {
    const acc = await this.prisma.distributorAccount.findFirst({ where: { distributorId } });
    if (!acc) throw new NotFoundException('딜러 계정을 찾을 수 없습니다');
    if (acc.emailVerifiedAt) throw new BadRequestException('이미 초기설정이 완료된 계정입니다');
    const code = genSetupCode();
    await this.prisma.distributorAccount.update({
      where: { id: acc.id },
      data: { setupCodeHash: await this.auth.hashPassword(code), setupCodeExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    const dealer = await this.prisma.distributor.findUnique({ where: { id: distributorId }, select: { name: true } });
    const sent = await this.email.sendDealerSetupCode(acc.email, dealer?.name ?? 'Dealer', code);
    return { emailedTo: acc.email, channel: sent.channel, codeSent: isVoucherEmailDelivered(sent.channel) };
  }

  private async depthOf(id: string): Promise<number> {
    let depth = 0; let cur: string | null = id;
    while (cur && depth < 10) {
      const d: { parentId: string | null } | null = await this.prisma.distributor.findUnique({ where: { id: cur }, select: { parentId: true } });
      if (!d) break;
      depth++; cur = d.parentId;
    }
    return depth;
  }

  /** 심사 승인 — 국내=유치업 등록(L3) / 해외=제휴계약 검증 + 만료확인 + 4-eyes. */
  async approve(id: string, approverId: string) {
    const d = await this.prisma.distributor.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('딜러를 찾을 수 없습니다');
    if (d.dealerType === 'DOMESTIC') {
      if (!d.licenseNumber) throw new BadRequestException({ code: 'LICENSE_REQUIRED', message: '국내 유치업자 — 유치업 등록번호 필요(L3)' });
    } else {
      if (!d.contractRef) throw new BadRequestException({ code: 'CONTRACT_REQUIRED', message: '해외 딜러 — 병원 제휴계약 참조 필요' });
    }
    if (d.licenseExpiry && d.licenseExpiry < new Date())
      throw new BadRequestException({ code: d.dealerType === 'DOMESTIC' ? 'LICENSE_EXPIRED' : 'CONTRACT_EXPIRED', message: d.dealerType === 'DOMESTIC' ? '유치업 등록 만료(L3)' : '제휴계약 만료' });
    const upd = await this.prisma.distributor.update({ where: { id }, data: { status: 'ACTIVE', approvedBy: approverId } });
    void this.audit.log({ userId: approverId, action: AuditAction.UPDATE, resourceType: 'VOUCHER_DISTRIBUTOR', resourceId: id, changes: { status: { old: d.status, new: 'ACTIVE' }, event: { old: null, new: 'APPROVED' } } });
    await this.emitDealer('vendor.changed', upd, `voucher:dealer:${id}:ACTIVE`); // ERP 거래처 활성화 동기화
    return upd;
  }

  /** 상태 변경. TERMINATED 시 미판매 재고(ALLOCATED) 병원 회수(§14.1). */
  async setStatus(id: string, status: string, actorId: string) {
    if (!['ACTIVE', 'SUSPENDED', 'TERMINATED'].includes(status)) throw new BadRequestException('잘못된 상태');
    const prev = await this.prisma.distributor.findUnique({ where: { id }, select: { status: true } });
    const d = await this.prisma.distributor.update({ where: { id }, data: { status } });
    void this.audit.log({ userId: actorId, action: AuditAction.UPDATE, resourceType: 'VOUCHER_DISTRIBUTOR', resourceId: id, changes: { status: { old: prev?.status ?? null, new: status } } });
    let revoked = 0;
    if (status === 'TERMINATED') {
      const stock = await this.prisma.checkupVoucher.findMany({
        where: { currentOwnerType: 'DISTRIBUTOR', currentOwnerId: id, status: 'ALLOCATED' },
        select: { id: true, serial: true, headHash: true }, take: 10000,
      });
      for (const v of stock) {
        await this.prisma.$transaction(async (tx) => {
          const head = await this.ledger.append(tx, {
            voucherId: v.id, serial: v.serial, type: 'REVOKE', prevHash: v.headHash,
            actorType: 'ADMIN', actorId, payload: { reason: 'DISTRIBUTOR_TERMINATED', distributorId: id },
          });
          await tx.checkupVoucher.update({ where: { id: v.id }, data: { status: 'ISSUED', currentOwnerType: 'HOSPITAL', currentOwnerId: null, headHash: head } });
        });
        revoked++;
      }
    }
    await this.emitDealer('vendor.changed', d, `voucher:dealer:${id}:${status}`); // ERP 거래처 상태 동기화
    return { id: d.id, status: d.status, revoked };
  }

  /** 기존 딜러 일괄 ERP 동기화(백필) — vendor.synced 재발행(ref 멱등). */
  async syncAllToErp() {
    const dealers = await this.prisma.distributor.findMany({ orderBy: { createdAt: 'asc' } });
    for (const d of dealers) await this.emitDealer('vendor.synced', d, `voucher:dealer:${d.id}`);
    return { enqueued: dealers.length };
  }

  async list(query: { status?: string; dealerType?: string; search?: string }) {
    const s = query.search?.trim();
    return this.prisma.distributor.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.dealerType ? { dealerType: query.dealerType } : {}),
        ...(s ? { OR: [{ managementNo: { contains: s, mode: 'insensitive' } }, { name: { contains: s, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: 200,
      include: { _count: { select: { sales: true } } },
    });
  }

  async get(id: string) {
    const d = await this.prisma.distributor.findUnique({ where: { id }, include: { accounts: { select: { email: true, locale: true, lastLoginAt: true } } } });
    if (!d) throw new NotFoundException('딜러를 찾을 수 없습니다');
    return d;
  }

  /** 내 하위 딜러 목록(계층 — 하위배분 대상) */
  async children(parentId: string) {
    return this.prisma.distributor.findMany({ where: { parentId, status: 'ACTIVE' }, select: { id: true, name: true, tier: true, dealerType: true, currency: true }, orderBy: { name: 'asc' } });
  }

  /** 내가 받은 선결제 배분(매입) 이력 */
  async myAllocations(distributorId: string) {
    return this.prisma.voucherAllocation.findMany({ where: { toDistributorId: distributorId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  /** 딜러 실적 요약 — 판매·수수료·미정산 */
  async summary(distributorId: string) {
    const [inv, sales, settle] = await Promise.all([
      this.prisma.checkupVoucher.groupBy({ by: ['status'], where: { currentOwnerType: 'DISTRIBUTOR', currentOwnerId: distributorId }, _count: true }),
      this.prisma.voucherSale.aggregate({ where: { distributorId }, _count: true, _sum: { salePrice: true, commissionAmount: true } }),
      this.prisma.voucherSettlement.aggregate({ where: { distributorId, status: { not: 'PAID' } }, _sum: { netPayable: true } }),
    ]);
    const counts = inv.reduce((a, c) => ({ ...a, [c.status]: c._count }), {} as Record<string, number>);
    return {
      stock: counts.ALLOCATED ?? 0,
      sold: sales._count,
      grossSales: sales._sum.salePrice ?? 0,
      commission: sales._sum.commissionAmount ?? 0,
      unsettled: settle._sum.netPayable ?? 0,
    };
  }

  /** 재고(보유 검진권) 집계 */
  async inventory(distributorId: string) {
    const counts = await this.prisma.checkupVoucher.groupBy({
      by: ['status'], where: { currentOwnerType: 'DISTRIBUTOR', currentOwnerId: distributorId }, _count: true,
    });
    const list = await this.prisma.checkupVoucher.findMany({
      where: { currentOwnerType: 'DISTRIBUTOR', currentOwnerId: distributorId },
      select: { serial: true, form: true, faceValue: true, balance: true, status: true, expiresAt: true },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    return { counts: counts.reduce((a, c) => ({ ...a, [c.status]: c._count }), {} as Record<string, number>), vouchers: list };
  }
}
