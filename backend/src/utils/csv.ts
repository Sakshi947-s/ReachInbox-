import { parse } from 'csv-parse/sync';
import { z } from 'zod';

const emailSchema = z.string().email();

export interface RecipientParseResult {
  validEmails: string[];
  duplicateEmails: string[];
  invalidEmails: string[];
  totalParsed: number;
}

/**
 * Intelligently inspects rows to find the email column header if not explicitly specified.
 */
function detectEmailColumn(headers: string[], firstRows: any[]): string | null {
  // 1. Direct case-insensitive match on common column names
  const candidates = ['email', 'email_address', 'emailaddress', 'e-mail', 'recipient', 'contact_email', 'mail'];
  for (const header of headers) {
    const normalized = header.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    if (candidates.includes(normalized)) {
      return header;
    }
  }

  // 2. Sample first few rows to find which column contains valid email addresses
  for (const header of headers) {
    let emailCount = 0;
    for (const row of firstRows) {
      const val = String(row[header] || '').trim();
      if (emailSchema.safeParse(val).success) {
        emailCount++;
      }
    }
    if (emailCount > 0 && emailCount >= Math.min(3, firstRows.length)) {
      return header;
    }
  }

  return null;
}

/**
 * Parses raw text or CSV content, extracting and validating email addresses.
 */
export function parseRecipientsFromContent(content: string, requestedColumn?: string): RecipientParseResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { validEmails: [], duplicateEmails: [], invalidEmails: [], totalParsed: 0 };
  }

  const validSet = new Set<string>();
  const duplicateSet = new Set<string>();
  const invalidSet = new Set<string>();
  let totalCandidates = 0;

  // Check if content looks like a simple text list of emails (no commas or semicolons)
  const isSimpleText = !trimmed.includes(',') && !trimmed.includes(';') && !trimmed.includes('\t');

  if (isSimpleText) {
    const lines = trimmed.split(/[\r\n]+/);
    for (const line of lines) {
      const raw = line.trim();
      if (!raw) continue;
      totalCandidates++;
      const email = raw.toLowerCase();
      const parsed = emailSchema.safeParse(email);
      if (parsed.success) {
        if (validSet.has(email)) {
          duplicateSet.add(email);
        } else {
          validSet.add(email);
        }
      } else {
        invalidSet.add(raw);
      }
    }
  } else {
    // Parse using csv-parse
    try {
      const records = parse(trimmed, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        relax_quotes: true,
      }) as Record<string, string>[];

      if (records.length === 0) {
        return { validEmails: [], duplicateEmails: [], invalidEmails: [], totalParsed: 0 };
      }

      const headers = Object.keys(records[0] || {});
      const emailCol = requestedColumn || detectEmailColumn(headers, records.slice(0, 5));

      for (const row of records) {
        let rawVal = '';
        if (emailCol && row[emailCol]) {
          rawVal = row[emailCol];
        } else {
          // Look across all values in the row for any email format
          for (const key of Object.keys(row)) {
            const v = String(row[key] || '').trim();
            if (emailSchema.safeParse(v).success) {
              rawVal = v;
              break;
            }
          }
        }

        const candidate = rawVal.trim().toLowerCase();
        if (!candidate) continue;

        totalCandidates++;
        const parsed = emailSchema.safeParse(candidate);
        if (parsed.success) {
          if (validSet.has(candidate)) {
            duplicateSet.add(candidate);
          } else {
            validSet.add(candidate);
          }
        } else {
          invalidSet.add(rawVal);
        }
      }
    } catch {
      // Fallback: extract using regex across entire text
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const matches = trimmed.match(emailRegex) || [];
      for (const m of matches) {
        const email = m.trim().toLowerCase();
        totalCandidates++;
        if (validSet.has(email)) {
          duplicateSet.add(email);
        } else {
          validSet.add(email);
        }
      }
    }
  }

  return {
    validEmails: Array.from(validSet),
    duplicateEmails: Array.from(duplicateSet),
    invalidEmails: Array.from(invalidSet),
    totalParsed: totalCandidates,
  };
}
