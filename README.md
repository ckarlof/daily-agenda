# Daily Agenda Generator

A Google Apps Script that creates a formatted Google Doc agenda each morning by reading your Google Calendar. Designed to be completed by an admin who adds action items, FYI notes, and a fun fact before posting to Slack.

## What it generates

Each morning, the script creates a Google Doc like this:

```
🚨 Agenda for Tuesday, October 15

Fun fact: [add fun fact here]

Action Items:
[Admin: add action items here]
__________________________

• 9:00-9:45a: Engineering Leads (agenda)
• 10:00-10:30a: Product Sync: biweekly (notes)
• 10:35-11:00a: Taylor / Morgan: biweekly (notes)
• 11:00-11:30a: Taylor / Riley: biweekly
• 12:30-1:15p: Acme Vendor Sync weekly

FYI:
[Admin: add FYI items here]

__________________________
QA
✅ All meetings have Zoom links
```

- Meeting notes and agenda docs attached to calendar events are linked inline
- A QA section at the bottom flags any meetings missing a Zoom link
- Calendar holds (`[bracketed]` titles) are included but excluded from the Zoom check
- "Try not to book" holds are excluded entirely
- Declined and all-day events are excluded

## Setup

### 1. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) and click **New project**
2. Replace the default code with the contents of `DailyAgenda.gs`
3. Rename the project (top left) to something like "Daily Agenda"

### 2. Enable the Calendar Advanced Service

1. In the left sidebar, click **Services (+)**
2. Find **Google Calendar API** and click **Add** (use version v3)

This is required — the standard `CalendarApp` service doesn't expose conference data or file attachments.

### 3. Configure

At the top of the script, update the `CONFIG` object:

```javascript
const CONFIG = {
  CALENDAR_ID: 'primary',  // or your calendar email address
  FOLDER_ID: '',           // Google Drive folder ID to save docs into (empty = My Drive root)
  SKIP_ZOOM_CHECK_KEYWORDS: ['lunch', 'focus time', 'block', 'hold', 'ooo', 'out of office', 'commute'],
};
```

To find a folder ID: open the folder in Google Drive — the ID is the last part of the URL (`drive.google.com/drive/folders/<FOLDER_ID>`).

### 4. Set up the daily trigger

1. Click the **clock icon** (Triggers) in the left sidebar
2. Click **+ Add Trigger** (bottom right)
3. Configure:
   - **Function**: `createDailyAgenda`
   - **Event source**: Time-driven
   - **Type**: Day timer
   - **Time**: Your preferred morning window (e.g., 6am–7am)
4. Click **Save**

### 5. Authorize

Run `createDailyAgenda()` manually once from the editor (click the play button). Google will prompt you to authorize calendar, docs, and drive access.

## How meeting notes links work

The script looks for linked Google Docs in two places:

1. **Calendar attachments** — files attached directly to the event in Google Calendar
2. **Event description** — any `docs.google.com` URL found in the event body

If found, a clickable `(notes)` or `(agenda)` link is appended to the event line in the doc. The label is `(agenda)` if the attachment title contains the word "agenda", otherwise `(notes)`.

## How Zoom detection works

The script checks for a Zoom link in:
- `conferenceData` (calendar's conference integration)
- The event description
- The event location field

Events are **excluded from the Zoom check** if:
- The title contains `[brackets]` (treated as a calendar hold)
- The title matches any keyword in `SKIP_ZOOM_CHECK_KEYWORDS`

## Admin workflow

After the doc is created each morning:

1. Open the doc (share the Drive folder with your admin)
2. Fill in **Fun fact**, **Action Items**, and **FYI**
3. Review the QA section and resolve any missing Zoom links
4. Copy into Slack
