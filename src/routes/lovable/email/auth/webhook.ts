import * as React from 'react'
import { render } from 'react-email'
import { parseEmailWebhookPayload } from '@lovable.dev/email-js'
import { WebhookError, verifyWebhookRequest } from '@lovable.dev/webhooks-js'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { SignupEmail } from '@/lib/email-templates/signup'
import { InviteEmail } from '@/lib/email-templates/invite'
import { MagicLinkEmail } from '@/lib/email-templates/magic-link'
import { RecoveryEmail } from '@/lib/email-templates/recovery'
import { EmailChangeEmail } from '@/lib/email-templates/email-change'
import { ReauthenticationEmail } from '@/lib/email-templates/reauthentication'

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'تأكيد بريدك الإلكتروني — ملوك القراصنة',
  invite: 'دعوة للانضمام — ملوك القراصنة',
  magiclink: 'رابط تأكيد الحساب — ملوك القراصنة',
  recovery: 'إعادة تعيين كلمة المرور — ملوك القراصنة',
  email_change: 'تأكيد بريدك الجديد — ملوك القراصنة',
  reauthentication: 'كود التحقق — ملوك القراصنة',
}

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Configuration
const SITE_NAME = "ملوك القراصنة"
const SENDER_DOMAIN = "notify.www.molok-alqarasna.com"
const ROOT_DOMAIN = "www.molok-alqarasna.com"
const FROM_DOMAIN = SENDER_DOMAIN
// ASCII display name keeps the From header safe across all mail servers.
const FROM_NAME = "Molok Alqarasna"

function buildAppConfirmationUrl(
  actionType: string,
  rawUrl: string | null | undefined,
  tokenHashFromPayload?: string | null,
): string | null {
  // Prefer explicit token_hash from payload; fall back to parsing the raw URL.
  // Supabase's verify URL uses `token` for the hashed OTP (which verifyOtp
  // accepts as `token_hash`); some payload versions surface it as `token_hash`.
  let tokenHash: string | null = tokenHashFromPayload ?? null
  let type = actionType

  if (rawUrl) {
    try {
      const source = new URL(rawUrl)
      if (!tokenHash) {
        tokenHash =
          source.searchParams.get('token_hash') ||
          source.searchParams.get('token')
      }
      type = source.searchParams.get('type') || actionType
    } catch {
      /* noop */
    }
  }

  if (!tokenHash) {
    console.warn('buildAppConfirmationUrl: missing token_hash', { actionType, hasRawUrl: !!rawUrl })
    return rawUrl ?? null
  }

  const appUrl = new URL('/auth/confirm', `https://${ROOT_DOMAIN}`)
  appUrl.searchParams.set('token_hash', tokenHash)
  appUrl.searchParams.set('type', type)
  appUrl.searchParams.set('next', actionType === 'recovery' ? '/reset-password' : '/')
  return appUrl.toString()
}

function redactEmail(email: string | null | undefined): string {
  if (!email) return '***'
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart[0]}***@${domain}`
}

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY

        if (!apiKey) {
          console.error('LOVABLE_API_KEY not configured')
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        // Verify signature + timestamp, then parse payload.
        let payload: any
        let run_id = ''
        try {
          const verified = await verifyWebhookRequest({
            req: request,
            secret: apiKey,
            parser: parseEmailWebhookPayload,
          })
          payload = verified.payload
          run_id = payload.run_id
        } catch (error) {
          if (error instanceof WebhookError) {
            switch (error.code) {
              case 'invalid_signature':
              case 'missing_timestamp':
              case 'invalid_timestamp':
              case 'stale_timestamp':
                console.error('Invalid webhook signature', { error: error.message })
                return Response.json(
                  { error: 'Invalid signature' },
                  { status: 401 }
                )
              case 'invalid_payload':
              case 'invalid_json':
                console.error('Invalid webhook payload', { error: error.message })
                return Response.json(
                  { error: 'Invalid webhook payload' },
                  { status: 400 }
                )
            }
          }

          console.error('Webhook verification failed', { error })
          return Response.json(
            { error: 'Invalid webhook payload' },
            { status: 400 }
          )
        }

        if (!run_id) {
          console.error('Webhook payload missing run_id')
          return Response.json(
            { error: 'Invalid webhook payload' },
            { status: 400 }
          )
        }

        if (payload.version !== '1') {
          console.error('Unsupported payload version', { version: payload.version, run_id })
          return Response.json(
            { error: `Unsupported payload version: ${payload.version}` },
            { status: 400 }
          )
        }

        // The email action type is in payload.data.action_type (e.g., "signup", "recovery")
        // payload.type is the hook event type ("auth")
        const emailType = payload.data.action_type
        console.log('Received auth event', {
          emailType,
          email_redacted: redactEmail(payload.data.email),
          run_id,
        })

        const EmailTemplate = EMAIL_TEMPLATES[emailType]
        if (!EmailTemplate) {
          console.error('Unknown email type', { emailType, run_id })
          return Response.json(
            { error: `Unknown email type: ${emailType}` },
            { status: 400 }
          )
        }

        // Build template props from payload.data (HookData structure)
        // Secure email change fires this hook twice (old address + new address)
        // with BOTH tokens in the payload. Sending token_hash to the new address
        // produces a dead link, so pick the token that matches the recipient.
        const d = payload.data as any
        const isNewAddressCopy =
          emailType === 'email_change' &&
          !!d.new_email &&
          String(d.email).toLowerCase() === String(d.new_email).toLowerCase()
        const tokenHash = isNewAddressCopy
          ? (d.token_hash_new ?? d.token_hash ?? null)
          : (d.token_hash ?? d.token_hash_new ?? null)

        const templateProps = {
          siteName: SITE_NAME,
          siteUrl: `https://${ROOT_DOMAIN}`,
          recipient: payload.data.email,
          confirmationUrl:
            buildAppConfirmationUrl(emailType, d.url, tokenHash) ?? d.url,
          token: payload.data.token,
          email: payload.data.email,
          oldEmail: payload.data.old_email,
          newEmail: payload.data.new_email,
        }

        // Render React Email to HTML and plain text
        const element = React.createElement(EmailTemplate, templateProps)
        const html = await render(element)
        const text = await render(element, { plainText: true })

        // Enqueue email for async processing by the dispatcher (process-email-queue).
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error('Missing Supabase environment variables')
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const messageId = crypto.randomUUID()

        // Log pending BEFORE enqueue so we have a record even if enqueue crashes
        await supabase.from('email_send_log').insert({
          message_id: messageId,
          template_name: emailType,
          recipient_email: payload.data.email,
          status: 'pending',
        })

        const { error: enqueueError } = await supabase.rpc('enqueue_email', {
          queue_name: 'auth_emails',
          payload: {
            run_id,
            message_id: messageId,
            to: payload.data.email,
            from: `${FROM_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject: EMAIL_SUBJECTS[emailType] || 'Notification',
            html,
            text,
            purpose: 'transactional',
            label: emailType,
            queued_at: new Date().toISOString(),
          },
        })

        if (enqueueError) {
          console.error('Failed to enqueue auth email', { error: enqueueError, run_id, emailType })
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: emailType,
            recipient_email: payload.data.email,
            status: 'failed',
            error_message: 'Failed to enqueue email',
          })
          return Response.json(
            { error: 'Failed to enqueue email' },
            { status: 500 }
          )
        }

        console.log('Auth email enqueued', {
          emailType,
          email_redacted: redactEmail(payload.data.email),
          run_id,
        })

        return Response.json({ success: true, queued: true })
      },
    },
  },
})
