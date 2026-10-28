import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Logger } from '@nestjs/common';
import { verifyDocumentSignature } from './signature-verify';
import { signedContentHash } from '../../modules/document-sign/document-content-hash';

const signatureLogger = new Logger('BlockchainSignature');

/**
 * 블록체인 서명 기록 공통 헬퍼 — 2026-07 트랜잭션 경계 전수.
 *
 * 진료·동의·퇴원요약·검사 워크시트·조제·처방·병리 **7곳이 같은 블록을 복제**하고 있었고,
 * 모두 `signedDocument` → `documentSignature` → `signedDocument.update` 를 **순차 쓰기**했다.
 * 중간에 실패하면 **서명 문서만 있고 실제 서명이 없거나**, 서명은 있는데 완료 카운트가
 * 오르지 않은 상태가 남는다.
 *
 * 여기서 세 쓰기를 한 트랜잭션으로 묶는다. 호출부의 try/catch(non-blocking) 성격은 그대로 —
 * 서명 기록 실패가 본 임상 작업(서명 상태 전이)을 되돌리지는 않는다.
 */

/**
 * 인증서 소유 대조 정본(2026-09-15 M1) — 서명자와 인증서 소유자가 같은가.
 *
 * 🔴 실측: 임상 6경로(진료·처방·조제·검사 워크시트·병리·퇴원요약)가 쓰는 이 헬퍼와 동의서 서명은
 *    인증서 id 만 받고 **소유자를 대조하지 않았다** — 로그인한 직원이 남의 인증서 id 로 서명하면
 *    서명 행이 그 직원(또는 인증서 주인) 이름으로 남았다. document-sign EP(B7)에만 대조가 있었다.
 * 규칙: 직원 서명 = 서명자 본인 소유 STAFF 인증서 · 환자 서명 = 그 환자 소유 PATIENT 인증서.
 * @returns null = 소유 일치 · 문자열 = 불일치 사유 코드
 */
export function certificateOwnershipProblem(
  cert: { ownerType: string; userId: string | null; patientId: string | null },
  signer: { signerType: 'STAFF' | 'PATIENT' | string; signerUserId?: string | null; signerPatientId?: string | null },
): string | null {
  if (signer.signerType === 'STAFF') {
    if (!signer.signerUserId) return 'SIGNER_UNKNOWN';
    if (cert.ownerType !== 'STAFF' || cert.userId !== signer.signerUserId) return 'SIGN_CERT_NOT_OWNED';
    return null;
  }
  if (signer.signerType === 'PATIENT') {
    if (!signer.signerPatientId) return 'SIGNER_UNKNOWN';
    if (cert.ownerType !== 'PATIENT' || cert.patientId !== signer.signerPatientId) return 'SIGN_CERT_NOT_OWNED';
    return null;
  }
  return 'SIGN_SIGNER_TYPE_INVALID';
}

/**
 * 서명 문서 해시 맞춤 정본(2026-09-15 P1) — `SignedDocument.documentHash` 는 **재검증 입력(서명된 메시지)** 이다.
 *
 * 🔴 실측: 동의서는 서명 전에 `anchorConsentSignature` 가 앵커 페이로드 해시로 문서를 만들었고, 그 뒤 화면 식별
 *    해시에 붙인 **실제 서명**이 기록되면 `/verify` 가 앵커 해시로 재검증해 정상 서명을 FAILED 라 말했다.
 * 규칙: 아직 서명이 한 건도 없는 문서의 해시는 **처음 기록되는(검증을 통과한) 서명의 해시**로 맞춘다.
 *       서명이 이미 있으면 바꾸지 않는다(그 서명들의 재검증 입력을 지키기 위해 — 해시 교체는 정정 재서명만).
 * @returns 맞췄으면 true
 */
