import React from "react";
import Navbar from "@/components/landing/navbar";
import Hero from "@/components/landing/hero";
import Features from "@/components/landing/Features";
import Footer from "@/components/landing/footer";
import { Button } from "@cronium/ui";
import Link from "next/link";

// Enable Partial Prerendering for this page
export const experimental_ppr = true;

// ISR configuration - revalidate every 6 hours
export const revalidate = 21600; // 6 hours
export const dynamic = "force-static";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col pt-16">
      <Navbar />

      <main className="flex-grow">
        {/* Hero Section */}
        <Hero />

        {/* How It Works Section */}
        <section id="how-it-works" className="bg-muted py-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-12 text-center">
              <h2 className="text-foreground text-3xl font-bold">
                How It Works
              </h2>
              <p className="text-muted-foreground mx-auto mt-4 max-w-2xl">
                Get started with Cronium in three simple steps
              </p>
            </div>

            <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="bg-primary/10 dark:bg-primary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <span className="text-primary text-xl font-bold">1</span>
                </div>
                <h3 className="text-foreground mb-2 text-xl font-semibold">
                  Create Your Events
                </h3>
                <p className="text-muted-foreground">
                  Write your code or set up HTTP requests to perform tasks. Use
                  any supported programming language.
                </p>
              </div>

              <div className="text-center">
                <div className="bg-secondary/20 dark:bg-secondary/30 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <span className="text-secondary text-xl font-bold">2</span>
                </div>
                <h3 className="text-foreground mb-2 text-xl font-semibold">
                  Set Up Schedules
                </h3>
                <p className="text-muted-foreground">
                  Choose when and how often your events should run using
                  flexible scheduling options.
                </p>
              </div>

              <div className="text-center">
                <div className="bg-primary/10 dark:bg-primary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <span className="text-primary text-xl font-bold">3</span>
                </div>
                <h3 className="text-foreground mb-2 text-xl font-semibold">
                  Monitor Execution
                </h3>
                <p className="text-muted-foreground">
                  Track performance with detailed logs and receive notifications
                  for success or failure.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <Features />

        {/* CTA Section */}
        <section className="bg-background py-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="from-primary to-secondary rounded-xl bg-gradient-to-r px-8 py-12 text-center text-white shadow-lg md:px-12 md:py-16">
              <h2 className="mb-4 text-3xl font-bold">
                Ready to start automating?
              </h2>
              <p className="mx-auto mb-4 max-w-2xl">
                Sign up for free and start building your first automation in
                minutes.
              </p>
              <p className="mx-auto mb-8 max-w-2xl text-gray-100">
                Join our growing community of developers to share insights and
                automation recipes.
              </p>
              <div className="flex flex-col justify-center gap-4 sm:flex-row">
                <Link
                  href="https://github.com/addison-moore/cronium"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/30 bg-white/10 px-8 font-semibold text-white hover:bg-white/20"
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
                    Star on GitHub
                  </Button>
                </Link>
                <Link href="/docs">
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/30 bg-white/10 px-8 font-semibold text-white hover:bg-white/20"
                  >
                    Read the Docs
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
