import { createHash } from 'crypto';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { canonicalJson } from '../../common/util/canonical-json';

export { canonicalJson };

/**
 * 전자서명 대상 문서의 내용 해시 — 서버 정본(2026-10-13 결함 발굴 A2).
 *
 * 🔴 종전: 서명 모달이 `${종류}:${id}:${제목}` 문자열을 해시해 서명했고, 서버는 **같은 요청이 보낸 해시**로
 *    서명값을 검증해 VERIFIED 를 줬다. 서명은 문서 내용에 묶이지 않았다 — 진료기록 SOAP 를 바꿔도 "검증됨".
 * 이제 해시는 서버가 문서 원장에서 계산한다. 서명 모달은 이 해시를 받아 서명하고, 서버는 같은 해시인지 대조한다.
 *
 *  · 정규화: 키 정렬 JSON · Date = ISO · Decimal = 문자열 · undefined 없음 · 자식 행은 id·부모 키·시각을 빼고 내용으로 정렬
 *    (진료기록 저장이 진단 행을 지우고 다시 만들어도 내용이 같으면 해시가 같다)
 *  · 서명 행위가 바꾸는 칸(상태·서명 시각·서명자·검수자 등)은 내용이 아니다 — 서명 전후 해시가 같아야 대조가 된다
 *  · 🔴 이 목록 밖의 종류는 해시를 지어내지 않는다(null) — 서명 EP 가 거부한다
 */
export const CONTENT_HASH_CANON = 'doc-content-v1';

export const CONTENT_HASH_TYPES = ['ENCOUNTER', 'DISCHARGE_SUMMARY', 'DISPENSING', 'LAB_WORKSHEET', 'PATHOLOGY_REPORT', 'PRESCRIPTION', 'CONSENT'] as const;
export type ContentHashType = typeof CONTENT_HASH_TYPES[number];
export const isContentHashType = (t: string): t is ContentHashType => (CONTENT_HASH_TYPES as readonly string[]).includes(t);

/** 서명 행위·운영 이력이 바꾸는 칸 — 어느 종류든 내용이 아니다 */
const ALWAYS_OUT = new Set(['createdAt', 'updatedAt', 'status', 'signedAt', 'signedBy']);
/** 자식 행에서 빼는 칸 — 행 식별·소속·시각 */
const CHILD_OUT = new Set(['id', 'createdAt', 'updatedAt', 'encounterId', 'dispensingId', 'worksheetId', 'labResultId']);

const OUT: Record<ContentHashType, string[]> = {
  ENCOUNTER: ['aiEditDistance', 'aiScribed', 'scribeSessionId', 'eligibilityCheckId'],
  DISCHARGE_SUMMARY: [],
  DISPENSING: ['dispensedAt', 'secondCheckBy', 'secondCheckAt', 'verifiedBy', 'verifiedAt', 'issuedBy', 'issuedAt', 'issuedTo'],
  LAB_WORKSHEET: [],
  PATHOLOGY_REPORT: ['reportedBy', 'reportedAt', 'amendedAt'],
  PRESCRIPTION: ['readBackConfirmedAt', 'readBackConfirmedBy', 'prescriberCosignedAt', 'prescriberCosignedBy', 'discontinuedAt', 'discontinuedBy', 'discontinueReason'],
  CONSENT: [],
};
/** 동의서는 서명 이미지·서명 연동 칸이 많아 "내용"만 고른다(제외 목록으로는 새 서명 칸이 생길 때마다 해시가 흔들린다) */
const CONSENT_PICK = ['id', 'patientId', 'type', 'consentType', 'templateId', 'templateName', 'content', 'risks', 'alternatives', 'explanation', 'encounterId', 'surgeryId', 'doctorId', 'expiresAt'];
const DX_CHILD_OUT = new Set([...CHILD_OUT]);

const omit = (row: Record<string, unknown>, out: Set<string>) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !out.has(k)));
/** 자식 행 — 식별·시각을 빼고 내용 JSON 으로 정렬 */
const children = (rows: Array<Record<string, unknown>>, out = CHILD_OUT) =>
  rows.map((r) => omit(r, out)).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));

export interface SignedContent {
  type: ContentHashType;
  /** 서명 원장이 쓰는 문서 id — 퇴원요약은 입원 id 로 물어도 요약 id 를 돌려준다(종전엔 모달=입원 id·서버=요약 id 로 갈렸다) */
  documentId: string;
  patientId: string | null;
  canon: string;
  hash: string;
}