export async function alignDocumentHashToFirstSignature(
  tx: { documentSignature: { count: (a: { where: { signedDocumentId: string } }) => Promise<number> }; signedDocument: { update: (a: { where: { id: string }; data: { documentHash: string } }) => Promise<unknown> } },
  signedDoc: { id: string; documentHash: string },
  signedHash: string,
): Promise<boolean> {
  if (signedDoc.documentHash === signedHash) return false;
  const existing = await tx.documentSignature.count({ where: { signedDocumentId: signedDoc.id } });
  if (existing > 0) return false;
  await tx.signedDocument.update({ where: { id: signedDoc.id }, data: { documentHash: signedHash } });
  signedDoc.documentHash = signedHash;
  return true;
}

/**
 * 서명 완료 수를 누가 세는가(2026-10-13 결함 발굴 U1).
 * 🔴 동의서는 서명 **사건 원장**(consent.service anchorConsentSignature — 환자·의사·간호사·증인 각 1회)이 센다.
 *    종전엔 같은 의사의 전자서명이 그 위에 한 번 더 세어져, 환자가 서명하기 전에 2/2·COMPLETED 가 됐다.
 *    동의서의 전자서명은 문서에 붙되 수를 올리지 않는다. 그 밖의 문서는 전자서명이 센다.
 */
export const countsBySigningEvents = (documentType: string) => documentType === 'CONSENT';

export interface BlockchainSignatureInput {
  certificateId: string;
  signatureValue: string;
  signatureAlgorithm: string;
  documentHash: string;
}

export interface RecordSignatureOptions {
  documentType: string;
  documentId: string;
  patientId?: string | null;
  /** 정정 후 재서명 — 직전 서명을 무효화하고 documentVersion 을 올린다(유효 서명 1개 보장) */
  amended?: boolean;
  signerUserId: string;
  signerRole?: string;
  signerType?: string;
}

/**
 * 인증서 유효성 확인 후 서명을 기록한다.
 * @returns 기록했으면 true, 인증서가 없거나 유효하지 않거나 **서명이 공개키로 검증되지 않아** 건너뛰었으면 false
 */
