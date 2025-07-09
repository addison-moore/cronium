# Implemented Tool Actions Tracking

This document tracks which tool actions have been implemented and which actions have template forms setup. It also includes a checklist of potential new actions to implement for each tool.

## Tool Actions Status

### Legend

- [x] Implemented
- [ ] Not implemented
- Template indicators:
  - [x] Has template form
  - [ ] No template form yet

### Email

#### Implemented Actions

- [x] **send-email** - Send an email message to recipients
  - [x] Has template form
  - Default templates: Event Success Report, Event Failure Alert, Weekly Summary Report

#### Potential New Actions

- [ ] **send-bulk-email** - Send personalized emails to multiple recipients with mail merge
- [ ] **send-email-with-attachments** - Send emails with file attachments from URLs or base64
- [ ] **send-template-email** - Send emails using predefined HTML templates with variable substitution
- [x] **reply-to-email** - Reply to a specific email thread (requires IMAP integration)
- [ ] **forward-email** - Forward emails to other recipients (requires IMAP integration)
- [x] **read-inbox** - Fetch emails from inbox with filters (requires IMAP)
- [x] **search-emails** - Search emails by subject, sender, date range (requires IMAP)
- [ ] **mark-email-status** - Update email read/unread status (requires IMAP)
- [ ] **move-email-to-folder** - Organize emails into folders (requires IMAP)
- [ ] **delete-email** - Remove emails from inbox (requires IMAP)

### Slack

#### Implemented Actions

- [x] **slack-send-message** - Send a message to a Slack channel
  - [x] Has template form
  - Default templates: Event Success Notification, Event Failure Alert, Deployment Notification

#### Potential New Actions

- [ ] **send-thread-reply** - Reply to a specific message thread
- [ ] **upload-file** - Upload files to Slack channels
- [ ] **create-channel** - Create new public or private channels
- [x] **send-direct-message** - Send DM to a specific user
- [x] **post-interactive-message** - Send messages with buttons and interactive elements
- [ ] **schedule-message** - Schedule messages for future delivery
- [ ] **update-message** - Edit previously sent messages
- [ ] **add-reaction** - Add emoji reactions to messages
- [ ] **set-channel-topic** - Update channel topic/description
- [ ] **search-messages** - Search Slack messages and files

### Discord

#### Implemented Actions

- [x] **discord-send-message** - Send a message to a Discord channel
  - [x] Has template form
  - Default templates: Event Success Notification, Event Failure Alert, Daily Summary

#### Potential New Actions

- [x] **send-embed-message** - Send rich embed messages with fields and images
- [ ] **create-thread** - Start a new thread in a channel
- [x] **send-direct-message** - Send DMs to users
- [ ] **add-reaction** - Add emoji reactions to messages
- [ ] **create-voice-channel** - Create voice channels
- [ ] **send-webhook-message** - Send messages via Discord webhooks
- [x] **create-server-invite** - Generate invite links
- [ ] **pin-message** - Pin important messages in channels
- [ ] **create-forum-post** - Create posts in forum channels
- [ ] **edit-message** - Modify previously sent messages
- [ ] **manage-roles** - Manage user roles in Discord
- [ ] **create-channel** - Create a new Discord channel

### Google Sheets

#### Implemented Actions

- [x] **read-data** - Read data from a spreadsheet
  - [ ] Has template form
- [x] **write-data** - Write data to a spreadsheet
  - [ ] Has template form
- [x] **create-sheet** - Create a new sheet/spreadsheet
  - [ ] Has template form

#### Potential New Actions

- [x] **append-row** - Add new rows to the end of data
- [x] **delete-rows-columns** - Remove specific rows or columns
- [ ] **find-and-replace** - Search and replace values across sheets
- [ ] **sort-data** - Sort ranges by multiple columns
- [ ] **filter-data** - Apply filters to data ranges
- [ ] **create-pivot-table** - Generate pivot tables from data
- [ ] **copy-sheet** - Duplicate sheets within or across spreadsheets
- [ ] **merge-cells** - Merge multiple cells into one
- [ ] **create-chart** - Generate charts from data ranges
- [ ] **batch-update-cells** - Update multiple non-contiguous cells efficiently
- [ ] **format-cells** - Format cells in a spreadsheet
- [ ] **execute-formula** - Execute formulas in cells

### Microsoft Teams

#### Implemented Actions

- [x] **send-message** - Send a message to Teams channel
  - [ ] Has template form
- [x] **send-card** - Send an adaptive card
  - [ ] Has template form

#### Potential New Actions

