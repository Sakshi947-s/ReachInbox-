import { describe, it, expect } from 'vitest';
import { parseRecipientsFromContent } from '../src/utils/csv.js';

describe('CSV & Text Recipient Parser', () => {
  it('should parse simple newline-delimited text of emails', () => {
    const text = `
      alice@example.com
      bob@example.com
      invalid-email
      alice@example.com
    `;

    const result = parseRecipientsFromContent(text);
    expect(result.validEmails).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.duplicateEmails).toEqual(['alice@example.com']);
    expect(result.invalidEmails).toEqual(['invalid-email']);
    expect(result.validEmails.length).toBe(2);
  });

  it('should parse standard CSV with "email" column', () => {
    const csv = `first_name,last_name,email
John,Doe,john.doe@reachinbox.ai
Jane,Smith,jane.smith@reachinbox.ai
Duplicate,User,john.doe@reachinbox.ai
Bad,Email,notanemail
`;

    const result = parseRecipientsFromContent(csv);
    expect(result.validEmails).toContain('john.doe@reachinbox.ai');
    expect(result.validEmails).toContain('jane.smith@reachinbox.ai');
    expect(result.duplicateEmails).toContain('john.doe@reachinbox.ai');
    expect(result.invalidEmails).toContain('notanemail');
    expect(result.validEmails.length).toBe(2);
  });

  it('should intelligently detect custom email column name', () => {
    const csv = `name,Recipient_Contact,company
Acme Corp,contact@acme.com,Acme
Beta LLC,sales@beta.org,Beta
`;

    const result = parseRecipientsFromContent(csv);
    expect(result.validEmails).toEqual(['contact@acme.com', 'sales@beta.org']);
  });

  it('should handle quoted values and commas within quotes', () => {
    const csv = `"Full Name","Contact Email","Notes"
"Doe, John","john.quoted@domain.com","VIP client, handle with care"
"Smith, Jane","jane.quoted@domain.com","Regular"
`;

    const result = parseRecipientsFromContent(csv);
    expect(result.validEmails).toEqual(['john.quoted@domain.com', 'jane.quoted@domain.com']);
  });

  it('should return empty results for empty text', () => {
    const result = parseRecipientsFromContent('   \n  \n');
    expect(result.validEmails).toEqual([]);
    expect(result.totalParsed).toBe(0);
  });
});
