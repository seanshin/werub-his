import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentService } from '../document/document.service';
import { transmissionFact } from './external-rx-transmission';

/** 처방전 발급 문서 유형(발급 원장 `issued_documents.document_type`) */
export const PRESCRIPTION_DOC_TYPE = 'PRESCRIPTION';
/** 서명(또는 정정 서명)된 진료만 처방전을 발급한다 — 초안은 처방전으로 쓸 수 없다 */
const ISSUABLE_ENCOUNTER = ['SIGNED', 'AMENDED'];

/**
 * 처방전 발급(2026-09-30) — 발급번호·QR 로 **진위를 확인할 수 있는 종이 처방전**.
 *
 * 🔴 종전 인쇄물은 "이 처방전은 전자처방전입니다 · 하단 QR로 검증하십시오"라고 적었는데 QR 은 없었고(이전 교정에서 없는 경로라 걷음),
 *    약국으로 나가는 전송도 없었으며, 교부번호는 인쇄할 때 계산만 하고 **어디에도 기록되지 않았다**.
 *
 * 규칙:
 *  · 스냅샷은 **서버가 DB 에서** 만든다 — 발급 원장 범용 EP 는 화면이 보낸 스냅샷을 해시해, 임의 내용이 진짜 번호를 받을 수 있다.
 *  · 인쇄 대상과 같은 집합: 원외(EXTERNAL) 약이 있으면 원외만, 없으면 활성 약 전부 · 취소·중단 제외.
 *  · 같은 내용을 다시 인쇄하면 **같은 번호**(해시 일치) · 내용이 바뀌면 새 번호 + 이전 발급은 `SUPERSEDED`(진위 확인에서 무효).
 *  · 약국 전송은 하지 않는다(채널 미구현) — 응답이 그 사실을 싣는다.
 */
@Injectable()
export class PrescriptionIssueService {
  constructor(private readonly prisma: PrismaService, private readonly documents: DocumentService) {}

