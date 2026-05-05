import crypto from "crypto"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const CATEGORIES = [
  "Salary / Income",
  "Food / Dining",
  "Transport",
  "Travel",
  "Shopping",
  "Subscriptions",
  "UPI Payments",
  "Transfers",
  "Bills / Utilities",
  "EMI / Loans",
  "Credit Card Payments",
  "Medical / Pharmacy",
  "Bank Charges",
  "Miscellaneous",
] as const

export type Category = (typeof CATEGORIES)[number]

type Intent =
  | "salary_income"
  | "merchant_spend"
  | "p2p_transfer"
  | "credit_card_payment"
  | "loan_emi"
  | "subscription_payment"
  | "utility_bill"
  | "medical_spend"
  | "bank_charge"
  | "miscellaneous"

type ClassificationInput = {
  rawDescription: string
  type: "debit" | "credit"
}

export type ClassificationResult = {
  description: string
  category: Category
  intent: Intent
  confidence: "high" | "medium" | "low"
}

export type AIRefineInput = {
  key: string
  rawDescription: string
  description: string
  type: "debit" | "credit"
  category: Category
  intent: Intent
}

type AIRefineResult = {
  description: string
  category: Category
}

const categoryCache = new Map<string, AIRefineResult>()

const GENERIC_ALIAS_LABELS = new Set([
  "Restaurant",
  "Food Delivery",
  "Retail",
  "Shopping",
  "Groceries",
  "Travel Booking",
  "Airline",
  "Hotel",
  "Ride Hailing",
  "Telecom",
  "Utilities",
  "Medical",
  "Subscription",
  "Credit Card Payment",
])

