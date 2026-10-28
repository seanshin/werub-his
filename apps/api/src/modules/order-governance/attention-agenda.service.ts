import { BadRequestException, Injectable } from '@nestjs/common';
import { CommitteeAgendaService, type AgendaOption } from './committee-agenda.service';

export const ATTENTION_PRIORITIES = ['STAT', 'URGENT', 'ROUTINE'] as const;
const KEY = 'orders.tracking.attentionMin';

/**
 * 오더 처리 주의 기준(긴급도별 분) — 위원회 안건으로 올린다(2026-10-07).
 * 🔴 값은 제안자가 후보로 적고 위원회가 고른다 — 이 화면은 설정을 바꾸지 않는다. "정하지 않음"도 선택지다.
 * 🔴 1~1440 분 정수만 · 후보마다 하나 이상의 긴급도 · 같은 후보 두 번 금지.
 */
@Injectable()
export class AttentionAgendaService {
  constructor(private readonly agendas: CommitteeAgendaService) {}

  async propose(dto: { candidates: Record<string, number | undefined>[]; note?: string }, proposerId: string) {
    const seen = new Set<string>();
    const options: AgendaOption[] = dto.candidates.map((c, i) => {
      const value: Record<string, number> = {};
      for (const p of ATTENTION_PRIORITIES) {
        const v = c[p];
        if (v == null) continue;
        if (!Number.isInteger(v) || v < 1 || v > 1440) {
          throw new BadRequestException({ code: 'ATTENTION_VALUE', message: '주의 기준은 1~1440 분 정수입니다', candidate: i + 1, priority: p });
        }
        value[p] = v;
      }
      if (!Object.keys(value).length) throw new BadRequestException({ code: 'ATTENTION_EMPTY', message: '후보마다 긴급도 하나 이상의 분을 적으십시오', candidate: i + 1 });
      const sig = JSON.stringify(value);
      if (seen.has(sig)) throw new BadRequestException({ code: 'ATTENTION_DUPLICATE', message: '같은 후보가 두 번 있습니다', candidate: i + 1 });
      seen.add(sig);
      return {
        value: `C${i + 1}`,
        // 값만 — 문장은 위원회 화면이 effect 와 함께 보인다
        label: `${Object.entries(value).map(([k, v]) => `${k} ${v}`).join(' · ')} (min)`,
        effect: '오더 실시간 추적이 발행 후 이 분을 넘긴 미완료 오더를 주의로 표시하고, 위원회 기준 점검이 초과 건을 셉니다.',
        enact: { kind: 'CONFIG_CHANGE', target: { key: KEY, newValue: value } },
      };
    });
    options.push({ value: 'NONE', label: '정하지 않음', effect: '설정을 바꾸지 않습니다 — 지금처럼 경과만 보이고 지연을 판정하지 않습니다.', enact: null });
    const body = [
      '오더 실시간 추적·위원회 기준 점검에서 올린 안건입니다. 주의 기준이 미설정이라 지연을 판정하지 않고 있습니다.',
      dto.note?.trim() ? '제안 사유: ' + dto.note.trim() : null,
    ].filter(Boolean).join('\n');
    return this.agendas.submit({
      surfaceKey: 'config:' + KEY, source: 'ORDER_ATTENTION', key: KEY,
      title: '오더 처리 주의 기준(긴급도별 분) 결정', body, options,
    }, proposerId);
  }
}
