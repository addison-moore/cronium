"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Menu, X, ChevronDown, Book, LogIn, UserPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/ui/logo";

export default function Navbar({ lang }: { lang: string }) {
  const t = useTranslations();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <nav className="bg-secondary-bg border-b border-border sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href={`/${lang}`} className="flex items-center">
                <Logo size="md" />
              </Link>
            </div>

            {/* Desktop navigation */}
            <div className="hidden sm:ml-6 sm:flex sm:space-x-4 items-center">
              <Link
                href={`/${lang}`}
                className="px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 hover:text-primary dark:hover:text-secondary"
              >
                {t("Nav.Home")}
              </Link>
              <Link
                href={`/${lang}/docs`}
                className="px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 hover:text-primary dark:hover:text-secondary flex items-center gap-1"
              >
                <Book className="h-4 w-4" />
                {t("Nav.Documentation")}
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="px-3 py-2 text-sm font-medium flex items-center gap-1 text-gray-800 dark:text-gray-200 hover:text-primary hover:bg-gray-100 dark:hover:text-secondary dark:hover:bg-slate-900"
                  >
                    {t("Nav.Resources")}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-white dark:bg-slate-950 border-gray-200 dark:border-gray-800 shadow-md">
                  <DropdownMenuItem className="text-gray-800 dark:text-gray-200 hover:text-primary dark:hover:text-secondary focus:bg-gray-100 dark:focus:bg-slate-900 focus:text-gray-900 dark:focus:text-white">
                    <Link href={`/${lang}/docs/api`} className="flex w-full">
                      {t("Nav.APIReference")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-gray-800 dark:text-gray-200 hover:text-primary dark:hover:text-secondary focus:bg-gray-100 dark:focus:bg-slate-900 focus:text-gray-900 dark:focus:text-white">
                    <Link
                      href={`/${lang}/docs/examples`}
                      className="flex w-full"
                    >
                      {t("Nav.Examples")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-gray-800 dark:text-gray-200 hover:text-primary dark:hover:text-secondary focus:bg-gray-100 dark:focus:bg-slate-900 focus:text-gray-900 dark:focus:text-white">
                    <Link href={`/${lang}/docs/faq`} className="flex w-full">
                      {t("Nav.FAQ")}
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Auth buttons */}
          <div className="hidden sm:ml-6 sm:flex sm:items-center gap-2">
            <Link href={`/${lang}/auth/signin`}>
              <Button
                variant="ghost"
                className="flex items-center gap-1 text-gray-800 dark:text-gray-200 hover:text-primary hover:bg-gray-100 dark:hover:text-secondary dark:hover:bg-slate-900"
              >
                <LogIn className="h-4 w-4" />
                {t("Auth.SignIn")}
              </Button>
            </Link>
            <Link href={`/${lang}/auth/signup`}>
              <Button
                variant="default"
                className="flex items-center gap-1 bg-primary hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90 text-primary-foreground"
              >
                <UserPlus className="h-4 w-4" />
                {t("Auth.SignUp")}
              </Button>
            </Link>
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center sm:hidden">
            <button
              onClick={toggleMenu}
              className="inline-flex items-center justify-center p-2 rounded-md text-primary dark:text-secondary hover:text-primary-foreground hover:bg-secondary dark:hover:bg-primary focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-secondary"
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
        <div className="px-2 pt-2 pb-3 space-y-1 bg-white dark:bg-slate-950 border-t border-border">
          <Link
            href={`/${lang}`}
            className="block px-3 py-2 rounded-md text-base font-medium text-gray-800 dark:text-gray-200 hover:text-primary hover:bg-gray-100 dark:hover:text-secondary dark:hover:bg-slate-900"
            onClick={() => setIsMenuOpen(false)}
          >
            {t("Nav.Home")}
          </Link>

          <Link
            href={`/${lang}/docs`}
            className="block px-3 py-2 rounded-md text-base font-medium text-gray-800 dark:text-gray-200 hover:text-primary hover:bg-gray-100 dark:hover:text-secondary dark:hover:bg-slate-900 flex items-center gap-1"
            onClick={() => setIsMenuOpen(false)}
          >
            <Book className="h-4 w-4" />
            {t("Nav.Documentation")}
          </Link>
          <div className="block px-3 py-2 rounded-md text-base font-medium text-gray-800 dark:text-gray-200">
            <div className="flex items-center justify-between">
              <span>{t("Nav.Resources")}</span>
            </div>
            <div className="pl-4 mt-2 space-y-1">
              <Link
                href={`/${lang}/docs/api`}
                className="block px-3 py-2 rounded-md text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:text-secondary dark:hover:bg-slate-900"
                onClick={() => setIsMenuOpen(false)}
              >
                {t("Nav.APIReference")}
              </Link>
              <Link
                href={`/${lang}/docs/examples`}
                className="block px-3 py-2 rounded-md text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:text-secondary dark:hover:bg-slate-900"
                onClick={() => setIsMenuOpen(false)}
              >
                {t("Nav.Examples")}
              </Link>
              <Link
                href={`/${lang}/docs/faq`}
                className="block px-3 py-2 rounded-md text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:text-secondary dark:hover:bg-slate-900"
                onClick={() => setIsMenuOpen(false)}
              >
                {t("Nav.FAQ")}
              </Link>
            </div>
          </div>
          <div className="pt-4 flex flex-col space-y-2">
            <Link
              href={`/${lang}/auth/signin`}
              onClick={() => setIsMenuOpen(false)}
            >
              <Button
                variant="outline"
                className="w-full flex items-center justify-center gap-1 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-slate-900 hover:text-primary dark:hover:text-secondary"
              >
                <LogIn className="h-4 w-4" />
                {t("Auth.SignIn")}
              </Button>
            </Link>
            <Link
              href={`/${lang}/auth/signup`}
              onClick={() => setIsMenuOpen(false)}
            >
              <Button
                variant="default"
                className="w-full flex items-center justify-center gap-1 bg-primary hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90 text-primary-foreground"
              >
                <UserPlus className="h-4 w-4" />
                {t("Auth.SignUp")}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
