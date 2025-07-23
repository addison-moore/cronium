"use client";

import React from "react";
import Link from "next/link";
import { Github, Twitter, Mail, Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/ui/logo";

export default function Footer({ lang = "en" }: { lang?: string }) {
  // Using a safer approach to load translations
  let translate;
  try {
    translate = useTranslations("Footer");
  } catch (error) {
    console.error("Translation error:", error);
    // Provide fallbacks if translations fail to load
    translate = (key: string) => {
      const fallbacks: Record<string, string> = {
        Product: "Product",
        Features: "Features",
        Pricing: "Pricing",
        Changelog: "Changelog",
        Roadmap: "Roadmap",
        Documentation: "Documentation",
        GettingStarted: "Getting Started",
        APIReference: "API Reference",
        Examples: "Examples",
        FAQ: "FAQ",
        Community: "Community",
        About: "About",
        Contact: "Contact",
        Privacy: "Privacy Policy",
        Terms: "Terms of Service",
        Connect: "Connect",
        GitHub: "GitHub",
        Twitter: "Twitter",
        ContactUs: "Contact Us",
        Copyright: "All rights reserved.",
        MadeWith: "Made with love for developers everywhere",
      };
      return fallbacks[key] ?? key;
    };
  }

  return (
    <footer className="bg-secondary-bg border-border border-t">
      <div className="mx-auto max-w-7xl overflow-hidden px-6 pt-12 pb-4 sm:py-12 lg:px-8">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>

        <nav
          className="columns-2 pb-4 sm:columns-3 sm:gap-8 md:columns-4"
          aria-label="Footer"
        >
          <div className="mb-10 break-inside-avoid">
            <h3 className="text-primary dark:text-secondary text-sm leading-6 font-bold">
              {translate("Product")}
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <Link
                  href={`/${lang}/features`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("Features")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/pricing`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("Pricing")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/changelog`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("Changelog")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/roadmap`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("Roadmap")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="mb-10 break-inside-avoid">
            <h3 className="text-primary dark:text-secondary text-sm leading-6 font-bold">
              {translate("Documentation")}
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <Link
                  href={`/${lang}/docs`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("GettingStarted")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/docs/api`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("APIReference")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/docs/examples`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("Examples")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/docs/faq`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("FAQ")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="mb-10 break-inside-avoid">
            <h3 className="text-primary dark:text-secondary text-sm leading-6 font-bold">
              {translate("Community")}
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <Link
                  href={`/${lang}/about`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("About")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/contact`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("Contact")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/privacy`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("Privacy")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/terms`}
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  {translate("Terms")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="mb-10 break-inside-avoid">
            <h3 className="text-primary dark:text-secondary text-sm leading-6 font-bold">
              {translate("Connect")}
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <a
                  href="https://github.com/addison-moore/cronium"
                  className="hover:text-primary dark:hover:text-secondary flex items-center text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  <Github className="mr-2 h-4 w-4" />
                  {translate("GitHub")}
                </a>
              </li>
              <li>
                <a
                  href="https://twitter.com/cronium"
                  className="hover:text-primary dark:hover:text-secondary flex items-center text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  <Twitter className="mr-2 h-4 w-4" />
                  {translate("Twitter")}
                </a>
              </li>
              <li>
                <a
                  href="mailto:support@cronium.app"
                  className="hover:text-primary dark:hover:text-secondary flex items-center text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  {translate("ContactUs")}
                </a>
              </li>
            </ul>
          </div>
        </nav>

        <div className="mt-5 flex flex-col items-center justify-between pt-2 md:flex-row">
          <p className="mb-4 text-xs leading-5 text-gray-600 md:mb-0 dark:text-gray-400">
            © {new Date().getFullYear()} Cronium. {translate("Copyright")}
          </p>
          <p className="flex items-center text-xs leading-5 text-gray-600 dark:text-gray-400">
            Made with <Heart className="mx-1 h-3 w-3 text-red-500" /> for
            developers everywhere
          </p>
        </div>
      </div>
    </footer>
  );
}
