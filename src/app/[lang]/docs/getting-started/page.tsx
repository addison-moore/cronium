import React from "react";
import Navbar from "@/components/landing/navbar";
import Footer from "@/components/landing/footer";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle, ChevronRight } from "lucide-react";

// Documentation Step Component
function DocStep({
  number,
  title,
  description,
  image,
}: {
  number: number;
  title: string;
  description: React.ReactNode;
  image?: string;
}) {
  return (
    <div className="border-border mb-12 overflow-hidden rounded-lg border">
      <div className="bg-muted/30 border-border flex items-center border-b p-4">
        <div className="bg-primary/10 mr-3 flex h-8 w-8 items-center justify-center rounded-full">
          <span className="text-primary font-bold">{number}</span>
        </div>
        <h3 className="text-xl font-semibold">{title}</h3>
      </div>
      <div className="p-6">
        <div className="prose prose-slate dark:prose-invert max-w-none">
          {description}
        </div>

        {image && (
          <div className="border-border mt-6 overflow-hidden rounded-md border">
            <img
              src={image}
              alt={`Step ${number} - ${title}`}
              className="w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default async function GettingStartedPage({
  params,
}: {
  params: { lang: string };
}) {
  const { lang } = params;

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar lang={params.lang} />

      <main className="flex-grow">
        {/* Header Section */}
        <section className="bg-muted/30 py-12">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl">
              <Link
                href="/docs"
                className="text-muted-foreground hover:text-foreground mb-6 flex items-center text-sm"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Documentation
              </Link>

              <h1 className="text-primary dark:text-secondary mb-4 text-4xl font-bold">
                Getting Started with Cronium
              </h1>
              <p className="text-muted-foreground mb-6 text-xl">
                This guide will walk you through the basics of setting up and
                using Cronium for your automation needs.
              </p>

              <div className="bg-background border-border rounded-lg border p-6">
                <h2 className="mb-4 text-xl font-semibold">Prerequisites</h2>
                <ul className="space-y-2">
                  <li className="flex items-start">
                    <CheckCircle className="mt-0.5 mr-2 h-5 w-5 flex-shrink-0 text-green-500" />
                    <span>
                      A Cronium account (sign up at{" "}
                      <Link
                        href="/auth/signup"
                        className="text-primary hover:underline"
                      >
                        cronium.com
                      </Link>
                      )
                    </span>
                  </li>
                  <li className="flex items-start">
                    <CheckCircle className="mt-0.5 mr-2 h-5 w-5 flex-shrink-0 text-green-500" />
                    <span>
                      Basic understanding of JavaScript, Python, or Bash
                    </span>
                  </li>
                  <li className="flex items-start">
                    <CheckCircle className="mt-0.5 mr-2 h-5 w-5 flex-shrink-0 text-green-500" />
                    <span>SSH key (if using remote execution features)</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Getting Started Steps */}
        <section className="py-12">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl">
              <DocStep
                number={1}
                title="Creating Your First Script"
                description={
                  <>
                    <p className="mb-4">
                      After logging in to your Cronium account, navigate to the
                      dashboard and click the "New Script" button in the
                      top-right corner.
                    </p>
                    <p className="mb-4">
                      This will open the script creation form. Here, you'll need
                      to provide:
                    </p>
                    <ul className="mb-4 list-disc pl-6">
                      <li>A name for your script</li>
                      <li>The script type (JavaScript, Python, or Bash)</li>
                      <li>The script content</li>
                      <li>Schedule settings</li>
                    </ul>
                    <p>
                      For this example, let's create a simple Python script that
                      logs the current time:
                    </p>
                    <pre className="mt-4 rounded-md bg-zinc-950 p-3 text-sm text-zinc-200">
                      <code>{`import datetime

now = datetime.datetime.now()
print(f"Current time: {now}")`}</code>
                    </pre>
                  </>
                }
              />

              <DocStep
                number={2}
                title="Setting a Schedule"
                description={
                  <>
                    <p className="mb-4">
                      After creating your script, you'll need to set up when it
                      should run. Cronium offers several scheduling options:
                    </p>
                    <ul className="mb-4 list-disc pl-6">
                      <li>
                        <strong>Interval-based:</strong> Run every X minutes,
                        hours, days, etc.
                      </li>
                      <li>
                        <strong>Cron syntax:</strong> For advanced scheduling
                        using cron expressions
                      </li>
                      <li>
                        <strong>One-time execution:</strong> Run only once at a
                        specific date and time
                      </li>
                    </ul>
                    <p className="mb-4">
                      For our example, let's schedule the script to run every
                      hour:
                    </p>
                    <ol className="list-decimal pl-6">
                      <li>Select "Interval" as the schedule type</li>
                      <li>Set the interval to "1" and the unit to "Hours"</li>
                      <li>Click "Save" to apply the schedule</li>
                    </ol>
                  </>
                }
              />

              <DocStep
                number={3}
                title="Adding Environment Variables"
                description={
                  <>
                    <p className="mb-4">
                      You may need to pass sensitive information or
                      configuration settings to your script. Cronium securely
                      stores your environment variables and makes them available
                      during script execution.
                    </p>
                    <p className="mb-4">To add environment variables:</p>
                    <ol className="mb-4 list-decimal pl-6">
                      <li>
                        Go to the "Environment Variables" section of your script
                      </li>
                      <li>Click "Add Variable"</li>
                      <li>Enter a key and value</li>
                      <li>Click "Save"</li>
                    </ol>
                    <p>
                      Your script can access these variables using the standard
                      methods for your programming language. For example, in
                      Python:
                    </p>
                    <pre className="mt-4 rounded-md bg-zinc-950 p-3 text-sm text-zinc-200">
                      <code>{`import os

api_key = os.environ.get("API_KEY")
print(f"Using API key: {api_key}")`}</code>
                    </pre>
                  </>
                }
              />

              <DocStep
                number={4}
                title="Viewing Execution Logs"
                description={
                  <>
                    <p className="mb-4">
                      After your script has run, you can view the execution logs
                      to see the output and check for any errors.
                    </p>
                    <p className="mb-4">To access logs:</p>
                    <ol className="mb-4 list-decimal pl-6">
                      <li>Go to your script's detail page</li>
                      <li>Click on the "Logs" tab</li>
                      <li>Select an execution from the list to view details</li>
                    </ol>
                    <p>
                      The log will show the script's output, execution time,
                      duration, and status (success or failure). If there was an
                      error, the error message will also be displayed to help
                      you troubleshoot.
                    </p>
                  </>
                }
              />

              <DocStep
                number={5}
                title="Setting Up Notifications"
                description={
                  <>
                    <p className="mb-4">
                      Cronium can notify you when your scripts succeed or fail.
                      This helps you stay informed about your automation without
                      having to constantly check the dashboard.
                    </p>
                    <p className="mb-4">To configure notifications:</p>
                    <ol className="mb-4 list-decimal pl-6">
                      <li>Go to your script's detail page</li>
                      <li>Click on the "Notifications" tab</li>
                      <li>Configure events for success and/or failure cases</li>
                      <li>
                        Select notification methods (email, webhook, etc.)
                      </li>
                      <li>Save your settings</li>
                    </ol>
                    <p>
                      You can set different notification types for different
                      events. For example, you might want email notifications
                      for failures but not for successful executions.
                    </p>
                  </>
                }
              />

              <div className="bg-primary/5 border-primary/20 mt-12 rounded-lg border p-6">
                <h2 className="mb-4 text-xl font-semibold">What's Next?</h2>
                <p className="mb-4">
                  Now that you've learned the basics of Cronium, you might want
                  to explore more advanced features:
                </p>
                <ul className="space-y-3">
                  <li>
                    <Link
                      href="/docs/remote-execution"
                      className="text-primary flex items-center hover:underline"
                    >
                      <ChevronRight className="mr-2 h-4 w-4" />
                      Remote Script Execution
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/docs/examples"
                      className="text-primary flex items-center hover:underline"
                    >
                      <ChevronRight className="mr-2 h-4 w-4" />
                      Script Examples
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/docs/api"
                      className="text-primary flex items-center hover:underline"
                    >
                      <ChevronRight className="mr-2 h-4 w-4" />
                      API Integration
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
