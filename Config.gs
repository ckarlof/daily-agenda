// =============================================================================
// CONFIGURATION
// =============================================================================
// Edit this file to customize your agenda. All user-facing settings live here.
// =============================================================================

const CONFIG = {
  CALENDAR_ID: 'primary',         // 'primary' or a specific calendar email address
  TIMEZONE: 'America/Los_Angeles', // IANA timezone for the agenda reader (e.g. 'America/New_York', 'Europe/London')
  FYI_CALENDARS: [
    { id: 'c_0d7b6c438e961742e737b9fd3a0fbd7ddc4fa863d93ac293f6fb407977ce8e57@group.calendar.google.com', shortName: 'CEE' },
    { id: 'mozilla.com_3u6oeq497a54e07tg7e5h48leg@group.calendar.google.com', shortName: 'SLT' },
    { id: 'c_0d34e4f8c4140929939a2e3f77c4e4b20be08af872469f8567ab38681c7395ca@group.calendar.google.com', shortName: 'CS' }

    // Additional calendars whose events appear in the FYI section:
    // { id: 'example@group.calendar.google.com', shortName: 'Team OOO' },
  ],
  EXCLUDE_KEYWORDS: [             // Event titles containing these words are excluded from the agenda entirely
    'lunch',
    'break',
    'focus time',
    'block',
    'hold',
    'ooo',
    'out of office',
    'commute',
    'therapy',
    'eod'
  ],
  SKIP_ZOOM_CHECK_KEYWORDS: [     // Event titles containing these words appear in the agenda but won't be flagged for missing Zoom
  ],
};
