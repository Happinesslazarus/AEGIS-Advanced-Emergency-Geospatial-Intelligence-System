/*
 * emailService.ts - Transactional Email Service with Dev/Prod Mode
 *
 * Controls how verification emails, password resets, and security alerts
 * are delivered:
 *
 *   EMAIL_MODE=dev        ? Emails logged to console + stored in dev_emails table
 *   EMAIL_MODE=production  ? Emails sent via SMTP (nodemailer)
 *
 * In dev mode, you can view all "sent" emails by querying:
 *   SELECT * FROM dev_emails ORDER BY created_at DESC;
 *
 * To switch to production on presentation day, simply set:
 *   EMAIL_MODE=production
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * This service is SEPARATE from notificationService.ts which handles
 * multi-channel alert delivery (SMS, Telegram, etc.).
 */

import nodemailer from 'nodemailer'
import pool from '../models/db.js'
import { logger } from './logger.js'

// Configuration

const EMAIL_MODE = (process.env.EMAIL_MODE || 'dev').toLowerCase() as 'dev' | 'production'
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@aegis.gov.uk'
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'AEGIS Platform'
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

let transporter: nodemailer.Transporter | null = null

if (EMAIL_MODE === 'production') {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = parseInt(process.env.SMTP_PORT || '587')
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  })
  logger.info({ host, port }, 'Email service: PRODUCTION mode (SMTP)')
} else {
  logger.info('Email service: DEV mode (emails logged + dev_emails table)')
}

// Core Send Function

interface EmailOptions {
  to: string
  subject: string
  text: string
  html: string
}

async function sendEmail(options: EmailOptions): Promise<void> {
  if (EMAIL_MODE === 'production' && transporter) {
    await transporter.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    })
  } else {
    // DEV MODE — log to console + store in DB
    logger.info({ to: options.to, subject: options.subject, body: options.text }, '[DEV EMAIL] (not actually sent)')

    // Store in dev_emails table for easy inspection
    try {
      await pool.query(
        `INSERT INTO dev_emails (to_email, subject, body_text, body_html)
         VALUES ($1, $2, $3, $4)`,
        [options.to, options.subject, options.text, options.html]
      )
    } catch {
      // Table might not exist yet if migration hasn't run — that's OK
    }
  }
}

// Email Templates

 /**
 * Send email verification link to a newly registered user.
 *
 * @param to      - Recipient email
 * @param token   - Raw (unhashed) verification token
 * @param userType - 'citizen' or 'operator'
 */
