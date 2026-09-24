import Link from "next/link";
import { ArrowRight, BarChart3, GraduationCap, Globe2, Headset, Mail, PlayCircle, Settings, ShoppingBag } from "lucide-react";
import { BrandLogo } from "@/components/logo";
import { DemoLanguagePicker, DemoLanguageProvider, DemoVideoPlayer } from "@/components/home/academy-demo";
import { CurvedArrow, HeroArtLeft, HeroArtRight } from "@/components/home/hero-decorations";

const STEPS = [
  { number: 1, icon: Globe2, title: "Language", subtitle: "Choose your language" },
  { number: 2, icon: PlayCircle, title: "Demo Video", subtitle: "Watch free demo" },
  { number: 3, icon: Mail, title: "Verify Email", subtitle: "Confirm your email" },
  { number: 4, icon: Settings, title: "Go to Process", subtitle: "Start next process" },
];

const PLATFORMS = [
  { name: "meesho", wrapper: "bg-[#f43397]", label: "text-white" },
  { name: "amazon", wrapper: "bg-[#131921]", label: "text-white" },
  { name: "Flipkart", wrapper: "bg-[#fbd000]", label: "text-[#1d4ed8]" },
  { name: "shopify", wrapper: "bg-white border border-border-soft", label: "text-[#0f172a]" },
];

const FEATURES = [
  { icon: GraduationCap, title: "Expert Trainers", subtitle: "Learn from industry experts" },
  { icon: Settings, title: "Practical Training", subtitle: "Hands-on live projects" },
  { icon: BarChart3, title: "Analytics", subtitle: "Track your growth" },
  { icon: Headset, title: "Lifetime Support", subtitle: "Get guidance anytime" },
];

