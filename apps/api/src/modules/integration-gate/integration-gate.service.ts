import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

// 트랙 정의 — 게이트 항목·개통 시 조작할 config 키 (신규 연동 트랙은 여기에 추가)
const TRACKS: Record<string, {
  label: string;
  configKey: string;
  configLabel: string;
  gates: { key: string; title: string; owner: string }[];
}> = {
  LIS_REFLEX: {
    label: 'LIS Reflex 양방향 오더',
    configKey: 'fhir.serviceRequestInbound.enabled',
    configLabel: 'FHIR 인바운드 ServiceRequest 수용(LIS reflex)',
    gates: [
      { key: 'A-1', title: '수용·청구 정책 결재', owner: '진료부·원무' },
      { key: 'A-2', title: '프로토콜 승인권자 지정 + 실 프로토콜 정식 승인(four-eyes)', owner: '진단검사의학과' },
      { key: 'A-3', title: 'LIS client에 ServiceRequest.write 자격증명 발급', owner: '보안팀' },
    ],
  },
};

@Injectable()
export class IntegrationGateService {
  private readonly logger = new Logger(IntegrationGateService.name);

  constructor(private readonly prisma: PrismaService) {}

  private trackDef(track: string) {
    const def = TRACKS[track];
    if (!def) throw new NotFoundException(`알 수 없는 연동 트랙: ${track}`);
    return def;
  }

  /** 트랙 현황 — 게이트 자동 시드(멱등) + 현재 개통 상태(config) 동봉 */
  async getTrack(track: string) {
    const def = this.trackDef(track);
    for (const g of def.gates) {
      await this.prisma.integrationGate.upsert({
        where: { track_key: { track, key: g.key } },
        update: {}, // 기존 상태 보존
        create: { track, key: g.key, title: g.title, owner: g.owner },
      });
    }
    const gates = await this.prisma.integrationGate.findMany({ where: { track }, orderBy: { key: 'asc' } });
    // 🔴 (2026-09-17 L2) 조회 실패를 `live: false`(개통 안 됨)로 그리지 않는다 — 개통 중인 트랙을
    //    "안 열렸다"고 말하면 화면이 **실제보다 안전한 것처럼** 보인다(§화면점검).
    const config = await this.prisma.systemConfig.findUnique({ where: { key: def.configKey } });
    const live = String(config?.value ?? 'false') === 'true';
    return {
      track,
      label: def.label,
      configKey: def.configKey,
      live,
      allConfirmed: gates.length > 0 && gates.every((g) => g.status === 'CONFIRMED'),
      gates,
    };
  }

  private async logEvent(track: string, action: string, actorId?: string, gate?: { id: string; key: string } | null, snapshot?: Record<string, unknown>) {
    await this.prisma.integrationGateEvent
      .create({ data: { track, action, key: gate?.key ?? null, gateId: gate?.id ?? null, actorId: actorId ?? null, snapshot: (snapshot ?? undefined) as never } })
      .catch((e) => this.logger.warn(`게이트 이벤트 기록 실패(비차단): ${e.message}`));
  }

  /**
   * 결재 완료 기록 — 구조화 근거: 결재 유형+식별자(문서번호/회의명) 필수, 결재일·결재자·링크 권장.
   * 시스템 기록자는 코디네이터/ADMIN(결재 주체는 owner 부서).
   */
  async confirm(
    track: string,
    key: string,
    userId: string,
    evidence: { evidenceType?: string; evidenceRef?: string; approvedOn?: string; approverName?: string; evidenceUrl?: string; note?: string },
  ) {
    this.trackDef(track);
    const type = (evidence.evidenceType ?? '').toUpperCase();
    if (!['APPROVAL_DOC', 'MEETING', 'OFFICIAL_LETTER', 'OTHER'].includes(type)) {
      throw new BadRequestException('결재 유형(evidenceType)이 필요합니다 — APPROVAL_DOC(전자결재)|MEETING(회의록)|OFFICIAL_LETTER(공문)|OTHER');
    }
    if (!evidence.evidenceRef?.trim()) {
      throw new BadRequestException('결재 식별자(evidenceRef — 문서번호·회의명 등)를 입력하세요');
    }
    if (evidence.approvedOn && isNaN(new Date(evidence.approvedOn).getTime())) {
      throw new BadRequestException('결재일(approvedOn)이 올바르지 않습니다');
    }
    const gate = await this.prisma.integrationGate.findUnique({ where: { track_key: { track, key } } });
    if (!gate) throw new NotFoundException('게이트를 찾을 수 없습니다 — 현황 조회로 시드 후 재시도');
    if (gate.status === 'CONFIRMED') throw new BadRequestException('이미 확인된 게이트입니다');

    const data = {
      status: 'CONFIRMED',
      confirmedBy: userId,
      confirmedAt: new Date(),
      evidenceType: type,
      evidenceRef: evidence.evidenceRef.trim().slice(0, 120),
      approvedOn: evidence.approvedOn ? new Date(evidence.approvedOn) : null,
      approverName: evidence.approverName?.trim().slice(0, 50) || null,
      evidenceUrl: evidence.evidenceUrl?.trim().slice(0, 300) || null,
      note: evidence.note?.trim().slice(0, 500) || null,
    };
    const updated = await this.prisma.integrationGate.update({ where: { track_key: { track, key } }, data });
    await this.logEvent(track, 'CONFIRM', userId, updated, data as Record<string, unknown>);
    return updated;
  }

