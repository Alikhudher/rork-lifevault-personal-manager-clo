import { addDays, format, setHours, setMinutes, subDays, subHours } from "date-fns";
import type {
  AppNotification,
  Appointment,
  DeviceSession,
  Expense,
  RegisteredAccount,
  Settings,
  Subscription,
  VaultDocument,
} from "./types";

function dayOffset(days: number): string {
  return format(addDays(new Date(), days), "yyyy-MM-dd");
}

function dateTimeOffset(days: number, hour: number, minute: number = 0): string {
  const base = days >= 0 ? addDays(new Date(), days) : subDays(new Date(), Math.abs(days));
  return setMinutes(setHours(base, hour), minute).toISOString();
}

export const DEFAULT_SETTINGS: Settings = {
  currency: "AUD",
  darkMode: false,
  biometric: false,
  monthlyBudget: 3800,
  language: "en",
  notifications: {
    documents: true,
    subscriptions: true,
    bills: true,
    appointments: true,
    budget: true,
  },
};

export function seedDocuments(): VaultDocument[] {
  return [
    {
      id: "doc_passport",
      name: "Australian Passport",
      category: "Passport",
      issueDate: dayOffset(-1650),
      expiryDate: dayOffset(24),
      notes: "Passport number P1234567. Renew online via AusPost.",
      reminderDays: 60,
      fileName: "passport-scan.pdf",
      fileKind: "pdf",
      createdAt: dateTimeOffset(-320, 10),
    },
    {
      id: "doc_licence",
      name: "NSW Driver Licence",
      category: "Driver Licence",
      issueDate: dayOffset(-1200),
      expiryDate: dayOffset(9),
      notes: "Licence no. 1234 5678. Renew at Service NSW.",
      reminderDays: 30,
      fileName: "driver-licence.jpg",
      fileKind: "image",
      createdAt: dateTimeOffset(-300, 14),
    },
    {
      id: "doc_home_insurance",
      name: "Home & Contents Insurance",
      category: "Insurance",
      issueDate: dayOffset(-340),
      expiryDate: dayOffset(25),
      notes: "NRMA policy HM-884-221. Covers contents up to $85k.",
      reminderDays: 30,
      fileName: "nrma-policy.pdf",
      fileKind: "pdf",
      createdAt: dateTimeOffset(-200, 9),
    },
    {
      id: "doc_car_rego",
      name: "Car Registration — Toyota Corolla",
      category: "Vehicle",
      issueDate: dayOffset(-360),
      expiryDate: dayOffset(-6),
      notes: "Plate ABC-12D. Renew rego + green slip together.",
      reminderDays: 14,
      fileName: "rego-certificate.pdf",
      fileKind: "pdf",
      createdAt: dateTimeOffset(-180, 16),
    },
    {
      id: "doc_medicare",
      name: "Medicare Card",
      category: "ID",
      issueDate: dayOffset(-700),
      expiryDate: dayOffset(410),
      notes: "Card number 2953 12345 1.",
      reminderDays: 30,
      fileName: "medicare-card.jpg",
      fileKind: "image",
      createdAt: dateTimeOffset(-400, 11),
    },
    {
      id: "doc_employment",
      name: "Employment Contract — Aurora Digital",
      category: "Employment",
      issueDate: dayOffset(-540),
      expiryDate: null,
      notes: "Full-time senior designer. 4 weeks notice period.",
      reminderDays: 30,
      fileName: "employment-contract.pdf",
      fileKind: "pdf",
      createdAt: dateTimeOffset(-500, 13),
    },
    {
      id: "doc_degree",
      name: "Bachelor of Design — UTS",
      category: "Education",
      issueDate: dayOffset(-2100),
      expiryDate: null,
      notes: "Original stored in fireproof safe.",
      reminderDays: 30,
      fileName: "uts-degree.pdf",
      fileKind: "pdf",
      createdAt: dateTimeOffset(-480, 15),
    },
    {
      id: "doc_macbook",
      name: "MacBook Pro AppleCare+",
      category: "Warranty",
      issueDate: dayOffset(-250),
      expiryDate: dayOffset(480),
      notes: "Serial C02XL0GTJGH5. Covers accidental damage.",
      reminderDays: 30,
      fileName: "applecare-receipt.pdf",
      fileKind: "pdf",
      createdAt: dateTimeOffset(-250, 12),
    },
  ];
}

