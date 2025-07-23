"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Terminal, CheckCircle } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useTranslations } from "next-intl";

export default function Hero({ lang = "en" }: { lang?: string }) {
  // Try to use next-intl's useTranslations first (this is server-side ready)
  let t: (key: string) => string;
  try {
    const intlT = useTranslations();
    t = (key: string) => {
      try {
        return intlT(key);
      } catch {
        return key;
      }
    };
  } catch {
    // Fallback to our custom useLanguage if next-intl context is not available
    const { t: langT } = useLanguage();
    t = langT;
  }
  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-white to-gray-100 pt-10 pb-16 dark:from-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1
            className="animate-fadeIn text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl dark:text-white"
            style={{ animationDelay: "0.1s" }}
          >
            <span className="text-primary dark:text-secondary">
              {t("Home.Hero.Title")}
            </span>
          </h1>
          <p
            className="animate-fadeIn mt-6 text-lg leading-8 text-gray-700 dark:text-gray-200"
            style={{ animationDelay: "0.3s" }}
          >
            {t("Home.Hero.Subtitle")}
          </p>
          <div
            className="animate-fadeIn mt-10 flex items-center justify-center gap-x-6"
            style={{ animationDelay: "0.5s" }}
          >
            <Link href={`/${lang}/auth/signup`}>
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90 text-primary-foreground rounded-full px-8 font-semibold"
              >
                {t("Home.Hero.ButtonPrimary")}{" "}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link
              href={`/${lang}/docs`}
              className="hover:text-primary dark:hover:text-secondary text-sm leading-6 font-semibold text-gray-700 dark:text-gray-200"
            >
              {t("Home.Hero.ButtonSecondary")} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <div
          className="animate-fadeInUp mt-16 flow-root sm:mt-24"
          style={{ animationDelay: "0.7s" }}
        >
          <div className="-m-2 rounded-xl bg-gray-100 p-2 ring-1 ring-gray-300 ring-inset lg:-m-4 lg:rounded-2xl lg:p-4 dark:bg-gray-800 dark:ring-gray-700">
            <div className="rounded-md bg-white shadow-2xl ring-1 ring-gray-900/10 dark:bg-gray-900 dark:ring-gray-700/30">
              <div className="flex items-center gap-1 rounded-t-md bg-zinc-800 p-2">
                <div className="h-3 w-3 rounded-full bg-red-500"></div>
                <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
                <div className="h-3 w-3 rounded-full bg-green-500"></div>
                <div className="ml-4 text-xs text-gray-300">
                  Cronium Dashboard
                </div>
              </div>
              <div className="border border-gray-200 px-6 py-10 dark:border-gray-700">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 bg-gray-100 p-6 dark:border-gray-700 dark:bg-gray-800">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                        Daily Database Backup
                      </h3>
                      <span className="rounded-full border border-green-200 bg-green-100 px-2 py-1 text-xs text-green-600 dark:border-green-800 dark:bg-green-900 dark:text-green-400">
                        Active
                      </span>
                    </div>
                    <div className="mb-4 flex items-center space-x-3 text-sm text-gray-600 dark:text-gray-300">
                      <div>Schedule: Every day at 03:00 AM</div>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-white p-3 font-mono text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                      <div className="mb-1 flex items-center gap-2 text-green-600 dark:text-green-400">
                        <Terminal className="h-3 w-3" />
                        <span>Last execution: Success (2m 34s)</span>
                      </div>
                      <div>
                        # Backup script for postgres database
                        <br />
                        pg_dump -U postgres -d myapp &gt; /backups/myapp_$(date
                        +%Y%m%d).sql
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-100 p-6 dark:border-gray-700 dark:bg-gray-800">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                        Server Monitoring
                      </h3>
                      <span className="rounded-full border border-green-200 bg-green-100 px-2 py-1 text-xs text-green-600 dark:border-green-800 dark:bg-green-900 dark:text-green-400">
                        Active
                      </span>
                    </div>
                    <div className="mb-4 flex items-center space-x-3 text-sm text-gray-600 dark:text-gray-300">
                      <div>Schedule: Every 5 minutes</div>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-white p-3 font-mono text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                      <div className="mb-1 flex items-center gap-2 text-green-600 dark:text-green-400">
                        <Terminal className="h-3 w-3" />
                        <span>Last execution: Success (0m 12s)</span>
                      </div>
                      <div>
                        # Check server health and send alerts
                        <br />
                        free -m | grep Mem | grep "Memory Usage"
                        <br /># Send alert if memory usage is above 90%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-primary dark:text-secondary text-base leading-7 font-semibold">
              {t("Home.Features.Title")}
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white">
              {t("Home.Features.Subtitle")}
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-2xl sm:mt-12 lg:mt-16 lg:max-w-4xl">
            <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-10 lg:max-w-none lg:grid-cols-2 lg:gap-y-16">
              {features.map((feature) => (
                <div key={feature.name} className="relative pl-12">
                  <dt className="text-lg leading-7 font-semibold text-gray-900 dark:text-white">
                    <div className="bg-primary dark:bg-primary absolute top-1 left-0 flex h-8 w-8 items-center justify-center rounded-lg">
                      <feature.icon
                        className="text-primary-foreground h-5 w-5"
                        aria-hidden="true"
                      />
                    </div>
                    {feature.name}
                  </dt>
                  <dd className="mt-2 text-base leading-7 text-gray-600 dark:text-gray-400">
                    {feature.description}
                  </dd>
                  <div className="mt-4">
                    {feature.benefits.map((benefit, i) => (
                      <div key={i} className="mt-2 flex items-center">
                        <CheckCircle className="text-secondary dark:text-secondary mr-2 h-4 w-4" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {benefit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

const features = [
  {
    name: "Flexible Scheduling",
    icon: (props: React.SVGProps<SVGSVGElement>) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    ),
    description:
      "Schedule your scripts to run at specific times or intervals with precision and reliability.",
    benefits: [
      "Cron-style scheduling syntax",
      "Custom interval options",
      "Timezone support for global teams",
      "Run scripts on demand",
    ],
  },
  {
    name: "Multiple Language Support",
    icon: (props: React.SVGProps<SVGSVGElement>) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
    ),
    description:
      "Support for multiple programming languages to automate all your workflows seamlessly.",
    benefits: [
      "JavaScript & TypeScript",
      "Python scripts",
      "Bash shell scripts",
      "Version control integration",
    ],
  },
  {
    name: "Remote Execution",
    icon: (props: React.SVGProps<SVGSVGElement>) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
        <line x1="6" y1="6" x2="6.01" y2="6"></line>
        <line x1="6" y1="18" x2="6.01" y2="18"></line>
      </svg>
    ),
    description:
      "Run scripts on remote servers via secure SSH connections with credential management.",
    benefits: [
      "SSH key authentication",
      "Multiple server management",
      "Health checks and monitoring",
      "Secure credential storage",
    ],
  },
  {
    name: "Comprehensive Monitoring",
    icon: (props: React.SVGProps<SVGSVGElement>) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
      </svg>
    ),
    description:
      "Detailed logs and notifications to keep track of your script executions and errors.",
    benefits: [
      "Real-time execution logs",
      "Success/failure notifications",
      "Performance analytics",
      "Error tracking and alerting",
    ],
  },
];
