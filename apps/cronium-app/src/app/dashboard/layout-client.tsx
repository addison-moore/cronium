"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Code,
  FileText,
  Menu,
  Server,
  Settings,
  UserCircle,
  X,
  MoonStar,
  Sun,
  LogOut,
  Terminal,
  ChevronLeft,
  GitFork,
  LayoutPanelTop,
  Zap,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@cronium/ui";
import { UserRole } from "@/shared/schema";
import { Logo } from "@cronium/ui";
import { useTheme } from "next-themes";
import { usePermissions } from "@/hooks/usePermissions";
import { SchedulerStatusBanner } from "@/components/system/SchedulerStatusBanner";
import type { User } from "next-auth";

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  user: User;
}

const navLabels = {
  dashboard: "Dashboard",
  events: "Events",
  workflows: "Workflows",
  logs: "Logs",
  servers: "Servers",
  tools: "Tools",
  settings: "Settings",
  console: "Console",
  admin: "Admin",
};

const roleLabels = {
  [UserRole.ADMIN]: "Administrator",
  [UserRole.USER]: "User",
};

export default function DashboardLayoutClient({
  children,
  user,
}: DashboardLayoutClientProps) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const pathname = usePathname();
  const { permissions } = usePermissions();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<string | undefined>(
    undefined,
  );

  // Only show the toggle UI after mounting to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
    setCurrentTheme(theme);
  }, [theme]);

  const toggleMobileNav = (): void => {
    setIsMobileNavOpen(!isMobileNavOpen);
  };

  const closeMobileNav = (): void => {
    setIsMobileNavOpen(false);
  };

  const toggleTheme = (): void => {
    if (currentTheme === "dark") {
      setTheme("light");
      setCurrentTheme("light");
    } else {
      setTheme("dark");
      setCurrentTheme("dark");
    }
  };

  const navItems = [
    {
      name: navLabels.dashboard,
      href: "/dashboard",
      icon: <LayoutPanelTop className="h-5 w-5 rotate-180" />,
    },
    {
      name: navLabels.events,
      href: "/dashboard/events",
      icon: <Code className="h-5 w-5" />,
    },
    {
      name: navLabels.workflows,
      href: "/dashboard/workflows",
      icon: <GitFork className="h-5 w-5 rotate-90" />,
    },
    {
      name: navLabels.logs,
      href: "/dashboard/logs",
      icon: <FileText className="h-5 w-5" />,
    },
    {
      name: navLabels.servers,
      href: "/dashboard/servers",
      icon: <Server className="h-5 w-5" />,
    },
    {
      name: navLabels.tools,
      href: "/dashboard/tools",
      icon: <Zap className="h-5 w-5" />,
    },
    {
      name: navLabels.settings,
      href: "/dashboard/settings",
      icon: <Settings className="h-5 w-5" />,
    },
    {
      name: navLabels.console,
      href: "/dashboard/console",
      icon: <Terminal className="h-5 w-5" />,
      permission: "console",
    },
    {
      name: navLabels.admin,
      href: "/dashboard/admin",
      icon: <UserCircle className="h-5 w-5" />,
      role: UserRole.ADMIN,
    },
  ];

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <SchedulerStatusBanner />
      {/* Mobile Navigation Toggle */}
      <div className="bg-secondary-bg border-border fixed top-0 right-0 left-0 z-30 flex h-16 items-center justify-between border-b px-4 shadow-sm md:hidden">
        <Link href="/dashboard">
          <Logo size="md" />
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="hover-theme-button"
            aria-label="Toggle theme"
          >
            {mounted &&
              (currentTheme === "dark" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <MoonStar className="h-5 w-5" />
              ))}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMobileNav}
            className="hover-theme-button"
            aria-label="Toggle navigation"
          >
            <Menu className="h-6 w-6" />
          </Button>
        </div>
      </div>

      {/* Mobile Navigation Overlay */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={closeMobileNav}
        />
      )}

      {/* Mobile Navigation Sidebar */}
      <div
        className={`bg-secondary-bg border-border fixed top-0 bottom-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out md:hidden ${
          isMobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } text-foreground flex flex-col border-r p-4 shadow-md`}
      >
        <div className="mb-8 flex items-center justify-between">
          <Link href="/dashboard">
            <Logo size="md" />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={closeMobileNav}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-grow overflow-y-auto">
          <ul className="space-y-2">
            {navItems.map((item) => {
              // Skip admin items for non-admin users
              if (
                item.role === UserRole.ADMIN &&
                user?.role !== UserRole.ADMIN
              ) {
                return null;
              }

              // Skip permission-based items for non-admin users without permission
              if (
                item.permission &&
                user?.role !== UserRole.ADMIN &&
                permissions &&
                !permissions[item.permission as keyof typeof permissions]
              ) {
                return null;
              }

              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    onClick={closeMobileNav}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors ${
                      isActive(item.href)
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="mr-3">{item.icon}</span>
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {user && (
          <div className="border-border mt-auto border-t pt-4">
            <Link
              href="/auth/signout"
              onClick={closeMobileNav}
              className="text-foreground hover:bg-muted flex items-center gap-2 rounded-md px-3 py-2 transition-colors"
            >
              <span className="mr-3">
                <LogOut className="h-5 w-5" />
              </span>
              Sign Out
            </Link>
          </div>
        )}
      </div>

      {/* Desktop Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 hidden flex-col md:flex ${isSidebarOpen ? "w-64" : "w-16"} bg-secondary-bg border-border text-foreground border-r shadow-sm transition-all duration-300`}
      >
        <div className="flex h-full flex-col">
          <div
            className={`border-border flex items-center border-b py-4 ${isSidebarOpen ? "ml-2 justify-between px-4" : "justify-center"}`}
          >
            {isSidebarOpen ? (
              <Link href="/dashboard">
                <Logo size="lg" />
              </Link>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="hover:bg-accent"
              aria-label={isSidebarOpen ? "Minimize sidebar" : "Expand sidebar"}
            >
              <ChevronLeft
                className={`h-4 w-4 transition-transform duration-300 ${isSidebarOpen ? "rotate-0" : "rotate-180"}`}
              />
            </Button>
          </div>
          <div className="flex-grow">
            <nav className="flex-1 overflow-y-auto border-none px-3 py-6">
              <ul className="space-y-2">
                {navItems.map((item) => {
                  // Skip admin items for non-admin users
                  if (
                    item.role === UserRole.ADMIN &&
                    user?.role !== UserRole.ADMIN
                  ) {
                    return null;
                  }

                  // Skip permission-based items for non-admin users without permission
                  if (
                    item.permission &&
                    user?.role !== UserRole.ADMIN &&
                    permissions &&
                    !permissions[item.permission as keyof typeof permissions]
                  ) {
                    return null;
                  }

                  return (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors ${
                          !isSidebarOpen ? "mx-auto justify-center" : ""
                        } ${
                          isActive(item.href)
                            ? "bg-primary text-primary-foreground font-medium"
                            : "text-foreground hover:bg-muted"
                        }`}
                        title={!isSidebarOpen ? item.name : undefined}
                      >
                        <span className={isSidebarOpen ? "mr-3" : ""}>
                          {item.icon}
                        </span>
                        {isSidebarOpen && item.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
          <div className="border-border mt-auto border-t p-4">
            <div
              className={`flex ${isSidebarOpen ? "justify-between" : "flex-col gap-2"} items-center`}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="hover-theme-button"
                aria-label="Toggle theme"
              >
                {mounted &&
                  (currentTheme === "dark" ? (
                    <Sun className="h-5 w-5" />
                  ) : (
                    <MoonStar className="h-5 w-5" />
                  ))}
              </Button>
            </div>
          </div>
        </div>

        {user && (
          <div
            className={`border-border border-t ${isSidebarOpen ? "p-4" : "py-4"}`}
          >
            <div
              className={`flex items-center ${isSidebarOpen ? "gap-3" : "justify-center"}`}
            >
              {isSidebarOpen && (
                <Link
                  href="/dashboard/settings#profile"
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <div className="flex-shrink-0">
                    {user.profileImageUrl ? (
                      <Image
                        src={user.profileImageUrl}
                        alt="User avatar"
                        width={32}
                        height={32}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-full">
                        <UserCircle className="text-muted-foreground h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {user.firstName ?? user.email ?? "User"}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {roleLabels[user.role] ?? "User"}
                    </p>
                  </div>
                </Link>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0"
                asChild
              >
                <Link href="/auth/signout">
                  <LogOut className="h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div
        className={`${isSidebarOpen ? "md:pl-64" : "md:pl-16"} bg-background min-h-screen pt-16 transition-all duration-300 md:pt-0`}
      >
        <main className="text-foreground p-4">{children}</main>
      </div>
    </div>
  );
}