export function seedExpenses(): Expense[] {
  return [
    { id: "exp_1", amount: 18.5, date: dateTimeOffset(0, 8, 15), category: "Food", merchant: "Single O Coffee", notes: "Breakfast with Sam", paymentMethod: "Debit Card" },
    { id: "exp_2", amount: 64.2, date: dateTimeOffset(0, 12, 40), category: "Food", merchant: "Woolworths", notes: "Weekly groceries top-up", paymentMethod: "Debit Card" },
    { id: "exp_3", amount: 22, date: dateTimeOffset(0, 17, 5), category: "Transport", merchant: "Opal", notes: "Train + bus", paymentMethod: "Credit Card" },
    { id: "exp_4", amount: 89.9, date: dateTimeOffset(-1, 18, 30), category: "Fuel", merchant: "BP Rozelle", notes: "Full tank", paymentMethod: "Credit Card" },
    { id: "exp_5", amount: 145, date: dateTimeOffset(-2, 10, 0), category: "Health", merchant: "City Dental", notes: "Check-up gap payment", paymentMethod: "Debit Card" },
    { id: "exp_6", amount: 38.75, date: dateTimeOffset(-2, 19, 45), category: "Entertainment", merchant: "Event Cinemas", notes: "Movie night", paymentMethod: "Credit Card" },
    { id: "exp_7", amount: 620, date: dateTimeOffset(-4, 9, 0), category: "Rent", merchant: "Ray White Property", notes: "Weekly rent", paymentMethod: "Bank Transfer" },
    { id: "exp_8", amount: 112.4, date: dateTimeOffset(-5, 14, 20), category: "Bills", merchant: "AGL Energy", notes: "Electricity bill", paymentMethod: "Bank Transfer" },
    { id: "exp_9", amount: 79.99, date: dateTimeOffset(-6, 16, 10), category: "Shopping", merchant: "Uniqlo", notes: "Winter jumper", paymentMethod: "Credit Card" },
    { id: "exp_10", amount: 54.3, date: dateTimeOffset(-7, 11, 30), category: "Food", merchant: "Coles", notes: "Groceries", paymentMethod: "Debit Card" },
    { id: "exp_11", amount: 26.9, date: dateTimeOffset(-9, 13, 15), category: "Health", merchant: "Chemist Warehouse", notes: "Vitamins", paymentMethod: "Cash" },
    { id: "exp_12", amount: 620, date: dateTimeOffset(-11, 9, 0), category: "Rent", merchant: "Ray White Property", notes: "Weekly rent", paymentMethod: "Bank Transfer" },
    { id: "exp_13", amount: 95.5, date: dateTimeOffset(-12, 18, 0), category: "Food", merchant: "The Grounds", notes: "Dinner with family", paymentMethod: "Credit Card" },
    { id: "exp_14", amount: 65.8, date: dateTimeOffset(-14, 15, 45), category: "Bills", merchant: "Telstra", notes: "Mobile plan", paymentMethod: "Bank Transfer" },
    { id: "exp_15", amount: 42, date: dateTimeOffset(-16, 10, 30), category: "Transport", merchant: "Uber", notes: "Airport trip", paymentMethod: "Credit Card" },
  ];
}

export function seedSubscriptions(): Subscription[] {
  return [
    { id: "sub_netflix", name: "Netflix Premium", price: 25.99, frequency: "monthly", nextPaymentDate: dayOffset(3), category: "Entertainment", paymentMethod: "Credit Card", reminderDays: 7, status: "active" },
    { id: "sub_spotify", name: "Spotify Duo", price: 20.99, frequency: "monthly", nextPaymentDate: dayOffset(8), category: "Entertainment", paymentMethod: "Debit Card", reminderDays: 7, status: "active" },
    { id: "sub_icloud", name: "iCloud+ 200GB", price: 4.49, frequency: "monthly", nextPaymentDate: dayOffset(12), category: "Bills", paymentMethod: "Credit Card", reminderDays: 7, status: "active" },
    { id: "sub_gym", name: "Anytime Fitness", price: 17.95, frequency: "weekly", nextPaymentDate: dayOffset(2), category: "Health", paymentMethod: "Debit Card", reminderDays: 7, status: "active" },
    { id: "sub_prime", name: "Amazon Prime", price: 79, frequency: "yearly", nextPaymentDate: dayOffset(114), category: "Shopping", paymentMethod: "Credit Card", reminderDays: 14, status: "active" },
    { id: "sub_adobe", name: "Adobe Creative Cloud", price: 86.99, frequency: "monthly", nextPaymentDate: dayOffset(19), category: "Bills", paymentMethod: "Credit Card", reminderDays: 7, status: "active" },
    { id: "sub_nrma_car", name: "NRMA Car Insurance", price: 312.4, frequency: "quarterly", nextPaymentDate: dayOffset(41), category: "Bills", paymentMethod: "Bank Transfer", reminderDays: 14, status: "active" },
    { id: "sub_stan", name: "Stan", price: 17, frequency: "monthly", nextPaymentDate: dayOffset(-20), category: "Entertainment", paymentMethod: "Credit Card", reminderDays: 7, status: "cancelled" },
    { id: "sub_youfoodz", name: "Youfoodz Meal Plan", price: 89, frequency: "weekly", nextPaymentDate: dayOffset(-45), category: "Food", paymentMethod: "Debit Card", reminderDays: 7, status: "cancelled" },
  ];
}

