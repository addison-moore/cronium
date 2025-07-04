import React from 'react';
import Link from 'next/link';
import { ArrowRight, FileText, BookOpen, Code, Terminal, Server, Shield, Clock, Database, Settings } from 'lucide-react';
import DocsLayout from '@/components/docs/docs-layout';

// Documentation section component
function DocSection({ title, description, icon: Icon, link }: { 
  title: string; 
  description: string; 
  icon: any; 
  link: string; 
}) {
  return (
    <Link href={link} className="group block p-6 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 hover:border-primary dark:hover:border-primary transition-colors">
      <div className="flex items-start space-x-4">
        <div className="flex-shrink-0">
          <Icon className="h-8 w-8 text-primary group-hover:text-primary/80" />
        </div>
        <div className="flex-grow">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary mb-2">
            {title}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {description}
          </p>
          <div className="flex items-center text-primary group-hover:text-primary/80">
            <span className="text-sm font-medium">Learn more</span>
            <ArrowRight className="ml-2 h-4 w-4" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default async function DocsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  
  return (
    <DocsLayout lang={lang}>
      <div className="max-w-4xl mx-auto">
        {/* Header Section */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">Documentation</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Learn how to use Cronium to automate your scripts and workflows
          </p>
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <Link 
              href={`/${lang}/docs/quick-start`}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <BookOpen className="h-5 w-5" />
              Quick Start
            </Link>
            <Link 
              href={`/${lang}/docs/api`}
              className="flex items-center gap-2 px-6 py-3 bg-muted text-foreground rounded-md hover:bg-muted/70 transition-colors"
            >
              <Code className="h-5 w-5" />
              API Reference
            </Link>
          </div>
        </div>
        
        {/* Documentation Sections */}
        <div className="mb-16">
          <h2 className="text-3xl font-bold mb-8">Documentation</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DocSection 
              title="Quick Start"
              description="Get up and running with Cronium in minutes"
              icon={BookOpen}
              link={`/${lang}/docs/quick-start`}
            />
            
            <DocSection 
              title="Features"
              description="Explore all the powerful features Cronium offers"
              icon={FileText}
              link={`/${lang}/docs/features`}
            />
            
            <DocSection 
              title="Events & Scripts"
              description="Create and manage automated events and scripts"
              icon={Clock}
              link={`/${lang}/docs/events`}
            />
            
            <DocSection 
              title="Workflows"
              description="Build complex automation workflows with multiple steps"
              icon={Terminal}
              link={`/${lang}/docs/workflows`}
            />
            
            <DocSection 
              title="Unified Input/Output"
              description="Pass data between events and workflows across Python, Node.js, and Bash"
              icon={Database}
              link={`/${lang}/docs/unified-io`}
            />
            
            <DocSection 
              title="Conditional Actions"
              description="Automate responses to event outcomes with powerful conditional actions"
              icon={Clock}
              link={`/${lang}/docs/conditional-actions`}
            />
            
            <DocSection 
              title="Tools"
              description="Configure communication tools and manage credentials for automated notifications"
              icon={FileText}
              link={`/${lang}/docs/tools`}
            />
            
            <DocSection 
              title="Templates"
              description="Create dynamic message templates with Handlebars syntax and runtime variables"
              icon={FileText}
              link={`/${lang}/docs/templates`}
            />
            
            <DocSection 
              title="Remote Execution"
              description="Execute scripts on remote servers via SSH"
              icon={Server}
              link={`/${lang}/docs/remote-execution`}
            />
            
            <DocSection 
              title="Security"
              description="Learn about Cronium's security features and best practices"
              icon={Shield}
              link={`/${lang}/docs/security`}
            />
            
            <DocSection 
              title="API Reference"
              description="Complete API documentation with examples"
              icon={Terminal}
              link={`/${lang}/docs/api`}
            />
            
            <DocSection 
              title="How-to Guides"
              description="Step-by-step guides for common tasks"
              icon={FileText}
              link={`/${lang}/docs/how-to`}
            />
          </div>
        </div>
      </div>
    </DocsLayout>
  );
}