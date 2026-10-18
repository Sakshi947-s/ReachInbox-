import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/** Which SMTP transport mode is currently active */
export type SmtpProvider = 'real' | 'ethereal';

let defaultTransporter: Transporter | null = null;
let currentProvider: SmtpProvider | null = null;
let etherealUser: string | null = null;

/**
 * Test helper to inject a mock transporter or reset cached instance.
 */
export function _setTransporterForTesting(
  transporter: Transporter | null,
  provider: SmtpProvider | null = null,
  eUser: string | null = null
): void {
  defaultTransporter = transporter;
  currentProvider = provider;
  etherealUser = eUser;
}

/**
 * Safe diagnostic metadata for SMTP configuration.
 * Never includes raw password, username secrets, or credentials.
 */
export interface SmtpDiagnostics {
  host: string;
  port: number;
  secure: boolean;
  hasUser: boolean;
  hasPass: boolean;
  passCharCount: number;
  provider: SmtpProvider;
}

/**
 * Returns safe diagnostic metadata about SMTP configuration.
 * NEVER exposes or logs passwords, username secrets, or credentials.
 * Does NOT send any email.
 */
export function getSmtpDiagnostics(): SmtpDiagnostics {
  const hasUser = Boolean(env.SMTP_USER && env.SMTP_USER.trim().length > 0);
  const hasPass = Boolean(env.SMTP_PASS && env.SMTP_PASS.trim().length > 0);
  const passCharCount = env.SMTP_PASS ? env.SMTP_PASS.trim().length : 0;

  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    hasUser,
    hasPass,
    passCharCount,
    provider: getSmtpProvider(),
  };
}

/**
 * Returns which SMTP provider is configured ('real' | 'ethereal').
 * Returns 'ethereal' if SMTP credentials are absent (auto-generated test account is used).
 * Returns 'real' if SMTP_USER and SMTP_PASS are set in the environment.
 */
export function getSmtpProvider(): SmtpProvider {
  if (env.SMTP_USER && env.SMTP_PASS) {
    return 'real';
  }
  return 'ethereal';
}

/**
 * Returns (or lazily creates) the shared nodemailer transporter.
 * Uses real SMTP when SMTP_USER + SMTP_PASS are set; otherwise creates an
 * Ethereal test account and logs the preview URL credentials.
 */
export async function getOrCreateTransporter(): Promise<{
  transporter: Transporter;
  provider: SmtpProvider;
  etherealUser: string | null;
}> {
  if (defaultTransporter && currentProvider) {
    return { transporter: defaultTransporter, provider: currentProvider, etherealUser };
  }

  if (env.SMTP_USER && env.SMTP_PASS) {
    defaultTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER.trim(),
        pass: env.SMTP_PASS.trim(),
      },
    });
    currentProvider = 'real';
    etherealUser = null;
    const diag = getSmtpDiagnostics();
    logger.info(
      {
        host: diag.host,
        port: diag.port,
        secure: diag.secure,
        hasUser: diag.hasUser,
        hasPass: diag.hasPass,
        passCharCount: diag.passCharCount,
        provider: diag.provider,
      },
      'SMTP transporter configured with real credentials'
    );
    return { transporter: defaultTransporter, provider: 'real', etherealUser: null };
  }

  // Auto-generate an Ethereal test account
  logger.info('No SMTP credentials configured; generating Ethereal test account...');
  const testAccount = await nodemailer.createTestAccount();
  etherealUser = testAccount.user;

  defaultTransporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  currentProvider = 'ethereal';
  logger.info(
    { user: testAccount.user, web: testAccount.web },
    '✅ Ethereal test account created — preview emails at https://ethereal.email'
  );
  return { transporter: defaultTransporter, provider: 'ethereal', etherealUser: testAccount.user };
}

/**
 * Verifies the SMTP transporter can connect to the configured server.
 * Returns { ok, provider, message }.
 */
export async function verifySmtpConfig(): Promise<{
  ok: boolean;
  provider: SmtpProvider;
  message: string;
}> {
  try {
    const { transporter, provider } = await getOrCreateTransporter();
    await transporter.verify();
    const diag = getSmtpDiagnostics();
    const message =
      provider === 'real'
        ? `SMTP verified: connected to ${diag.host}:${diag.port} (secure: ${diag.secure})`
        : 'SMTP verified: Ethereal test transport ready';
    logger.info({ provider, host: diag.host, port: diag.port, secure: diag.secure }, message);
    return { ok: true, provider, message };
  } catch (error: any) {
    const provider = currentProvider || getSmtpProvider();
    const message = error?.message || 'SMTP verification failed';
    logger.error({ error, provider }, 'SMTP transport verification failed');
    return { ok: false, provider, message };
  }
}

export interface SendEmailOptions {
  from?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  success: boolean;
  provider: SmtpProvider;
  messageId?: string;
  previewUrl?: string | false;
  error?: string;
}

/**
 * Sends an email using the configured SMTP transport.
 * On Ethereal, returns a preview URL. On real SMTP, previewUrl is undefined.
 * Throws on SMTP delivery failure so the caller (worker) can handle retries.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { transporter, provider, etherealUser: eUser } = await getOrCreateTransporter();

  const fromAddress =
    options.from ||
    (eUser ? `${eUser}` : env.SMTP_FROM);

  const info = await transporter.sendMail({
    from: fromAddress,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text || options.html.replace(/<[^>]*>?/gm, ''),
  });

  const previewUrl = provider === 'ethereal' ? nodemailer.getTestMessageUrl(info) : undefined;

  logger.info(
    { messageId: info.messageId, to: options.to, provider, previewUrl: previewUrl || 'N/A' },
    `Email sent via ${provider === 'real' ? 'real SMTP' : 'Ethereal SMTP'}`
  );

  return {
    success: true,
    provider,
    messageId: info.messageId,
    previewUrl: previewUrl || undefined,
  };
}
