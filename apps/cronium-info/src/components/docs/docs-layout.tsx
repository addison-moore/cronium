"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@cronium/ui";
import { ChevronDown, ChevronRight, Menu, X } from "lucide-react";
import Navbar from "@/components/landing/navbar";
import Footer from "@/components/landing/footer";

interface NavItem {
  title: string;
  href?: string;
  items?: NavItem[];
}

interface DocsLayoutProps {
  children: React.ReactNode;
  tableOfContents?: { title: string; href: string; level: number }[];
}

const navigationItems: NavItem[] = [
  {
    title: "Getting Started",
    items: [
      { title: "Self-Hosting", href: "/docs/self-hosting" },
      { title: "Quick Start", href: "/docs/quick-start" },
    ],
  },
  {
    title: "Features",
    items: [
      { title: "Overview", href: "/docs/features" },
      { title: "Runtime Helpers", href: "/docs/runtime-helpers" },
      { title: "Unified Input/Output", href: "/docs/unified-io" },
      { title: "Conditional Actions", href: "/docs/conditional-actions" },
      { title: "Tools", href: "/docs/tools" },
      { title: "Templates", href: "/docs/templates" },
    ],
  },
  {
    title: "API Reference",
    items: [{ title: "REST API", href: "/docs/api" }],
  },
  {
    title: "How-to Guides",
    items: [
      { title: "Overview", href: "/docs/how-to" },
      { title: "Create Your First Event", href: "/docs/how-to/first-event" },
    ],
  },
];

function NavSection({ item, level = 0 }: { item: NavItem; level?: number }) {
  const [isOpen, setIsOpen] = useState(true);
  const pathname = usePathname();

  if (item.items) {
    return (
      <div className="mb-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          {isOpen ? (
            <ChevronDown className="mr-2 h-4 w-4" />
          ) : (
            <ChevronRight className="mr-2 h-4 w-4" />
          )}
          {item.title}
        </button>
        {isOpen && (
          <div className="ml-4 space-y-1">
            {item.items.map((subItem, index) => (
              <NavSection key={index} item={subItem} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = pathname === item.href;

  return (
    <Link
      href={item.href ?? "#"}
      className={cn(
        "block rounded-md px-3 py-2 text-sm transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
      )}
    >
      {item.title}
    </Link>
  );
}

function TableOfContents({
  items,
}: {
  items: { title: string; href: string; level: number }[];
}) {
  if (!items || items.length === 0) return null;

  return (
    <aside className="hidden w-64 shrink-0 xl:block">
      <div className="p-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
            On this page
          </h3>
          <nav className="space-y-1">
            {items.map((item, index) => (
              <a
                key={index}
                href={item.href}
                className={cn(
                  "block py-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100",
                  item.level === 2
                    ? "pl-0"
                    : item.level === 3
                      ? "pl-4"
                      : "pl-8",
                )}
              >
                {item.title}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </aside>
  );
}

export default function DocsLayout({
  children,
  tableOfContents,
}: DocsLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen pt-16">
      <Navbar />

      <div className="flex">
        {/* Mobile sidebar overlay */}
        {isSidebarOpen && (
          <div
            className="bg-opacity-50 fixed inset-0 z-40 bg-black lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            "fixed top-16 left-0 z-40 h-[calc(100vh-4rem)] w-72 transform overflow-y-auto border-r border-gray-200 bg-white transition-transform duration-200 ease-in-out dark:border-gray-800 dark:bg-gray-900",
            "lg:fixed lg:z-10 lg:block lg:h-[calc(100vh-4rem)] lg:w-72 lg:translate-x-0",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="p-6 lg:px-8 lg:py-8">
            <div className="mb-6 flex items-center justify-between lg:hidden">
              <h2 className="text-lg font-semibold">Documentation</h2>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="rounded-md p-2 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="space-y-2">
              {navigationItems.map((item, index) => (
                <NavSection key={index} item={item} />
              ))}
            </nav>
          </div>
        </aside>

        {/* Main content area - offset by sidebar width on desktop */}
        <div className="min-w-0 flex-1 lg:ml-72">
          <div className="flex min-h-screen flex-col">
            {/* Main content */}
            <main className="flex-1">
              {/* Mobile menu button */}
              <div className="fixed top-20 left-4 z-30 lg:hidden">
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="rounded-md border border-gray-200 bg-white p-2 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </div>

              <div className="flex lg:gap-8 lg:px-8 lg:py-8">
                <div className="min-w-0 flex-1">
                  <div className="mx-auto max-w-4xl px-4 py-8 pb-16 sm:px-6 lg:px-0 lg:py-0 xl:mx-0 xl:max-w-none xl:pr-0">
                    {children}
                  </div>
                </div>

                {/* Table of contents */}
                {tableOfContents && <TableOfContents items={tableOfContents} />}
              </div>
            </main>

            <Footer />
          </div>
        </div>
      </div>
    </div>
  );
}