  /** 발급 대상 스냅샷(결정적 — 같은 내용이면 같은 해시) */
  async buildSnapshot(encounterId: string) {
    const enc = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      select: {
        id: true, status: true, patientId: true, doctorId: true,
        doctor: { select: { familyName: true, givenName: true } },
        diagnoses: { orderBy: { rank: 'asc' }, select: { diagnosisCode: { select: { code: true, nameKo: true } } } },
        prescriptions: {
          where: { type: 'MEDICATION', status: 'ACTIVE' },
          select: { id: true, dosage: true, frequency: true, duration: true, quantity: true, route: true, instructions: true, dispensingType: true, rxValidUntil: true, medicationCode: { select: { code: true, nameKo: true, nameEn: true } } },
        },
      },
    });
    if (!enc) throw new NotFoundException('Encounter not found');
    const external = enc.prescriptions.filter((p) => p.dispensingType === 'EXTERNAL');
    const items = (external.length ? external : enc.prescriptions).slice().sort((a, b) => a.id.localeCompare(b.id));
    const validUntil = external.map((p) => p.rxValidUntil?.getTime() ?? null).filter((v): v is number => v != null);
    return {
      enc,
      snapshot: {
        encounterId: enc.id,
        patientId: enc.patientId,
        prescriberId: enc.doctorId,
        prescriberName: enc.doctor ? `${enc.doctor.familyName ?? ''}${enc.doctor.givenName ?? ''}` : null,
        scope: external.length ? 'EXTERNAL' : 'ALL',
        rxValidUntil: validUntil.length ? new Date(Math.min(...validUntil)).toISOString() : null,
        // 🔴 (2026-10-13 결함 발굴 B2) 종이에 찍히는 것은 전부 해시에 — 종전엔 지시사항·진단이 빠져, 지시사항만 바꾼 처방전이
        //    같은 교부번호를 재사용하고 진위 확인은 "유효"라 답했다. 인쇄 화면은 이 판을 그린다(실시간 조회가 아니라).
        diagnoses: enc.diagnoses.map((d) => ({ code: d.diagnosisCode?.code ?? null, name: d.diagnosisCode?.nameKo ?? null })),
        items: items.map((p) => ({
          prescriptionId: p.id, code: p.medicationCode?.code ?? null, name: p.medicationCode?.nameKo ?? null, nameEn: p.medicationCode?.nameEn ?? null,
          dosage: p.dosage, frequency: p.frequency, duration: p.duration, quantity: p.quantity, route: p.route, instructions: p.instructions ?? null, dispensingType: p.dispensingType,
        })),
      },
    };
  }

  async issue(encounterId: string, userId: string) {
    const { enc, snapshot } = await this.buildSnapshot(encounterId);
    if (!ISSUABLE_ENCOUNTER.includes(enc.status as string)) {
      throw new ConflictException({ code: 'ENCOUNTER_NOT_SIGNED', message: 'A prescription can be issued only for a signed encounter' });
    }
    if (snapshot.items.length === 0) {
      throw new ConflictException({ code: 'NO_PRESCRIPTION_ITEMS', message: 'There are no active medication items to issue' });
    }
    // 발급 원장과 같은 해시 규칙(sha256(JSON(snapshot)))
    const hash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const prior = await this.prisma.issuedDocument.findMany({
      where: { documentType: PRESCRIPTION_DOC_TYPE, sourceId: encounterId, status: { in: ['ORIGINAL', 'REISSUE'] } },
      orderBy: { issuedAt: 'desc' },
      select: { issueNo: true, hash: true, dateKey: true, seq: true, issuedAt: true, status: true },
    });
    const same = prior.find((d) => d.hash === hash);
    if (same) {
      // 🔴 지난번 대체 처리가 실패했어도 여기서 마저 한다(같은 내용 재인쇄가 수렴시킨다 — 두 번호가 함께 유효하게 남지 않게)
      const superseded = await this.supersedeOthers(prior.filter((d) => d.issueNo !== same.issueNo).map((d) => d.issueNo), same.issueNo);
      const v = await this.documents.verifyUrl(same.issueNo);
      return { ...same, ...v, reused: true, superseded, itemCount: snapshot.items.length, snapshot, transmission: transmissionFact() };
    }
    const doc = await this.documents.issue({ documentType: PRESCRIPTION_DOC_TYPE, sourceId: encounterId, patientId: enc.patientId, snapshot }, userId);
    const superseded = await this.supersedeOthers(prior.map((d) => d.issueNo), doc.issueNo);
    const row = await this.prisma.issuedDocument.findUnique({ where: { issueNo: doc.issueNo }, select: { dateKey: true, seq: true } });
    return { ...doc, dateKey: row?.dateKey ?? null, seq: row?.seq ?? null, reused: false, superseded, itemCount: snapshot.items.length, snapshot, transmission: transmissionFact() };
  }

  /**
   * 내용이 바뀐 재발급 — 이전 발급은 진위 확인에서 무효(`SUPERSEDED`)가 되게(이전 종이를 약국이 받지 않도록) · 새 발급에 이전 번호를 잇는다.
   * 두 쓰기는 한 트랜잭션 · 조건부(아직 유효한 것만 — 이미 무효인 것을 다시 쓰지 않는다).
   */
  private async supersedeOthers(olderIssueNos: string[], currentIssueNo: string): Promise<string[]> {
    if (olderIssueNos.length === 0) return [];
    await this.prisma.$transaction([
      this.prisma.issuedDocument.updateMany({ where: { issueNo: { in: olderIssueNos }, status: { in: ['ORIGINAL', 'REISSUE'] } }, data: { status: 'SUPERSEDED' } }),
      this.prisma.issuedDocument.updateMany({ where: { issueNo: currentIssueNo, reissueOf: null }, data: { reissueOf: olderIssueNos[0] } }),
    ]);
    return olderIssueNos;
  }
}
