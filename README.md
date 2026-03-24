# Daily Agenda Generator

A Google Apps Script that writes a formatted daily agenda into a Google Doc each morning by reading your Google Calendar. Designed to be completed by an admin who adds action items and FYI notes before posting to Slack.

## What it generates

Each morning, the script overwrites the attached Google Doc with an agenda like this:

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

FYI:
• Team OOO: Alex on vacation; Jordan at conference
• Holidays: Indigenous Peoples Day

__________________________
QA
✅ All meetings have Zoom links
```

- Meeting notes and agenda docs attached to calendar events are linked inline
- The FYI section is populated from additional calendars you configure (e.g. OOO, holidays)
- A QA section at the bottom flags any meetings missing a Zoom link
- Calendar holds (`[bracketed]` titles) are excluded from the Zoom check
- "Try not to book" holds, declined events, and all-day events are excluded
- Events matching keywords in `EXCLUDE_KEYWORDS` are excluded entirely

## Setup

### 1. Create a container-bound Apps Script

The script writes into the Google Doc it is attached to, so it must be created as a container-bound script:

1. Open (or create) the Google Doc you want the agenda written into each day
2. Click **Extensions > Apps Script**
3. Replace the default code with the contents of `DailyAgenda.gs`
4. Rename the project (top left) to something like "Daily Agenda"

### 2. Enable the Calendar Advanced Service

1. In the left sidebar, click **Services (+)**
2. Find **Google Calendar API** and click **Add** (use version v3)

This is required — the standard `CalendarApp` service doesn't expose conference data or file attachments.

### 3. Configure

At the top of the script, update the `CONFIG` object:

```javascript
const CONFIG = {
  CALENDAR_ID: 'primary',       // or your calendar email address
  TIMEZONE: 'America/New_York', // IANA timezone of the agenda reader

  FYI_CALENDARS: [              // additional calendars shown in the FYI section
    { id: 'abc123@group.calendar.google.com', shortName: 'Team OOO' },
    { id: 'xyz456@group.calendar.google.com', shortName: 'Holidays' },
  ],

  EXCLUDE_KEYWORDS: [           // events with these words are hidden entirely
    'lunch', 'focus time', 'block', 'hold', 'ooo', 'out of office', 'commute',
  ],

  SKIP_ZOOM_CHECK_KEYWORDS: [], // events shown in agenda but exempt from Zoom check
};
```

**Finding a calendar ID:** In Google Calendar, click the three-dot menu next to a calendar name > **Settings and sharing** > scroll to **Integrate calendar** > copy the **Calendar ID**.

**Timezone:** Use any [IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) (e.g. `America/Los_Angeles`, `Europe/London`). This controls both which day's events are fetched and how event times are displayed — useful when the script runner and agenda reader are in different timezones.

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

Run `createDailyAgenda()` manually once from the editor (click the play button). Google will prompt you to authorize calendar and doc access.

## How FYI calendars work

Each calendar listed in `FYI_CALENDARS` is queried for events on the agenda day, including all-day events (useful for OOO and holiday calendars). Events are grouped by calendar and rendered as a single bullet per calendar:

```
• Team OOO: Alex on vacation; Jordan at conference
```

If no FYI calendars are configured or none have events that day, a placeholder is shown instead.

## How meeting notes links work

The script looks for linked Google Docs in two places:

1. **Calendar attachments** — files attached directly to the event in Google Calendar
2. **Event description** — any `docs.google.com` URL found in the event body

If found, a clickable `(notes)` or `(agenda)` link is appended to the event line. The label is `(agenda)` if the attachment title contains the word "agenda", otherwise `(notes)`.

## How Zoom detection works

The script checks for a Zoom link in:
- `conferenceData` (calendar's conference integration)
- The event description
- The event location field

Events are **excluded from the Zoom check** if:
- The title contains `[brackets]` (treated as a calendar hold)
- The title matches any keyword in `SKIP_ZOOM_CHECK_KEYWORDS`

Events in `EXCLUDE_KEYWORDS` never reach the Zoom check because they are filtered out entirely.

## Admin workflow

After the doc is created each morning:

1. Open the bound Google Doc
2. Fill in **Fun fact**, **Action Items**, and review the **FYI** section
3. Resolve any missing Zoom links flagged in the QA section
4. Copy into Slack
