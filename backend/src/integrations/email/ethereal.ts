/**
 * @deprecated
 * This file is kept for backward compatibility.
 * All functionality has been moved to smtp.ts.
 * Import from '../email/smtp.js' in new code.
 */
// Runtime value exports (functions)
export {
  sendEmail,
  verifySmtpConfig as verifyEmailTransport,
  getOrCreateTransporter as getOrCreateEtherealTransport,
  getSmtpProvider,
  getSmtpDiagnostics,
} from './smtp.js';

// Type-only exports (interfaces and type aliases — erased at runtime)
export type {
  SmtpProvider,
  SendEmailOptions,
  SendEmailResult,
  SmtpDiagnostics,
} from './smtp.js';
