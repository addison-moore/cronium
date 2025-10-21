"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X, Book, Github, Moon, Sun } from "lucide-react";
import { Logo } from "@cronium/ui";
import { useTheme } from "@/components/theme-provider";

export default function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const toggleTheme = () => {
    // Toggle between light and dark (ignore system for manual toggle)
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <nav className="bg-secondary-bg border-border fixed top-0 right-0 left-0 z-50 border-b shadow-sm">
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
          <div className="hidden items-center md:flex md:space-x-4">
            <Link
              href="/docs"
              className="hover:text-primary dark:hover:text-secondary text-foreground flex items-center gap-1 px-3 py-2 text-sm font-medium"
            >
              <Book className="h-4 w-4" />
              Docs
            </Link>

            <Link
              href="https://github.com/addison-moore/cronium"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary dark:hover:text-secondary text-foreground flex items-center gap-1 px-3 py-2 text-sm font-medium"
            >
              <Github className="h-5 w-5" />
            </Link>

            {mounted && (
              <button
                onClick={toggleTheme}
                className="hover:text-primary dark:hover:text-secondary text-foreground flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium"
                aria-label="Toggle theme"
              >
                {theme === "dark" ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </button>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center md:hidden">
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
      <div className={`md:hidden ${isMenuOpen ? "block" : "hidden"}`}>
        <div className="border-border bg-secondary-bg space-y-1 border-t px-2 pt-2 pb-3">
          <Link
            href="/docs"
            className="hover:text-primary dark:hover:text-secondary text-foreground hover:bg-muted flex items-center gap-1 rounded-md px-3 py-2 text-base font-medium"
            onClick={() => setIsMenuOpen(false)}
          >
            <Book className="h-4 w-4" />
            Docs
          </Link>
          <Link
            href="https://github.com/addison-moore/cronium"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary dark:hover:text-secondary text-foreground hover:bg-muted flex items-center gap-1 rounded-md px-3 py-2 text-base font-medium"
            onClick={() => setIsMenuOpen(false)}
          >
            <Github className="h-5 w-5" />
            GitHub
          </Link>
          {mounted && (
            <button
              onClick={() => {
                toggleTheme();
                setIsMenuOpen(false);
              }}
              className="hover:text-primary dark:hover:text-secondary text-foreground hover:bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-base font-medium"
            >
              {theme === "dark" ? (
                <>
                  <Sun className="h-5 w-5" />
                  Light Mode
                </>
              ) : (
                <>
                  <Moon className="h-5 w-5" />
                  Dark Mode
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