/** 문서 내용(서명 대상)을 원장에서 모은다 — 없으면 null */
async function contentOf(prisma: PrismaService, type: ContentHashType, id: string): Promise<{ documentId: string; patientId: string | null; body: unknown } | null> {
  const base = (row: Record<string, unknown>) => omit(row, new Set([...ALWAYS_OUT, ...OUT[type]]));
  switch (type) {
    case 'ENCOUNTER': {
      const r = await prisma.encounter.findUnique({ where: { id }, include: { diagnoses: true } });
      if (!r) return null;
      const { diagnoses, ...row } = r as typeof r & { diagnoses: Array<Record<string, unknown>> };
      return { documentId: r.id, patientId: r.patientId, body: { ...base(row), diagnoses: children(diagnoses, DX_CHILD_OUT) } };
    }
    case 'DISCHARGE_SUMMARY': {
      const r = (await prisma.dischargeSummary.findUnique({ where: { id } })) ?? (await prisma.dischargeSummary.findUnique({ where: { admissionId: id } }));
      if (!r) return null;
      const adm = await prisma.admission.findUnique({ where: { id: r.admissionId }, select: { patientId: true } });
      return { documentId: r.id, patientId: adm?.patientId ?? null, body: base(r) };
    }
    case 'DISPENSING': {
      const r = await prisma.dispensing.findUnique({ where: { id }, include: { items: true } });
      if (!r) return null;
      const { items, ...row } = r as typeof r & { items: Array<Record<string, unknown>> };
      const itemOut = new Set([...CHILD_OUT, 'scannedAt']);
      return { documentId: r.id, patientId: r.patientId, body: { ...base(row), items: children(items, itemOut) } };
    }
    case 'LAB_WORKSHEET': {
      const r = await prisma.labWorksheet.findUnique({ where: { id }, include: { items: true } });
      if (!r) return null;
      const { items, ...row } = r as typeof r & { items: Array<Record<string, unknown> & { labResultId: string | null }> };
      const resultIds = items.map((i) => i.labResultId).filter((x): x is string => !!x);
      const values = resultIds.length ? await prisma.labResultItem.findMany({ where: { labResultId: { in: resultIds } } }) : [];
      return {
        documentId: r.id, patientId: null,
        body: {
          ...base(row),
          items: children(items.map((i) => ({ ...i, values: children(values.filter((v) => v.labResultId === i.labResultId) as unknown as Array<Record<string, unknown>>) }))),
        },
      };
    }
    case 'PATHOLOGY_REPORT': {
      const r = await prisma.pathologyReport.findUnique({ where: { id } });
      if (!r) return null;
      const sp = await prisma.pathologySpecimen.findUnique({ where: { id: r.specimenId }, select: { patientId: true } });
      return { documentId: r.id, patientId: sp?.patientId ?? null, body: base(r) };
    }
    case 'PRESCRIPTION': {
      const r = await prisma.prescription.findUnique({ where: { id } });
      if (!r) return null;
      const enc = await prisma.encounter.findUnique({ where: { id: r.encounterId }, select: { patientId: true } });
      return { documentId: r.id, patientId: enc?.patientId ?? null, body: base(r) };
    }
    case 'CONSENT': {
      const r = await prisma.consentForm.findUnique({ where: { id } });
      if (!r) return null;
      const picked = Object.fromEntries(CONSENT_PICK.map((k) => [k, (r as Record<string, unknown>)[k]]));
      return { documentId: r.id, patientId: r.patientId, body: picked };
    }
  }
}

/** 서명 대상 내용 해시 — 종류 밖이거나 문서가 없으면 null(지어내지 않는다) */
export async function signedContentHash(prisma: PrismaService, type: string, id: string): Promise<SignedContent | null> {
  if (!isContentHashType(type)) return null;
  const c = await contentOf(prisma, type, id);
  if (!c) return null;
  const hash = createHash('sha256').update(`${CONTENT_HASH_CANON}\n${type}\n${canonicalJson(c.body)}`, 'utf8').digest('hex');
  return { type, documentId: c.documentId, patientId: c.patientId, canon: CONTENT_HASH_CANON, hash };
}
