import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATIENT_FACING_OMIT } from '../../src/common/patient-select';
import { PortalService } from '../../src/modules/portal/portal.service';

/**
 * 환자·보호자 응답에서 **직원 몫**이 빠지는가 — 정본 `PATIENT_FACING_OMIT` ↔ 실제 쿼리 인자 대조 (2026-09-16 F4).
 *
 * 🔴 전수 실측: 환자 표면 핸들러 165(+무인증 86) 중, select 없이 모델을 통째로 돌려주던 자리에서만 나왔다.
 *    - 알레르기 2자리 → `notes`(임상 자유기재)·`recordedBy`(직원 UUID)
 *    - 원격진료 2자리 → `notes`·약사 검토 3필드·간호기록 id·녹화본 주소
 *    - 서류 발급 2자리 → 처리·기안·대리검증 직원 UUID 3종·신청 계정 id
 *    - 입원 상세 1자리 → `...admission` 전개(병상·담당의 내부 UUID)
 *    소비 화면(web portal·mobile)은 이 필드들을 하나도 읽지 않는다 — grep 소비처 0.
 *
 * 🔴 정본을 만든 것과 소비처가 쓰는 것은 다른 일이다(판정 규칙 §2) — 그래서 **목이 받은 실제 인자**를 본다.
 *    소스 문자열만 보면 `omit` 을 지운 뒤에도 다른 줄의 `omit` 에 걸려 통과할 수 있다.
 */

const ROOT = join(__dirname, '../..');

/** schema.prisma 에서 모델의 스칼라 필드 이름을 뽑는다 — 정본 키의 오타를 잡는다 */
function modelFields(model: string): Set<string> {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const m = schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'));
  if (!m) throw new Error(`schema.prisma 에 model ${model} 이 없다`);
  const out = new Set<string>();
  for (const line of m[1].split('\n')) {
    const f = line.match(/^\s{2}(\w+)\s+\S/);
    if (f) out.add(f[1]);
  }
  return out;
}

describe('환자 응답 omit 정본 — 필드가 실재하는가', () => {
  const MODEL_OF: Record<keyof typeof PATIENT_FACING_OMIT, string> = {
    allergy: 'Allergy',
    telehealthSession: 'TelehealthSession',
    documentRequest: 'DocumentRequest',
    admission: 'Admission',
  };

  it('대조군 — 정본이 비어 있지 않다(스캐너가 죽으면 이 파일 전체가 무의미하다)', () => {
    expect(Object.keys(PATIENT_FACING_OMIT).length).toBeGreaterThanOrEqual(4);
  });

  for (const [key, model] of Object.entries(MODEL_OF)) {
    it(`${key} — omit 키가 전부 ${model} 의 실제 필드다(오타면 Prisma 런타임에서야 터진다)`, () => {
      const fields = modelFields(model);
      const omitKeys = Object.keys(PATIENT_FACING_OMIT[key as keyof typeof PATIENT_FACING_OMIT]);
      expect(omitKeys.length).toBeGreaterThan(0);
      expect(omitKeys.filter((k) => !fields.has(k))).toEqual([]);
    });
  }

  it('🔴 환자가 봐야 하는 필드는 빼지 않는다 — 대조군', () => {
    // 알레르기: 화면이 쓰는 3필드 · 서류: 거절 사유(환자가 알아야 한다) · 원격진료: 입장에 필요한 roomId
    for (const keep of ['allergen', 'reaction', 'severity']) {
      expect(PATIENT_FACING_OMIT.allergy).not.toHaveProperty(keep);
    }
    expect(PATIENT_FACING_OMIT.documentRequest).not.toHaveProperty('rejectReason');
    expect(PATIENT_FACING_OMIT.telehealthSession).not.toHaveProperty('roomId');
    expect(PATIENT_FACING_OMIT.telehealthSession).not.toHaveProperty('chiefComplaint');
  });
});

/**
 * 남은 자리 동결 — "select/omit 없이 prisma 결과를 그대로 돌려주는" 포털 서비스 자리.
 * 🔴 **결함 목록이 아니다.** 환자 본인이 쓴 것(건강메모·만족도·문진 응답·폼 제출)과 직원 경로(서류 상태 변경)다.
 *    지키는 것은 하나 — **늘지 않는다**. 새 자리가 생기면 이 테스트가 실패하고, 사람이 한 번 판정한다.
 */
const BARE_RETURN_BASELINE: Record<string, number> = {
  'healthMemo.findMany': 1,
  'healthMemo.create': 1,
  'satisfactionSurvey.findMany': 1,
  'satisfactionSurvey.create': 1,
  // 🔴 (2026-09-16 G3) `blockchainCertificate.create` 를 여기서 뺐다 — 목록과 같은 `select` 로 좁혔다.
  //    종전엔 발급만 통째로 돌려줘 certHash·fingerprint·pinFailCount 같은 내부 운영 값이 환자 앱에 실렸다.
  'checkupVisit.update': 1,
  'checkupQuestionnaireResponse.update': 1,
  'checkupQuestionnaireResponse.create': 1,
  'formSubmission.create': 1,
};

