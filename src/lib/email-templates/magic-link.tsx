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
  Section,
  Text,
} from '@react-email/components'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="ar" dir="rtl">
    <Head />
    <Preview>رابط دخول مؤقت إلى {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>رابط الدخول</Heading>
        <Text style={text}>
          اضغط على الزر التالي للدخول إلى {siteName}. الرابط مؤقت وينتهي تلقائياً.
        </Text>
        <Button style={button} href={confirmationUrl}>
          دخول
        </Button>
        <Text style={text}>أو انسخ الرابط التالي وافتحه في المتصفح:</Text>
        <Section style={linkBox}>
          <Link href={confirmationUrl} style={linkStyle}>{confirmationUrl}</Link>
        </Section>
        <Text style={footer}>
          إذا لم تطلب هذا الرابط، تجاهل الرسالة بأمان.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

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
const button = {
  backgroundColor: '#000000',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const linkBox = { backgroundColor: '#f5f5f4', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '12px', margin: '0 0 20px', wordBreak: 'break-all' as const, textAlign: 'left' as const }
const linkStyle = { color: '#b8841f', fontSize: '12px', textDecoration: 'underline' }
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', textAlign: 'right' as const }