const LABEL_ALIASES: Array<{ pattern: RegExp; label?: string; category?: Category; intent?: Intent }> = [
  { pattern: /\bCRED(CLUB)?\b|PAYMENT ON CRED|\bCHEQ\b|\bMOBIKWIK\b.*\bZIP\b|\bSIMPL\b|\bLAZY ?PAY\b|\bUNI ?CARD\b|\bONECARD\b|\bSLICE\b|\bRING\b/i, label: "Credit Card Payment", category: "Credit Card Payments", intent: "credit_card_payment" },
  { pattern: /\bSWIGGY(DINEOUT|DINERS)?\b/i, label: "Swiggy", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bZOMATO\b/i, label: "Zomato", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bEATCLUB\b|\bEAT\.?CLUB\b|\bBOX8\b|\bFAASOS\b/i, label: "EatClub", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bDOMINOS?\b|\bPIZZA HUT\b|\bMCDONALD'?S\b|\bKFC\b|\bBURGER KING\b|\bSUBWAY\b|\bSTARBUCKS\b/i, label: "Restaurant", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bDOORDASH\b|\bUBER ?EATS\b|\bGRUBHUB\b|\bPOSTMATES\b|\bDELIVEROO\b|\bJUST ?EAT\b|\bSKIPTHEDISHES\b|\bWOLT\b|\bFOODPANDA\b|\bGLOVO\b/i, label: "Food Delivery", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bCHIPOTLE\b|\bTACO BELL\b|\bDUNKIN\b|\bCOSTA\b|\bTIM HORTONS\b|\bPAPA JOHN'?S\b/i, label: "Restaurant", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bANNAPURNA\b.*\bFOODS?\b|\bANNAPURNA\s+FOODS?\b/i, label: "Annapurna Foods", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bWAFFLE\b/i, label: "Waffle Binge", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bSWEETS?\b|\bMITHAI\b|\bHALWAI\b|\bBAKERY\b|\bCONFECTION(?:ERY)?\b|\bDESSERT\b|\bICE ?CREAM\b|\bGELATO\b|\bSNACKS?\b|\bEATERY\b|\bBISTRO\b|\bRESTAURANTS?\b|\bRESTRO\b|\bDHABA\b|\bPURE ?VEG\b|\bBAR\b|\bPUB\b|\bLOUNGE\b/i, category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bFLIPKART\b/i, label: "Flipkart", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bAMAZON\b/i, label: "Amazon", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bMYNTRA\b/i, label: "Myntra", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bAJIO\b/i, label: "Ajio", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bNYKAA\b/i, label: "Nykaa", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bMEESHO\b/i, label: "Meesho", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bJIOMART\b/i, label: "JioMart", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bBIGBASKET\b/i, label: "BigBasket", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bZEPTO\b/i, label: "Zepto", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bBLINKIT\b|\bGROFERS\b/i, label: "Blinkit", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bWALMART\b|\bTARGET\b|\bCOSTCO\b|\bTESCO\b|\bSAINSBURY'?S\b|\bASDA\b|\bALDI\b|\bLIDL\b|\bCARREFOUR\b|\bAUCHAN\b/i, label: "Retail", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bEBAY\b|\bETSY\b|\bSHOPIFY\b|\bSHEIN\b|\bTEMU\b|\bALIEXPRESS\b|\bBEST BUY\b|\bHM\b|\bH&M\b|\bZARA\b|\bUNIQLO\b/i, label: "Shopping", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bWOOLWORTHS\b|\bCOLES\b|\bKROGER\b|\bSAFEWAY\b|\bWHOLE ?FOODS\b|\bINSTACART\b/i, label: "Groceries", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bMAKEMYTRIP\b|\bMAKE\s*MY\s*TRIP\b/i, label: "MakeMyTrip", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bGOIBIBO\b/i, label: "Goibibo", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bCLEARTRIP\b/i, label: "Cleartrip", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bAGODA\b/i, label: "Agoda", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bBOOKING\.?COM\b|\bBOOKING COM\b/i, label: "Booking.com", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bYATRA\b/i, label: "Yatra", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bIXIGO\b/i, label: "Ixigo", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bEASEMYTRIP\b/i, label: "EaseMyTrip", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bAIRBNB\b|\bEXPEDIA\b|\bHOTELS\.?COM\b|\bTRIVAGO\b|\bKAYAK\b|\bPRICELINE\b/i, label: "Travel Booking", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bDELTA\b|\bUNITED\b|\bAMERICAN AIRLINES\b|\bEMIRATES\b|\bQATAR\b|\bLUFTHANSA\b|\bRYANAIR\b|\bEASYJET\b|\bSOUTHWEST\b/i, label: "Airline", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bMARRIOTT\b|\bHILTON\b|\bHYATT\b|\bIHG\b|\bACCOR\b|\bRADISSON\b|\bOYO\b/i, label: "Hotel", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bOLA\b/i, label: "Ola", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bUBER\b/i, label: "Uber", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bRAPIDO\b/i, label: "Rapido", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bLYFT\b/i, label: "Lyft", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bBOLT\b/i, label: "Bolt", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bCABIFY\b|\bDIDI\b|\bGRAB\b|\bGOJEK\b|\b99APP\b|\bFREE NOW\b/i, label: "Ride Hailing", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bPAYTM\b.*\bEXPRESS\b|\bWEB\s+UPI\b.*\bPAYTM\b/i, label: "Paytm", category: "Bills / Utilities", intent: "utility_bill" },
  { pattern: /\bDTDC\b/i, label: "DTDC", category: "Bills / Utilities", intent: "merchant_spend" },
  { pattern: /\bAIRTEL\b|\bJIO\b|\bVODAFONE\b|\bVI\b|\bBSNL\b|\bVERIZON\b|\bAT&T\b|\bT-MOBILE\b|\bEE\b|\bO2\b|\bORANGE\b/i, label: "Telecom", category: "Bills / Utilities", intent: "utility_bill" },
  { pattern: /\bELECTRIC\b|\bELECTRICITY\b|\bPOWER\b|\bWATER\b|\bGAS\b|\bSEWER\b|\bUTILITY\b|\bFASTAG\b/i, label: "Utilities", category: "Bills / Utilities", intent: "utility_bill" },
  { pattern: /\bANGEL\b.*\bCHEMIST\b|\bCHEMIST\b|\bPHARMACY\b|\bPHARMA\b|\bMEDPLUS\b|\bAPOLLO\b|\bNETMEDS\b|\bPHARMEASY\b|\b1MG\b|\bMEDICAL\b|\bDENTAL\b|\bDERMA(?:TOLOGY)?\b|\bPATHO(?:LOGY)?\b|\bDIAGNOSTIC\b|\bDIAGNOSTICS\b|\bCLINIC\b|\bHOSPITAL\b|\bLAB\b|\bLABS\b|\bSCAN\b|\bIMAGING\b|\bXRAY\b|\bX-RAY\b|\bMRI\b|\bCT ?SCAN\b|\bBLOOD ?TEST\b/i, category: "Medical / Pharmacy", intent: "medical_spend" },
  { pattern: /\bCVS\b|\bWALGREENS\b|\bRITE ?AID\b|\bBOOTS\b|\bQUEST ?DIAGNOSTICS\b|\bLABCORP\b|\bMAYO\b|\bKAISER\b|\bNHS\b|\bOPTUM\b/i, category: "Medical / Pharmacy", intent: "medical_spend" },
  { pattern: /\bRAZORPAY\b/i, label: "Razorpay", category: "Bills / Utilities", intent: "merchant_spend" },
  { pattern: /\bHDFC\s+BANK\s+LTD\b/i, label: "HDFC Bank Ltd", category: "EMI / Loans", intent: "loan_emi" },
  { pattern: /\bLAMBDATEST\b.*\bPRIVATE\b.*\bLIMITED\b/i, label: "LambdaTest India Private Limited", category: "Salary / Income", intent: "salary_income" },
  { pattern: /\bNETFLIX\b|\bSPOTIFY\b|\bHOTSTAR\b|\bDISNEY\+?\b|\bJIOHOTSTAR\b|\bSONYLIV\b|\bZEE5\b|\bVOOT\b|\bYOUTUBE PREMIUM\b|\bAMAZON PRIME\b|\bPRIME VIDEO\b|\bAPPLE\b.*\bSUBSCRIPTION\b|\bAPPLE\b.*\bTV\b|\bAPPLE MUSIC\b|\bHULU\b|\bMAX\b|\bHBO\b|\bPEACOCK\b|\bPARAMOUNT\+?\b|\bDISCOVERY\+?\b|\bCRUNCHYROLL\b|\bAUDIBLE\b|\bPANDORA\b|\bDEEZER\b|\bTIDAL\b|\bXBOX\b|\bPLAYSTATION\b|\bNINTENDO\b|\bCHATGPT\b|\bOPENAI\b|\bANTHROPIC\b|\bNOTION\b|\bCANVA\b|\bADOBE\b|\bMICROSOFT\s*365\b/i, label: "Subscription", category: "Subscriptions", intent: "subscription_payment" },
]

const BANKING_NOISE = [
  "UPIINTENT",
  "NO REMARKS",
  "PAYMENT ON CRED",
  "PAYMENTONCRED",
  "UTIB",
  "UBIN",
  "ICICI",
  "HDFCBANK",
  "HDFC",
  "AXISB",
  "PAYU",
  "OKICICI",
  "OKHDFC",
  "OKSBI",
  "YBL",
  "YESBOYBLUPI",
  "YESBOPTMUPI",
  "MCHUPI",
  "SBOYBLUPI",
  "DFCBANK",
]

const BUSINESS_MARKERS = [
  "LTD",
  "LIMITED",
  "PRIVATE",
  "PVT",
  "TECHNOLOGIES",
  "SOLUTIONS",
  "SOFTWARE",
  "SERVICES",
  "VENTURES",
  "LABS",
  "RETAIL",
  "DIGITAL",
  "INTERNET",
  "LOGISTICS",
  "SUPERMARKET",
  "STORE",
  "STORES",
  "MART",
  "EXPRESS",
  "FINANCE",
  "BANK",
  "PHARMACY",
  "CHEMIST",
  "MARKETPLACE",
  "ONLINE",
  "FOODS",
  "FOODS",
  "TRAVEL",
  "TRIP",
  "PAYMENTS",
  "PAYTM",
  "PINELABS",
  "BIGBASKET",
  "BLINKIT",
  "GROFERS",
  "ZEPTO",
  "MAKEMYTRIP",
  "GOIBIBO",
  "CLEARTRIP",
  "AGODA",
  "BOOKING",
  "IXIGO",
  "EASEMYTRIP",
  "ANNAPURNA",
  "LAMBDATEST",
  "RAZORPAY",
  "CREDCLUB",
  "FLIPKART",
  "AMAZON",
  "MYNTRA",
  "AJIO",
  "NYKAA",
  "MEESHO",
  "JIOMART",
  "SWIGGY",
  "ZOMATO",
  "DOORDASH",
  "DELIVEROO",
  "GRUBHUB",
  "POSTMATES",
  "FOODPANDA",
  "GLOVO",
  "UBER",
  "LYFT",
  "BOLT",
  "OLA",
  "RAPIDO",
  "DTDC",
]

const CATEGORY_RULES: Array<{ category: Category; intent: Intent; patterns: RegExp[] }> = [
  {
    category: "Salary / Income",
    intent: "salary_income",
    patterns: [
      /\bSALARY\b/i,
      /\bPAYROLL\b/i,
      /\bBONUS\b/i,
      /\bINCENTIVE\b/i,
      /\bSTIPEND\b/i,
      /\bREIMBURSEMENT\b/i,
      /\bREFUND\b/i,
      /\bCASHBACK\b/i,
      /\bCREDITED BY\b/i,
      /\bSAL\s*CR\b/i,
      /\bLAMBDATEST\b/i,
      /\bPAYROLL\b/i,
      /\bPAYMENT FROM EMPLOYER\b/i,
    ],
  },
  {
    category: "Credit Card Payments",
    intent: "credit_card_payment",
    patterns: [/\bCRED(CLUB)?\b/i, /\bPAYMENT ON CRED\b/i, /\bCREDIT CARD\b/i, /\bCC PAYMENT\b/i, /\bCHEQ\b/i, /\bMOBIKWIK\b.*\bZIP\b/i, /\bSIMPL\b/i, /\bLAZY ?PAY\b/i, /\bUNI ?CARD\b/i, /\bONECARD\b/i, /\bSLICE\b/i, /\bRING\b/i],
  },
  {
    category: "EMI / Loans",
    intent: "loan_emi",
    patterns: [
      /\bACH ?D\b/i,
      /\bACHD\b/i,
      /\bNACH\b/i,
      /\bECS\b/i,
      /\bMANDATE\b/i,
      /\bEMI\b/i,
      /\bLOAN\b/i,
      /\bHL DEBIT\b/i,
      /\bBAJAJ\b/i,
      /\bFINANCE\b/i,
      /\bINSURANCE PREMIUM\b/i,
    ],
  },
  {
    category: "Bank Charges",
    intent: "bank_charge",
    patterns: [/\bCHARGE(S)?\b/i, /\bPENALTY\b/i, /\bINTEREST\b/i, /\bGST\b/i, /\bANNUAL FEE\b/i],
  },
  {
    category: "Subscriptions",
    intent: "subscription_payment",
    patterns: [/\bNETFLIX\b/i, /\bSPOTIFY\b/i, /\bHOTSTAR\b/i, /\bDISNEY\+?\b/i, /\bJIOHOTSTAR\b/i, /\bSONYLIV\b/i, /\bZEE5\b/i, /\bVOOT\b/i, /\bYOUTUBE PREMIUM\b/i, /\bAMAZON PRIME\b/i, /\bPRIME VIDEO\b/i, /\bAPPLE MUSIC\b/i, /\bAPPLE\b.*\bTV\b/i, /\bHULU\b/i, /\bMAX\b/i, /\bHBO\b/i, /\bPEACOCK\b/i, /\bPARAMOUNT\+?\b/i, /\bDISCOVERY\+?\b/i, /\bCRUNCHYROLL\b/i, /\bAUDIBLE\b/i, /\bPANDORA\b/i, /\bDEEZER\b/i, /\bTIDAL\b/i, /\bXBOX\b/i, /\bPLAYSTATION\b/i, /\bNINTENDO\b/i, /\bCHATGPT\b/i, /\bOPENAI\b/i, /\bANTHROPIC\b/i, /\bNOTION\b/i, /\bCANVA\b/i, /\bADOBE\b/i, /\bMICROSOFT\s*365\b/i],
  },
  {
    category: "Food / Dining",
    intent: "merchant_spend",
    patterns: [/\bSWIGGY\b/i, /\bZOMATO\b/i, /\bPIZZA\b/i, /\bRESTAURANT\b/i, /\bRESTAURANTS?\b/i, /\bRESTRO\b/i, /\bCAFE\b/i, /\bWAFFLE\b/i, /\bANNAPURNA\b/i, /\bDOMINOS?\b/i, /\bPIZZA HUT\b/i, /\bMCDONALD'?S\b/i, /\bKFC\b/i, /\bBURGER KING\b/i, /\bSUBWAY\b/i, /\bSTARBUCKS\b/i, /\bDOORDASH\b/i, /\bUBER ?EATS\b/i, /\bGRUBHUB\b/i, /\bDELIVEROO\b/i, /\bJUST ?EAT\b/i, /\bPOSTMATES\b/i, /\bFOODPANDA\b/i, /\bGLOVO\b/i, /\bSWEETS?\b/i, /\bMITHAI\b/i, /\bHALWAI\b/i, /\bBAKERY\b/i, /\bCONFECTION(?:ERY)?\b/i, /\bDESSERT\b/i, /\bICE ?CREAM\b/i, /\bGELATO\b/i, /\bSNACKS?\b/i, /\bEATERY\b/i, /\bBISTRO\b/i, /\bDHABA\b/i, /\bPURE ?VEG\b/i, /\bBAR\b/i, /\bPUB\b/i, /\bLOUNGE\b/i],
  },
  {
    category: "Shopping",
    intent: "merchant_spend",
    patterns: [/\bFLIPKART\b/i, /\bAMAZON\b/i, /\bMYNTRA\b/i, /\bAJIO\b/i, /\bNYKAA\b/i, /\bBIGBASKET\b/i, /\bZEPTO\b/i, /\bBLINKIT\b/i, /\bMEESHO\b/i, /\bJIOMART\b/i, /\bWALMART\b/i, /\bTARGET\b/i, /\bCOSTCO\b/i, /\bTESCO\b/i, /\bSAINSBURY'?S\b/i, /\bASDA\b/i, /\bALDI\b/i, /\bLIDL\b/i, /\bCARREFOUR\b/i, /\bAUCHAN\b/i, /\bEBAY\b/i, /\bETSY\b/i, /\bSHOPIFY\b/i, /\bSHEIN\b/i, /\bTEMU\b/i, /\bALIEXPRESS\b/i, /\bBEST BUY\b/i, /\bWOOLWORTHS\b/i, /\bCOLES\b/i, /\bKROGER\b/i, /\bSAFEWAY\b/i, /\bWHOLE ?FOODS\b/i, /\bINSTACART\b/i],
  },
  {
    category: "Travel",
    intent: "merchant_spend",
    patterns: [/\bMAKEMYTRIP\b/i, /\bMAKE\s*MY\s*TRIP\b/i, /\bGOIBIBO\b/i, /\bIRCTC\b/i, /\bYATRA\b/i, /\bAGODA\b/i, /\bBOOKING\.?COM\b/i, /\bIXIGO\b/i, /\bEASEMYTRIP\b/i, /\bAIRBNB\b/i, /\bEXPEDIA\b/i, /\bHOTELS\.?COM\b/i, /\bTRIVAGO\b/i, /\bKAYAK\b/i, /\bPRICELINE\b/i, /\bMARRIOTT\b/i, /\bHILTON\b/i, /\bHYATT\b/i, /\bIHG\b/i, /\bACCOR\b/i, /\bRADISSON\b/i, /\bOYO\b/i, /\bDELTA\b/i, /\bUNITED\b/i, /\bAMERICAN AIRLINES\b/i, /\bEMIRATES\b/i, /\bQATAR\b/i, /\bLUFTHANSA\b/i, /\bRYANAIR\b/i, /\bEASYJET\b/i, /\bSOUTHWEST\b/i],
  },
  {
    category: "Medical / Pharmacy",
    intent: "medical_spend",
    patterns: [/\bCHEMIST\b/i, /\bPHARMACY\b/i, /\bPHARMA\b/i, /\bMEDICAL\b/i, /\bMEDPLUS\b/i, /\bAPOLLO\b/i, /\bNETMEDS\b/i, /\bPHARMEASY\b/i, /\b1MG\b/i, /\bDENTAL\b/i, /\bDERMA(?:TOLOGY)?\b/i, /\bPATHO(?:LOGY)?\b/i, /\bDIAGNOSTIC\b/i, /\bDIAGNOSTICS\b/i, /\bCLINIC\b/i, /\bHOSPITAL\b/i, /\bLAB\b/i, /\bLABS\b/i, /\bSCAN\b/i, /\bIMAGING\b/i, /\bXRAY\b/i, /\bX-RAY\b/i, /\bMRI\b/i, /\bCT ?SCAN\b/i, /\bBLOOD ?TEST\b/i, /\bCVS\b/i, /\bWALGREENS\b/i, /\bRITE ?AID\b/i, /\bBOOTS\b/i, /\bQUEST ?DIAGNOSTICS\b/i, /\bLABCORP\b/i],
  },
  {
    category: "Bills / Utilities",
    intent: "utility_bill",
    patterns: [/\bAIRTEL\b/i, /\bJIO\b/i, /\bBSNL\b/i, /\bBROADBAND\b/i, /\bELECTRICITY\b/i, /\bWATER\b/i, /\bGAS\b/i, /\bDTDC\b/i, /\bPAYTM\b.*\bEXPRESS\b/i, /\bWEB\s+UPI\b.*\bPAYTM\b/i, /\bMOBILE RECHARGE\b/i, /\bPOSTPAID\b/i, /\bFASTAG\b/i, /\bVERIZON\b/i, /\bAT&T\b/i, /\bT-MOBILE\b/i, /\bEE\b/i, /\bO2\b/i, /\bORANGE\b/i],
  },
  {
    category: "Transport",
    intent: "merchant_spend",
    patterns: [/\bOLA\b/i, /\bUBER\b/i, /\bRAPIDO\b/i, /\bLYFT\b/i, /\bBOLT\b/i, /\bCABIFY\b/i, /\bDIDI\b/i, /\bGRAB\b/i, /\bGOJEK\b/i, /\b99APP\b/i, /\bFREE NOW\b/i, /\bFASTAG\b/i, /\bFUEL\b/i, /\bPETROL\b/i, /\bDIESEL\b/i, /\bMETRO\b/i],
  },
]

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeTransactionText(value: string): string {
  return compactWhitespace(value)
    .replace(/\bPRI\s*VATE\b/gi, "PRIVATE")
    .replace(/\bLIM\s*ITED\b/gi, "LIMITED")
    .replace(/\bPAY\s+TM\b/gi, "PAYTM")
    .replace(/\bMAKE\s+MY\s+TRIP\b/gi, "MAKEMYTRIP")
    .replace(/\bLAMBDA\s*TEST\b/gi, "LAMBDATEST")
    .replace(/\bLAMBDATESTINDIA\b/gi, "LAMBDATEST INDIA")
    .replace(/\bPAYMENT\s+ON\s+CRED\b/gi, "PAYMENT ON CRED")
    .replace(/\bWEB\s+UPI\b/gi, "WEB UPI")
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ")
}

function uniqueTokens(tokens: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const key = token.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
  }
  return out
}

function extractAlias(raw: string) {
  return LABEL_ALIASES.find((alias) => alias.pattern.test(raw))
}

function shouldUseAliasLabel(label: string | undefined): label is string {
  if (!label) return false
  return !GENERIC_ALIAS_LABELS.has(label)
}

function stripRailPrefix(raw: string): string {
  return raw
    .replace(/^(UPI|IMPS|NEFT(?:\s+CR|\s+DR)?|RTGS(?:\s+CR|\s+DR)?|ACH\s*D|ACHD|NACH|ECS|HL)\s*[-:\s]*/i, "")
    .replace(/\b(CR|DR)\b\s*[-:\s]*/i, "")
}

function splitBeforeNoise(raw: string): string {
  const upper = raw.toUpperCase()
  const candidates = [
    upper.indexOf("@"),
    upper.indexOf(" NO REMARKS"),
    upper.indexOf(" UPIINTENT"),
    upper.indexOf(" PAYMENT ON CRED"),
  ].filter((idx) => idx >= 0)
  if (!candidates.length) return raw
  return raw.slice(0, Math.min(...candidates))
}

function extractAlphaTokens(raw: string): string[] {
  const cleaned = splitBeforeNoise(stripRailPrefix(raw))
    .replace(/[._]/g, " ")
    .replace(/[^A-Za-z\s-]/g, " ")
    .replace(/-/g, " ")
  return cleaned
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !BANKING_NOISE.includes(token.toUpperCase()))
}

function extractEntityLabel(raw: string): string {
  const alias = extractAlias(raw)
  if (shouldUseAliasLabel(alias?.label)) return alias.label

  const tokens = uniqueTokens(extractAlphaTokens(raw))
  if (!tokens.length) return "Miscellaneous"

  const ltdIdx = tokens.findIndex((token) => ["LIMITED", "LTD", "PRIVATE", "PVT"].includes(token.toUpperCase()))
  if (ltdIdx >= 0) {
    return toTitleCase(tokens.slice(0, Math.min(tokens.length, ltdIdx + 1)).join(" ")).slice(0, 48)
  }

  const businessToken = tokens.find((token) => BUSINESS_MARKERS.includes(token.toUpperCase()))
  if (businessToken) {
    const start = tokens.findIndex((token) => token.toUpperCase() === businessToken.toUpperCase())
    const slice = tokens.slice(Math.max(0, start - 1), Math.min(tokens.length, start + 3))
    return toTitleCase(slice.join(" ")).slice(0, 40)
  }

  return toTitleCase(tokens.slice(0, 4).join(" ")).slice(0, 40)
}

function looksLikePerson(label: string): boolean {
  const tokens = label.split(/\s+/).filter(Boolean)
  if (tokens.length < 2 || tokens.length > 4) return false
  if (tokens.some((token) => BUSINESS_MARKERS.includes(token.toUpperCase()))) return false
  return tokens.every((token) => /^[A-Za-z]+$/.test(token))
}

function looksLikeBusiness(raw: string, label: string): boolean {
  if (extractAlias(raw)) return true
  const upper = `${raw} ${label}`.toUpperCase()
  if (BUSINESS_MARKERS.some((token) => upper.includes(token))) return true
  if (/\b(LTD|LIMITED|PRIVATE|PVT|LLP|INC|TECHNOLOGIES|SOLUTIONS|SERVICES|ONLINE|MARKETPLACE|FOODS|PAYTM|PINELABS|LABS|VENTURES|RETAIL|DIGITAL|INTERNET|LOGISTICS|STORE|STORES|MART)\b/i.test(upper)) return true
  return false
}

function looksLikeEmployerIncome(raw: string, type: "debit" | "credit"): boolean {
  if (type !== "credit") return false
  const normalized = normalizeTransactionText(raw)
  const upper = normalized.toUpperCase()
  if (/\b(REFUND|CASHBACK|REVERSAL|REWARD|INTEREST)\b/.test(upper)) return false
  const label = extractEntityLabel(normalized)
  if (hasTransferRail(normalized) && looksLikeBusiness(normalized, label)) return true
  if (/\b(CR|CREDIT|SALARY|PAYROLL|INCOME)\b/.test(upper) && looksLikeBusiness(normalized, label)) return true
  if (looksLikeBusiness(normalized, label) && !hasUpiRail(normalized) && !/\b(ACH|NACH|ECS|MANDATE|EMI|LOAN|CHARGE|FEE)\b/.test(upper)) {
    return true
  }
  return false
}

function isNoisyLabel(label: string): boolean {
  const upper = label.toUpperCase()
  return (
    label.length < 3 ||
    /\d{4,}/.test(label) ||
    /[@]/.test(label) ||
    BANKING_NOISE.some((token) => upper.includes(token)) ||
    upper === "MISCELLANEOUS"
  )
}

function hasTransferRail(raw: string): boolean {
  return /\b(NEFT|IMPS|RTGS)\b/i.test(raw)
}

function hasUpiRail(raw: string): boolean {
  return /\bUPI\b/i.test(raw)
}

export function classifyTransaction({ rawDescription, type }: ClassificationInput): ClassificationResult {
  const raw = normalizeTransactionText(rawDescription)
  const alias = extractAlias(raw)
  const label = extractEntityLabel(raw)

  if (looksLikeEmployerIncome(raw, type)) {
    return {
      description: label,
      category: "Salary / Income",
      intent: "salary_income",
      confidence: "high",
    }
  }

  if (hasTransferRail(raw)) {
    return {
      description: label,
      category: "Transfers",
      intent: "p2p_transfer",
      confidence: "high",
    }
  }

  if (alias?.category && alias?.intent) {
    return {
      description: shouldUseAliasLabel(alias.label) ? alias.label : label,
      category: alias.category,
      intent: alias.intent,
      confidence: "high",
    }
  }

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(raw))) {
      return {
        description: label,
        category: rule.category,
        intent: rule.intent,
        confidence: "high",
      }
    }
  }

  if (hasUpiRail(raw) && looksLikePerson(label)) {
    return {
      description: label,
      category: "UPI Payments",
      intent: "merchant_spend",
      confidence: "medium",
    }
  }

  if (hasUpiRail(raw)) {
    return {
      description: label,
      category: looksLikeBusiness(raw, label) ? "Miscellaneous" : "UPI Payments",
      intent: "merchant_spend",
      confidence: looksLikeBusiness(raw, label) || isNoisyLabel(label) ? "low" : "medium",
    }
  }

  return {
    description: label,
    category: "Miscellaneous",
    intent: "miscellaneous",
    confidence: isNoisyLabel(label) ? "low" : "medium",
  }
}

