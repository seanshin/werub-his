import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { catalogTransitionAllowed } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CommitteeAgendaService } from '../order-governance/committee-agenda.service';

/** 약속처방 사용 중 전환의 거버넌스 표면 — 카탈로그 단위(세트마다가 아니다) · 담당 = 위원회 표면 매핑 */
export const ORDER_SET_PUBLISH_SURFACE = 'publish:order_set';

/**
 * 카탈로그 변경 → 위원회 안건(2026-10-21 임상 규칙·템플릿 P5 B4).
 *
 * 🔴 화면은 세트를 사용 중으로 바꾸지 않는다 — "사용 중으로 / 보류" 선택지를 담당 위원회 안건으로 올릴 뿐이다.
 *    바뀌는 것은 위원회가 "사용 중으로"를 의결해 집행 엔진(PUBLISH · 정본 `OrderSetService.changeStatus`)이 반영할 때다.
 * 🔴 담당 위원회는 표면 매핑이 정한다(화면이 고르지 않는다) — 결정 `catalog.ownership` 이 미배정이면 매핑이 없어
 *    올리지 않고 그렇다고 말한다(`owner()` = null · 상정 400 AGENDA_NO_OWNER).
 * 🔴 사용 중으로 바꿀 수 없는 상태(승인 대기·사용 중·폐기)는 올리지 않는다 — 의결해도 집행이 거부된다(위원회 시간을 버린다).
 * 치료일정 템플릿은 집행 엔진에 사용 중 전환 경로가 없어 대상이 아니다(PUBLISH docType = PROTOCOL·PATHWAY·ORDER_SET).
 */
@Injectable()
export class CatalogAgendaService {
  constructor(private readonly prisma: PrismaService, private readonly agenda: CommitteeAgendaService) {}

  /** 담당 위원회 — 없으면 null(지정 안 됨) · 조회 실패는 전파(없음으로 접지 않는다) */
  async owner() {
    try {
      return await this.agenda.ownerCommittee(ORDER_SET_PUBLISH_SURFACE);
    } catch (e) {
      const code = (e as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
      if (e instanceof BadRequestException && code?.code === 'AGENDA_NO_OWNER') return null;
      throw e;
    }
  }

  async submitOrderSetActivation(id: string, proposerId: string) {
    const set = await this.prisma.orderSet.findUnique({ where: { id }, select: { id: true, name: true, version: true, status: true } });
    if (!set) throw new NotFoundException('약속처방을 찾을 수 없습니다');
    if (!catalogTransitionAllowed(set.status, 'ACTIVE')) {
      throw new ConflictException({ code: 'CATALOG_NOT_SUBMITTABLE', message: '이 상태에서는 사용 중으로 바꿀 수 없어 안건으로 올리지 않습니다', status: set.status });
    }
    return this.agenda.submit({
      surfaceKey: ORDER_SET_PUBLISH_SURFACE,
      source: 'CATALOG_ORDER_SET',
      key: set.id,
      title: '약속처방 사용 중 전환 — ' + set.name + ' (v' + set.version + ')',
      body: '이 약속처방을 사용 중으로 바꿀지 의결합니다. 의결 전에는 세트가 바뀌지 않습니다. 사용 중이 되면 같은 계보의 이전 판은 폐기됩니다.',
      options: [
        { value: 'PUBLISH', label: '사용 중으로', effect: '세트를 사용 중으로 바꾼다(집행한 사람이 승인자로 남는다)', enact: { kind: 'PUBLISH', target: { docType: 'ORDER_SET', id: set.id, op: 'publish' } } },
        { value: 'HOLD', label: '보류', effect: '세트를 바꾸지 않는다', enact: null },
      ],
    }, proposerId);
  }

  list() {
    return this.agenda.list(['CATALOG_ORDER_SET']);
  }
}
