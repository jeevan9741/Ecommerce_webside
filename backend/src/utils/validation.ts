import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().toLowerCase(),
  phone: z.string().min(10).max(15),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/i, "Username can only contain letters, numbers, and underscores")
    .toLowerCase(),
  password: z.string().min(8).max(72),
  referralCode: z.string().max(16).optional().nullable(),
  preferredLanguageCode: z.string().max(10).optional().nullable(),
});

export const sendOtpSchema = z.object({
  email: z.string().email().toLowerCase(),
  purpose: z.enum(["REGISTER", "LOGIN_RESET"]),
});

export const verifyOtpSchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().length(6),
  purpose: z.enum(["REGISTER", "LOGIN_RESET"]),
});

export const createOrderSchema = z.object({
  courseId: z.string().min(1),
  selectedLanguage: z.string().optional().nullable(),
  referralCode: z.string().max(16).optional().nullable(),
});

export const payoutMethodSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("UPI"),
    label: z.string().min(2).max(50),
    upiId: z.string().min(3).max(80),
  }),
  z.object({
    type: z.literal("BANK"),
    label: z.string().min(2).max(50),
    accountHolderName: z.string().min(2).max(100),
    accountNumber: z.string().min(6).max(30),
    ifsc: z.string().min(4).max(15),
  }),
]);

export const withdrawalRequestSchema = z.object({
  payoutMethodId: z.string().min(1),
  amountInPaise: z.number().int().positive(),
});

export const jobApplicationSchema = z.object({
  jobId: z.string().min(1),
  applicantName: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().min(10).max(15),
  coverNote: z.string().max(2000).optional(),
});

export const reviewSchema = z.object({
  customerName: z.string().min(2).max(100),
  rating: z.number().int().min(1).max(5),
  text: z.string().min(2).max(1000),
  isApproved: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

export const courseSchema = z.object({
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  type: z.enum(["EBOOK", "VIDEO", "ZOOM", "CENTRE"]),
  title: z.string().min(2).max(150),
  shortDescription: z.string().min(2).max(300),
  description: z.string().min(2).max(5000),
  priceInPaise: z.number().int().positive(),
  commissionInPaise: z.number().int().nonnegative(),
  isActive: z.boolean().default(true),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const moduleSchema = z.object({
  title: z.string().min(1).max(150),
  displayOrder: z.number().int().optional(),
});

export const lessonSchema = z.object({
  title: z.string().min(1).max(150),
  videoUrl: z.string().min(1).optional().nullable(),
  subtitleUrl: z.string().min(1).optional().nullable(),
  displayOrder: z.number().int().optional(),
});

export const languageSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[a-z-]+$/i, "Code should look like an ISO language code, e.g. hi, en, brx")
    .toLowerCase(),
  name: z.string().min(1).max(60),
  nativeName: z.string().min(1).max(60),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
});

export const courseLanguageVideoSchema = z.object({
  videoUrl: z.string().min(1).optional().nullable(),
  subtitleUrl: z.string().min(1).optional().nullable(),
  ebookUrl: z.string().min(1).optional().nullable(),
});

export const employeeSchema = z.object({
  employeeCode: z.string().min(2).max(30),
  name: z.string().min(2).max(100),
  position: z.string().min(2).max(100),
  joiningDate: z.string(),
  salaryInPaise: z.number().int().nonnegative(),
  workType: z.enum(["WORK_FROM_HOME", "OFFICE", "HYBRID"]),
  status: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).default("ACTIVE"),
  notes: z.string().max(1000).optional(),
});

export const jobPostingSchema = z.object({
  title: z.string().min(2).max(150),
  description: z.string().min(2).max(5000),
  eligibility: z.string().min(2).max(2000),
  salary: z.string().min(1).max(100),
  workType: z.enum(["WORK_FROM_HOME", "OFFICE", "HYBRID"]),
  workingHours: z.string().min(1).max(100),
  isActive: z.boolean().default(true),
});