export default function HomePage() {
  return (
    <DemoLanguageProvider>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-gold-100/70 via-ink to-ink pb-10 pt-10 sm:pb-14 sm:pt-12">
        <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-gold-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-0 h-80 w-80 rounded-full bg-gold-400/10 blur-3xl" />

        {/* Decorative side art — desktop only, purely decorative */}
        <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-full xl:block">
          <div className="container-academy relative h-full">
            <div className="absolute left-2 top-4 w-56">
              <p className="font-hand -rotate-6 text-[28px] font-semibold leading-tight text-parchment">
                Learn
                <br />
                E-Commerce
                <br />
                Step by Step
              </p>
              <CurvedArrow className="ml-8 mt-2 h-16 w-20" />
            </div>
            <HeroArtLeft className="absolute -left-16 bottom-4 w-[360px]" />

            <div className="absolute right-2 top-4 w-60 text-right">
              <p className="font-hand rotate-6 text-[28px] font-semibold leading-tight text-parchment">
                Build
                <br />
                Your Online
                <br />
                Business Today!
              </p>
              <CurvedArrow flip className="ml-auto mr-8 mt-2 h-16 w-20" />
            </div>
            <HeroArtRight className="absolute -right-12 bottom-4 w-[360px]" />
          </div>
        </div>

        <div className="container-academy relative">
          <div className="mx-auto max-w-3xl text-center xl:max-w-4xl">
            <BrandLogo className="mx-auto aspect-square w-[190px] sm:w-[215px] lg:w-[235px]" />

            <h1 className="font-display mt-4 text-[1.75rem] font-extrabold tracking-tight sm:text-4xl lg:text-[2.6rem]">
              <span className="text-gold-500">E-COMMERCE</span>{" "}
              <span className="text-parchment">TRAINING ACADEMY</span>
            </h1>
            <p className="mt-2 text-lg font-bold text-gold-500 sm:text-xl">
              Empowering Your Online Selling Journey
            </p>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-parchment-muted sm:text-base">
              Learn how to sell on Meesho, Amazon, Flipkart, Shopify, Dropshipping &amp; Meta Ads with practical
              training and expert guidance.
            </p>
          </div>
        </div>
      </section>

      {/* Get Started In Minutes */}
      <section id="get-started" className="scroll-mt-24 pb-14">
        <div className="container-academy">
          <div className="mx-auto max-w-6xl rounded-3xl bg-gold-100/60 p-6 sm:p-10">
            <div className="text-center">
              <h2 className="font-display text-2xl font-bold text-parchment sm:text-3xl lg:text-4xl">
                Get Started In Minutes
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm text-parchment-muted sm:text-base">
                Pick your language, preview the teaching style, confirm your email, and you&apos;re ready to create an
                account and unlock any course.
              </p>
            </div>

            {/* 4-step flow */}
            <div className="relative mx-auto mt-9 max-w-3xl">
              <div className="absolute left-[12%] right-[12%] top-5 h-px bg-border-strong sm:top-6" />
              <div className="relative grid grid-cols-4 gap-2">
                {STEPS.map((step) => (
                  <div key={step.number} className="flex flex-col items-center text-center">
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold sm:h-12 sm:w-12 sm:text-base ${
                        step.number === 1
                          ? "bg-gold-500 text-white shadow-md"
                          : "border-2 border-gold-500/40 bg-ink-elevated text-gold-500"
                      }`}
                    >
                      {step.number}
                    </span>
                    <step.icon className="mt-3 h-5 w-5 text-gold-500 sm:h-6 sm:w-6" />
                    <span className="mt-2 text-xs font-bold text-gold-500 sm:text-sm">{step.title}</span>
                    <span className="mt-0.5 text-[11px] text-parchment-muted sm:text-xs">{step.subtitle}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Language selector */}
            <div className="mx-auto mt-9 max-w-2xl">
              <h3 className="text-center text-base font-bold text-parchment sm:text-lg">
                Choose your preferred language
              </h3>
              <div className="mt-4">
                <DemoLanguagePicker />
              </div>

              <div className="mt-5 flex justify-center">
                <Link
                  href="/register"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-gold-400 to-gold-600 px-10 py-3.5 text-base font-semibold text-white shadow-[0_10px_24px_-8px_rgba(37,99,235,0.6)] transition hover:from-gold-hover hover:to-gold-500 sm:w-auto sm:min-w-[260px]"
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Watch & Learn */}
      <section id="demo" className="scroll-mt-24 pb-14">
        <div className="container-academy">
          <div className="mx-auto max-w-3xl text-center">
            <span className="badge-pill">Watch &amp; Learn</span>
            <h2 className="font-display mt-4 text-2xl font-bold text-parchment sm:text-3xl">
              E-Commerce Training Academy - Demo Video
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-parchment-muted sm:text-base">
              Watch the demo video below to understand how we train you on Meesho, Amazon, Flipkart, Dropshipping &amp;
              Meta Ads.
            </p>
          </div>

          <div className="mt-8">
            <DemoVideoPlayer />
          </div>
        </div>
      </section>

      {/* Learn On Top Platforms */}
      <section className="pb-14">
        <div className="container-academy">
          <div className="text-center">
            <span className="badge-pill">Learn On Top Platforms</span>
          </div>

          <div className="mx-auto mt-7 grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
            {PLATFORMS.map((p) => (
              <div
                key={p.name}
                className={`flex h-20 items-center justify-center rounded-2xl shadow-md transition hover:-translate-y-0.5 sm:h-24 ${p.wrapper}`}
              >
                <span className={`flex items-center gap-2 text-xl font-bold sm:text-2xl ${p.label}`}>
                  {p.name === "shopify" && <ShoppingBag className="h-5 w-5 text-[#95bf47]" />}
                  <span className={p.name === "meesho" ? "italic" : ""}>{p.name}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features — doubles as the "About" target of the navbar link */}
      <section id="about" className="scroll-mt-24 pb-16">
        <div className="container-academy">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-y-8 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border-soft">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex items-center gap-3 px-2 lg:justify-center lg:px-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold-100 text-gold-500">
                  <feature.icon className="h-6 w-6" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-parchment sm:text-base">{feature.title}</span>
                  <span className="block whitespace-nowrap text-xs text-parchment-muted sm:text-[13px]">
                    {feature.subtitle}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tagline strip */}
      <section className="bg-gradient-to-r from-gold-500 to-gold-600 py-5">
        <p className="container-academy text-center font-display text-base font-medium text-white sm:text-lg">
          &ldquo; Learn &nbsp;|&nbsp; Sell &nbsp;|&nbsp; Grow &nbsp;|&nbsp; Build Your Future &rdquo;
        </p>
      </section>
    </DemoLanguageProvider>
  );
}
