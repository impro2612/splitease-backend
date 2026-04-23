import nodemailer from "nodemailer"

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT ?? 465),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendPasswordResetEmail(email: string, otp: string) {
  await transporter.sendMail({
    from: `"SplitIT" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Your SplitIT password reset code",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a1a;color:#fff;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
          <span style="font-size:48px;">💸</span>
          <h2 style="color:#fff;margin:8px 0 4px;">Reset your password</h2>
          <p style="color:#94a3b8;margin:0;">Use the code below to reset your SplitIT password.</p>
        </div>
        <div style="background:#1a1a2e;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
          <p style="color:#94a3b8;font-size:13px;margin:0 0 8px;">Your one-time code</p>
          <p style="font-size:40px;font-weight:800;letter-spacing:12px;color:#6366f1;margin:0;">${otp}</p>
          <p style="color:#475569;font-size:12px;margin:12px 0 0;">Expires in 15 minutes</p>
        </div>
        <p style="color:#475569;font-size:12px;text-align:center;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  })
}
