import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, CompoundingStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { localeDateTimeText } from '@hospital-run/shared';

interface ComponentInput {
  role: string; name: string; medicationCodeId?: string;
  orderedAmount?: number; amountUnit?: string; computedVolumeMl?: number; sortOrder?: number;
}
interface CreateOrderInput {
  sourceType: string; patientId: string; prescriptionId?: string; specialNutritionOrderId?: string;
  priority?: string; isHazardous?: boolean; dueAt?: string; notes?: string; components?: ComponentInput[];
}

@Injectable()
export class CompoundingService {
  private readonly logger = new Logger(CompoundingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async atomic(id: string, from: CompoundingStatus, data: Prisma.CompoundingOrderUpdateManyMutationInput, conflictMsg: string) {
    const upd = await this.prisma.compoundingOrder.updateMany({ where: { id, status: from }, data });
    if (upd.count === 0) throw new ConflictException(conflictMsg);
    return this.prisma.compoundingOrder.findUnique({ where: { id }, include: { components: { orderBy: { sortOrder: 'asc' } } } });
  }

  /** 조제 지시 생성 — 항암(CHEMO)은 자동 hazardous. 처방 연결 시 환자 일치 검증(MAR·청구 연계 축). */
  async createOrder(dto: CreateOrderInput, userId: string) {
    if (!['IV_RX', 'TPN', 'CHEMO'].includes(dto.sourceType)) throw new BadRequestException('sourceType은 IV_RX/TPN/CHEMO');
    const isHazardous = dto.isHazardous ?? dto.sourceType === 'CHEMO';
    if (dto.prescriptionId) {
      const rx = await this.prisma.prescription.findUnique({
        where: { id: dto.prescriptionId },
        select: { id: true, encounter: { select: { patientId: true } } },
      });
      if (!rx) throw new BadRequestException('연결하려는 처방을 찾을 수 없습니다.');
      if (rx.encounter?.patientId !== dto.patientId) {
        throw new BadRequestException('처방의 환자와 조제지시 환자가 일치하지 않습니다.');
      }
    }
    return this.prisma.compoundingOrder.create({
      data: {
        sourceType: dto.sourceType, patientId: dto.patientId,
        prescriptionId: dto.prescriptionId, specialNutritionOrderId: dto.specialNutritionOrderId,
        priority: dto.priority ?? 'ROUTINE', isHazardous, dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        notes: dto.notes, createdBy: userId,
        components: dto.components?.length ? {
          create: dto.components.map((c, i) => ({
            role: c.role, name: c.name, medicationCodeId: c.medicationCodeId,
            orderedAmount: c.orderedAmount, amountUnit: c.amountUnit, computedVolumeMl: c.computedVolumeMl,
            sortOrder: c.sortOrder ?? i,
          })),
        } : undefined,
      },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /** 무균조제실 워크리스트(활성 조제지시) */
  async getWorklist(status?: string) {
    return this.prisma.compoundingOrder.findMany({
      where: status ? { status: status as CompoundingStatus } : { status: { notIn: ['RELEASED', 'CANCELLED'] } },
      orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
      include: {
        components: { orderBy: { sortOrder: 'asc' } },
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
      },
      take: 300,
    });
  }

  async getOne(id: string) {
    const o = await this.prisma.compoundingOrder.findUnique({
      where: { id },
      include: { components: { orderBy: { sortOrder: 'asc' } }, patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
    });
    if (!o) throw new NotFoundException('조제지시 없음');
    return o;
  }

  /** 조성 계산 완료 — 성분별 계산용량 갱신 후 CALCULATED. */
  async calculate(id: string, components?: Array<{ id: string; computedVolumeMl?: number }>) {
    const order = await this.prisma.compoundingOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('조제지시 없음');
    if (order.status !== 'ORDERED') throw new BadRequestException(`계산은 ORDERED에서만 가능(현재 ${order.status})`);
    if (components?.length) {
      await this.prisma.$transaction(components.map((c) =>
        this.prisma.compoundingComponent.update({ where: { id: c.id }, data: { computedVolumeMl: c.computedVolumeMl } }),
      ));
    }
    return this.atomic(id, 'ORDERED', { status: 'CALCULATED' }, '이미 처리됨(계산 충돌)');
  }

  /** 무균조제 수행 — 조제자·후드·성분 로트 기록. 🔴항암은 BSC/아이솔레이터 차폐 필수. */
  async prep(id: string, dto: { compoundedBy: string; hoodType: string; componentLots?: Array<{ id: string; lotNumber?: string; expiryDate?: string }> }) {
    const order = await this.prisma.compoundingOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('조제지시 없음');
    if (order.status !== 'CALCULATED') throw new BadRequestException(`조제는 CALCULATED에서만 가능(현재 ${order.status})`);
    if (order.isHazardous && !['BSC_II', 'ISOLATOR'].includes(dto.hoodType)) {
      throw new BadRequestException('항암(hazardous) 조제는 생물안전작업대(BSC_II)/아이솔레이터 차폐가 필수입니다.');
    }
    if (dto.componentLots?.length) {
      await this.prisma.$transaction(dto.componentLots.map((c) =>
        this.prisma.compoundingComponent.update({ where: { id: c.id }, data: { lotNumber: c.lotNumber, expiryDate: c.expiryDate ? new Date(c.expiryDate) : undefined } }),
      ));
    }
    return this.atomic(id, 'CALCULATED', { compoundedBy: dto.compoundedBy, hoodType: dto.hoodType, startedAt: new Date(), finishedAt: new Date(), status: 'COMPOUNDED' }, '이미 조제됨(동시 조제 충돌)');
  }

  /** 독립 2차 검증 — 조제자≠검증자(무균조제 무결성). BUD 스탬프. */
  async verify(id: string, dto: { verifiedBy: string; budHours?: number }) {
    const order = await this.prisma.compoundingOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('조제지시 없음');
    if (order.status !== 'COMPOUNDED') throw new BadRequestException(`검증은 COMPOUNDED에서만 가능(현재 ${order.status})`);
    if (!dto.verifiedBy) throw new BadRequestException('검증자가 필요합니다.');
    if (order.compoundedBy && order.compoundedBy === dto.verifiedBy) {
      throw new BadRequestException('검증자는 조제자와 달라야 합니다(독립 2차 확인).');
    }
    const budHours = dto.budHours && dto.budHours > 0 ? dto.budHours : 24; // 기본 24h(기관 정책·안정성으로 조정)
    const budAt = new Date(Date.now() + budHours * 3600000);
    return this.atomic(id, 'COMPOUNDED', { verifiedBy: dto.verifiedBy, verifiedAt: new Date(), budAt, status: 'VERIFIED' }, '이미 검증됨(동시 검증 충돌)');
  }

  /** 불출(라벨 발행) — 원자 클레임으로 이중불출 방지. 처방 연동 시 MAR 연결 + 청구 이벤트. */
  async release(id: string) {
    const order = await this.prisma.compoundingOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('조제지시 없음');
    if (order.status !== 'VERIFIED') throw new BadRequestException(`불출은 VERIFIED에서만 가능(현재 ${order.status})`);
    const labelBarcode = `CMP-${id.slice(0, 8).toUpperCase()}`;
    const released = await this.atomic(id, 'VERIFIED', { status: 'RELEASED', releasedAt: new Date(), labelBarcode }, '이미 불출됨(동시 불출 충돌)');

    // 처방 연동 시 미연결 MAR에 무균조제 실물 연결 — 병동 인계 추적 폐쇄 (선례 issueDispensing)
    if (order.prescriptionId) {
      await this.prisma.medicationAdministration
        .updateMany({
          where: { prescriptionId: order.prescriptionId, compoundingOrderId: null },
          data: { compoundingOrderId: id },
        })
        .catch((e) => this.logger.warn(`MAR-무균조제 연결 실패(비차단): ${e.message}`));
    }
    // 청구 발생주의 — prescriptionId 동봉 시 billing-accrual 리스너가 라인 발행(lineId=rx.id 멱등·일반 조제와 이중과금 없음)
    this.eventEmitter.emit('compounding.released', {
      compoundingOrderId: id,
      patientId: order.patientId,
      prescriptionId: order.prescriptionId ?? undefined,
      sourceType: order.sourceType,
      isHazardous: order.isHazardous,
    });
    return released;
  }

  // ── 항암 용량 계산(BSA·용량밴딩) ──

  /** BSA(체표면적) — Mosteller 공식. m². */
  computeBsa(heightCm: number, weightKg: number): number {
    if (!(heightCm > 0) || !(weightKg > 0)) return 0;
    return Math.round(Math.sqrt((heightCm * weightKg) / 3600) * 100) / 100;
  }

  /**
   * 항암 용량 계산 — BSA×(mg/m²). 용량밴딩(bandMg 단위 반올림)·상한(capMg) 적용.
   * 🔴안전: 최종 용량이 상한을 넘지 않도록 캡, 밴딩으로 조제 오차·미량조작 감소.
   */
  computeChemoDose(p: { heightCm: number; weightKg: number; dosePerM2: number; capMg?: number; bandMg?: number }) {
    const bsa = this.computeBsa(p.heightCm, p.weightKg);
    const rawDose = Math.round(bsa * p.dosePerM2 * 100) / 100;
    let finalDose = rawDose;
    let banded = false;
    if (p.bandMg && p.bandMg > 0) {
      finalDose = Math.round(rawDose / p.bandMg) * p.bandMg;
      banded = finalDose !== rawDose;
    }
    let capped = false;
    if (p.capMg != null && finalDose > p.capMg) {
      finalDose = p.capMg;
      capped = true;
    }
    return { bsa, rawDose, finalDose, banded, capped, unit: 'mg' };
  }

  /**
   * 무균조제 라벨(인쇄용 HTML) — 환자·약물·경로·성분·BUD·바코드. 불출 후 부착.
   * 🔴바코드는 labelBarcode 텍스트 + Code128 SVG(경량 자체 렌더) — 라벨프린터 연동 시 ZPL 등으로 확장.
   */
  async buildLabel(id: string): Promise<{ filename: string; content: string }> {
    const o = await this.prisma.compoundingOrder.findUnique({
      where: { id },
      include: { components: { orderBy: { sortOrder: 'asc' } }, patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
    if (!o) throw new NotFoundException('조제지시 없음');
    const esc = (s: unknown) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
    const SRC: Record<string, string> = { IV_RX: '주사', TPN: 'TPN', CHEMO: '항암(위험)' };
    const comps = o.components.map((c) => `<li>${esc(c.name)}${c.orderedAmount ? ` — ${esc(c.orderedAmount)}${esc(c.amountUnit)}` : ''}${c.computedVolumeMl ? ` (${esc(c.computedVolumeMl)}mL)` : ''}</li>`).join('');
    const bud = o.budAt ? localeDateTimeText(new Date(o.budAt), 'ko-KR') : '-';
    const barcode = o.labelBarcode ?? `CMP-${o.id.slice(0, 8).toUpperCase()}`;
    const content = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(barcode)}</title>
<style>@page{size:90mm 50mm;margin:3mm}body{font-family:sans-serif;margin:0;padding:4mm;width:82mm}
.hz{color:#b91c1c;font-weight:bold}.b{font-family:monospace;letter-spacing:2px;font-size:15px;border:1px solid #000;padding:2px 6px;display:inline-block}
h3{margin:0 0 2mm}ul{margin:1mm 0;padding-left:5mm;font-size:11px}.row{font-size:11px;margin:0.5mm 0}</style></head>
<body>
<h3>무균조제 라벨 ${o.isHazardous ? '<span class="hz">☣ 위험약물(항암)</span>' : ''}</h3>
<div class="row"><b>${esc(o.patient?.familyName)}${esc(o.patient?.givenName)}</b> · MRN ${esc(o.patient?.mrn)}</div>
<div class="row">유형: ${esc(SRC[o.sourceType] ?? o.sourceType)}</div>
<ul>${comps}</ul>
<div class="row">BUD(사용기한): <b>${esc(bud)}</b></div>
<div class="row" style="margin-top:2mm"><span class="b">${esc(barcode)}</span></div>
<script>window.onload=function(){try{window.print()}catch(e){}}</script>
</body></html>`;
    return { filename: `label-${barcode}.html`, content };
  }

  /**
   * 무균조제 라벨 ZPL(Zebra) — 라벨프린터 직인쇄용. 90×50mm @203dpi(719×406 dots).
   * 한글은 ^CI28(UTF-8) + 프린터 한글 폰트(^A@…E:KOREAN.TTF 등) 전제 — 미탑재 프린터는
   * 바코드·영숫자만 정상 출력되므로 도입 시 폰트 탑재 확인 필요(운영 체크리스트).
   */
  async buildLabelZpl(id: string): Promise<{ filename: string; content: string }> {
    const o = await this.prisma.compoundingOrder.findUnique({
      where: { id },
      include: { components: { orderBy: { sortOrder: 'asc' } }, patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
    if (!o) throw new NotFoundException('조제지시 없음');
    const z = (s: unknown) => String(s ?? '').replace(/[\^~\\]/g, ' '); // ZPL 제어문자 제거
    const SRC: Record<string, string> = { IV_RX: '주사', TPN: 'TPN', CHEMO: '항암(위험)' };
    const barcode = o.labelBarcode ?? `CMP-${o.id.slice(0, 8).toUpperCase()}`;
    const bud = o.budAt ? new Date(o.budAt.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') + ' KST' : '-';
    const comps = o.components.slice(0, 4).map((c, i) =>
      `^FO20,${170 + i * 34}^A@N,26,26,E:KOREAN.TTF^FD- ${z(c.name)}${c.orderedAmount ? ` ${z(c.orderedAmount)}${z(c.amountUnit ?? '')}` : ''}${c.computedVolumeMl ? ` (${z(c.computedVolumeMl)}mL)` : ''}^FS`,
    ).join('\n');
    const content = [
      '^XA',
      '^CI28', // UTF-8
      '^PW719^LL406', // 90×50mm @203dpi
      `^FO20,20^A@N,34,34,E:KOREAN.TTF^FD무균조제${o.isHazardous ? ' [!! 위험약물-항암 !!]' : ''}^FS`,
      `^FO20,64^A@N,30,30,E:KOREAN.TTF^FD${z(o.patient?.familyName)}${z(o.patient?.givenName)}  MRN ${z(o.patient?.mrn)}^FS`,
      `^FO20,102^A@N,26,26,E:KOREAN.TTF^FD유형: ${z(SRC[o.sourceType] ?? o.sourceType)}   BUD: ${bud}^FS`,
      `^FO20,138^GB679,2,2^FS`, // 구분선
      comps,
      `^FO450,300^BY2^BCN,70,Y,N,N^FD${z(barcode)}^FS`, // Code128
      ...(o.isHazardous ? ['^FO20,310^GB410,80,4^FS', '^FO36,332^A@N,34,34,E:KOREAN.TTF^FD세포독성 - 차폐 취급^FS'] : []),
      '^XZ',
    ].filter(Boolean).join('\n');
    return { filename: `label-${barcode}.zpl`, content };
  }

  async cancel(id: string, reason?: string) {
    const order = await this.prisma.compoundingOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('조제지시 없음');
    if (['RELEASED', 'CANCELLED'].includes(order.status)) throw new BadRequestException(`${order.status} 상태는 취소할 수 없습니다.`);
    return this.prisma.compoundingOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
  }
}
