"use client";

import React from "react";
import Link from "next/link";
import { Github, Twitter, Mail, Heart } from "lucide-react";
import { Logo } from "@cronium/ui";

export default function Footer() {
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
              Product
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <Link
                  href="/features"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  href="/pricing"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  Pricing
                </Link>
              </li>
              <li>
                <Link
                  href="/changelog"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  Changelog
                </Link>
              </li>
              <li>
                <Link
                  href="/roadmap"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  Roadmap
                </Link>
              </li>
            </ul>
          </div>

          <div className="mb-10 break-inside-avoid">
            <h3 className="text-primary dark:text-secondary text-sm leading-6 font-bold">
              Documentation
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <Link
                  href="/docs"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  Getting Started
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/api"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  API Reference
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/examples"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  Examples
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/faq"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  FAQ
                </Link>
              </li>
            </ul>
          </div>

          <div className="mb-10 break-inside-avoid">
            <h3 className="text-primary dark:text-secondary text-sm leading-6 font-bold">
              Community
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <Link
                  href="/about"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  About
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  Contact
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="hover:text-primary dark:hover:text-secondary text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>

          <div className="mb-10 break-inside-avoid">
            <h3 className="text-primary dark:text-secondary text-sm leading-6 font-bold">
              Connect
            </h3>
            <ul role="list" className="mt-4 space-y-3">
              <li>
                <a
                  href="https://github.com/addison-moore/cronium"
                  className="hover:text-primary dark:hover:text-secondary flex items-center text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  <Github className="mr-2 h-4 w-4" />
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://twitter.com/cronium"
                  className="hover:text-primary dark:hover:text-secondary flex items-center text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  <Twitter className="mr-2 h-4 w-4" />
                  Twitter
                </a>
              </li>
              <li>
                <a
                  href="mailto:support@cronium.app"
                  className="hover:text-primary dark:hover:text-secondary flex items-center text-sm leading-6 text-gray-600 dark:text-gray-400"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Contact Us
                </a>
              </li>
            </ul>
          </div>
        </nav>

        <div className="mt-5 flex flex-col items-center justify-between pt-2 md:flex-row">
          <p className="mb-4 text-xs leading-5 text-gray-600 md:mb-0 dark:text-gray-400">
            © {new Date().getFullYear()} Cronium. All rights reserved.
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
