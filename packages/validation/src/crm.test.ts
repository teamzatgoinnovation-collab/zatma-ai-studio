import { describe, expect, it } from 'vitest';
import {
  autoMapColumns,
  bulkLeadsSchema,
  createActivitySchema,
  createLeadSchema,
  csvCell,
  CsvError,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  parseCsv,
  toCsv,
  whatsappLink,
} from './crm.js';

describe('phone and email normalisation', () => {
  it('normalises Indian and Gulf numbers to E.164', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('098765-43210')).toBe('+919876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('0091 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('050 123 4567', '971')).toBe('+971501234567');
    expect(normalizePhone('+971 (50) 123-4567')).toBe('+971501234567');
    expect(normalizePhone('5 1234 5678', '966')).toBe('+966512345678');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('normalises emails and company names', () => {
    expect(normalizeEmail('  Zain@ZatGo.COM ')).toBe('zain@zatgo.com');
    expect(normalizeEmail('not an email')).toBeNull();
    expect(normalizeCompanyName('ZatGo Innovation Pvt. Ltd.')).toBe('zatgo innovation');
    expect(normalizeCompanyName('Al Noor Trading L.L.C')).toBe('al noor trading');
    expect(normalizeCompanyName('Kochi Bakes LLP')).toBe(normalizeCompanyName('Kochi Bakes'));
  });

  it('builds WhatsApp click-to-chat links', () => {
    expect(whatsappLink('098765 43210', 'Hi')).toBe('https://wa.me/919876543210?text=Hi');
    expect(whatsappLink('x')).toBeNull();
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, newlines in fields, CRLF, BOM and semicolons', () => {
    const csv = '\uFEFFName,Phone,Notes\r\n"Rahul, K",98765 43210,"Said ""call later""\nafter 5"\r\n\r\nAisha,050 123 4567,\n';
    expect(parseCsv(csv)).toEqual({ headers: ['Name', 'Phone', 'Notes'], rows: [['Rahul, K', '98765 43210', 'Said "call later"\nafter 5'], ['Aisha', '050 123 4567', '']] });
    expect(parseCsv('a;b\n1;2').rows).toEqual([['1', '2']]);
  });

  it('rejects empty, unterminated and oversized files', () => {
    expect(() => parseCsv('')).toThrow(CsvError);
    expect(() => parseCsv('a,b\n"1,2')).toThrow('unclosed quote');
    expect(() => parseCsv('a\n1\n2\n3', 2)).toThrow('more than 2 rows');
  });

  it('escapes formulas and special characters on export', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+919876543210')).toBe("'+919876543210");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(['x', 'y'])).toBe('x; y');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['A'], [['1']])).toBe('\uFEFFA\r\n1\r\n');
  });

  it('auto-maps headers to fields once each', () => {
    expect(autoMapColumns('leads', ['Full Name', 'Mobile Number', 'E-mail', 'Company Name', 'Mobile', 'Whatever'])).toEqual({
      'Full Name': 'firstName',
      'Mobile Number': 'phone',
      'E-mail': 'email',
      'Company Name': 'company',
      Mobile: null,
      Whatever: null,
    });
    expect(autoMapColumns('leads', ['Name'])).toEqual({ Name: 'firstName' });
  });
});

describe('CRM schemas', () => {
  it('validates leads with defaults and blank optional fields', () => {
    const v = createLeadSchema.parse({ firstName: 'Rahul', email: '', phone: '98765 43210' });
    expect(v).toMatchObject({ status: 'NEW', source: 'other', email: null, tags: [], customFields: {}, allowDuplicate: false });
    expect(createLeadSchema.safeParse({ firstName: '' }).success).toBe(false);
    expect(createLeadSchema.safeParse({ firstName: 'A', email: 'nope' }).success).toBe(false);
    expect(createLeadSchema.safeParse({ firstName: 'A', organizationId: 'x' }).success).toBe(false);
  });

  it('requires a link and a due date where needed for activities', () => {
    const lead = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(createActivitySchema.safeParse({ type: 'CALL', subject: 'Intro call' }).success).toBe(false);
    expect(createActivitySchema.safeParse({ type: 'FOLLOW_UP', subject: 'Send quote', leadId: lead }).success).toBe(false);
    expect(createActivitySchema.safeParse({ type: 'FOLLOW_UP', subject: 'Send quote', leadId: lead, dueAt: '2026-11-10T09:00:00+05:30' }).success).toBe(true);
  });

  it('requires the value for bulk actions', () => {
    const ids = ['0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'];
    expect(bulkLeadsSchema.safeParse({ ids, action: 'assign' }).success).toBe(false);
    expect(bulkLeadsSchema.safeParse({ ids, action: 'status', status: 'QUALIFIED' }).success).toBe(true);
    expect(bulkLeadsSchema.safeParse({ ids, action: 'delete' }).success).toBe(true);
  });
});
