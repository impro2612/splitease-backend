const secret = (process.env.MOBILE_JWT_SECRET ?? process.env.NEXTAUTH_SECRET)?.trim()

if (!secret) {
  throw new Error("MOBILE_JWT_SECRET (or NEXTAUTH_SECRET) is required")
}

export const MOBILE_JWT_SECRET = new TextEncoder().encode(secret)
