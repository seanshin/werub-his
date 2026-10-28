import { Logger } from '@nestjs/common';

/**
 * 안전 게이트 위반 원장 기록 — **실패를 조용히 삼키지 않는다**(2026-09-16 K4).
 *
 * 🔴 왜 정본이 필요한가: 이 저장소의 게이트 규약은 "막으면 방치된다 — 봉쇄가 아니라 **기록과 가시화**"이고,
 *    "가짜 게이트 금지 — 체크가 버튼을 막는다면 그 체크는 **서버에 남아야** 한다"이다.
 *    그런데 `gateViolationLog.create(...).catch(() => undefined)` 가 8파일 10자리에 흩어져 있었다 —
 *    기록이 실패하면 **아무 흔적도 남지 않고**, `/admin/safety-gates` 는 그 게이트를 "위반 0"으로 그린다.
 *    0건은 이 화면에서 "준수"로 읽히고, WARN→BLOCK 승격 판단의 근거가 된다.
 *    같은 함정을 이 저장소가 이미 겪었다(v4.4.0 DUR 43룰 — 탐지기가 죽어 0행이었는데 "위반 없음"으로 읽었다).
 *    읽는 쪽은 이미 고쳐져 있다(`governance.service` 집계 실패 → `null` + '산출 불가' 메모).
 *    **쓰는 쪽만 조용했다.**
 *
 * 규약:
 *  · **던지지 않는다** — 호출부는 이미 게이트 판정을 끝낸 쓰기 경로다(BLOCK 은 자기 예외를 따로 던진다).
 *    기록 실패가 임상 행위를 되돌리면 안 된다.
 *  · **트랜잭션 밖** 클라이언트로 부른다 — BLOCK 롤백에도 위반 기록은 보존되어야 한다(기존 규약 유지).
 *  · 실패하면 `logger.error` 로 게이트·대상 식별자를 남긴다 — 사후에 무엇이 유실됐는지 셀 수 있게.
 *  · 기록 여부를 `boolean` 으로 돌려준다 — 호출부가 화면·응답에 드러내고 싶으면 쓸 수 있게(강제하지 않는다).
 */
export interface GateViolationRecord {
  gateKey: string;
  /** OFF|WARN|BLOCK|OVERRIDE 등 호출부 어휘 그대로 — 이 정본은 어휘를 지어내지 않는다 */
  severity: string;
  message: string;
  refType?: string;
  refId?: string;
}

/** `PrismaService` 의 최소 표면만 요구한다(목·트랜잭션 클라이언트 모두 넘길 수 있게) */
export interface GateViolationLogWriter {
  gateViolationLog: {
    create(args: {
      data: { gateKey: string; severity: string; message: string; refType?: string; refId?: string };
    }): Promise<unknown>;
  };
}

/** 원장 컬럼 상한(safety-gate 정본과 같은 값) */
const MESSAGE_LIMIT = 2000;

export async function recordGateViolation(
  prisma: GateViolationLogWriter,
  logger: Logger,
  rec: GateViolationRecord,
): Promise<boolean> {
  try {
    await prisma.gateViolationLog.create({
      data: {
        gateKey: rec.gateKey,
        severity: rec.severity,
        message: rec.message.slice(0, MESSAGE_LIMIT),
        refType: rec.refType,
        refId: rec.refId,
      },
    });
    return true;
  } catch (e) {
    // 🔴 유실을 말한다 — 이 줄이 없으면 관제 화면의 "위반 0"이 사실인지 아무도 모른다
    logger.error(
      `게이트 위반 기록 실패 — 관제(/admin/safety-gates)에 남지 않았다: ` +
        `gate=${rec.gateKey} severity=${rec.severity} ref=${rec.refType ?? '-'}/${rec.refId ?? '-'}: ${(e as Error).message}`,
    );
    return false;
  }
}
