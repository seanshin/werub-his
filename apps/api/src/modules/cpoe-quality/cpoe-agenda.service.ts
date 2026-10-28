import { BadRequestException, Injectable } from '@nestjs/common';
import { cpoeQiDef, type CpoeQiKey } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { normalizeIndicatorKey, resolveIndicatorPolicy, resolveRegistryDirection } from '../quality/indicator-policy';
import { CommitteeAgendaService, type AgendaOption } from '../order-governance/committee-agenda.service';

/**
 * CPOE 지표를 질 지표 원장에 올리는 일 — **위원회(질향상·환자안전) 안건으로**(2026-10-07).
 *
 * 🔴 목표값은 위원회가 정한다 — 화면은 후보(1~3)를 적어 올리고 "정하지 않음"도 선택지로 둔다.
 *    의결되면 집행 엔진(MASTER_DATA `quality-indicator`)이 원장에 등록·변경한다. 이 서비스는 원장을 직접 바꾸지 않는다.
 * 🔴 방향 — 코드 등재표(REGISTRY)에 있으면 그것 · 없으면 제안자가 정해 올린다(관찰 지표는 방향 자체가 위원회 결정이다).
 *    이름 보조신호(HINT)는 방향으로 쓰지 않는다(추정을 정책으로 박지 않는다).
 * 🔴 등록된 지표는 목표 변경(update)만 — 이름·산식은 바꾸지 않는다(바꾸면 다른 지표다).
 */
@Injectable()
export class CpoeAgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agendas: CommitteeAgendaService,
  ) {}

  async propose(dto: { key: CpoeQiKey; targets: number[]; direction?: string; note?: string }, proposerId: string) {
    const def = cpoeQiDef(dto.key);
    if (!def) throw new BadRequestException('알 수 없는 CPOE 지표입니다');
    const targets = [...new Set(dto.targets)];
    if (targets.length !== dto.targets.length) throw new BadRequestException({ code: 'QI_TARGET_DUPLICATE', message: '같은 목표 후보가 두 번 있습니다' });
    for (const t of targets) {
      if (!Number.isFinite(t) || t < 0 || t > 100) throw new BadRequestException({ code: 'QI_TARGET_RANGE', message: '목표는 0~100(%) 사이여야 합니다', target: t });
    }
    const rows = await this.prisma.qualityIndicator.findMany({ where: { isActive: true }, select: { id: true, name: true, direction: true, unit: true, valueScale: true, formula: true, targetValue: true } });
    const ledger = rows.find((r) => normalizeIndicatorKey(r.name) === normalizeIndicatorKey(def.qiName)) ?? null;
    const registry = resolveRegistryDirection(def.qiName);
    const policy = ledger ? resolveIndicatorPolicy(ledger) : null;
    // 방향: 원장 컬럼 → 코드 등재표 → 제안자 · 이름 추정(HINT)은 쓰지 않는다
    const direction = policy?.registeredDirection ?? (registry.source === 'REGISTRY' ? registry.direction : null) ?? (dto.direction ?? null);
    if (!direction || !['LOWER_IS_BETTER', 'HIGHER_IS_BETTER'].includes(direction)) {
      throw new BadRequestException({ code: 'QI_DIRECTION_REQUIRED', message: '이 지표는 방향이 정해져 있지 않습니다 — 낮을수록/높을수록 중 하나를 골라 올리십시오' });
    }
    const sym = direction === 'LOWER_IS_BETTER' ? '≤' : '≥';
    const options: AgendaOption[] = targets.map((t, i) => ({
      value: `T${i + 1}`,
      label: `${sym} ${t}%`,
      effect: ledger
        ? '질 지표 원장의 이 지표 목표를 이 값으로 바꿉니다 — 이후 측정·화면 판정이 새 목표를 씁니다.'
        : '질 지표 원장에 이 지표를 등록하고 목표를 이 값으로 둡니다 — 등록 뒤 월 측정 기록과 목표 판정이 열립니다.',
      enact: {
        kind: 'MASTER_DATA',
        target: ledger
          ? { master: 'quality-indicator', op: 'update', id: ledger.id, payload: { targetValue: t, ...(policy?.registeredDirection ? {} : { direction }) } }
          : {
            master: 'quality-indicator', op: 'create',
            payload: {
              name: def.qiName, category: 'CPOE', formula: def.numerator + ' / ' + def.denominator + ' × 100',
              targetValue: t, direction, unit: '%', valueScale: 100,
            },
          },
      },
    }));
    options.push({ value: 'NONE', label: '정하지 않음', effect: '원장을 바꾸지 않습니다 — 화면은 계속 판정 없이 수만 보입니다.', enact: null });
    const body = [
      'CPOE 질 지표 화면에서 올린 안건입니다.',
      '지표: ' + def.qiName,
      '분자: ' + def.numerator + ' / 분모: ' + def.denominator,
      ledger ? '현재 원장 목표: ' + String(ledger.targetValue) : '현재 원장 미등록 — 목표 판정·월 측정 기록이 막혀 있습니다.',
      registry.source === 'REGISTRY' ? '방향: 코드 등재표' : policy?.registeredDirection ? '방향: 원장 등록값' : '방향: 제안자 선택(위원회 확인 필요)',
      dto.note?.trim() ? '제안 사유: ' + dto.note.trim() : null,
    ].filter(Boolean).join('\n');
    return this.agendas.submit({
      surfaceKey: 'master:quality-indicator', source: 'CPOE_QI', key: dto.key,
      title: (ledger ? '질 지표 목표 변경 — ' : '질 지표 원장 등록·목표 — ') + def.qiName, body, options,
    }, proposerId);
  }
}