export async function sendVerificationEmail(
  to: string,
  token: string,
  userType: 'citizen' | 'operator'
): Promise<void> {
  const basePath = userType === 'citizen' ? '/citizen/verify-email' : '/admin/verify-email'
  const verifyUrl = `${CLIENT_URL}${basePath}?token=${encodeURIComponent(token)}`

  const subject = 'Verify Your AEGIS Account'
  const text = [
    'Welcome to AEGIS!',
    '',
    'Please verify your email address by clicking the link below:',
    '',
    verifyUrl,
    '',
    'This link expires in 24 hours.',
    '',
    'If you did not create an account, please ignore this email.',
    '',
    '— The AEGIS Team',
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">&#x1F6E1; AEGIS</h1>
        <p style="color: #bfdbfe; margin: 8px 0 0;">Emergency Management Platform</p>
      </div>
      <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <h2 style="color: #1f2937; margin-top: 0;">Verify Your Email</h2>
        <p style="color: #4b5563; line-height: 1.6;">Welcome to AEGIS! Please click the button below to verify your email address:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${verifyUrl}" style="background: #2563eb; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
            Verify Email Address
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 24 hours. If you did not create an account, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #9ca3af; font-size: 12px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${verifyUrl}</p>
      </div>
    </div>`

  await sendEmail({ to, subject, text, html })
}

 /**
 * Send password reset link.
 */
export async function sendPasswordResetEmail(
  to: string,
  token: string,
  userType: 'citizen' | 'operator'
): Promise<void> {
  const basePath = userType === 'citizen' ? '/citizen/login' : '/reset-password'
  const resetUrl = `${CLIENT_URL}${basePath}?reset=${encodeURIComponent(token)}`

  const subject = 'AEGIS Password Reset'
  const text = [
    'Password Reset Request',
    '',
    'Click the link below to reset your password. This link expires in 30 minutes.',
    '',
    resetUrl,
    '',
    'If you did not request this reset, please ignore this email and your password will remain unchanged.',
    '',
    '— The AEGIS Team',
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">&#x1F6E1; AEGIS</h1>
        <p style="color: #fecaca; margin: 8px 0 0;">Password Reset</p>
      </div>
      <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <h2 style="color: #1f2937; margin-top: 0;">Reset Your Password</h2>
        <p style="color: #4b5563; line-height: 1.6;">We received a request to reset your password. Click the button below to choose a new one:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${resetUrl}" style="background: #dc2626; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 30 minutes. If you did not request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #9ca3af; font-size: 12px;">If the button doesn't work, copy and paste this link:</p>
        <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${resetUrl}</p>
      </div>
    </div>`

  await sendEmail({ to, subject, text, html })
}

 /**
 * Send account lockout notification.
 */
export async function sendLockoutNotification(
  to: string,
  minutesLocked: number
): Promise<void> {
  const subject = 'AEGIS Account Locked — Suspicious Login Activity'
  const text = [
    'Account Security Alert',
    '',
    `Your AEGIS account has been temporarily locked for ${minutesLocked} minutes due to multiple failed login attempts.`,
    '',
    'If this was you, please wait and try again later.',
    'If this was NOT you, someone may be trying to access your account. We recommend changing your password immediately after the lockout expires.',
    '',
    '— The AEGIS Security Team',
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">&#x1F6E1; AEGIS</h1>
        <p style="color: #fef3c7; margin: 8px 0 0;">Security Alert</p>
      </div>
      <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <h2 style="color: #1f2937; margin-top: 0;">&#x1F512; Account Locked</h2>
        <p style="color: #4b5563; line-height: 1.6;">Your account has been temporarily locked for <strong>${minutesLocked} minutes</strong> due to multiple failed login attempts.</p>
        <p style="color: #4b5563; line-height: 1.6;">If this wasn't you, please change your password as soon as possible.</p>
      </div>
    </div>`

  await sendEmail({ to, subject, text, html })
}

/* Expose the current email mode for startup logging and debugging */
export function getEmailMode(): string {
  return EMAIL_MODE
}

/**
 * Send a security alert email to an operator.
 *
 * @param to       - Recipient email
 * @param title    - Alert title (e.g. "Two-Factor Authentication Disabled")
 * @param message  - Alert detail message
 * @param severity - 'info' | 'warning' | 'critical'
 */
export async function sendSecurityAlertEmail(
  to: string,
  title: string,
  message: string,
  severity: 'info' | 'warning' | 'critical'
): Promise<void> {
  const severityColors: Record<string, { bg: string; label: string }> = {
    info: { bg: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)', label: 'Security Notice' },
    warning: { bg: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)', label: 'Security Warning' },
    critical: { bg: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)', label: 'Critical Security Alert' },
  }
  const style = severityColors[severity] || severityColors.warning

  const subject = `AEGIS Security Alert: ${title}`
  const text = [
    style.label,
    '',
    title,
    '',
    message,
    '',
    'If you did not perform this action, please contact your administrator immediately.',
    '',
    '— The AEGIS Security Team',
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: ${style.bg}; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">AEGIS</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">${style.label}</p>
      </div>
      <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <h2 style="color: #1f2937; margin-top: 0;">${title}</h2>
        <p style="color: #4b5563; line-height: 1.6;">${message.replace(/\n/g, '<br>')}</p>
        <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">If you did not perform this action, please contact your administrator immediately.</p>
      </div>
    </div>`

  await sendEmail({ to, subject, text, html })
}
