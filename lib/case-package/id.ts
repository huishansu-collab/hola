/** RFC 9562 §5.7: 48-bit Unix milliseconds, version 7, variant 10, 74 random bits.
 * Generate once at creation; edits, builds and imports preserve the identity.
 */
export function createCaseId(existing: ReadonlySet<string> = new Set()): string {
  let id: string;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let timestamp = Date.now();
    for (let i = 5; i >= 0; i--) {
      bytes[i] = timestamp % 256;
      timestamp = Math.floor(timestamp / 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  } while (existing.has(id));
  return id;
}