export async function recordBlockchainSignature(
  prisma: PrismaService,
  sig: BlockchainSignatureInput,
  opts: RecordSignatureOptions,
): Promise<boolean> {
  const cert = await prisma.blockchainCertificate.findUnique({ where: { id: sig.certificateId } });
  if (!cert || cert.status !== 'ACTIVE' || cert.expiresAt <= new Date()) return false;
  // 🔴 (M1) 남의 인증서로 남긴 서명은 서명이 아니다 — 이 헬퍼는 직원 서명 경로 전용(signerUserId = 로그인 사용자)
  const ownership = certificateOwnershipProblem(cert, { signerType: opts.signerType ?? 'STAFF', signerUserId: opts.signerUserId });
  if (ownership) {
    // 로그 문장은 코드·값만(조립 한국어 문장 기준선) — 사유 코드가 정본
    signatureLogger.warn(`SIGNATURE_REJECTED reason=${ownership} doc=${opts.documentType}:${opts.documentId} signer=${opts.signerUserId}`);
    return false;
  }
  // 🔴 (2026-09-15 N2) 공개키로 검증되지 않는 서명은 기록하지 않는다(종전: 아무 문자열이나 isValid=true 로 기록)
  const verification = verifyDocumentSignature({
    publicKey: cert.publicKey, certAlgorithm: cert.algorithm,
    signatureAlgorithm: sig.signatureAlgorithm, signatureValue: sig.signatureValue, documentHash: sig.documentHash,
  });
  if (verification.state === 'FAILED') return false;

  // 🔴 (2026-10-13 A2) 서명한 해시가 이 문서 **내용**의 해시여야 한다. 서명 모달이 document-sign 으로 이미 대조·기록한
  //    같은 서명(아래 dup)은 그때 대조됐다 — 그 밖의 서명은 지금 내용과 대조한다(맞지 않으면 기록하지 않는다).
  const existingDoc = await prisma.signedDocument.findFirst({ where: { documentType: opts.documentType, documentId: opts.documentId } });
  const alreadySigned = existingDoc
    ? await prisma.documentSignature.findFirst({ where: { signedDocumentId: existingDoc.id, certificateId: sig.certificateId, signatureValue: sig.signatureValue }, select: { id: true } })
    : null;
  if (!alreadySigned) {
    const content = await signedContentHash(prisma, opts.documentType, opts.documentId);
    if (!content || content.hash !== sig.documentHash) {
      signatureLogger.warn(`SIGNATURE_REJECTED reason=SIGN_HASH_NOT_CONTENT doc=${opts.documentType}:${opts.documentId} signer=${opts.signerUserId}`);
      return false;
    }
  }

  await prisma.$transaction(async (tx) => {
    let signedDoc = await tx.signedDocument.findFirst({
      where: { documentType: opts.documentType, documentId: opts.documentId },
    });

    const created = !signedDoc;
    if (!signedDoc) {
      signedDoc = await tx.signedDocument.create({
        data: {
          documentType: opts.documentType,
          documentId: opts.documentId,
          patientId: opts.patientId ?? undefined,
          documentHash: sig.documentHash,
          status: 'SIGNED',
        },
      });
    }

    // 같은 서명값이 이미 이 문서에 있으면 다시 만들지 않는다 — 서명 모달이 document-sign EP 로 이미 기록한 서명을
    // 임상 경로가 한 번 더 넘기면 서명 행·완료 카운트가 이중으로 쌓였다(M1).
    const dup = await tx.documentSignature.findFirst({
      where: { signedDocumentId: signedDoc.id, certificateId: sig.certificateId, signatureValue: sig.signatureValue },
      select: { id: true },
    });

    if (opts.amended && !created) {
      // 정정 후 재서명: 직전 유효 서명 무효화 + 버전 증가(현행 유효본 1개 보장) — 방금 기록된 같은 서명(dup)은 현행본이다
      await tx.documentSignature.updateMany({
        where: { signedDocumentId: signedDoc.id, isValid: true, ...(dup ? { id: { not: dup.id } } : {}) },
        data: { isValid: false },
      });
      signedDoc = await tx.signedDocument.update({
        where: { id: signedDoc.id },
        data: { documentVersion: { increment: 1 }, documentHash: sig.documentHash, status: 'SIGNED' },
      });
    }

    if (dup) return;

    // 🔴 (P1) 앵커 등이 먼저 만든 빈 문서의 해시를 이 서명이 실제로 서명한 해시로 맞춘다(정정 재서명은 위에서 이미 교체)
    if (!created && !opts.amended) await alignDocumentHashToFirstSignature(tx, signedDoc, sig.documentHash);

    await tx.documentSignature.create({
      data: {
        signedDocumentId: signedDoc.id,
        certificateId: sig.certificateId,
        signatureValue: sig.signatureValue,
        signatureAlgorithm: sig.signatureAlgorithm,
        signedAt: new Date(),
        signerRole: opts.signerRole ?? 'PRIMARY',
        signerType: opts.signerType ?? 'STAFF',
        signerUserId: opts.signerUserId,
        verifiedAt: verification.state === 'VERIFIED' ? new Date() : null,
      },
    });

    if (!countsBySigningEvents(opts.documentType)) {
      // 🔴 (U1) 종전엔 필요 서명 수와 무관하게 COMPLETED 로 덮었다 — 증가된 실제 값으로 판정한다
      const counted = await tx.signedDocument.update({
        where: { id: signedDoc.id },
        data: { completedSigners: { increment: 1 } },
        select: { completedSigners: true, requiredSigners: true },
      });
      await tx.signedDocument.update({
        where: { id: signedDoc.id },
        data: { status: counted.completedSigners >= counted.requiredSigners ? 'COMPLETED' : 'PENDING' },
      });
    }
  });

  return true;
}
