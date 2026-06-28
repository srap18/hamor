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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
  token: string
}

export const SignupEmail = ({
  siteName,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="ar" dir="rtl">
    <Head />
    <Preview>تأكيد حسابك في {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={brand}>⚓ {siteName}</Heading>
        <Heading style={h1}>تأكيد حسابك</Heading>
        <Text style={text}>
          مرحباً بك يا قبطان! اضغط على الزر التالي لتأكيد بريدك <strong>{recipient}</strong> وتفعيل حسابك في ملوك القراصنة:
        </Text>
        <Section style={btnWrap}>
          <Button style={button} href={confirmationUrl}>
            ⚓ تأكيد الحساب
          </Button>
        </Section>
        <Text style={text}>
          أو انسخ الرابط التالي وافتحه في المتصفح:
        </Text>
        <Section style={linkBox}>
          <Link href={confirmationUrl} style={linkStyle}>{confirmationUrl}</Link>
        </Section>
        <Text style={text}>
          الرابط صالح لمدة <strong>ساعة واحدة</strong>.
        </Text>
        <Text style={footer}>
          إذا لم تكن أنت من طلب إنشاء الحساب، تجاهل هذه الرسالة بأمان.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Tahoma, Arial, sans-serif' }
const container = { padding: '30px 25px', maxWidth: '520px' }
const brand = { fontSize: '20px', fontWeight: 'bold' as const, color: '#b8841f', margin: '0 0 20px', textAlign: 'center' as const }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#0a1929', margin: '0 0 20px', textAlign: 'center' as const }
const text = { fontSize: '15px', color: '#3f3f46', lineHeight: '1.7', margin: '0 0 20px', textAlign: 'right' as const }
const btnWrap = { textAlign: 'center' as const, margin: '0 0 25px' }
const button = { backgroundColor: '#b8841f', color: '#ffffff', fontSize: '16px', fontWeight: 'bold' as const, borderRadius: '12px', padding: '14px 28px', textDecoration: 'none' }
const linkBox = { backgroundColor: '#f5f5f4', border: '1px solid #e7e5e4', borderRadius: '8px', padding: '12px', margin: '0 0 20px', wordBreak: 'break-all' as const, textAlign: 'left' as const }
const linkStyle = { color: '#b8841f', fontSize: '12px', textDecoration: 'underline' }
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', textAlign: 'right' as const }