export function normalizeDescription(raw: string): string {
  return classifyTransaction({ rawDescription: raw, type: "debit" }).description
}

export function categorizeByRules(description: string): Category {
  return classifyTransaction({ rawDescription: description, type: "debit" }).category
}

export function shouldRefineWithAI(result: ClassificationResult, rawDescription: string): boolean {
  if (result.category === "Miscellaneous") return true
  if (result.confidence === "low") return true
  if (result.category === "Transfers" && /\b(PAYU|RAZORPAY|LTD|PRIVATE|TECHNOLOGIES)\b/i.test(rawDescription)) return true
  if (result.category === "UPI Payments" && !looksLikePerson(result.description)) return true
  if (
    hasUpiRail(rawDescription) &&
    looksLikeBusiness(rawDescription, result.description) &&
    result.category === "UPI Payments"
  ) return true
  if (result.category === "Salary / Income" && /\b(REFUND|CASHBACK|REVERSAL|REWARD)\b/i.test(rawDescription)) return true
  return isNoisyLabel(result.description)
}

function isGenericCategory(category: Category): boolean {
  return category === "Miscellaneous" || category === "UPI Payments" || category === "Transfers"
}

function reconcileAIResult(
  original: AIRefineInput,
  aiLabel: string,
  aiCategory: Category
): AIRefineResult {
  const base = classifyTransaction({
    rawDescription: original.rawDescription,
    type: original.type,
  })

  let category = aiCategory
  if (base.category === "Salary / Income" && aiCategory === "Miscellaneous") {
    category = "Salary / Income"
  } else if (!isGenericCategory(base.category) && isGenericCategory(aiCategory)) {
    category = base.category
  } else if (base.category !== "Miscellaneous" && aiCategory === "Miscellaneous") {
    category = base.category
  }

  const cleanedAiLabel = compactWhitespace(aiLabel).slice(0, 48)
  const description =
    !cleanedAiLabel ||
    GENERIC_ALIAS_LABELS.has(cleanedAiLabel) ||
    /^(food|shopping|travel|transport|medical|utilities|subscription|transfer)s?$/i.test(cleanedAiLabel)
      ? base.description
      : cleanedAiLabel
  return {
    description,
    category,
  }
}

