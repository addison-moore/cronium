"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Menu, X, Book, Github } from "lucide-react";
import { Logo } from "@cronium/ui";

export default function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <nav className="bg-secondary-bg border-border sticky top-0 z-50 border-b shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between">
          <div className="flex">
            <div className="flex flex-shrink-0 items-center">
              <Link href="/" className="flex items-center">
                <Logo size="md" />
              </Link>
            </div>
          </div>

          {/* Desktop navigation - right side */}
          <div className="hidden items-center sm:flex sm:space-x-4">
            <Link
              href="/docs"
              className="hover:text-primary dark:hover:text-secondary flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
            >
              <Book className="h-4 w-4" />
              Docs
            </Link>

            <Link
              href="https://github.com/addison-moore/cronium"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary dark:hover:text-secondary flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
            >
              <Github className="h-5 w-5" />
            </Link>
          </div>
        </div>

        {/* Mobile menu button */}
        <div className="flex items-center sm:hidden">
          <button
            onClick={toggleMenu}
            className="text-primary dark:text-secondary hover:text-primary-foreground hover:bg-secondary dark:hover:bg-primary focus:ring-primary dark:focus:ring-secondary inline-flex items-center justify-center rounded-md p-2 focus:ring-2 focus:outline-none"
          >
            <span className="sr-only">
              {isMenuOpen ? "Close menu" : "Open menu"}
            </span>
            {isMenuOpen ? (
              <X className="block h-6 w-6" aria-hidden="true" />
            ) : (
              <Menu className="block h-6 w-6" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu, show/hide based on menu state */}
      <div className={`sm:hidden ${isMenuOpen ? "block" : "hidden"}`}>
        <div className="border-border space-y-1 border-t bg-white px-2 pt-2 pb-3 dark:bg-slate-950">
          <Link
            href="/docs"
            className="hover:text-primary dark:hover:text-secondary flex items-center gap-1 rounded-md px-3 py-2 text-base font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-slate-900"
            onClick={() => setIsMenuOpen(false)}
          >
            <Book className="h-4 w-4" />
            Docs
          </Link>
          <Link
            href="https://github.com/addison-moore/cronium"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary dark:hover:text-secondary flex items-center gap-1 rounded-md px-3 py-2 text-base font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-slate-900"
            onClick={() => setIsMenuOpen(false)}
          >
            <Github className="h-5 w-5" />
            GitHub
          </Link>
        </div>
      </div>
    </nav>
  );
}
