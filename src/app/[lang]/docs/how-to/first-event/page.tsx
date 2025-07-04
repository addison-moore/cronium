import React from 'react';
import DocsLayout from '@/components/docs/docs-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, ArrowRight, Terminal, Server, Clock, Play, AlertCircle } from 'lucide-react';

const tableOfContents = [
  { title: 'Before You Begin', href: '#before-you-begin', level: 2 },
  { title: 'Step 1: Navigate to Events', href: '#step-1-navigate', level: 2 },
  { title: 'Step 2: Create New Event', href: '#step-2-create', level: 2 },
  { title: 'Step 3: Configure Script', href: '#step-3-configure', level: 2 },
  { title: 'Step 4: Test Execution', href: '#step-4-test', level: 2 },
  { title: 'Step 5: Set Schedule', href: '#step-5-schedule', level: 2 },
  { title: 'Best Practices', href: '#best-practices', level: 2 },
  { title: 'Troubleshooting', href: '#troubleshooting', level: 2 },
];

function CodeBlock({ children, language = 'bash' }: { children: string; language?: string }) {
  return (
    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
      <code>{children}</code>
    </pre>
  );
}

function StepCard({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">
            {step}
          </div>
          <CardTitle className="text-xl">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
}

export default async function FirstEventPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;

  return (
    <DocsLayout lang={lang} tableOfContents={tableOfContents}>
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
              Beginner
            </Badge>
            <Badge variant="outline">10 minutes</Badge>
          </div>
          <h1 className="text-4xl font-bold mb-4">Create Your First Event</h1>
          <p className="text-xl text-muted-foreground">
            Learn how to create and run your first automated script in Cronium. This guide walks you 
            through the complete process from setup to execution.
          </p>
        </div>

        <section id="before-you-begin" className="mb-12">
          <h2 className="text-2xl font-bold mb-4">Before You Begin</h2>
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-1" />
                  <div>
                    <h4 className="font-semibold">Cronium Account</h4>
                    <p className="text-sm text-muted-foreground">
                      Make sure you have access to a Cronium instance and can sign in to the dashboard.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Server className="h-5 w-5 text-blue-500 mt-1" />
                  <div>
                    <h4 className="font-semibold">Server Connection (Optional)</h4>
                    <p className="text-sm text-muted-foreground">
                      For remote execution, you'll need SSH access to a server. Local execution works without this.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Terminal className="h-5 w-5 text-purple-500 mt-1" />
                  <div>
                    <h4 className="font-semibold">Basic Script Knowledge</h4>
                    <p className="text-sm text-muted-foreground">
                      Familiarity with bash, Python, or Node.js scripts will be helpful but not required.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <StepCard step={1} title="Navigate to Events">
          <div className="space-y-4">
            <p>
              Start by accessing the Events section in your Cronium dashboard.
            </p>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Sign in to your Cronium dashboard</li>
              <li>Click on <strong>"Events"</strong> in the main navigation</li>
              <li>Click the <strong>"Create Event"</strong> button</li>
            </ol>
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <Terminal className="h-5 w-5 text-blue-500 mt-1" />
                <div>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Tip:</strong> If you don't see the "Create Event" button, check that you have the necessary permissions. 
                    Contact your administrator if needed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </StepCard>

        <StepCard step={2} title="Create New Event">
          <div className="space-y-4">
            <p>
              Fill in the basic information for your event. Start with something simple for your first event.
            </p>
            
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Basic Information</h4>
                <div className="bg-muted p-4 rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <strong>Event Name:</strong><br />
                      <code>My First Event</code>
                    </div>
                    <div>
                      <strong>Event Type:</strong><br />
                      <code>Bash Script</code>
                    </div>
                    <div className="md:col-span-2">
                      <strong>Description:</strong><br />
                      <code>A simple hello world script to test Cronium</code>
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">Event Type Options</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Card className="border-green-200 dark:border-green-800">
                    <CardContent className="pt-4">
                      <h5 className="font-medium text-green-700 dark:text-green-300">Bash Script</h5>
                      <p className="text-sm text-muted-foreground mt-1">Best for system administration and file operations</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="font-medium">Python Script</h5>
                      <p className="text-sm text-muted-foreground mt-1">Great for data processing and API integrations</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="font-medium">Node.js Script</h5>
                      <p className="text-sm text-muted-foreground mt-1">Perfect for JavaScript-based automation</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="font-medium">HTTP Request</h5>
                      <p className="text-sm text-muted-foreground mt-1">For webhook calls and API testing</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </StepCard>

        <StepCard step={3} title="Configure Your Script">
          <div className="space-y-4">
            <p>
              Now add the script content. For your first event, we'll create a simple script that demonstrates 
              basic functionality.
            </p>
            
            <div>
              <h4 className="font-semibold mb-3">Sample Script</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Copy and paste this script into the script editor:
              </p>
              <CodeBlock>{`#!/bin/bash

# Your first Cronium event
echo "Hello from Cronium!"
echo "Event started at: $(date)"
echo "Running on server: $(hostname)"

# Check current directory
echo "Current directory: $(pwd)"

# Show current user
echo "Running as user: $(whoami)"

# Create a simple log entry
echo "$(date): First event executed successfully" >> /tmp/cronium-first-event.log

# Display system information
echo "System uptime:"
uptime

echo "Event completed successfully!"`}</CodeBlock>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Script Explanation</h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">echo</span>
                  <span className="text-muted-foreground">Outputs information to the console</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">$(date)</span>
                  <span className="text-muted-foreground">Shows the current date and time</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">$(hostname)</span>
                  <span className="text-muted-foreground">Displays the server name</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">{">>"} /tmp/...</span>
                  <span className="text-muted-foreground">Writes a log entry to a file</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">uptime</span>
                  <span className="text-muted-foreground">Shows how long the system has been running</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Server Selection</h4>
              <p className="text-sm text-muted-foreground">
                If you have servers configured, select one from the dropdown. If not, you can run this locally 
                or skip server selection for now.
              </p>
            </div>
          </div>
        </StepCard>

        <StepCard step={4} title="Test Your Event">
          <div className="space-y-4">
            <p>
              Before scheduling your event, let's test it to make sure everything works correctly.
            </p>
            
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">1. Save Your Event</h4>
                <p className="text-sm text-muted-foreground">
                  Click <strong>"Save Event"</strong> to store your configuration.
                </p>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">2. Run Test Execution</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Click the <strong>"Run Now"</strong> button to execute your event immediately.
                </p>
                <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Play className="h-4 w-4" />
                    <span className="text-white">Execution started...</span>
                  </div>
                  <div>Hello from Cronium!</div>
                  <div>Event started at: Mon Jan 20 2024 14:30:00 GMT</div>
                  <div>Running on server: my-server</div>
                  <div>Current directory: /home/user</div>
                  <div>Running as user: user</div>
                  <div>System uptime: 14:30:42 up 5 days, 2:15, 1 user</div>
                  <div>Event completed successfully!</div>
                  <div className="flex items-center gap-2 mt-2 text-green-500">
                    <CheckCircle className="h-4 w-4" />
                    <span>Execution completed (exit code: 0)</span>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">3. Review the Results</h4>
                <p className="text-sm text-muted-foreground">
                  Check that the output looks similar to the example above. The exact values will vary 
                  based on your server and current time.
                </p>
              </div>
            </div>

            <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 mt-1" />
                <div>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    <strong>Success!</strong> If you see output similar to the example, your event is working correctly. 
                    You're ready to schedule it for automatic execution.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </StepCard>

        <StepCard step={5} title="Set Up Scheduling">
          <div className="space-y-4">
            <p>
              Now that your event works, let's schedule it to run automatically.
            </p>
            
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">1. Edit Event Schedule</h4>
                <p className="text-sm text-muted-foreground">
                  Go back to your event and click <strong>"Edit"</strong>, then navigate to the Schedule section.
                </p>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">2. Choose Schedule Type</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="font-medium mb-2">For Testing</h5>
                      <p className="text-sm text-muted-foreground mb-2">Run every 5 minutes:</p>
                      <code className="bg-muted px-2 py-1 rounded">{'*/5 * * * *'}</code>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="font-medium mb-2">For Production</h5>
                      <p className="text-sm text-muted-foreground mb-2">Run daily at 2 AM:</p>
                      <code className="bg-muted px-2 py-1 rounded">{'0 2 * * *'}</code>
                    </CardContent>
                  </Card>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">3. Common Schedule Examples</h4>
                <div className="bg-muted p-4 rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div><strong>Every minute:</strong> <code>{'* * * * *'}</code></div>
                    <div><strong>Every hour:</strong> <code>{'0 * * * *'}</code></div>
                    <div><strong>Every day at midnight:</strong> <code>{'0 0 * * *'}</code></div>
                    <div><strong>Every Monday at 9 AM:</strong> <code>{'0 9 * * 1'}</code></div>
                    <div><strong>First day of month:</strong> <code>{'0 0 1 * *'}</code></div>
                    <div><strong>Every 15 minutes:</strong> <code>*/15 * * * *</code></div>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">4. Enable the Event</h4>
                <p className="text-sm text-muted-foreground">
                  Make sure the event status is set to <strong>"Active"</strong> and save your changes.
                </p>
              </div>
            </div>
          </div>
        </StepCard>

        <section id="best-practices" className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Best Practices</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Script Writing</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li>• Always include error handling in your scripts</li>
                  <li>• Use descriptive names for your events</li>
                  <li>• Add comments to explain complex logic</li>
                  <li>• Test scripts manually before scheduling</li>
                  <li>• Use absolute paths for file operations</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Scheduling</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li>• Start with longer intervals for testing</li>
                  <li>• Consider server timezone settings</li>
                  <li>• Avoid scheduling too many events simultaneously</li>
                  <li>• Monitor initial executions closely</li>
                  <li>• Set up notifications for failures</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="troubleshooting" className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Troubleshooting</h2>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  Common Issues
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-red-700 dark:text-red-300">Event fails with "Permission denied"</h4>
                    <p className="text-sm text-muted-foreground">
                      Check that your script has execute permissions and that the user has access to required files.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-red-700 dark:text-red-300">Script runs locally but fails on server</h4>
                    <p className="text-sm text-muted-foreground">
                      Verify that all required tools and dependencies are installed on the target server.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-red-700 dark:text-red-300">Schedule doesn't trigger</h4>
                    <p className="text-sm text-muted-foreground">
                      Ensure the event is set to "Active" status and check the cron expression syntax.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950 dark:to-blue-950 border border-green-200 dark:border-green-800 p-6 rounded-lg">
          <h3 className="font-semibold mb-2">Congratulations!</h3>
          <p className="text-sm text-muted-foreground mb-4">
            You've successfully created and scheduled your first Cronium event. You now have the foundation 
            to build more complex automation workflows.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <a 
              href={`/${lang}/docs/how-to/build-workflow`}
              className="inline-flex items-center justify-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm"
            >
              Next: Build a Workflow
            </a>
            <a 
              href={`/${lang}/docs/how-to`}
              className="inline-flex items-center justify-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
            >
              More How-to Guides
            </a>
          </div>
        </div>
      </div>
    </DocsLayout>
  );
}