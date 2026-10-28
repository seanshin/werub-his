import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { UPLOAD_URL_PREFIX, signUploadUrl } from '../util/upload-url';

/** 순회 상한 — 대형 응답에서 비용이 폭주하지 않도록 */
const MAX_DEPTH = 8;
const MAX_NODES = 20_000;

/**
 * 응답 본문의 업로드 URL(`/uploads/...`)에 단기 서명을 붙인다.
 *
 * 저장된 URL 은 그대로 두고 **응답 시점에만** 서명하므로 도메인 코드를 건드리지 않는다
 * (환자 사진·상담/VoC 첨부·여권 사본·동의서 스캔 등 발급처가 흩어져 있어 누락 위험이 크다).
 * 서명이 없는 요청은 `/uploads` 게이트 미들웨어가 401 로 막는다.
 */
@Injectable()
export class UploadUrlSignInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => signDeep(body, Date.now(), { nodes: 0 })));
  }
}

function signDeep(node: unknown, now: number, budget: { nodes: number }, depth = 0): unknown {
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES) return node;
  budget.nodes++;

  if (typeof node === 'string') {
    return node.startsWith(UPLOAD_URL_PREFIX) ? signUploadUrl(node, now) : node;
  }
  if (Array.isArray(node)) {
    let changed = false;
    const out = node.map((v) => {
      const r = signDeep(v, now, budget, depth + 1);
      if (r !== v) changed = true;
      return r;
    });
    return changed ? out : node;
  }
  // Date·Buffer 등 특수 객체는 건드리지 않는다(plain object 만 순회)
  if (node && typeof node === 'object' && isPlainObject(node)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const r = signDeep(v, now, budget, depth + 1);
      if (r !== v) changed = true;
      out[k] = r;
    }
    return changed ? out : node;
  }
  return node;
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