describe('포털 응답에서 모델을 통째로 돌려주는 자리는 늘지 않는다', () => {
  const SRC = readFileSync(join(ROOT, 'src/modules/portal/portal.service.ts'), 'utf8');

  /** 괄호 균형으로 호출 인자 블록을 뽑는다(중첩 객체를 넘기기 위해) */
  const argBlock = (s: string, start: number) => {
    let d = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === '(') d++;
      else if (s[i] === ')') { d--; if (d === 0) return s.slice(start, i + 1); }
    }
    return '';
  };

  const scan = () => {
    const re = /return (?:await )?this\.prisma\.(\w+)\.(findMany|findFirst|findUnique|create|update|upsert)\s*\(/g;
    const out: Record<string, number> = {};
    let m: RegExpExecArray | null;
    while ((m = re.exec(SRC))) {
      const b = argBlock(SRC, m.index + m[0].length - 1);
      if (/(^|[\s{,])(select|omit)\s*:/.test(b)) continue;
      const k = `${m[1]}.${m[2]}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };

  it('대조군 — 스캐너가 살아 있다(가드된 자리도 실제로 찾는다)', () => {
    const re = /return (?:await )?this\.prisma\.\w+\.\w+\s*\(/g;
    expect((SRC.match(re) ?? []).length).toBeGreaterThan(20);
  });

  it('통째 반환 자리가 기준선과 정확히 같다(늘면 새 노출 · 줄면 이 수를 내린다)', () => {
    expect(scan()).toEqual(BARE_RETURN_BASELINE);
  });

  /**
   * 🔴 (G3) 인증서는 **발급과 목록이 같은 필드 집합**이다 — 같은 사실에 정본이 둘이면 갈라진다.
   *    내부 운영 값(해시·지문·PIN 실패 횟수·이전 인증서 id)은 어느 경로로도 환자 앱에 나가지 않는다.
   */
  it('환자 인증서 — 발급·목록이 한 집합을 쓰고 내부 운영 값을 싣지 않는다', () => {
    const uses = (SRC.match(/select: PATIENT_CERTIFICATE_SELECT/g) ?? []).length;
    expect(uses, '발급·목록 둘 다 같은 select 를 써야 한다').toBe(2);
    const block = SRC.slice(SRC.indexOf('const PATIENT_CERTIFICATE_SELECT'), SRC.indexOf('@Injectable()'));
    for (const internal of ['certHash', 'fingerprint', 'pinFailCount', 'pinLockedUntil', 'previousCertId', 'keyCustody', 'attestationRef', 'publicKey']) {
      expect(block, `${internal} 가 환자 인증서 집합에 들어갔다`).not.toContain(internal);
    }
    // 대조군 — 화면이 읽는 필드는 그대로 있다
    for (const keep of ['serialNumber', 'status', 'expiresAt', 'algorithm']) {
      expect(block).toContain(keep);
    }
  });
});

describe('포털 서비스가 환자 응답에 omit 을 실제로 넘기는가', () => {
  let service: any;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
      telehealthSession: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ id: 't-1' }) },
      documentRequest: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ id: 'd-1' }) },
      admission: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    service = new PortalService(prisma, { get: vi.fn() } as any, { get: vi.fn() } as any, {} as any, {} as any, {} as any);
  });

  it('알레르기 목록 — 직원 메모·기록자 UUID 를 빼고 조회한다', async () => {
    await service.getAllergies('p-1');
    const args = prisma.allergy.findMany.mock.calls[0][0];
    expect(args.omit).toEqual(PATIENT_FACING_OMIT.allergy);
    expect(args.where).toEqual({ patientId: 'p-1', isActive: true });
  });

  it('원격진료 목록·상세 — 직원 메모·약사 검토·녹화본을 빼고 조회한다', async () => {
    await service.getTelehealthSessions('p-1');
    expect(prisma.telehealthSession.findMany.mock.calls[0][0].omit).toEqual(PATIENT_FACING_OMIT.telehealthSession);
    await service.getTelehealthSession('t-1', 'p-1');
    expect(prisma.telehealthSession.findFirst.mock.calls[0][0].omit).toEqual(PATIENT_FACING_OMIT.telehealthSession);
  });

  it('서류 발급 목록·상세 — 처리 직원 UUID 를 빼고 조회한다', async () => {
    await service.getDocumentRequests('p-1');
    expect(prisma.documentRequest.findMany.mock.calls[0][0].omit).toEqual(PATIENT_FACING_OMIT.documentRequest);
    await service.getDocumentRequest('p-1', 'd-1');
    expect(prisma.documentRequest.findFirst.mock.calls[0][0].omit).toEqual(PATIENT_FACING_OMIT.documentRequest);
  });

  it('🔴 쓰기 응답도 같은 표면이다 — 입장·메시지·평가·취소·예약이 갱신된 전 행을 그대로 돌려주지 않는다', async () => {
    prisma.telehealthSession.update = vi.fn().mockResolvedValue({ id: 't-1' });
    prisma.telehealthSession.create = vi.fn().mockResolvedValue({ id: 't-2' });
    await service.joinTelehealth('t-1', 'p-1');
    await service.sendTelehealthMessage('t-1', 'p-1', '메시지');
    await service.rateTelehealth('t-1', 'p-1', 5, '좋았습니다');
    await service.cancelTelehealth('t-1', 'p-1');
    expect(prisma.telehealthSession.update.mock.calls.length).toBe(4);
    for (const [args] of prisma.telehealthSession.update.mock.calls) {
      expect(args.omit).toEqual(PATIENT_FACING_OMIT.telehealthSession);
    }
  });

  it('입원 상세 — 엔티티를 그대로 펼치므로 내부 UUID 를 빼고 조회한다', async () => {
    await service.getInpatientDetail('p-1');
    const args = prisma.admission.findFirst.mock.calls[0][0];
    expect(args.omit).toEqual(PATIENT_FACING_OMIT.admission);
    // 대조군 — 화면이 쓰는 관계(bed.ward·attendingDoctor)는 계속 실린다
    expect(args.include).toHaveProperty('bed');
    expect(args.include).toHaveProperty('attendingDoctor');
  });
});
