import type { Metadata } from "next"
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage"

export const metadata: Metadata = { title: "Terms of Use — SplitIT" }

const SECTIONS: LegalSection[] = [
  {
    heading: "Using SplitIT",
    body: ["By creating an account or using the SplitIT apps or website, you agree to these Terms and to our Privacy Policy. You must be at least 13 years old, and you are responsible for keeping your login details safe and for everything done from your account."],
  },
  {
    heading: "What SplitIT does — and doesn't",
    body: [
      "SplitIT is a record-keeping tool. It helps you note shared expenses, see who owes whom, and record when people pay each other.",
      [
        "SplitIT does not move, hold or transfer money. You pay each other however you choose (UPI, cash, bank transfer), and \"Settle up\" only records that it happened.",
        "Balances are only as accurate as the expenses people enter. Check amounts before you pay or ask for money.",
        "Spending insights, categories and suggestions are automated (partly using AI) and may contain mistakes. They are not financial, tax or legal advice.",
        "Exchange rates for other currencies come from public sources and are approximate.",
      ],
    ],
  },
  {
    heading: "Free use, free trial and SplitIT Plus",
    body: [
      [
        "Splitting is free: groups, expenses, balances, settling up, friends and chat.",
        "Every new account gets all features free for 3 months. After that, My Spending, Borrow Book, Trip Planner, Timeline, ScrapBook and Spend Diary need a SplitIT Plus subscription.",
        "SplitIT Plus is ₹49 a month or ₹499 a year (or the local price shown in the App Store or Google Play). Payment is taken by Apple or Google when you confirm the purchase.",
        "Subscriptions renew automatically at the end of each period unless you cancel at least 24 hours before it ends. Manage or cancel in your App Store or Google Play subscription settings; cancelling stops the next renewal, and Plus stays active until the paid period ends.",
        "Refunds are handled by Apple or Google under their refund policies.",
        "If Plus ends, nothing is deleted. Locked features keep your data and come back when you subscribe again.",
        "We may change prices or what Plus includes; any price change for an existing subscription follows Apple's and Google's rules for notice and consent.",
      ],
    ],
  },
  {
    heading: "Your content",
    body: ["You own what you add to SplitIT. You give us permission to store it, process it and show it to the people you share it with (for example, members of your groups), only to run the service. You are responsible for the content you add and must have the right to share it."],
  },
  {
    heading: "Acceptable use",
    body: [
      "Please don't:",
      [
        "use SplitIT for anything illegal, for fraud, or to track money from illegal activity;",
        "harass, threaten or spam other people, or share content that is abusive, hateful or sexually explicit;",
        "add people or their contact details without a good reason, or impersonate someone;",
        "try to break, overload, reverse-engineer or get unauthorised access to SplitIT or other people's accounts.",
      ],
      "You can block other users from Friends. We may suspend or close accounts that break these rules.",
    ],
  },
  {
    heading: "Availability and changes",
    body: ["We work to keep SplitIT running and your data safe, but the service is provided \"as is\" and may sometimes be unavailable or change. We may add, change or remove features. We will tell you in the app about important changes to these Terms."],
  },
  {
    heading: "Liability",
    body: ["To the extent the law allows, SplitIT is not responsible for disagreements between users about money, for losses caused by incorrect entries, or for indirect losses. Our total liability to you for any claim is limited to the amount you paid us for SplitIT Plus in the 12 months before the claim. Nothing in these Terms limits rights you have under consumer-protection laws that cannot be excluded."],
  },
  {
    heading: "Ending your account",
    body: ["You can delete your account at any time in Profile & settings → Delete Account. Deleting your account does not cancel an App Store or Google Play subscription — cancel that in your store settings."],
  },
  {
    heading: "Law and disputes",
    body: ["These Terms are governed by the laws of India. If there is a dispute, please contact us first so we can try to resolve it; otherwise the courts of India will have jurisdiction."],
  },
  {
    heading: "Apple users",
    body: ["If you downloaded SplitIT from the App Store, these Terms are between you and SplitIT, not Apple. Apple's standard licence (EULA) also applies, and Apple has no obligation to provide support for the app."],
  },
  {
    heading: "Contact",
    body: ["support.splitit@gmail.com"],
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      updated="19 October 2026"
      intro="These Terms explain the rules for using SplitIT and the SplitIT Plus subscription. Please read them together with our Privacy Policy."
      sections={SECTIONS}
    />
  )
}
