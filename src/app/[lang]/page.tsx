import React from "react";
import Navbar from "@/components/landing/navbar";
import Hero from "@/components/landing/hero";
import Features from "@/components/landing/Features";
import Footer from "@/components/landing/footer";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function Home({ params }: { params: { lang: string } }) {
  const { lang } = await Promise.resolve(params);

  // Get translations function for server component
  const t = (await import(`@/messages/${lang}.json`)).default;

  // Helper function to safely access nested translations
  const translate = (key: string) => {
    try {
      // Split key by dots and traverse the object
      return key.split(".").reduce((obj, part) => obj?.[part], t) || key;
    } catch (e) {
      return key;
    }
  };
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar lang={lang} />

      <main className="flex-grow">
        {/* Hero Section */}
        <Hero lang={lang} />

        {/* How It Works Section */}
        <section
          id="how-it-works"
          className="bg-gray-100 py-16 dark:bg-slate-900"
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {translate("Home.HowItWorks.Title")}
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-gray-600 dark:text-gray-400">
                {translate("Home.HowItWorks.Subtitle")}
              </p>
            </div>

            <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="bg-primary/10 dark:bg-primary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <span className="text-primary text-xl font-bold">1</span>
                </div>
                <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {translate("Home.HowItWorks.Step1.Title")}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {translate("Home.HowItWorks.Step1.Description")}
                </p>
              </div>

              <div className="text-center">
                <div className="bg-secondary/20 dark:bg-secondary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <span className="text-secondary-foreground dark:text-secondary-foreground text-xl font-bold">
                    2
                  </span>
                </div>
                <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {translate("Home.HowItWorks.Step2.Title")}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {translate("Home.HowItWorks.Step2.Description")}
                </p>
              </div>

              <div className="text-center">
                <div className="bg-primary/10 dark:bg-primary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <span className="text-primary text-xl font-bold">3</span>
                </div>
                <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {translate("Home.HowItWorks.Step3.Title")}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {translate("Home.HowItWorks.Step3.Description")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <Features />

        {/* CTA Section */}
        <section className="bg-white py-16 dark:bg-slate-950">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-8 py-12 text-center text-white shadow-lg md:px-12 md:py-16 dark:from-violet-700 dark:to-indigo-600">
              <h2 className="mb-4 text-3xl font-bold">
                {translate("Home.CTA.Title")}
              </h2>
              <p className="mx-auto mb-4 max-w-2xl">
                {translate("Home.CTA.Description")}
              </p>
              <p className="mx-auto mb-8 max-w-2xl text-gray-100">
                {translate("Home.CTA.Community")}
              </p>
              <div className="flex flex-col justify-center gap-4 sm:flex-row">
                <Link href={`/${lang}/auth/signup`}>
                  <Button
                    size="lg"
                    className="border-white bg-white px-8 font-semibold text-blue-600 hover:bg-gray-100 dark:text-violet-600"
                  >
                    {translate("Home.CTA.GetStarted")}{" "}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link
                  href="https://github.com/cronies/cronies"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/30 bg-blue-700/40 px-8 font-semibold text-white hover:bg-blue-700/50 dark:bg-violet-800/40 dark:hover:bg-violet-800/50"
                  >
                    <svg
                      className="mr-2 h-5 w-5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {translate("Home.CTA.GitHub")}
                  </Button>
                </Link>
                <Link href={`/${lang}/docs`}>
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/30 bg-blue-700/40 px-8 font-semibold text-white hover:bg-blue-700/50 dark:bg-violet-800/40 dark:hover:bg-violet-800/50"
                  >
                    {translate("Home.CTA.Documentation")}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer lang={lang} />
    </div>
  );
}
