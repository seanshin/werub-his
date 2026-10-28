import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  DECISION_PRINT_CANON_VERSION, decisionPrintCanonLine, decisionPrintStateOf, sortDecisionsForRegister, type DecisionPrintState,
} from '@hospital-run/shared';
import { DecisionService } from './decision.service';

export type DecisionPrintKind = 'REGISTER' | 'RECORD';

/** 발급 스냅샷 v1 — 🔴 해시는 `lines.join('\n')` 의 sha256(JSON 키 순서에 기대지 않는다) */
export interface DecisionPrintSnapshot {
  v: number;
  kind: DecisionPrintKind;
  key: string | null;
  measuredAt: string;
  counts: Record<DecisionPrintState, number>;
  lines: string[];
}

export const decisionPrintHash = (lines: readonly string[]) => crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');

/**
 * 결정 인쇄본 정본 줄 — 2026-10-12 기획 `decision-print-remaining` P0.
 * 발급·대조는 공용 발급 모듈(`print-issuance`)이 맡고, 여기서는 **지금 원장에서 줄을 만드는 일**만 한다.
 */
@Injectable()
export class DecisionPrintService {
  constructor(private readonly decisions: DecisionService) {}

  /** 지금 원장의 정본 줄 — 대장은 전 결정(세부 분류 → 키 순) · 의사결정서는 그 결정 하나 */
  async build(kind: DecisionPrintKind, key?: string | null): Promise<DecisionPrintSnapshot> {
    const payload = await this.decisions.list();
    const items = kind === 'RECORD' ? payload.items.filter((i) => i.key === key) : sortDecisionsForRegister(payload.items);
    if (kind === 'RECORD' && items.length === 0) throw new NotFoundException({ code: 'DECISION_NOT_FOUND', message: '등록부에 없는 결정입니다', details: { key } });
    const counts: Record<DecisionPrintState, number> = { REAL: 0, SEED: 0, OPEN: 0 };
    for (const i of items) counts[decisionPrintStateOf(i)]++;
    return {
      v: DECISION_PRINT_CANON_VERSION, kind, key: kind === 'RECORD' ? key! : null,
      measuredAt: payload.measuredAt, counts,
      lines: items.map((i) => decisionPrintCanonLine({ key: i.key, decided: i.decided, seeded: i.seeded, record: i.record })),
    };
  }
}
