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

export const referralClaimSchema = z.object({
  studentName: z.string().trim().min(2).max(100),
  studentPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/, "Enter a valid 10–15 digit phone number"),
  courseId: z.string().min(1),
  // UPI UTRs are 12 digits; allow bank/UPI reference variants but keep it to plain alphanumerics.
  utr: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{10,30}$/, "Enter a valid UTR / payment reference (10–30 letters or digits)"),
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

// ---------- Partner ID cards ----------

// Photos are cropped and re-encoded in the browser (~50–150 KB); the cap keeps a crafted upload
// from bloating every card read. Base64 inflates by 4/3, so 700k chars ≈ 512 KB of image.
const cardPhoto = z
  .string()
  .max(700_000, "Photo is too large — please use an image under 500 KB")
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, "Photo must be a JPG, PNG or WebP image");

const cardSignature = z
  .string()
  .max(300_000, "Signature image is too large")
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, "Signature must be a PNG image");

const cardPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{10,17}$/, "Enter a valid 10–15 digit mobile number");

// The card's fonts only carry Latin glyphs, so anything else would print as blank boxes.
const cardName = z
  .string()
  .trim()
  .min(2, "Enter the full name")
  .max(40, "Name must be 40 characters or fewer")
  .regex(/^[A-Za-z][A-Za-z .'-]*$/, "Use English letters for the name as it should print on the card");

const cardLocation = z
  .string()
  .trim()
  .min(2, "Enter the location")
  .max(48, "Location must be 48 characters or fewer")
  .regex(/^[A-Za-z0-9 .,'()/-]+$/, "Use English letters for the location");

const cardDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "Use a valid date");

export const partnerCardRequestSchema = z.object({
  fullName: cardName,
  location: cardLocation,
  phone: cardPhone,
  photo: cardPhoto,
});

export const partnerCardPhotoSchema = z.object({ photo: cardPhoto });

export const partnerCardAdminUpdateSchema = z
  .object({
    fullName: cardName,
    role: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9 &.,'()/-]+$/, "Use English letters for the role"),
    location: cardLocation,
    email: z.string().trim().email().max(60),
    phone: cardPhone,
    validFrom: cardDate.nullable(),
    photo: cardPhoto,
    signature: cardSignature.nullable(),
    adminNote: z.string().trim().max(500).nullable(),
  })
  .partial();

export const partnerCardAdminIssueSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  location: cardLocation,
  validFrom: cardDate.optional(),
});

export const partnerCardReviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  adminNote: z.string().trim().max(500).optional(),
  validFrom: cardDate.optional(),
});

export const partnerCardStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
  adminNote: z.string().trim().max(500).optional(),
});