  /** 확인 회수 — 개통 중이면 먼저 회수(개통 상태에서 게이트 공백 방지) */
  async revoke(track: string, key: string, userId: string, note?: string) {
    const def = this.trackDef(track);
    // 🔴 (2026-09-17 L2) 종전 `.catch(() => null)` 은 **이 가드를 조회 실패로 끄는 코드**였다 —
    //    개통 여부를 못 읽으면 `'false'` 로 접혀 "개통 중이 아니다"로 판정되고, **개통 중인데도 게이트가 회수**됐다
    //    (바로 위 주석이 막겠다고 적어둔 "개통 상태에서 게이트 공백"이 그대로 생긴다).
    //    행이 없는 경우는 `findUnique` 가 이미 `null` 을 돌려주므로 이 catch 가 삼킨 것은 실제 실패뿐이다.
    const config = await this.prisma.systemConfig.findUnique({ where: { key: def.configKey } });
    if (String(config?.value ?? 'false') === 'true') {
      throw new BadRequestException('개통 중에는 게이트를 회수할 수 없습니다 — 먼저 개통을 중지하세요');
    }
    const gate = await this.prisma.integrationGate.findUnique({ where: { track_key: { track, key } } });
    if (!gate) throw new NotFoundException('게이트를 찾을 수 없습니다');
    // 회수 전 근거는 이벤트 스냅샷으로 보존 — 게이트 본문은 초기화
    await this.logEvent(track, 'REVOKE', userId, gate, {
      revokeReason: note?.trim() || null,
      prior: { evidenceType: gate.evidenceType, evidenceRef: gate.evidenceRef, approvedOn: gate.approvedOn, approverName: gate.approverName, evidenceUrl: gate.evidenceUrl, note: gate.note },
    });
    return this.prisma.integrationGate.update({
      where: { track_key: { track, key } },
      data: {
        status: 'PENDING', confirmedBy: null, confirmedAt: null,
        evidenceType: null, evidenceRef: null, approvedOn: null, approverName: null, evidenceUrl: null,
        note: note?.trim() ? `[회수: ${note.trim()}]`.slice(0, 500) : null,
      },
    });
  }

  /** 개통 — 전 게이트 CONFIRMED일 때만 config ON. 감사는 /admin 경로 AuditInterceptor + 로그 */
  async activate(track: string, userId: string) {
    const def = this.trackDef(track);
    const status = await this.getTrack(track);
    if (!status.allConfirmed) {
      const pending = status.gates.filter((g) => g.status !== 'CONFIRMED').map((g) => g.key);
      throw new BadRequestException(`미결 게이트가 있어 개통할 수 없습니다: ${pending.join(', ')}`);
    }
    await this.prisma.systemConfig.upsert({
      where: { key: def.configKey },
      update: { value: true, updatedBy: userId },
      create: { key: def.configKey, value: true, category: 'integration', label: def.configLabel, updatedBy: userId },
    });
    this.logger.log(`연동 개통: ${track} (${def.configKey}=true) by ${userId}`);
    await this.logEvent(track, 'ACTIVATE', userId);
    return this.getTrack(track);
  }

  /** 트랙 이력 — 확인/회수/개통/중지 (최근순) */
  async getEvents(track: string, limit = 30) {
    this.trackDef(track);
    return this.prisma.integrationGateEvent.findMany({
      where: { track },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(100, limit)),
    });
  }

  /** 개통 중지 — 게이트 기록은 보존(재개통 시 재사용) */
  async deactivate(track: string, userId: string) {
    const def = this.trackDef(track);
    await this.prisma.systemConfig.upsert({
      where: { key: def.configKey },
      update: { value: false, updatedBy: userId },
      create: { key: def.configKey, value: false, category: 'integration', label: def.configLabel, updatedBy: userId },
    });
    this.logger.log(`연동 개통 중지: ${track} (${def.configKey}=false) by ${userId}`);
    await this.logEvent(track, 'DEACTIVATE', userId);
    return this.getTrack(track);
  }
}
