// Barcode scanner helper utilities
export function sanitizeBarcode(rawText, detectedFormat) {
  if (!rawText) return { sku: '', format: detectedFormat || 'UNKNOWN' };
  let text = String(rawText).trim();
  let formatLabel = detectedFormat ? detectedFormat.toUpperCase().replace(/_/g, ' ') : 'BARCODE';

  if (/^\*[A-Za-z0-9\-.$/+% ]+\*$/.test(text) && text.length >= 3) {
    text = text.substring(1, text.length - 1).trim();
    formatLabel = 'CODE 39 (Libre 39)';
  } else if (detectedFormat && (detectedFormat.toLowerCase().includes('code_39') || detectedFormat.toLowerCase().includes('code 39'))) {
    formatLabel = 'CODE 39 (Libre 39)';
    if (text.startsWith('*') && text.endsWith('*') && text.length > 2) {
      text = text.slice(1, -1).trim();
    }
  } else if (detectedFormat && (detectedFormat.toLowerCase().includes('code_128') || detectedFormat.toLowerCase().includes('code 128'))) {
    formatLabel = 'CODE 128';
  } else if (detectedFormat && detectedFormat.toLowerCase().includes('qr')) {
    formatLabel = 'QR CODE';
  }

  return { sku: text, format: formatLabel };
}