- [x] **send-channel-announcement** - Post important announcements
- [ ] **upload-file-to-channel** - Share files in Teams channels
- [ ] **reply-to-message** - Reply to specific messages in threads
- [ ] **create-task-in-planner** - Add tasks to Teams Planner
- [ ] **update-meeting** - Modify existing meeting details
- [ ] **create-wiki-page** - Add wiki pages to channels
- [ ] **send-activity-notification** - Send notifications to user activity feeds
- [ ] **create-team-with-template** - Create teams using predefined templates
- [ ] **archive-team** - Archive teams when projects complete
- [ ] **create-live-event** - Schedule and create live events
- [ ] **create-meeting** - Create a Teams meeting
- [ ] **manage-team** - Manage team settings and members

### Notion

#### Implemented Actions

- [x] **create-page** - Create a new Notion page
  - [ ] Has template form
- [x] **update-database** - Update Notion database entries
  - [ ] Has template form
- [x] **search-content** - Search for content in Notion
  - [ ] Has template form
- [x] **manage-blocks** - Manage blocks within pages
  - [ ] Has template form

#### Potential New Actions

- [x] **add-database-item** - Create new database entries
- [x] **update-page-properties** - Modify page metadata and properties
- [x] **query-database** - Filter and sort database entries
- [ ] **archive-page** - Archive pages when no longer needed
- [ ] **duplicate-page** - Clone pages with all content
- [ ] **add-comment** - Add comments to pages or blocks
- [ ] **create-database-view** - Add filtered/sorted views to databases
- [ ] **sync-external-data** - Import data from CSV/JSON
- [ ] **create-page-from-template** - Use page templates for consistency
- [ ] **export-page-content** - Export pages to Markdown/HTML

### Trello

#### Implemented Actions

- [x] **create-card** - Create a new Trello card
  - [ ] Has template form
- [x] **move-card** - Move cards between lists
  - [ ] Has template form
- [x] **add-checklist** - Add checklists to cards
  - [ ] Has template form

#### Potential New Actions

- [ ] **create-board** - Create new Trello boards
- [x] **create-list** - Add lists to boards
- [x] **update-card** - Modify card details (name, description, due date)
- [ ] **add-label-to-card** - Apply color-coded labels
- [x] **archive-card** - Archive completed cards
- [ ] **copy-card** - Duplicate cards within or across boards
- [ ] **add-comment** - Comment on cards
- [ ] **set-card-cover** - Add cover images to cards
- [ ] **update-checklist-item** - Mark checklist items as complete
- [ ] **create-card-from-template** - Use card templates
- [ ] **add-member** - Add members to cards
- [ ] **attach-file** - Attach files to cards

### Webhook

#### Implemented Actions

- [x] **webhook.send** - Send HTTP requests (GET, POST, PUT, DELETE, PATCH)
  - [ ] Has template form

#### Potential New Actions

- [ ] **send-graphql-request** - Execute GraphQL queries and mutations
- [ ] **webhook-with-retry** - Send with automatic retry on failure
- [ ] **batch-webhook-requests** - Send multiple requests in parallel
- [ ] **webhook-with-auth** - Support various auth methods (OAuth, API keys, JWT)
- [ ] **parse-webhook-response** - Extract specific data from responses
- [ ] **chain-webhooks** - Send sequential webhooks based on responses
- [ ] **webhook-with-file-upload** - Send multipart/form-data requests
- [ ] **conditional-webhook** - Send based on response conditions
- [ ] **webhook-with-rate-limiting** - Respect API rate limits
- [ ] **transform-webhook-data** - Map/transform data before sending

## Summary

### Current Implementation Status

- **Total Tools**: 8
- **Implemented Actions**: 26
- **Actions with Templates**: 3 (11.5%)
- **Actions without Templates**: 23 (88.5%)

### Potential New Actions

- **Total Potential Actions**: 80 (10 per tool)
- **Content Creation/Sending Actions**: 56 (70%)
- **Data Management Actions**: 24 (30%)

### Implementation Priority Guidelines

1. **High Priority**: Actions that create, send, or update content (e.g., sending messages, creating documents)
2. **Medium Priority**: Actions that read or query data (e.g., search, read inbox)
3. **Low Priority**: Actions that manage settings or permissions

## Notes

- Default templates are currently available only for messaging actions (Email, Slack, Discord)
- Template system supports Handlebars syntax for dynamic content
- Templates can reference Cronium variables using `{{cronium.event.*}}` and `{{cronium.getVariables.*}}`
- Template forms need to be created for most non-messaging actions
- Many email actions would require IMAP integration for read capabilities
- Interactive elements (buttons, forms) in Slack/Discord/Teams would enhance automation capabilities
- Batch operations and data transformation actions would improve efficiency for data-heavy workflows