export function seedAppointments(): Appointment[] {
  return [
    { id: "apt_dentist", title: "Dentist — 6-month clean", date: dayOffset(1), time: "09:30", location: "City Dental, 120 Pitt St, Sydney", notes: "Ask about night guard.", reminder: "1 day before" },
    { id: "apt_car", title: "Car service — 60,000km", date: dayOffset(4), time: "08:00", location: "Toyota Service Centre, Alexandria", notes: "Mention brake squeal. Loan car booked.", reminder: "1 day before" },
    { id: "apt_gp", title: "GP appointment — Dr Nguyen", date: dayOffset(7), time: "14:15", location: "Green Square Medical Centre", notes: "Annual check-up, bring referral letter.", reminder: "3 hours before" },
    { id: "apt_lease", title: "Lease renewal meeting", date: dayOffset(11), time: "17:30", location: "Ray White Surry Hills", notes: "Negotiate 12-month term.", reminder: "1 day before" },
    { id: "apt_haircut", title: "Haircut", date: dayOffset(13), time: "11:00", location: "Barber & Co, Newtown", notes: "", reminder: "1 hour before" },
    { id: "apt_accountant", title: "Tax planning — accountant", date: dayOffset(20), time: "10:00", location: "Video call (Zoom)", notes: "Prepare FY expense summary export.", reminder: "1 day before" },
  ];
}

/** Demo account used for the mock auth flow. Password: "password123" */
export function seedAccounts(): RegisteredAccount[] {
  return [
    {
      email: "mia.thompson@example.com",
      name: "Mia Thompson",
      photo: null,
      password: "password123",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 87).toISOString(),
      emailVerified: true,
    },
  ];
}

export function seedSessions(): DeviceSession[] {
  return [
    {
      id: "ses_current",
      device: "iPhone 15 Pro",
      location: "Sydney, Australia",
      app: "LifeVault iOS · 1.0",
      lastActive: new Date().toISOString(),
      current: true,
    },
    {
      id: "ses_ipad",
      device: "iPad Air",
      location: "Sydney, Australia",
      app: "LifeVault iOS · 1.0",
      lastActive: subHours(new Date(), 6).toISOString(),
    },
    {
      id: "ses_macbook",
      device: "MacBook Pro · Safari",
      location: "Melbourne, Australia",
      app: "LifeVault Web · 1.0",
      lastActive: subHours(new Date(), 28).toISOString(),
    },
    {
      id: "ses_windows",
      device: "Windows PC · Chrome",
      location: "Brisbane, Australia",
      app: "LifeVault Web · 1.0",
      lastActive: subHours(new Date(), 74).toISOString(),
    },
  ];
}

export function seedNotifications(): AppNotification[] {
  return [
    { id: "ntf_1", type: "document", title: "Driver licence expiring soon", message: "Your NSW Driver Licence expires in 9 days. Renew at Service NSW.", date: dateTimeOffset(0, 8), read: false },
    { id: "ntf_2", type: "subscription", title: "Anytime Fitness renews soon", message: "A$17.95 will be charged to your debit card in 2 days.", date: dateTimeOffset(0, 7, 30), read: false },
    { id: "ntf_3", type: "appointment", title: "Dentist tomorrow at 9:30 AM", message: "6-month clean at City Dental, 120 Pitt St, Sydney.", date: dateTimeOffset(0, 7), read: false },
    { id: "ntf_4", type: "budget", title: "80% of monthly budget used", message: "You have spent A$3,040 of your A$3,800 monthly budget.", date: dateTimeOffset(-1, 18), read: false },
    { id: "ntf_5", type: "document", title: "Car registration expired", message: "Your Toyota Corolla registration expired 6 days ago.", date: dateTimeOffset(-1, 9), read: true },
    { id: "ntf_6", type: "subscription", title: "Netflix renews in 3 days", message: "A$25.99 will be charged to your credit card.", date: dateTimeOffset(-2, 10), read: true },
    { id: "ntf_7", type: "bill", title: "Electricity bill paid", message: "AGL Energy bill of A$112.40 was recorded from your bank transfer.", date: dateTimeOffset(-5, 14, 30), read: true },
    { id: "ntf_8", type: "document", title: "Passport renewal window open", message: "Your Australian Passport expires in 24 days. Allow 6 weeks for renewal.", date: dateTimeOffset(-6, 9), read: true },
  ];
}
