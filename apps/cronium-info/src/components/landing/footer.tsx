"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Github, Mail, Heart, X } from "lucide-react";
import {
  Input,
  Textarea,
  Button,
  Label,
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@cronium/ui";

interface ContactFormModalProps {
  open: boolean;
  onClose: () => void;
}

function ContactFormModal({ open, onClose }: ContactFormModalProps) {
  const [subject, setSubject] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");

  if (!open) return null;

  const resetForm = () => {
    setSubject("");
    setEmail("");
    setMessage("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("idle");
    setStatusMessage("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subject, email, message }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Unable to send message.");
      }

      setStatus("success");
      setStatusMessage(
        "Thanks! We received your message and will get back to you soon.",
      );
      resetForm();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.";
      setStatus("error");
      setStatusMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-6">
      <Card className="pointer-events-auto w-full max-w-md shadow-xl sm:max-w-lg lg:max-w-xl">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle>Contact Us</CardTitle>
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setStatusMessage("");
              onClose();
            }}
            className="hover:text-muted-foreground cursor-pointer text-gray-500 transition-colors dark:hover:text-gray-200"
            aria-label="Close contact form"
          >
            <X className="h-5 w-5" />
          </button>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="contact-subject">Subject</Label>
              <Input
                id="contact-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                required
                placeholder="How can we help?"
                className="bg-muted/50 text-foreground dark:bg-muted/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email address</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="you@example.com"
                className="bg-muted/50 text-foreground dark:bg-muted/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-message">Message</Label>
              <Textarea
                id="contact-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                required
                rows={4}
                placeholder="Share some details so we can assist you."
                className="bg-muted/40 text-foreground dark:bg-muted/20 border-border border"
              />
            </div>

            {status !== "idle" && (
              <Alert variant={status === "error" ? "destructive" : "default"}>
                <AlertTitle>
                  {status === "error" ? "Something went wrong" : "Message sent"}
                </AlertTitle>
                <AlertDescription>{statusMessage}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send message"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Footer() {
  const [isContactOpen, setIsContactOpen] = useState(false);

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
                  className="hover:text-primary dark:hover:text-secondary text-muted-foreground text-sm"
                >
                  Getting Started
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/api"
                  className="hover:text-primary dark:hover:text-secondary text-muted-foreground text-sm"
                >
                  API Reference
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
                  className="hover:text-primary dark:hover:text-secondary text-muted-foreground flex items-center text-sm"
                >
                  <Github className="mr-2 h-4 w-4" />
                  GitHub
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setIsContactOpen(true)}
                  className="hover:text-primary dark:hover:text-secondary flex cursor-pointer items-center text-sm text-gray-600 transition-colors dark:text-gray-400"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Contact Us
                </button>
              </li>
            </ul>
          </div>
        </nav>

        <div className="border-border mt-6 flex flex-col items-center justify-between border-t pt-6 md:flex-row">
          <p className="mb-2 text-xs text-gray-600 md:mb-0 dark:text-gray-400">
            © {new Date().getFullYear()} Cronium. All rights reserved.
          </p>
          <p className="text-muted-foreground flex items-center text-xs">
            Made with <Heart className="text-destructive mx-1 h-3 w-3" /> for
            developers everywhere
          </p>
        </div>
      </div>
      <ContactFormModal
        open={isContactOpen}
        onClose={() => setIsContactOpen(false)}
      />
    </footer>
  );
}
