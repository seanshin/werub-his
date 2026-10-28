/**
 * VoiceEMR — PCM 변환 헬퍼 (프로토타입·순수 함수·미배선·테스트 가능)
 *
 * Web Audio Float32(48k) → WeRU.B `/api/stt/chunk` 요구 형식(raw PCM 16-bit LE mono 16kHz·Q1).
 * 브라우저 API 불필요 — 순수 배열 변환이라 단위 테스트 가능.
 */

/** Float32[-1,1] → Int16 LE PCM */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** sourceRate → 16000 다운샘플(평균 데시메이션). sourceRate<=16000 이면 그대로. */
export function downsampleTo16k(input: Float32Array, sourceRate: number, target = 16000): Float32Array {
  if (sourceRate <= target) return input;
  const ratio = sourceRate / target;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** 캡처 프레임 → 전송용 Int16 PCM(다운샘플+변환) */
export function frameToPcm16(frame: Float32Array, sourceRate: number): Int16Array {
  return floatToInt16(downsampleTo16k(frame, sourceRate));
}

/** 청크 바이트 크기(16-bit·mono) */
export function pcm16ByteLength(samples: number): number {
  return samples * 2;
}

/**
 * 클라이언트 VAD(에너지 게이트) — 무음/마이크 노이즈면 false → STT 전송 안 함(환각 방지·Q4).
 * RMS 또는 peak 중 하나라도 임계 초과면 발화로 간주(조용한 발화도 통과). <50ms@16k 는 무조건 false.
 */
export function pcmHasSpeech(pcm: Int16Array, rmsThreshold = 180, peakThreshold = 1500): boolean {
  if (pcm.length < 800) return false;
  let sum = 0, peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / pcm.length);
  return rms > rmsThreshold || peak > peakThreshold;
}

/** Int16Array → base64(청크 전송 · STT EP 의 pcmBase64) */
export function int16ToBase64(a: Int16Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
