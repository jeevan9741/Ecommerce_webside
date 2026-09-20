import Link from "next/link";
import { LogoMark } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-5 py-12">
      <Link href="/" className="mb-8">
        <LogoMark />
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
