"use client";

import React from "react";
import Link from "next/link";
import { Github, Mail, Heart } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-secondary-bg border-border border-t">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <nav
          className="flex flex-wrap justify-center gap-x-8 gap-y-4 md:gap-x-16 lg:gap-x-24"
          aria-label="Footer"
        >
          <div>
            <h3 className="text-primary dark:text-secondary text-sm font-bold">
              Documentation
            </h3>
            <ul role="list" className="mt-2 space-y-2">
              <li>
                <Link
                  href="/docs"
                  className="hover:text-primary dark:hover:text-secondary text-sm text-gray-600 dark:text-gray-400"
                >
                  Getting Started
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/api"
                  className="hover:text-primary dark:hover:text-secondary text-sm text-gray-600 dark:text-gray-400"
                >
                  API Reference
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-primary dark:text-secondary text-sm font-bold">
              Community
            </h3>
            <ul role="list" className="mt-2 space-y-2">
              <li>
                <Link
                  href="/about"
                  className="hover:text-primary dark:hover:text-secondary text-sm text-gray-600 dark:text-gray-400"
                >
                  About
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="hover:text-primary dark:hover:text-secondary text-sm text-gray-600 dark:text-gray-400"
                >
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-primary dark:text-secondary text-sm font-bold">
              Connect
            </h3>
            <ul role="list" className="mt-2 space-y-2">
              <li>
                <a
                  href="https://github.com/addison-moore/cronium"
                  className="hover:text-primary dark:hover:text-secondary flex items-center text-sm text-gray-600 dark:text-gray-400"
                >
                  <Github className="mr-2 h-4 w-4" />
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="mailto:support@cronium.app"
                  className="hover:text-primary dark:hover:text-secondary flex items-center text-sm text-gray-600 dark:text-gray-400"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Contact Us
                </a>
              </li>
            </ul>
          </div>
        </nav>

        <div className="border-border mt-6 flex flex-col items-center justify-between border-t pt-6 md:flex-row">
          <p className="mb-2 text-xs text-gray-600 md:mb-0 dark:text-gray-400">
            © {new Date().getFullYear()} Cronium. All rights reserved.
          </p>
          <p className="flex items-center text-xs text-gray-600 dark:text-gray-400">
            Made with <Heart className="mx-1 h-3 w-3 text-red-500" /> for
            developers everywhere
          </p>
        </div>
      </div>
    </footer>
  );
}
