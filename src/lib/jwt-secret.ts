const secret = (
  process.env.NODE_ENV === "production"
    ? process.env.MOBILE_JWT_SECRET
    : process.env.MOBILE_JWT_SECRET ?? process.env.NEXTAUTH_SECRET
)?.trim()

if (!secret) {
  throw new Error(
    process.env.NODE_ENV === "production"
      ? "MOBILE_JWT_SECRET is required in production"
      : "MOBILE_JWT_SECRET (or NEXTAUTH_SECRET) is required"
  )
}

export const MOBILE_JWT_SECRET = new TextEncoder().encode(secret)