export async function batchRefineTransactionsWithAI(inputs: AIRefineInput[]): Promise<Record<string, AIRefineResult>> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey || inputs.length === 0) return {}

  const unique = inputs.filter((item) => !categoryCache.has(item.key))
  const resultMap: Record<string, AIRefineResult> = {}

  for (const item of inputs) {
    const cached = categoryCache.get(item.key)
    if (cached) resultMap[item.key] = cached
  }

  if (!unique.length) return resultMap

  const refineChunk = async (chunk: typeof unique) => {
    const prompt = `
You classify Indian bank-statement transactions.

Allowed categories: ${CATEGORIES.join(" | ")}

Rules:
- CRED / PAYMENT ON CRED / CHEQ / LazyPay / Simpl / OneCard / Slice / Ring / MobiKwik ZIP => Credit Card Payments
- ACH D / NACH / ECS / mandate debits => EMI / Loans unless clearly bank fees
- Employer/company incoming NEFT/IMPS/RTGS credits => Salary / Income
- Plain NEFT / IMPS / RTGS transfers without employer/company context => Transfers
- UPI with company/merchant names => classify by merchant (Swiggy => Food / Dining, Flipkart/BigBasket/Zepto => Shopping, MakeMyTrip => Travel, Paytm Express/Web UPI => Bills / Utilities, etc.)
- Popular merchant hints:
  - Food / Dining: Swiggy, Zomato, EatClub, Box8, Faasos, Domino's, Pizza Hut, McDonald's, KFC, Burger King, Subway, Starbucks, Annapurna Foods
  - Shopping: Flipkart, Amazon, Myntra, Ajio, Nykaa, Meesho, JioMart, BigBasket, Zepto, Blinkit
  - Travel: MakeMyTrip, Goibibo, Cleartrip, Agoda, Booking.com, Yatra, Ixigo, EaseMyTrip
  - Transport: Ola, Uber, Rapido, Lyft, Bolt
  - Medical / Pharmacy: MedPlus, Apollo, NetMeds, PharmEasy, Angel Chemist, CVS, Walgreens, Boots, medical/pharma/clinic/diagnostic keywords
  - Subscriptions: Netflix, Prime Video, Disney+, Hotstar, SonyLIV, Zee5, Hulu, Max, Peacock, Paramount+, Discovery+, Spotify, Audible, Apple Music
- UPI with only person/payee names and no clear merchant => UPI Payments
- Chemist/pharmacy/medical stores => Medical / Pharmacy
- Charges/fees/penalty/interest => Bank Charges
- Swiggy/Zomato => Food / Dining
- Flipkart/Amazon/Myntra => Shopping
- MakeMyTrip / GoIbibo / Yatra => Travel

Return ONLY JSON array.
Each item must be:
{"key":"...","label":"Short Clean Label","category":"One Allowed Category"}

Keep label short, human-readable, 2-5 words, no refs/account numbers.

Transactions:
${chunk.map((item) => JSON.stringify({
  key: item.key,
  raw: item.rawDescription,
  currentLabel: item.description,
  currentCategory: item.category,
  type: item.type,
  intentHint: item.intent,
})).join("\n")}
`.trim()

    const genAI = new GoogleGenerativeAI(geminiKey)
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      generationConfig: { maxOutputTokens: 2048, temperature: 0 },
    })

    const response = await model.generateContent(prompt)
    const text = response.response.text().trim()
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const parsed = JSON.parse(jsonMatch[0]) as Array<{ key: string; label: string; category: string }>
    for (const item of parsed) {
      if (!item?.key || !item?.label || !CATEGORIES.includes(item.category as Category)) continue
      const original = chunk.find((candidate) => candidate.key === item.key)
      if (!original) continue
      const refined = reconcileAIResult(
        original,
        item.label,
        item.category as Category
      )
      categoryCache.set(item.key, refined)
      resultMap[item.key] = refined
    }
  }

  try {
    for (let i = 0; i < unique.length; i += 40) {
      await refineChunk(unique.slice(i, i + 40))
    }
    return resultMap
  } catch (err) {
    console.error("Gemini classify error:", err)
    return resultMap
  }
}

export async function batchCategorizeWithAI(descriptions: string[]): Promise<Record<string, Category>> {
  const inputs = descriptions.map((description) => ({
    key: description,
    rawDescription: description,
    description,
    type: "debit" as const,
    category: "Miscellaneous" as const,
    intent: "miscellaneous" as const,
  }))
  const refined = await batchRefineTransactionsWithAI(inputs)
  const out: Record<string, Category> = {}
  for (const [key, value] of Object.entries(refined)) out[key] = value.category
  return out
}

export function makeHash(userId: string, date: string, amount: number, rawDesc: string): string {
  return crypto
    .createHash("sha1")
    .update(`${userId}|${date}|${amount}|${rawDesc.toLowerCase().trim()}`)
    .digest("hex")
}
