const need = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`Missing environment variable ${k}`)
  return v
}

const token = need('HCLOUD_TOKEN')
const smtpPort = Number(need('SMTP_PORT'))
if (!Number.isInteger(smtpPort)) throw new Error('SMTP_PORT must be a number')

export const env = {
  token,
  pollToken: process.env.HCLOUD_POLL_TOKEN || token,
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: need('ADMIN_PASSWORD'),
  smtp: {
    host: need('SMTP_HOST'),
    port: smtpPort,
    user: need('SMTP_USER'),
    pass: need('SMTP_PASS'),
    from: need('SMTP_FROM'),
    to: need('SMTP_TO').split(',').map((s) => s.trim()).filter(Boolean),
  },
  port: Number(process.env.PORT || 8080),
  dataDir: process.env.DATA_DIR || './data',
}
