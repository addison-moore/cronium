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
      return fallbacks[key] || key;
    };
  }

  return (
    <footer className="bg-secondary-bg border-t border-border">
      <div className="mx-auto max-w-7xl overflow-hidden px-6 pt-12 pb-4 sm:py-12 lg:px-8">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        <nav
          className="columns-2 sm:columns-3 sm:gap-8 md:columns-4 pb-4"
          aria-label="Footer"
        >
          <div className="mb-10 break-inside-avoid">
            <h3 className="text-sm font-bold leading-6 text-primary dark:text-secondary">
              {translate("Product")}
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <Link
                  href={`/${lang}/features`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("Features")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/pricing`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("Pricing")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/changelog`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("Changelog")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/roadmap`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("Roadmap")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="mb-10 break-inside-avoid">
            <h3 className="text-sm font-bold leading-6 text-primary dark:text-secondary">
              {translate("Documentation")}
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <Link
                  href={`/${lang}/docs`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("GettingStarted")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/docs/api`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("APIReference")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/docs/examples`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("Examples")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/docs/faq`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("FAQ")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="mb-10 break-inside-avoid">
            <h3 className="text-sm font-bold leading-6 text-primary dark:text-secondary">
              {translate("Community")}
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <Link
                  href={`/${lang}/about`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("About")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/contact`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("Contact")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/privacy`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("Privacy")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/terms`}
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary"
                >
                  {translate("Terms")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="mb-10 break-inside-avoid">
            <h3 className="text-sm font-bold leading-6 text-primary dark:text-secondary">
              {translate("Connect")}
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <a
                  href="https://github.com/cronium"
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary flex items-center"
                >
                  <Github className="h-4 w-4 mr-2" />
                  {translate("GitHub")}
                </a>
              </li>
              <li>
                <a
                  href="https://twitter.com/cronium"
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary flex items-center"
                >
                  <Twitter className="h-4 w-4 mr-2" />
                  {translate("Twitter")}
                </a>
              </li>
              <li>
                <a
                  href="mailto:support@cronium.app"
                  className="text-sm leading-6 text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-secondary flex items-center"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  {translate("ContactUs")}
                </a>
              </li>
            </ul>
          </div>
        </nav>

        <div className="mt-5 flex flex-col md:flex-row justify-between items-center pt-2">
          <p className="text-xs leading-5 text-gray-600 dark:text-gray-400 mb-4 md:mb-0">
            © {new Date().getFullYear()} Cronium. {translate("Copyright")}
          </p>
          <p className="flex items-center text-xs leading-5 text-gray-600 dark:text-gray-400">
            Made with <Heart className="h-3 w-3 mx-1 text-red-500" /> for
            developers everywhere
          </p>
        </div>
      </div>
    </footer>
  );
}
