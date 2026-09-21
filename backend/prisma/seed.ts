import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { generateReferralCode } from "../lib/crypto";

// The 22 officially recognised (Eighth Schedule) Indian languages, plus English.
const LANGUAGES: { code: string; name: string; nativeName: string; displayOrder: number }[] = [
  { code: "en", name: "English", nativeName: "English", displayOrder: 0 },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", displayOrder: 1 },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া", displayOrder: 2 },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", displayOrder: 3 },
  { code: "brx", name: "Bodo", nativeName: "बड़ो", displayOrder: 4 },
  { code: "doi", name: "Dogri", nativeName: "डोगरी", displayOrder: 5 },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", displayOrder: 6 },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", displayOrder: 7 },
  { code: "ks", name: "Kashmiri", nativeName: "کٲشُر", displayOrder: 8 },
  { code: "kok", name: "Konkani", nativeName: "कोंकणी", displayOrder: 9 },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം", displayOrder: 10 },
  { code: "mni", name: "Manipuri (Meitei)", nativeName: "ꯃꯤꯇꯩꯂꯣꯟ", displayOrder: 11 },
  { code: "mr", name: "Marathi", nativeName: "मराठी", displayOrder: 12 },
  { code: "mai", name: "Maithili", nativeName: "मैथिली", displayOrder: 13 },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", displayOrder: 14 },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", displayOrder: 15 },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", displayOrder: 16 },
  { code: "sa", name: "Sanskrit", nativeName: "संस्कृतम्", displayOrder: 17 },
  { code: "sat", name: "Santali", nativeName: "ᱥᱟᱱᱛᱟᱲᱤ", displayOrder: 18 },
  { code: "sd", name: "Sindhi", nativeName: "سنڌي", displayOrder: 19 },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", displayOrder: 20 },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", displayOrder: 21 },
  { code: "ur", name: "Urdu", nativeName: "اردو", displayOrder: 22 },
];

async function seedLanguages() {
  for (const lang of LANGUAGES) {
    await prisma.language.upsert({
      where: { code: lang.code },
      update: { name: lang.name, nativeName: lang.nativeName, displayOrder: lang.displayOrder },
      create: lang,
    });
  }
  console.log(`Seeded ${LANGUAGES.length} languages.`);
}

async function main() {
  await seedLanguages();

  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const username = process.env.ADMIN_USERNAME?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !email || !username || !password) {
    throw new Error(
      "ADMIN_NAME, ADMIN_EMAIL, ADMIN_USERNAME, and ADMIN_PASSWORD must be set (in .env) to seed the admin account."
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let referralCode = generateReferralCode(email);
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.user.findUnique({ where: { referralCode } });
    if (!clash) break;
    referralCode = generateReferralCode(email + i);
  }

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN", name, username, passwordHash },
    create: {
      name,
      email,
      username,
      passwordHash,
      role: "ADMIN",
      referralCode,
      emailVerified: new Date(),
    },
  });

  console.log(`Admin account ready: ${admin.email} (username: ${admin.username})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
