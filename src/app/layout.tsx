import type { Metadata, Viewport } from "next"
import { Inter, Plus_Jakarta_Sans } from "next/font/google"
import "./globals.css"

// Same type pairing as the mobile app: Plus Jakarta Sans for display, Inter for text
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] })
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["600", "700", "800"] })

const DESCRIPTION = "Split shared expenses with friends, flatmates and travel buddies. Unlimited expenses, free forever. SplitIT does the maths, you settle up however you like."

export const metadata: Metadata = {
  metadataBase: new URL("https://splitwithease.vercel.app"),
  title: "SplitIT — Split expenses. Stay friends.",
  description: DESCRIPTION,
  icons: { icon: "/splitit-logo.png", apple: "/splitit-logo.png" },
  openGraph: {
    title: "SplitIT — Split expenses. Stay friends.",
    description: DESCRIPTION,
    images: ["/splitit-logo.png"],
    type: "website",
  },
}

export const viewport: Viewport = { themeColor: "#0a0a1a" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body className="min-h-screen bg-[#0a0a1a] antialiased">{children}</body>
    </html>
  )
}
