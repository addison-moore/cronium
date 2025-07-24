"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Menu, X, ChevronDown, Book } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cronium/ui";
import { Button } from "@cronium/ui";
import { useTranslations } from "next-intl";
import { Logo } from "@cronium/ui";

export default function Navbar({ lang }: { lang: string }) {
  const t = useTranslations();
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
              <Link href={`/${lang}`} className="flex items-center">
                <Logo size="md" />
              </Link>
            </div>

            {/* Desktop navigation */}
            <div className="hidden items-center sm:ml-6 sm:flex sm:space-x-4">
              <Link
                href={`/${lang}`}
                className="hover:text-primary dark:hover:text-secondary px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
              >
                {t("Nav.Home")}
              </Link>
              <Link
                href={`/${lang}/docs`}
                className="hover:text-primary dark:hover:text-secondary flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
              >
                <Book className="h-4 w-4" />
                {t("Nav.Documentation")}
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="hover:text-primary dark:hover:text-secondary flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-slate-900"
                  >
                    {t("Nav.Resources")}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="border-gray-200 bg-white shadow-md dark:border-gray-800 dark:bg-slate-950">
                  <DropdownMenuItem className="hover:text-primary dark:hover:text-secondary text-gray-800 focus:bg-gray-100 focus:text-gray-900 dark:text-gray-200 dark:focus:bg-slate-900 dark:focus:text-white">
                    <Link href={`/${lang}/docs/api`} className="flex w-full">
                      {t("Nav.APIReference")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="hover:text-primary dark:hover:text-secondary text-gray-800 focus:bg-gray-100 focus:text-gray-900 dark:text-gray-200 dark:focus:bg-slate-900 dark:focus:text-white">
                    <Link
                      href={`/${lang}/docs/examples`}
                      className="flex w-full"
                    >
                      {t("Nav.Examples")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="hover:text-primary dark:hover:text-secondary text-gray-800 focus:bg-gray-100 focus:text-gray-900 dark:text-gray-200 dark:focus:bg-slate-900 dark:focus:text-white">
                    <Link href={`/${lang}/docs/faq`} className="flex w-full">
                      {t("Nav.FAQ")}
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
      </div>

      {/* Mobile menu, show/hide based on menu state */}
      <div className={`sm:hidden ${isMenuOpen ? "block" : "hidden"}`}>
        <div className="border-border space-y-1 border-t bg-white px-2 pt-2 pb-3 dark:bg-slate-950">
          <Link
            href={`/${lang}`}
            className="hover:text-primary dark:hover:text-secondary block rounded-md px-3 py-2 text-base font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-slate-900"
            onClick={() => setIsMenuOpen(false)}
          >
            {t("Nav.Home")}
          </Link>

          <Link
            href={`/${lang}/docs`}
            className="hover:text-primary dark:hover:text-secondary block flex items-center gap-1 rounded-md px-3 py-2 text-base font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-slate-900"
            onClick={() => setIsMenuOpen(false)}
          >
            <Book className="h-4 w-4" />
            {t("Nav.Documentation")}
          </Link>
          <div className="block rounded-md px-3 py-2 text-base font-medium text-gray-800 dark:text-gray-200">
            <div className="flex items-center justify-between">
              <span>{t("Nav.Resources")}</span>
            </div>
            <div className="mt-2 space-y-1 pl-4">
              <Link
                href={`/${lang}/docs/api`}
                className="hover:text-primary dark:hover:text-secondary block rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-900"
                onClick={() => setIsMenuOpen(false)}
              >
                {t("Nav.APIReference")}
              </Link>
              <Link
                href={`/${lang}/docs/examples`}
                className="hover:text-primary dark:hover:text-secondary block rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-900"
                onClick={() => setIsMenuOpen(false)}
              >
                {t("Nav.Examples")}
              </Link>
              <Link
                href={`/${lang}/docs/faq`}
                className="hover:text-primary dark:hover:text-secondary block rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-900"
                onClick={() => setIsMenuOpen(false)}
              >
                {t("Nav.FAQ")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
