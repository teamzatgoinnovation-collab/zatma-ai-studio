import { describe, expect, it } from 'vitest';
import { dataUrlToBlob, exportFileName, pdfPage } from './export';

describe('export helpers', () => {
  it('builds safe ASCII file names', () => {
    expect(exportFileName('Onam Sale — 30% OFF!', 'png', 1080, 1080)).toBe('onam-sale-30-off-1080x1080.png');
    expect(exportFileName('   ', 'pdf', 1200, 630)).toBe('design-1200x630.pdf');
    expect(exportFileName('ZatGo വാൻ സെയിൽസ് ERP', 'png', 1080, 1080)).toBe('zatgo-erp-1080x1080.png');
    expect(exportFileName('ഓണം ഓഫർ', 'jpg', 1080, 1920)).toBe('design-1080x1920.jpg');
    expect(exportFileName('Café Offer', 'jpg', 1, 1)).toBe('cafe-offer-1x1.jpg');
  });

  it('sizes PDF pages from pixels with the right orientation', () => {
    expect(pdfPage(1080, 1920)).toEqual({ orientation: 'portrait', format: [810, 1440] });
    expect(pdfPage(1200, 630)).toEqual({ orientation: 'landscape', format: [900, 472.5] });
  });

  it('decodes data URLs to blobs', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,' + btoa('hello'));
    expect(blob.type).toBe('image/png');
    expect(await blob.text()).toBe('hello');
  });
});
