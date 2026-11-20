import { createTransport } from 'nodemailer'
import { env } from './env.js'

const { host, port, user, pass, from, to } = env.smtp

const tx = createTransport({ host, port, secure: port === 465, auth: { user, pass } })

export const sendMail = async (subject: string, text: string): Promise<void> => {
  await tx.sendMail({ from, to, subject: `[VPS-Sniper] ${subject}`, text })
}
