import { db } from "../server/db";
import { events, EventStatus, EventType, TimeUnit } from "../shared/schema";

/**
 * This script seeds the database with sample events/scripts
 * These will be used by the workflows seeding script
 */
async function seedEvents() {
  console.log("Starting to seed events/scripts...");

  // First, let's get the default admin user ID
  const adminUser = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.email, "admin@example.com"),
  });

  if (!adminUser) {
    console.error(
      "Admin user not found. Please run the main seed script first.",
    );
    process.exit(1);
  }

  const userId = adminUser.id;
  console.log(`Using admin user with ID: ${userId}`);

  // Check if we already have events
  const existingEvents = await db.select().from(events);

  if (existingEvents.length > 0) {
    console.log(
      `Found ${existingEvents.length} existing events/scripts. Skipping seeding.`,
    );
    return;
  }

  // Create sample scripts/events

  // Bash scripts
  await createScript({
    name: "Daily Database Backup",
    type: EventType.BASH,
    userId,
    content: `#!/bin/bash
# Script to backup database
echo "Starting database backup..."
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_DIR="/backups"
mkdir -p $BACKUP_DIR
pg_dump -U postgres -F c -b -v -f "$BACKUP_DIR/backup_$DATE.backup" my_database
echo "Backup completed: $BACKUP_DIR/backup_$DATE.backup"`,
    status: EventStatus.ACTIVE,
    scheduleNumber: 24,
    scheduleUnit: TimeUnit.HOURS,
  });

  await createScript({
    name: "Log System Health",
    type: EventType.BASH,
    userId,
    content: `#!/bin/bash
# Script to log system health metrics
echo "Logging system health metrics..."
DATE=$(date +%Y-%m-%d_%H-%M-%S)
LOG_DIR="/logs"
mkdir -p $LOG_DIR
echo "System Health Check: $DATE" > "$LOG_DIR/health_$DATE.log"
echo "CPU Usage:" >> "$LOG_DIR/health_$DATE.log"
top -b -n 1 | head -n 20 >> "$LOG_DIR/health_$DATE.log"
echo "Memory Usage:" >> "$LOG_DIR/health_$DATE.log"
free -m >> "$LOG_DIR/health_$DATE.log"
echo "Disk Usage:" >> "$LOG_DIR/health_$DATE.log"
df -h >> "$LOG_DIR/health_$DATE.log"
echo "System health logged to: $LOG_DIR/health_$DATE.log"`,
    status: EventStatus.ACTIVE,
    scheduleNumber: 1,
    scheduleUnit: TimeUnit.HOURS,
  });

  await createScript({
    name: "Set User Permissions",
    type: EventType.BASH,
    userId,
    content: `#!/bin/bash
# Script to set user permissions
echo "Setting user permissions..."
# Check if username was provided
if [ -z "$1" ]; then
  echo "Error: Username not provided"
  exit 1
fi
USERNAME=$1
# Check if user exists
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  echo "Error: User $USERNAME does not exist"
  exit 1
fi
# Add user to groups
usermod -aG sudo,developers,webadmin "$USERNAME"
echo "Added $USERNAME to groups: sudo, developers, webadmin"
# Set home directory permissions
chmod 750 /home/$USERNAME
echo "Set permissions on /home/$USERNAME"
echo "User permissions set successfully for $USERNAME"`,
    status: EventStatus.DRAFT,
  });

  // Node.js scripts
  await createScript({
    name: "Send Daily Email Report",
    type: EventType.NODEJS,
    userId,
    content: `// Send email report script
const nodemailer = require('nodemailer');

async function sendEmailReport() {
  console.log('Preparing to send email report...');
  
  // Create test SMTP service
  let testAccount = await nodemailer.createTestAccount();
  
  // Create reusable transporter
  let transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.ethereal.email",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || testAccount.user,
      pass: process.env.SMTP_PASS || testAccount.pass,
    },
  });
  
  // Get date for report
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  
  // Send mail with defined transport object
  let info = await transporter.sendMail({
    from: '"System Monitor" <system@example.com>',
    to: process.env.RECIPIENT_EMAIL || "admin@example.com",
    subject: \`Daily System Report - \${dateStr}\`,
    text: \`
      Daily System Report - \${dateStr}
      
      All systems operational.
      Database backups completed successfully.
      No security incidents detected.
      
      For more details, please check the dashboard.
    \`,
    html: \`
      <h2>Daily System Report - \${dateStr}</h2>
      
      <p>✅ All systems operational.</p>
      <p>✅ Database backups completed successfully.</p>
      <p>✅ No security incidents detected.</p>
      
      <p>For more details, please check the <a href="https://dashboard.example.com">dashboard</a>.</p>
    \`,
  });
  
  console.log("Email sent successfully");
  console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
  
  return { success: true, messageId: info.messageId };
}

// Run the function
sendEmailReport()
  .then(result => console.log('Complete:', result))
  .catch(error => {
    console.error('Error sending email:', error);
    process.exit(1);
  });`,
    status: EventStatus.ACTIVE,
    scheduleNumber: 24,
    scheduleUnit: TimeUnit.HOURS,
  });

  await createScript({
    name: "Process User Analytics",
    type: EventType.NODEJS,
    userId,
    content: `// Process user analytics data
const fs = require('fs');
const path = require('path');

async function processAnalytics() {
  console.log('Processing user analytics data...');
  
  // Path to analytics data
  const dataDir = process.env.DATA_DIR || './data';
  const outputDir = process.env.OUTPUT_DIR || './reports';
  
  // Ensure directories exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Simulating data processing
  console.log('Reading analytics files...');
  
  // Generate sample analytics data
  const analyticsData = {
    uniqueVisitors: Math.floor(Math.random() * 10000) + 5000,
    pageviews: Math.floor(Math.random() * 50000) + 20000,
    avgSessionDuration: (Math.random() * 5 + 2).toFixed(2),
    bounceRate: (Math.random() * 40 + 30).toFixed(2),
    topPages: [
      { url: '/home', views: Math.floor(Math.random() * 5000) + 3000 },
      { url: '/products', views: Math.floor(Math.random() * 4000) + 2000 },
      { url: '/about', views: Math.floor(Math.random() * 2000) + 1000 },
      { url: '/contact', views: Math.floor(Math.random() * 1000) + 500 },
      { url: '/blog', views: Math.floor(Math.random() * 3000) + 1500 },
    ]
  };
  
  // Save processed data
  const today = new Date().toISOString().split('T')[0];
  const outputFile = path.join(outputDir, \`analytics_\${today}.json\`);
  
  fs.writeFileSync(outputFile, JSON.stringify(analyticsData, null, 2));
  console.log(\`Analytics data processed and saved to \${outputFile}\`);
  
  return {
    success: true,
    outputFile,
    metrics: analyticsData
  };
}

// Run the function
processAnalytics()
  .then(result => console.log('Complete:', result))
  .catch(error => {
    console.error('Error processing analytics:', error);
    process.exit(1);
  });`,
    status: EventStatus.PAUSED,
    scheduleNumber: 1,
    scheduleUnit: TimeUnit.DAYS,
  });

  await createScript({
    name: "Send Welcome Email",
    type: EventType.NODEJS,
    userId,
    content: `// Send welcome email to new users
const nodemailer = require('nodemailer');

async function sendWelcomeEmail() {
  console.log('Sending welcome email...');
  
  // Check if email address was provided
  const recipientEmail = process.env.RECIPIENT_EMAIL;
  if (!recipientEmail) {
    throw new Error('Recipient email not provided. Set the RECIPIENT_EMAIL environment variable.');
  }
  
  // Create test SMTP service
  let testAccount = await nodemailer.createTestAccount();
  
  // Create reusable transporter
  let transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.ethereal.email",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || testAccount.user,
      pass: process.env.SMTP_PASS || testAccount.pass,
    },
  });
  
  // Send welcome email
  let info = await transporter.sendMail({
    from: '"Company Team" <welcome@example.com>',
    to: recipientEmail,
    subject: "Welcome to Our Platform!",
    text: \`
      Welcome to Our Platform!
      
      Thank you for joining our platform. We're excited to have you on board!
      
      Your account has been successfully created and is ready to use.
      
      Here are a few resources to help you get started:
      - User Guide: https://example.com/guide
      - FAQ: https://example.com/faq
      - Support: support@example.com
      
      If you have any questions, please don't hesitate to reach out.
      
      Best regards,
      The Team
    \`,
    html: \`
      <h2>Welcome to Our Platform!</h2>
      
      <p>Thank you for joining our platform. We're excited to have you on board!</p>
      
      <p>Your account has been successfully created and is ready to use.</p>
      
      <p>Here are a few resources to help you get started:</p>
      <ul>
        <li><a href="https://example.com/guide">User Guide</a></li>
        <li><a href="https://example.com/faq">FAQ</a></li>
        <li>Support: <a href="mailto:support@example.com">support@example.com</a></li>
      </ul>
      
      <p>If you have any questions, please don't hesitate to reach out.</p>
      
      <p>Best regards,<br>The Team</p>
    \`,
  });
  
  console.log("Welcome email sent successfully");
  console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
  
  return { success: true, messageId: info.messageId };
}

// Run the function
sendWelcomeEmail()
  .then(result => console.log('Complete:', result))
  .catch(error => {
    console.error('Error sending welcome email:', error);
    process.exit(1);
  });`,
    status: EventStatus.DRAFT,
  });

  // Python scripts
  await createScript({
    name: "Generate Monthly Report",
    type: EventType.PYTHON,
    userId,
    content: `#!/usr/bin/env python3
# Generate monthly report

import os
import sys
import json
import datetime
import matplotlib.pyplot as plt
import numpy as np

def generate_report():
    print("Generating monthly report...")
    
    # Create report directory if it doesn't exist
    report_dir = os.environ.get('REPORT_DIR', './reports')
    os.makedirs(report_dir, exist_ok=True)
    
    # Get current month and year
    now = datetime.datetime.now()
    month_name = now.strftime('%B')
    year = now.strftime('%Y')
    
    # Simulate generating report data
    print(f"Analyzing data for {month_name} {year}...")
    
    # Generate sample data
    data = {
        'month': month_name,
        'year': year,
        'total_revenue': round(np.random.uniform(50000, 150000), 2),
        'total_users': np.random.randint(1000, 5000),
        'new_users': np.random.randint(100, 500),
        'active_users': np.random.randint(500, 2000),
        'top_products': [
            {'name': 'Product A', 'sales': np.random.randint(100, 500)},
            {'name': 'Product B', 'sales': np.random.randint(100, 400)},
            {'name': 'Product C', 'sales': np.random.randint(50, 300)},
            {'name': 'Product D', 'sales': np.random.randint(40, 200)},
            {'name': 'Product E', 'sales': np.random.randint(30, 150)},
        ]
    }
    
    # Save report data
    report_file = os.path.join(report_dir, f"monthly_report_{now.strftime('%Y_%m')}.json")
    with open(report_file, 'w') as f:
        json.dump(data, f, indent=2)
    
    # Generate a simple chart
    plt.figure(figsize=(10, 6))
    products = [p['name'] for p in data['top_products']]
    sales = [p['sales'] for p in data['top_products']]
    plt.bar(products, sales)
    plt.title(f"Top Products - {month_name} {year}")
    plt.xlabel("Products")
    plt.ylabel("Sales")
    
    # Save chart
    chart_file = os.path.join(report_dir, f"monthly_sales_chart_{now.strftime('%Y_%m')}.png")
    plt.savefig(chart_file)
    
    print(f"Report generated and saved to {report_file}")
    print(f"Chart saved to {chart_file}")
    
    return {
        'success': True,
        'report_file': report_file,
        'chart_file': chart_file,
        'data': data
    }

if __name__ == "__main__":
    try:
        result = generate_report()
        print("Monthly report generation completed successfully")
        sys.exit(0)
    except Exception as e:
        print(f"Error generating report: {str(e)}")
        sys.exit(1)`,
    status: EventStatus.ACTIVE,
    scheduleNumber: 1,
    scheduleUnit: TimeUnit.DAYS,
  });

  await createScript({
    name: "Data Cleanup",
    type: EventType.PYTHON,
    userId,
    content: `#!/usr/bin/env python3
# Clean up old data files

import os
import sys
import datetime
import glob
import shutil

def cleanup_old_data():
    print("Starting data cleanup process...")
    
    # Get data directory from environment or use default
    data_dir = os.environ.get('DATA_DIR', './data')
    backup_dir = os.environ.get('BACKUP_DIR', './backups')
    
    # Ensure backup directory exists
    os.makedirs(backup_dir, exist_ok=True)
    
    # Get retention period in days (default 30 days)
    retention_days = int(os.environ.get('RETENTION_DAYS', '30'))
    
    # Calculate cutoff date
    cutoff_date = datetime.datetime.now() - datetime.timedelta(days=retention_days)
    print(f"Cleaning up files older than {cutoff_date.strftime('%Y-%m-%d')}")
    
    # Find files older than retention period
    old_files = []
    total_size = 0
    
    if os.path.exists(data_dir):
        for root, dirs, files in os.walk(data_dir):
            for file in files:
                file_path = os.path.join(root, file)
                file_time = datetime.datetime.fromtimestamp(os.path.getmtime(file_path))
                
                if file_time < cutoff_date:
                    file_size = os.path.getsize(file_path)
                    old_files.append({
                        'path': file_path,
                        'modified': file_time,
                        'size': file_size
                    })
                    total_size += file_size
    
    print(f"Found {len(old_files)} files to clean up, total size: {total_size / (1024*1024):.2f} MB")
    
    # Move old files to backup directory
    moved_count = 0
    for file_info in old_files:
        try:
            # Create relative path structure in backup directory
            rel_path = os.path.relpath(file_info['path'], data_dir)
            backup_path = os.path.join(backup_dir, rel_path)
            
            # Create directories if needed
            os.makedirs(os.path.dirname(backup_path), exist_ok=True)
            
            # Move file
            shutil.move(file_info['path'], backup_path)
            moved_count += 1
            print(f"Moved: {file_info['path']} -> {backup_path}")
        except Exception as e:
            print(f"Error moving file {file_info['path']}: {str(e)}")
    
    print(f"Cleanup complete. Moved {moved_count} files to backup directory.")
    
    return {
        'success': True,
        'files_processed': len(old_files),
        'files_moved': moved_count,
        'total_size_mb': total_size / (1024*1024)
    }

if __name__ == "__main__":
    try:
        result = cleanup_old_data()
        print("Data cleanup completed successfully")
        sys.exit(0)
    except Exception as e:
        print(f"Error during cleanup: {str(e)}")
        sys.exit(1)`,
    status: EventStatus.ACTIVE,
    scheduleNumber: 7,
    scheduleUnit: TimeUnit.DAYS,
  });

  await createScript({
    name: "Create New User",
    type: EventType.PYTHON,
    userId,
    content: `#!/usr/bin/env python3
# Create a new user in the system

import os
import sys
import json
import uuid
import datetime
import random
import string

def create_user():
    print("Creating a new user...")
    
    # Check for required environment variables
    username = os.environ.get('USERNAME')
    email = os.environ.get('EMAIL')
    
    if not username or not email:
        print("Error: USERNAME and EMAIL environment variables are required")
        return {'success': False, 'error': 'Missing required environment variables'}
    
    # Generate random password if not provided
    password = os.environ.get('PASSWORD')
    if not password:
        password = ''.join(random.choices(string.ascii_letters + string.digits + string.punctuation, k=12))
        print(f"Generated random password for new user")
    
    # Create user data
    user_id = str(uuid.uuid4())
    user_data = {
        'id': user_id,
        'username': username,
        'email': email,
        'created_at': datetime.datetime.now().isoformat(),
        'status': 'active',
        'role': os.environ.get('ROLE', 'user')
    }
    
    # Simulate saving user to database
    users_dir = os.environ.get('USERS_DIR', './data/users')
    os.makedirs(users_dir, exist_ok=True)
    
    user_file = os.path.join(users_dir, f"{user_id}.json")
    with open(user_file, 'w') as f:
        # Don't include password in saved data
        json.dump(user_data, f, indent=2)
    
    print(f"User created successfully - ID: {user_id}")
    print(f"Username: {username}")
    print(f"Email: {email}")
    
    # Return result with user data (include password for initial setup process)
    result = {
        'success': True,
        'user': user_data,
        'password': password,
        'file': user_file
    }
    
    return result

if __name__ == "__main__":
    try:
        result = create_user()
        if result['success']:
            print("User creation completed successfully")
            sys.exit(0)
        else:
            print(f"Error creating user: {result.get('error', 'Unknown error')}")
            sys.exit(1)
    except Exception as e:
        print(f"Error creating user: {str(e)}")
        sys.exit(1)`,
    status: EventStatus.DRAFT,
  });

  // HTTP Request script
  await createScript({
    name: "API Health Check",
    type: EventType.HTTP_REQUEST,
    userId,
    httpMethod: "GET",
    httpUrl: "https://api.example.com/health",
    httpHeaders: JSON.stringify([
      { key: "Accept", value: "application/json" },
      { key: "User-Agent", value: "Cronium-Monitor/1.0" },
    ]),
    status: EventStatus.ACTIVE,
    scheduleNumber: 15,
    scheduleUnit: TimeUnit.MINUTES,
  });

  await createScript({
    name: "Update Inventory",
    type: EventType.HTTP_REQUEST,
    userId,
    httpMethod: "POST",
    httpUrl: "https://api.example.com/inventory/update",
    httpHeaders: JSON.stringify([
      { key: "Content-Type", value: "application/json" },
      { key: "Authorization", value: "Bearer {{API_TOKEN}}" },
    ]),
    httpBody: JSON.stringify({
      action: "update_stock",
      items: [
        { sku: "PROD-001", quantity: 100 },
        { sku: "PROD-002", quantity: 50 },
        { sku: "PROD-003", quantity: 75 },
      ],
    }),
    status: EventStatus.PAUSED,
    scheduleNumber: 1,
    scheduleUnit: TimeUnit.DAYS,
  });

  console.log("Successfully seeded events/scripts!");
}

// Helper function to create a script
async function createScript(data: any) {
  const [script] = await db
    .insert(events)
    .values({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  console.log(`Created script: ${script.name} (${script.type})`);
  return script;
}

// If this file is run directly, execute the seed function
if (require.main === module) {
  seedEvents()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Error seeding events/scripts:", error);
      process.exit(1);
    });
}

export { seedEvents };
