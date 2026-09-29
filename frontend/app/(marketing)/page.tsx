import { BarChart3, GraduationCap, Globe2, Headset, LayoutGrid, Mail, PlayCircle, Settings, UserPlus } from "lucide-react";
import { BrandLogo } from "@/components/logo";
import {
  DemoLanguagePicker,
  DemoLanguageProvider,
  DemoPlatformPicker,
  DemoVideoPlayer,
} from "@/components/home/academy-demo";
import { CurvedArrow, HeroArtLeft, HeroArtRight } from "@/components/home/hero-decorations";

const STEPS = [
  { number: 1, icon: Globe2, title: "Language", subtitle: "Choose your language" },
  { number: 2, icon: LayoutGrid, title: "Platform", subtitle: "Pick a platform" },
  { number: 3, icon: PlayCircle, title: "Demo Video", subtitle: "Watch free demo" },
  { number: 4, icon: Mail, title: "Verify Email", subtitle: "Confirm your email" },
  { number: 5, icon: UserPlus, title: "Register", subtitle: "Create your account" },
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
                Pick your language and a platform, watch its free demo, confirm your email, and you&apos;re ready to
                create an account and unlock any course.
              </p>
            </div>

            {/* 4-step flow */}
            <div className="relative mx-auto mt-9 max-w-4xl">
              <div className="absolute left-[10%] right-[10%] top-5 h-px bg-border-strong sm:top-6" />
              <div className="relative grid grid-cols-5 gap-1 sm:gap-2">
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
                    <span className="mt-2 text-[11px] font-bold text-gold-500 sm:text-sm">{step.title}</span>
                    <span className="mt-0.5 hidden text-xs text-parchment-muted sm:block">{step.subtitle}</span>
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
            </div>

            {/* Platform cards (step 2) — the chosen platform's demo plays in the player below */}
            <div className="mx-auto mt-9 max-w-5xl">
              <h3 className="text-center text-base font-bold text-parchment sm:text-lg">Choose a platform</h3>
              <p className="mt-1 text-center text-xs text-parchment-muted sm:text-sm">Tap a platform to watch its free demo.</p>
              <div className="mt-4">
                <DemoPlatformPicker />
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
              Platform Demo Video
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-parchment-muted sm:text-base">
              See how we train you on the platform you chose — in your language.
            </p>
          </div>

          <div className="mt-8">
            <DemoVideoPlayer />
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
