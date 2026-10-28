import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { INCIDENT_SEVERITY_LABEL, incidentTypeLabel, normalizeIncidentSeverity } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { resolveIndicatorPolicy } from '../quality/indicator-policy';
import { CommitteeAgendaService, type AgendaOption } from '../order-governance/committee-agenda.service';
import { localDateKey } from '../../common/day-range';

/**
 * 질관리 화면 → 위원회 안건(QI 흐름 2026-10-08) — 화면은 값을 바꾸지 않고 **후보 + "정하지 않음"** 을 올린다.
 *  · 질 지표 목표(QPS) — 의결되면 집행 엔진(MASTER_DATA quality-indicator)이 원장 목표를 바꾼다(CPOE 지표와 같은 길)
 *  · 환자안전사고 검토(SAFE) — 선택지는 원장을 바꾸지 않는다(조치 계획 승인·RCA 요구·추가 조사). 🔴 환자 식별정보·서술 본문은 싣지 않는다
 */
@Injectable()
export class QiAgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agendas: CommitteeAgendaService,
  ) {}

  async proposeTarget(indicatorId: string, dto: { targets: number[]; note?: string }, proposerId: string) {
    const ind = await this.prisma.qualityIndicator.findUnique({ where: { id: indicatorId } });
    if (!ind) throw new NotFoundException('질 지표를 찾을 수 없습니다');
    const targets = [...new Set(dto.targets)];
    if (!targets.length || targets.length > 3) throw new BadRequestException({ code: 'QI_TARGET_COUNT', message: '목표 후보는 1~3개입니다' });
    if (targets.length !== dto.targets.length) throw new BadRequestException({ code: 'QI_TARGET_DUPLICATE', message: '같은 목표 후보가 두 번 있습니다' });
    const policy = resolveIndicatorPolicy(ind);
    for (const t of targets) {
      if (!Number.isFinite(t) || t < 0 || t > 999) throw new BadRequestException({ code: 'QI_TARGET_RANGE', message: '목표는 0~999 사이여야 합니다(Decimal(5,2))', target: t });
      if (policy.unit === '%' && t > 100) throw new BadRequestException({ code: 'QI_TARGET_RANGE', message: '백분율 지표의 목표는 100 이하입니다', target: t });
    }
    if (!policy.direction) {
      throw new BadRequestException({ code: 'QI_DIRECTION_REQUIRED', message: '이 지표는 방향이 등재되지 않았습니다 — 먼저 지표 방향을 정해야 목표가 판정에 쓰입니다' });
    }
    const sym = policy.direction === 'LOWER_IS_BETTER' ? '≤' : '≥';
    const options: AgendaOption[] = targets.map((t, i) => ({
      value: `T${i + 1}`, label: `${sym} ${t}${policy.unit ?? ''}`,
      effect: '질 지표 원장의 이 지표 목표를 이 값으로 바꿉니다 — 이후 측정 판정·경보가 새 목표를 씁니다(지난 측정값은 읽는 시점에 재판정).',
      enact: { kind: 'MASTER_DATA', target: { master: 'quality-indicator', op: 'update', id: ind.id, payload: { targetValue: t } } },
    }));
    options.push({ value: 'NONE', label: '정하지 않음(현행 유지)', effect: '원장을 바꾸지 않습니다.', enact: null });
    const body = [
      '질 지표 화면에서 올린 목표 안건입니다.',
      '지표: ' + ind.name + ' · 산식: ' + ind.formula,
      '현재 목표: ' + String(ind.targetValue) + (policy.unit ?? '') + ' · 방향: ' + (policy.direction === 'LOWER_IS_BETTER' ? '낮을수록 좋음' : '높을수록 좋음') + `(${policy.directionSource})`,
      dto.note?.trim() ? '제안 사유: ' + dto.note.trim() : null,
    ].filter(Boolean).join('\n');
    return this.agendas.submit({ surfaceKey: 'master:quality-indicator', source: 'QI_INDICATOR', key: ind.id, title: '질 지표 목표 — ' + ind.name, body, options }, proposerId);
  }

  async proposeIncidentReview(incidentId: string, note: string | undefined, proposerId: string) {
    const inc = await this.prisma.safetyIncident.findUnique({ where: { id: incidentId }, select: { id: true, type: true, severity: true, status: true, occurredAt: true, wardId: true, harmLevel: true, rcaCompleted: true } });
    if (!inc) throw new NotFoundException('안전사건을 찾을 수 없습니다');
    const ward = inc.wardId ? await this.prisma.ward.findUnique({ where: { id: inc.wardId }, select: { name: true } }) : null;
    const sev = normalizeIncidentSeverity(inc.severity);
    const body = [
      '환자안전 화면에서 올린 사고 검토 안건입니다(환자 식별정보·서술 본문은 싣지 않았습니다 — 사고 화면에서 확인).',
      `유형: ${incidentTypeLabel(inc.type)} · 중증도: ${INCIDENT_SEVERITY_LABEL[sev] ?? inc.severity} · 상태: ${inc.status}`,
      `발생일: ${localDateKey(inc.occurredAt)}${ward ? ' · 병동: ' + ward.name : ''}${inc.harmLevel ? ' · 위해 정도: ' + inc.harmLevel : ''}`,
      `RCA: ${inc.rcaCompleted ? '승인 완료' : '미완료'}`,
      note?.trim() ? '제안 사유: ' + note.trim() : null,
    ].filter(Boolean).join('\n');
    return this.agendas.submit({
      surfaceKey: 'review:safety-incident', source: 'SAFETY_INCIDENT', key: inc.id,
      title: `환자안전사고 검토 — ${incidentTypeLabel(inc.type)}(${localDateKey(inc.occurredAt)})`, body,
      options: [
        { value: 'APPROVE_PLAN', label: '조치 계획 승인', effect: '사고 화면의 조치 내역을 승인으로 기록합니다 — 원장 변경 없음.', enact: null },
        { value: 'REQUIRE_RCA', label: '근본원인분석(RCA) 요구', effect: '전담인력이 사고 화면에서 RCA 를 시작하도록 요구합니다.', enact: null },
        { value: 'MORE_INFO', label: '추가 조사 후 재상정', effect: '추가 조사 결과를 붙여 다시 올리도록 합니다.', enact: null },
      ],
    }, proposerId);
  }
}
