// Matches the deterministic IDs used by the storage migration scripts.
export function storageFileId(path: string): string {
  const value = path.replace(/^\/+/, '').trim();
  if (!value.includes('/') && /^[a-zA-Z0-9._-]{1,36}$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes); padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bytes.length * 8, true);
  view.setUint32(padded.length - 4, Math.floor(bytes.length / 0x20000000), true);
  const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  const constants = Array.from({length:64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let offset = 0; offset < padded.length; offset += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      const round = Math.floor(i / 16);
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = round === 0 ? i : round === 1 ? (5*i+1)%16 : round === 2 ? (3*i+5)%16 : (7*i)%16;
      const sum = (a + f + constants[i] + view.getInt32(offset + 4*g, true)) | 0;
      const shift = shifts[4*round + i%4];
      const next = (b + ((sum << shift) | (sum >>> (32-shift)))) | 0;
      a = d; d = c; c = b; b = next;
    }
    a0 = (a0+a)|0; b0 = (b0+b)|0; c0 = (c0+c)|0; d0 = (d0+d)|0;
  }
  return [a0,b0,c0,d0].flatMap(n => [0,8,16,24].map(s => ((n >>> s)&255).toString(16).padStart(2,'0'))).join('');
}
