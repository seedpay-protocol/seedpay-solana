const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const encode = (data: unknown): Uint8Array => {
  const parts: Uint8Array[] = [];
  encodeValue(data, parts);
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const encodeValue = (data: unknown, parts: Uint8Array[]): void => {
  if (typeof data === "string") {
    const bytes = encoder.encode(data);
    parts.push(encoder.encode(`${bytes.length}:`));
    parts.push(bytes);
  } else if (typeof data === "number" || typeof data === "bigint") {
    parts.push(encoder.encode(`i${data.toString()}e`));
  } else if (data instanceof Uint8Array) {
    parts.push(encoder.encode(`${data.length}:`));
    parts.push(data);
  } else if (Array.isArray(data)) {
    parts.push(encoder.encode("l"));
    for (const item of data) {
      encodeValue(item, parts);
    }
    parts.push(encoder.encode("e"));
  } else if (data !== null && typeof data === "object") {
    parts.push(encoder.encode("d"));
    const keys = Object.keys(data as Record<string, unknown>).sort();
    for (const key of keys) {
      encodeValue(key, parts);
      encodeValue((data as Record<string, unknown>)[key], parts);
    }
    parts.push(encoder.encode("e"));
  }
};

export const decode = (
  buf: Uint8Array,
  encoding?: "utf8",
): unknown => {
  const state = { pos: 0, buf, encoding };
  return decodeNext(state);
};

interface DecodeState {
  pos: number;
  buf: Uint8Array;
  encoding?: "utf8";
}

const decodeNext = (state: DecodeState): unknown => {
  const ch = state.buf[state.pos];

  if (ch === 0x69) {
    // 'i' — integer
    state.pos++;
    const end = state.buf.indexOf(0x65, state.pos); // 'e'
    if (end === -1) throw new Error("Unterminated integer");
    const str = decoder.decode(state.buf.slice(state.pos, end));
    state.pos = end + 1;
    const num = parseInt(str, 10);
    if (num.toString() === str && Number.isSafeInteger(num)) return num;
    return str; // Return as string if too large
  }

  if (ch === 0x6c) {
    // 'l' — list
    state.pos++;
    const result: unknown[] = [];
    while (state.buf[state.pos] !== 0x65) {
      result.push(decodeNext(state));
    }
    state.pos++; // skip 'e'
    return result;
  }

  if (ch === 0x64) {
    // 'd' — dictionary
    state.pos++;
    const result: Record<string, unknown> = {};
    while (state.buf[state.pos] !== 0x65) {
      const key = decodeNext(state) as string;
      result[key] = decodeNext(state);
    }
    state.pos++; // skip 'e'
    return result;
  }

  if (ch >= 0x30 && ch <= 0x39) {
    // digit — string
    const colonIdx = state.buf.indexOf(0x3a, state.pos); // ':'
    if (colonIdx === -1) throw new Error("Unterminated string length");
    const lenStr = decoder.decode(state.buf.slice(state.pos, colonIdx));
    const len = parseInt(lenStr, 10);
    state.pos = colonIdx + 1;
    const bytes = state.buf.slice(state.pos, state.pos + len);
    state.pos += len;
    if (state.encoding === "utf8") return decoder.decode(bytes);
    return bytes;
  }

  throw new Error(`Unexpected byte at position ${state.pos}: 0x${ch.toString(16)}`);
};
