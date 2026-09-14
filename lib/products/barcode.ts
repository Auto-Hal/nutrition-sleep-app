const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export function normalizeBarcode(value: string) {
  return value.replace(/\D/g, "");
}

export function gtinCheckDigit(body: string) {
  if (!/^\d+$/.test(body)) return null;
  let sum = 0;
  for (let index = body.length - 1, offset = 0; index >= 0; index -= 1, offset += 1) {
    const digit = Number(body[index]);
    sum += digit * (offset % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(value: string) {
  const barcode = normalizeBarcode(value);
  if (!GTIN_LENGTHS.has(barcode.length) || barcode !== value.trim()) return false;
  const expected = gtinCheckDigit(barcode.slice(0, -1));
  return expected !== null && expected === Number(barcode.at(-1));
}
