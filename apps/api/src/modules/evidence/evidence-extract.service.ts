import { Injectable, Logger, Optional } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import {
  evidenceUnavailable, pickIsoDate, pickText,
  type EvidenceExtractResult, type EvidenceExtractFields,
} from '@hospital-run/shared';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';

/** 판독 가능한 형식 — 🔴 vision 모델은 **이미지만** 읽는다. PDF 를 읽는 척하지 않는다 */
const READABLE_IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp']);
/** 판독 대상 상한 — 초과분을 잘라 보내면 문서의 일부만 보고 판단하게 된다 */
const MAX_BYTES = 6 * 1024 * 1024;

/**
 * 행정 **증빙 문서 판독** — 정본 하나 (2026-08-28).
 *
 * 개원 항목 기록과 결정 등록부가 **같은 것을 쓴다.** 각자 구현하면 한쪽만 정직해진다.
 *
 * 🔴 이 서비스가 하지 않는 것:
 *   · **저장하지 않는다.** 초안만 돌려준다 — 저장은 사람이 확인한 뒤 별도 호출이다.
 *   · **추정하지 않는다.** 못 읽으면 `UNAVAILABLE` + 이유. 파일명에서 숫자를 뽑는 식의
 *     "대체"는 대체가 아니라 날조다 — 그래서 이 축에는 `FALLBACK` 이 없다.
 *   · **형식을 고쳐 맞추지 않는다.** `2026.03.01` 은 날짜로 받지 않는다(shared `pickIsoDate`).
 */
@Injectable()
export class EvidenceExtractService {
  private readonly logger = new Logger(EvidenceExtractService.name);

  constructor(
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly ai?: MedicalAiService,
  ) {}

  /** 판독 기능이 켜져 있는가 — 🔴 기본 OFF. 문서가 원내를 떠나므로 켜는 것이 결정이다 */
  async enabled(): Promise<boolean> {
    const v = await this.config?.get('ai.evidenceExtract.enabled').catch(() => false);
    return v === true || v === 'true';
  }

  /**
   * 파일 하나를 판독해 **초안**을 낸다.
   *
   * @param filePath 서버 로컬 경로(호출부가 검증한 것만 넘긴다)
   * @param fileName 사람에게 보여줄 원본 파일명
   * @param docHint  무슨 문서인가 — 프롬프트에 그대로 들어간다(예: '의료기관 개설 신고 증빙')
   */
  async extract(filePath: string, fileName: string, docHint: string): Promise<EvidenceExtractResult> {
    if (!(await this.enabled())) {
      return evidenceUnavailable('증빙 AI 판독이 꺼져 있습니다(시스템 설정 ai.evidenceExtract.enabled).', fileName);
    }
    if (!this.ai) {
      // 🔴 주입이 비면 조용히 빈 결과를 내지 않는다 — 배선 문제를 사실로 말한다
      return evidenceUnavailable('AI 판독 서비스가 배선되지 않았습니다(운영자 확인 필요).', fileName);
    }
    const ext = extname(fileName).toLowerCase();
    if (!READABLE_IMAGE.has(ext)) {
      // 🔴 PDF 를 읽는 척하지 않는다. 읽을 수 없다고 말하고, 사람이 직접 입력한다
      return evidenceUnavailable(
        `${ext || '이 형식'} 은 판독할 수 없습니다 — 이미지(jpg·png·webp)만 판독합니다. 직접 입력하세요.`,
        fileName,
      );
    }

    let buf: Buffer;
    try {
      buf = await readFile(filePath);
    } catch (e) {
      this.logger.warn(`증빙 판독 파일 읽기 실패 ${fileName}: ${e instanceof Error ? e.message : e}`);
      return evidenceUnavailable('첨부 파일을 읽지 못했습니다.', fileName);
    }
    if (buf.byteLength > MAX_BYTES) {
      return evidenceUnavailable(
        `파일이 커서 판독하지 않았습니다(${Math.round(buf.byteLength / 1024 / 1024)}MB > 6MB). 잘라 보내면 문서의 일부만 보고 판단하게 됩니다.`,
        fileName,
      );
    }

    let raw: string;
    try {
      raw = await this.ai.extractDocumentFields(buf.toString('base64'), docHint);
    } catch (e) {
      // 🔴 실패를 "없음"으로 번역하지 않는다
      this.logger.warn(`증빙 판독 실패 ${fileName}: ${e instanceof Error ? e.message : e}`);
      return evidenceUnavailable('AI 판독 서버에 닿지 못했습니다 — 잠시 후 다시 시도하거나 직접 입력하세요.', fileName);
    }

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch {
      return evidenceUnavailable('판독 결과를 이해하지 못했습니다 — 직접 입력하세요.', fileName);
    }

    // 🔴 정본 파서로만 담는다. 못 읽은 칸은 **키를 만들지 않는다**
    const fields: EvidenceExtractFields = {};
    const ref = pickText(parsed.docNo ?? parsed.evidenceRef);
    if (ref) fields.evidenceRef = ref;
    const date = pickIsoDate(parsed.issuedDate ?? parsed.evidenceDate);
    if (date) fields.evidenceDate = date;
    const issuer = pickText(parsed.issuer, 100);
    if (issuer) fields.issuer = issuer;
    const title = pickText(parsed.docTitle ?? parsed.title, 150);
    if (title) fields.docTitle = title;

    return { source: 'AI', fields, reason: null, fileName, extractedAt: new Date().toISOString() };
  }
}
