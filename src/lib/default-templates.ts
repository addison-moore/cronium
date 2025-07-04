/**
 * Default Templates for Cronium Tools
 *
 * Provides consistent Handlebars-style templates across all communication tools
 */

export const defaultTemplates = {
  EMAIL: [
    {
      id: -1,
      name: "Event Success Notification",
      type: "EMAIL",
      content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #22c55e, #16a34a); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 24px;">✅ Event Completed Successfully</h1>
    <p style="margin: 8px 0 0 0; opacity: 0.9;">Cronium Automation Platform</p>
  </div>
  
  <div style="background: white; padding: 30px; border: 1px solid #e2e8f0; border-radius: 0 0 8px 8px;">
    <p>Great news! Your automated event has completed successfully.</p>
    
    <div style="background: #f8fafc; padding: 20px; border-radius: 6px; margin: 20px 0;">
      <p><strong>Event Name:</strong> {{cronium.event.name}}</p>
      <p><strong>Status:</strong> {{cronium.event.status}}</p>
      <p><strong>Execution Time:</strong> {{formatTime cronium.event.executionTime}}</p>
      <p><strong>Server:</strong> {{cronium.event.server}}</p>
    </div>
    
    {{#if cronium.event.output}}
    <div style="margin-top: 20px;">
      <h3>Output:</h3>
      <pre style="background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 6px; overflow-x: auto;">{{cronium.event.output}}</pre>
    </div>
    {{/if}}
  </div>
</div>`,
      subject: "✅ Event Success: {{cronium.event.name}}",
    },
    {
      id: -2,
      name: "Event Failure Notification",
      type: "EMAIL",
      content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 24px;">❌ Event Failed</h1>
    <p style="margin: 8px 0 0 0; opacity: 0.9;">Cronium Automation Platform</p>
  </div>
  
  <div style="background: white; padding: 30px; border: 1px solid #e2e8f0; border-radius: 0 0 8px 8px;">
    <p>Your automated event encountered an error and failed to complete.</p>
    
    <div style="background: #fef2f2; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ef4444;">
      <p><strong>Event Name:</strong> {{cronium.event.name}}</p>
      <p><strong>Status:</strong> {{cronium.event.status}}</p>

      <p><strong>Execution Time:</strong> {{formatTime cronium.event.executionTime}}</p>
      <p><strong>Server:</strong> {{cronium.event.server}}</p>
    </div>
    
    {{#if cronium.event.error}}
    <div style="margin-top: 20px;">
      <h3>Error Details:</h3>
      <pre style="background: #1e293b; color: #f87171; padding: 16px; border-radius: 6px; overflow-x: auto;">{{cronium.event.error}}</pre>
    </div>
    {{/if}}
  </div>
</div>`,
      subject: "❌ Event Failed: {{cronium.event.name}}",
    },
    {
      id: -3,
      name: "Custom Event Notification",
      type: "EMAIL",
      content: `<p>Hello,</p>

<p>Event "{{cronium.event.name}}" has {{cronium.event.status}} with the following details:</p>

<ul>

  <li><strong>Server:</strong> {{cronium.event.server}}</li>
  <li><strong>Time:</strong> {{formatTime cronium.event.executionTime}}</li>
</ul>

{{#if cronium.getVariables.customMessage}}
<p><strong>Custom Message:</strong> {{cronium.getVariables.customMessage}}</p>
{{/if}}`,
      subject: "Event Update: {{cronium.event.name}}",
    },
  ],

  SLACK: [
    {
      id: -1,
      name: "Event Success Message",
      type: "SLACK",
      content: `{
  "text": "Event {{cronium.event.name}} completed successfully",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "✅ Event Completed Successfully"
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*Event:*\\n{{cronium.event.name}}"
        },
        {
          "type": "mrkdwn",
          "text": "*Status:*\\n{{cronium.event.status}}"
        },
        {
          "type": "mrkdwn",
          "text": "*Execution Time:*\\n{{formatTime cronium.event.executionTime}}"
        },
        {
          "type": "mrkdwn",
          "text": "*Server:*\\n{{cronium.event.server}}"
        }
      ]
    }
  ]
}`,
    },
    {
      id: -2,
      name: "Event Failure Message",
      type: "SLACK",
      content: `{
  "text": "Event {{cronium.event.name}} failed",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "❌ Event Failed"
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*Event:*\\n{{cronium.event.name}}"
        },
        {
          "type": "mrkdwn",
          "text": "*Status:*\\n{{cronium.event.status}}"
        },
        {
          "type": "mrkdwn",
          "text": "*Execution Time:*\\n{{formatTime cronium.event.executionTime}}"
        },
        {
          "type": "mrkdwn",
          "text": "*Server:*\\n{{cronium.event.server}}"
        }
      ]
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "🕒 {{formatTime cronium.event.executionTime}}"
        }
      ]
    }
  ]
}`,
    },
    {
      id: -3,
      name: "Simple Status Update",
      type: "SLACK",
      content: `{
  "text": "Event \\"{{cronium.event.name}}\\" {{cronium.event.status}} on {{cronium.event.server}} at {{formatTime cronium.event.executionTime}}"
}`,
    },
  ],

  DISCORD: [
    {
      id: -1,
      name: "Event Success Embed",
      type: "DISCORD",
      content: `{
  "embeds": [
    {
      "title": "✅ Event Completed Successfully",
      "description": "Event **{{cronium.event.name}}** has completed successfully.",
      "color": 5763719,
      "fields": [
        {
          "name": "📊 Status",
          "value": "{{cronium.event.status}}",
          "inline": true
        },
        {
          "name": "⏱️ Execution Time",
          "value": "{{formatTime cronium.event.executionTime}}",
          "inline": true
        },
        {
          "name": "🖥️ Server",
          "value": "{{cronium.event.server}}",
          "inline": true
        }
      ],
      "footer": {
        "text": "Cronium Automation • {{formatTime cronium.event.executionTime}}"
      }
    }
  ]
}`,
    },
    {
      id: -2,
      name: "Event Failure Embed",
      type: "DISCORD",
      content: `{
  "embeds": [
    {
      "title": "❌ Event Failed",
      "description": "Event **{{cronium.event.name}}** encountered an error and failed to complete.",
      "color": 15548997,
      "fields": [
        {
          "name": "📊 Status",
          "value": "{{cronium.event.status}}",
          "inline": true
        },
        {
          "name": "⏱️ Execution Time",
          "value": "{{formatTime cronium.event.executionTime}}",
          "inline": true
        },
        {
          "name": "🖥️ Server",
          "value": "{{cronium.event.server}}",
          "inline": true
        }
      ],
      "footer": {
        "text": "Cronium Automation • {{formatTime cronium.event.executionTime}}"
      }
    }
  ]
}`,
    },
    {
      id: -3,
      name: "Simple Status Message",
      type: "DISCORD",
      content: `{
  "content": "🔔 Event **{{cronium.event.name}}** {{cronium.event.status}} at {{formatTime cronium.event.executionTime}} on {{cronium.event.server}}"
}`,
    },
  ],
};

export function getDefaultTemplatesForType(type: string) {
  return defaultTemplates[type as keyof typeof defaultTemplates] || [];
}
