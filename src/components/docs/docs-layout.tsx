"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
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
  lang: string;
  tableOfContents?: { title: string; href: string; level: number }[];
}

const navigationItems: NavItem[] = [
  {
    title: "Getting Started",
    items: [
      { title: "Quick Start", href: "/docs/quick-start" },
      { title: "Installation", href: "/docs/installation" },
      { title: "Configuration", href: "/docs/configuration" },
    ],
  },
  {
    title: "Features",
    items: [
      { title: "Overview", href: "/docs/features" },
      { title: "Events & Scripts", href: "/docs/events" },
      { title: "Workflows", href: "/docs/workflows" },
      { title: "Runtime Helpers", href: "/docs/runtime-helpers" },
      { title: "Unified Input/Output", href: "/docs/unified-io" },
      { title: "Conditional Actions", href: "/docs/conditional-actions" },
      { title: "Tools", href: "/docs/tools" },
      { title: "Templates", href: "/docs/templates" },
      { title: "Scheduling", href: "/docs/scheduling" },
      { title: "Remote Execution", href: "/docs/remote-execution" },
      { title: "Monitoring", href: "/docs/monitoring" },
    ],
  },
  {
    title: "API",
    items: [
      { title: "Authentication", href: "/docs/api/authentication" },
      { title: "Events", href: "/docs/api/events" },
      { title: "Workflows", href: "/docs/api/workflows" },
      { title: "Servers", href: "/docs/api/servers" },
      { title: "Users", href: "/docs/api/users" },
    ],
  },
  {
    title: "How-to",
    items: [
      { title: "Create Your First Event", href: "/docs/how-to/first-event" },
      { title: "Set Up SSH Connection", href: "/docs/how-to/ssh-setup" },
      { title: "Build a Workflow", href: "/docs/how-to/build-workflow" },
      {
        title: "Monitor Performance",
        href: "/docs/how-to/monitor-performance",
      },
      { title: "Deploy to Production", href: "/docs/how-to/deploy-production" },
      { title: "Troubleshooting", href: "/docs/how-to/troubleshooting" },
    ],
  },
];

function NavSection({
  item,
  lang,
  level = 0,
}: {
  item: NavItem;
  lang: string;
  level?: number;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const pathname = usePathname();

  if (item.items) {
    return (
      <div className="mb-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center w-full text-left py-2 px-3 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4 mr-2" />
          ) : (
            <ChevronRight className="h-4 w-4 mr-2" />
          )}
          {item.title}
        </button>
        {isOpen && (
          <div className="ml-4 space-y-1">
            {item.items.map((subItem, index) => (
              <NavSection
                key={index}
                item={subItem}
                lang={lang}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = pathname === `/${lang}${item.href}`;

  return (
    <Link
      href={`/${lang}${item.href}`}
      className={cn(
        "block py-2 px-3 text-sm rounded-md transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
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
    <aside className="hidden xl:block w-64 shrink-0">
      <div className="sticky top-24 p-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
          <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-3">
            On this page
          </h3>
          <nav className="space-y-1">
            {items.map((item, index) => (
              <a
                key={index}
                href={item.href}
                className={cn(
                  "block text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 py-1",
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
  lang,
  tableOfContents,
}: DocsLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar lang={lang} />

      <div className="flex-1 flex">
        {/* Mobile sidebar overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            "fixed top-16 left-0 z-50 w-72 h-[calc(100vh-4rem)] bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 overflow-y-auto transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)]",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-6 lg:hidden">
              <h2 className="text-lg font-semibold">Documentation</h2>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="space-y-2">
              {navigationItems.map((item, index) => (
                <NavSection key={index} item={item} lang={lang} />
              ))}
            </nav>
          </div>
        </aside>

        {/* Main content area with table of contents */}
        <div className="flex-1 flex lg:ml-0">
          {/* Main content */}
          <main className="flex-1 min-w-0">
            {/* Mobile menu button */}
            <div className="lg:hidden fixed top-20 left-4 z-30">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>

            <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto xl:max-w-none xl:mx-0 xl:pr-0">
              {children}
            </div>
          </main>

          {/* Table of contents */}
          {tableOfContents && <TableOfContents items={tableOfContents} />}
        </div>
      </div>

      <Footer lang={lang} />
    </div>
  );
}
