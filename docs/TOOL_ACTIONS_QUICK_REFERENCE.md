# Tool Actions Quick Reference

## 🚀 Quick Setup

### 1. Add a Tool

```
Dashboard > Settings > Tools > Add Tool
```

### 2. Create an Event

```
Dashboard > Events > New Event > Tool Action
```

### 3. Monitor Execution

```
Dashboard > Tools > Execution History
```

## 🔧 Supported Tools & Actions

### Slack

| Action         | Parameters                 | Example                              |
| -------------- | -------------------------- | ------------------------------------ |
| Send Message   | channel, message           | `#general`, `Hello team!`            |
| Create Channel | name, private              | `project-x`, `false`                 |
| Upload File    | channel, content, filename | `#docs`, `Report data`, `report.txt` |

### Discord

| Action       | Parameters                | Example                               |
| ------------ | ------------------------- | ------------------------------------- |
| Send Message | content                   | `Update: Build completed!`            |
| Send Embed   | title, description, color | `Status`, `All systems go`, `#00ff00` |

### Email

| Action     | Parameters        | Example                                       |
| ---------- | ----------------- | --------------------------------------------- |
| Send Email | to, subject, body | `user@example.com`, `Alert`, `<p>Message</p>` |

### Google Sheets

| Action     | Parameters                   | Example                         |
| ---------- | ---------------------------- | ------------------------------- |
| Read Data  | spreadsheetId, range         | `1234abcd`, `A1:B10`            |
| Write Data | spreadsheetId, range, values | `1234abcd`, `A1`, `[["Hello"]]` |

### Notion

| Action          | Parameters               | Example                         |
| --------------- | ------------------------ | ------------------------------- |
| Create Page     | parentId, title, content | `page-id`, `New Task`, `blocks` |
| Update Database | databaseId, properties   | `db-id`, `{status: "Done"}`     |

### Teams

| Action         | Parameters         | Example                             |
| -------------- | ------------------ | ----------------------------------- |
| Send Message   | webhookUrl, card   | `https://...`, `adaptive card JSON` |
| Create Meeting | subject, startTime | `Team Sync`, `2024-01-01T10:00:00Z` |

### Trello

| Action      | Parameters         | Example                              |
| ----------- | ------------------ | ------------------------------------ |
| Create Card | listId, name, desc | `list-123`, `New Task`, `Details...` |
| Move Card   | cardId, listId     | `card-456`, `list-789`               |

## 📝 Common Patterns

### Variables in Messages

```
Hello {{USER_NAME}},
Job {{EVENT_NAME}} completed at {{TIMESTAMP}}
Results: {{RESULT_COUNT}} items processed
```

### Scheduling Examples

```
Every hour: 0 * * * *
Daily at 9 AM: 0 9 * * *
Weekdays only: 0 9 * * 1-5
First Monday: 0 10 * * 1#1
Every 30 mins: */30 * * * *
```

### Error Handling

- Automatic retry: 3 attempts with exponential backoff
- Rate limiting: Respects service limits
- Circuit breaker: Prevents cascade failures

## 🔍 Troubleshooting

### Check Credentials

1. Go to Settings > Tools
2. Click "Test Connection"
3. Update if needed

### View Logs

1. Go to Dashboard > Tools
2. Click "Execution History"
3. Filter by status or tool

### Common Errors

| Error               | Solution             |
| ------------------- | -------------------- |
| Tool not found      | Check tool is active |
| Invalid credentials | Re-enter and test    |
| Rate limit exceeded | Wait and retry       |
| Connection timeout  | Check service status |

## ⚡ Performance Tips

1. **Batch Operations**: Combine multiple actions when possible
2. **Use Webhooks**: Faster than API calls
3. **Cache Results**: For read-heavy operations
4. **Set Timeouts**: Don't wait forever
5. **Monitor Health**: Check Tools Dashboard regularly

## 🔗 Useful Links

- [Full User Guide](./TOOL_ACTIONS_GUIDE.md)
- [API Documentation](./api/tools.md)
- [Webhook Setup Guides](#webhook-guides)
- [Variable Reference](./VARIABLES.md)

## 💡 Pro Tips

1. **Test First**: Use "Test Connection" before creating events
2. **Start Simple**: Get basic messages working before complex flows
3. **Use Templates**: Copy working events as templates
4. **Tag Everything**: Makes finding events easier
5. **Document Purpose**: Add descriptions to your events

---

Need help? Check the [full guide](./TOOL_ACTIONS_GUIDE.md) or visit Dashboard > Tools!
