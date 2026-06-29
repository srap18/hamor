import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components'

interface EmailChangeEmailProps {
  siteName: string
  // oldEmail is the user's current address (HookData.OldEmail). For the
  // NEW-recipient half of a secure email_change fanout, `email` equals the
  // recipient (NEW), so the "from" line must render oldEmail to read
  // "from OLD to NEW" instead of "from NEW to NEW".
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="ar" dir="rtl">
    <Head />
    <Preview>تأكيد تغيير البريد في {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>تأكيد تغيير البريد</Heading>
        <Text style={text}>
          طلبت تغيير بريد حسابك في {siteName} من{' '}
          <Link href={`mailto:${oldEmail}`} style={link}>
            {oldEmail}
          </Link>{' '}
          إلى{' '}
          <Link href={`mailto:${newEmail}`} style={link}>
            {newEmail}
          </Link>
          .
        </Text>
        <Text style={text}>
          اضغط على الزر التالي لتأكيد التغيير. الرابط مؤقت وينتهي تلقائياً:
        </Text>
        <Button style={button} href={confirmationUrl}>
          تأكيد تغيير البريد
        </Button>
        <Text style={text}>أو انسخ الرابط التالي وافتحه في المتصفح:</Text>
        <Text style={linkBox}><Link href={confirmationUrl} style={copyLink}>{confirmationUrl}</Link></Text>
        <Text style={footer}>
          إذا لم تطلب هذا التغيير، قم بتأمين حسابك فوراً.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
  textAlign: 'right' as const,
}
const link = { color: 'inherit', textDecoration: 'underline' }
const linkBox = { backgroundColor: '#f5f5f4', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '12px', margin: '0 0 20px', wordBreak: 'break-all' as const, textAlign: 'left' as const }
const copyLink = { color: '#b8841f', fontSize: '12px', textDecoration: 'underline' }
const button = {
  backgroundColor: '#000000',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', textAlign: 'right' as const }
