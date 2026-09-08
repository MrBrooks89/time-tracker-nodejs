// Server-only mailer (Phase 6, D5/D6). The transport is built once from the
// SMTP env vars; when SMTP_HOST is unset the app runs in log-only mode —
// sendMail resolves with status "would_send" and the caller records the
// reminderLog/distributionLog row without dispatching anything (D5). Never
// import this module from client components: it pulls in nodemailer and the
// node net/tls builtins.

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

import { smtpConfigFromEnv, type SmtpConfig } from "./email.ts";

/** Row status vocabulary shared by reminderLog and distributionLog. */
export type MailSendStatus = "sent" | "would_send" | "failed";

export interface SendMailResult {
  status: MailSendStatus;
  /** Transport response or error message, for log-row diagnostics. */
  detail: string | null;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

// The transporter is env-derived and immutable per process — build it lazily
// on first use and cache it so the SMTP connection setup is not repeated for
// every email in a batch.
let cachedTransporter: Transporter | null = null;
let cachedConfig: SmtpConfig | null = null;
let resolved = false;

function transporter(): { config: SmtpConfig | null; mailer: Transporter | null } {
  if (!resolved) {
    resolved = true;
    cachedConfig = smtpConfigFromEnv(process.env);
    if (cachedConfig) {
      cachedTransporter = nodemailer.createTransport({
        host: cachedConfig.host,
        port: cachedConfig.port,
        // Implicit TLS on the dedicated SMTPS port; on the submission port
        // (587) STARTTLS is negotiated by the transport itself.
        secure: cachedConfig.port === 465,
        auth:
          cachedConfig.user || cachedConfig.pass
            ? { user: cachedConfig.user, pass: cachedConfig.pass }
            : undefined,
      });
    }
  }
  return { config: cachedConfig, mailer: cachedTransporter };
}

/** True when SMTP is configured — callers use it to pick the reminderLog
 * channel ("email" vs "in_app") before sending. */
export function isMailConfigured(): boolean {
  return transporter().config !== null;
}

/** Sender identity: SMTP_FROM when set, else a neutral local address so
 * sendMail still gets a valid envelope. */
function fromAddress(config: SmtpConfig): string {
  return config.from || "time-tracker@localhost";
}

/** Detail recorded for log-only rows so the history explains itself. */
export const LOG_ONLY_DETAIL = "SMTP not configured (log-only mode)";

/**
 * Sends one email. Log-only mode (D5): when SMTP is unconfigured the message
 * is NOT dispatched — the result is status "would_send" and the caller
 * records the reminderLog/distributionLog row as such. When configured, a
 * transport failure resolves to status "failed" instead of throwing, so one
 * bad recipient can never abort a batch send.
 */
export async function sendMail(email: OutgoingEmail): Promise<SendMailResult> {
  const { config, mailer } = transporter();
  if (!config || !mailer) {
    return { status: "would_send", detail: LOG_ONLY_DETAIL };
  }
  try {
    const info = await mailer.sendMail({
      from: fromAddress(config),
      to: email.to,
      subject: email.subject,
      text: email.body,
    });
    return { status: "sent", detail: info.response ?? null };
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
