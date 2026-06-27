import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
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
  token,
}: SignupEmailProps) => (
  <Html lang="ar" dir="rtl">
    <Head />
    <Preview>كود تأكيد حسابك في {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={brand}>⚓ {siteName}</Heading>
        <Heading style={h1}>كود تأكيد الحساب</Heading>
        <Text style={text}>
          مرحباً بك يا قبطان! استخدم الكود التالي لتأكيد بريدك {recipient} وتفعيل حسابك في ملوك القراصنة:
        </Text>
        <Section style={codeBox}>
          <Text style={codeStyle}>{token}</Text>
        </Section>
        <Text style={text}>
          الكود صالح لمدة <strong>ساعة واحدة</strong>. أدخله في صفحة التسجيل لإكمال إنشاء حسابك.
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
const brand = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  color: '#b8841f',
  margin: '0 0 20px',
  textAlign: 'center' as const,
}
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#0a1929',
  margin: '0 0 20px',
  textAlign: 'center' as const,
}
const text = {
  fontSize: '15px',
  color: '#3f3f46',
  lineHeight: '1.7',
  margin: '0 0 20px',
  textAlign: 'right' as const,
}
const codeBox = {
  backgroundColor: '#fef3c7',
  border: '2px dashed #b8841f',
  borderRadius: '12px',
  padding: '20px',
  margin: '0 0 25px',
  textAlign: 'center' as const,
}
const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '36px',
  fontWeight: 'bold' as const,
  color: '#0a1929',
  letterSpacing: '8px',
  margin: '0',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', textAlign: 'right' as const }
