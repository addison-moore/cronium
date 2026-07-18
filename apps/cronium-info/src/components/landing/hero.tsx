"use client";

import React from "react";
import Link from "next/link";
import { CheckCircle } from "lucide-react";

export default function Hero() {
  return (
    <div className="dark:from-background dark:to-card relative overflow-hidden bg-gradient-to-b from-white to-gray-100 pt-10 pb-16">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p
            className="animate-fadeIn text-muted-foreground mb-4 text-sm font-semibold tracking-wide uppercase"
            style={{ animationDelay: "0.05s" }}
          >
            Open source · Self-hosted · AGPL-3.0
          </p>
          <h1
            className="animate-fadeIn text-foreground text-4xl font-bold tracking-tight sm:text-6xl"
            style={{ animationDelay: "0.1s" }}
          >
            <span className="text-link">Cronium</span> is a self-hosted
            automation platform
          </h1>
          <p
            className="animate-fadeIn text-foreground mt-6 text-lg leading-8"
            style={{ animationDelay: "0.3s" }}
          >
            Schedule Python, Node.js, and Bash scripts. Chain them into
            multi-step workflows with conditional logic. Run everything in
            isolated containers or on your own servers over SSH — on
            infrastructure you control.
          </p>
          <div
            className="animate-fadeIn mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            style={{ animationDelay: "0.5s" }}
          >
            <Link
              href="/docs/self-hosting"
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-6 py-3 text-sm font-semibold shadow-sm transition-colors"
            >
              Deploy with Docker
            </Link>
            <Link
              href="/docs/quick-start"
              className="border-border text-foreground hover:bg-muted rounded-md border px-6 py-3 text-sm font-semibold transition-colors"
            >
              Quick start
            </Link>
            <Link
              href="/docs"
              className="hover:text-link text-foreground text-sm leading-6 font-semibold"
            >
              Read the docs <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <div className="mt-16">
          <div className="mx-auto mt-10 max-w-2xl sm:mt-12 lg:mt-16 lg:max-w-4xl">
            <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-10 lg:max-w-none lg:grid-cols-2 lg:gap-y-16">
              {features.map((feature) => (
                <div key={feature.name} className="relative pl-12">
                  <dt className="text-foreground text-lg leading-7 font-semibold">
                    <div className="bg-primary dark:bg-primary absolute top-1 left-0 flex h-8 w-8 items-center justify-center rounded-lg">
                      <feature.icon
                        className="text-primary-foreground h-5 w-5"
                        aria-hidden="true"
                      />
                    </div>
                    {feature.name}
                  </dt>
                  <dd className="text-muted-foreground mt-2 text-base leading-7">
                    {feature.description}
                  </dd>
                  <div className="mt-4">
                    {feature.benefits.map((benefit, i) => (
                      <div key={i} className="mt-2 flex items-center">
                        <CheckCircle className="text-secondary mr-2 h-4 w-4" />
                        <span className="text-muted-foreground text-sm">
                          {benefit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

const features = [
  {
    name: "Flexible Scheduling",
    icon: (props: React.SVGProps<SVGSVGElement>) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    ),
    description:
      "Schedule your scripts to run at specific times or intervals with precision and reliability.",
    benefits: [
      "Cron expressions or simple intervals",
      "Run on demand at any time",
      "Pause and resume any schedule",
      "Automatic retries with backoff",
    ],
  },
  {
    name: "Write Scripts in Any Language",
    icon: (props: React.SVGProps<SVGSVGElement>) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
    ),
    description:
      "Write automations in the language you already use, with a built-in editor and runtime helpers.",
    benefits: [
      "Python, Node.js, and Bash",
      "Or call any HTTP endpoint",
      "Pass data between steps",
      "Isolated container execution",
    ],
  },
  {
    name: "Remote Execution",
    icon: (props: React.SVGProps<SVGSVGElement>) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
        <line x1="6" y1="6" x2="6.01" y2="6"></line>
        <line x1="6" y1="18" x2="6.01" y2="18"></line>
      </svg>
    ),
    description:
      "Run scripts on remote servers via secure SSH connections with credential management.",
    benefits: [
      "SSH key authentication",
      "Multi-server execution",
      "Health checks and monitoring",
      "Secure credential storage",
    ],
  },
  {
    name: "Comprehensive Monitoring",
    icon: (props: React.SVGProps<SVGSVGElement>) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
      </svg>
    ),
    description:
      "Detailed logs and notifications to keep track of your script executions and errors.",
    benefits: [
      "Real-time streaming logs",
      "Success and failure notifications",
      "Full execution history",
      "Alerts to Slack, Discord, or email",
    ],
  },
];
