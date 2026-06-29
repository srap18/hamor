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

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="ar" dir="rtl">
    <Head />
    <Preview>دعوة للانضمام إلى {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>تمت دعوتك</Heading>
        <Text style={text}>
          تمت دعوتك للانضمام إلى{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . اضغط على الزر لقبول الدعوة وإنشاء حسابك. الرابط مؤقت وينتهي تلقائياً.
        </Text>
        <Button style={button} href={confirmationUrl}>
          قبول الدعوة
        </Button>
        <Text style={text}>أو انسخ الرابط التالي وافتحه في المتصفح:</Text>
        <Text style={linkBox}><Link href={confirmationUrl} style={copyLink}>{confirmationUrl}</Link></Text>
        <Text style={footer}>
          إذا لم تكن تتوقع هذه الدعوة، تجاهل الرسالة بأمان.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

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
