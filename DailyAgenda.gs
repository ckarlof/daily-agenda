/**
 * Daily Agenda Google Doc Generator
 * ===================================
 * Creates a formatted Google Doc agenda each morning by reading Google Calendar.
 *
 * SETUP INSTRUCTIONS:
 * -------------------
 * 1. Open Google Apps Script: go to script.google.com or from Google Drive,
 *    click New > More > Google Apps Script.
 *
 * 2. Enable the Calendar Advanced Service:
 *    - In the Apps Script editor, click the "+" next to "Services" in the left panel.
 *    - Find "Google Calendar API" and click Add (use version v3).
 *    - This gives you access to the `Calendar` object used in this script.
 *
 * 3. Paste this entire file into the editor (replacing any existing code).
 *
 * 4. Set your CONFIG values below (CALENDAR_ID, FOLDER_ID, etc.).
 *
 * 5. Set up a daily time-based trigger:
 *    - Click the clock icon ("Triggers") in the left sidebar.
 *    - Click "+ Add Trigger" (bottom right).
 *    - Choose function: createDailyAgenda
 *    - Event source: Time-driven
 *    - Type: Day timer
 *    - Time: Choose your preferred morning window (e.g., 6am–7am)
 *    - Click Save.
 *
 * 6. On first run, authorize the script when prompted.
 *
 * You can also run createDailyAgenda() manually from the editor to test it.
 */

// =============================================================================
// CONFIGURATION
// =============================================================================
const CONFIG = {
  CALENDAR_ID: 'primary',         // 'primary' or a specific calendar email address
  TIMEZONE: 'America/New_York', // IANA timezone for the agenda reader (e.g. 'America/New_York', 'Europe/London')
  FYI_CALENDARS: [
    { id: 'c_0d7b6c438e961742e737b9fd3a0fbd7ddc4fa863d93ac293f6fb407977ce8e57@group.calendar.google.com', shortName: 'CEE' },
    { id: 'mozilla.com_3u6oeq497a54e07tg7e5h48leg@group.calendar.google.com', shortName: 'SLT' },
    { id: 'c_0d34e4f8c4140929939a2e3f77c4e4b20be08af872469f8567ab38681c7395ca@group.calendar.google.com', shortName: 'CS' }

    // Additional calendars whose events appear in the FYI section
    // { id: 'example@group.calendar.google.com', shortName: 'Team OOO' },
  ],
  EXCLUDE_KEYWORDS: [             // Event titles containing these words are excluded from the agenda entirely (and implicitly skip the Zoom check)
    'lunch',
    'focus time',
    'block',
    'hold',
    'ooo',
    'out of office',
    'commute',
    'therapy'
  ],
  SKIP_ZOOM_CHECK_KEYWORDS: [     // Event titles containing these words appear in the agenda but won't be flagged for missing Zoom
  ],
};

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Creates the daily agenda Google Doc for today.
 * Call this function manually or via a time-based trigger.
 */
function createDailyAgenda() {
  try {
    const today = new Date();
    const events = fetchCalendarEvents_(today);
    const fyiItems = fetchFyiEvents_(today);
    const doc = buildAgendaDoc_(today, events, fyiItems);
    Logger.log('Daily agenda created: ' + doc.getUrl());
  } catch (e) {
    Logger.log('ERROR in createDailyAgenda: ' + e.message + '\n' + e.stack);
    throw e;
  }
}

// =============================================================================
// TIMEZONE HELPERS
// =============================================================================

/**
 * Returns ISO 8601 start/end timestamps for the given date in CONFIG.TIMEZONE.
 * This ensures day boundaries are correct for the reader's timezone regardless
 * of where the script is running.
 *
 * @param {Date} date
 * @returns {{ start: string, end: string }}
 */
function getDayBounds_(date) {
  var tz = CONFIG.TIMEZONE;
  var dateStr = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
  // 'Z' gives offset like "-0700"; ISO 8601 requires "-07:00"
  var offset    = Utilities.formatDate(date, tz, 'Z');
  var isoOffset = offset.slice(0, 3) + ':' + offset.slice(3);
  return {
    start: dateStr + 'T00:00:00' + isoOffset,
    end:   dateStr + 'T23:59:59' + isoOffset,
  };
}

// =============================================================================
// CALENDAR FETCHING
// =============================================================================

/**
 * Fetches calendar events for the given date using the Calendar Advanced Service.
 * Filters out all-day events and events the user has declined.
 *
 * @param {Date} date - The date to fetch events for.
 * @returns {Object[]} Array of calendar event resource objects.
 */
function fetchCalendarEvents_(date) {
  var bounds = getDayBounds_(date);

  const params = {
    timeMin: bounds.start,
    timeMax: bounds.end,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
    showDeleted: false,
  };

  // Request conferenceData and attachments fields
  // supportsAttachments must be true to get attachment data
  let response;
  try {
    response = Calendar.Events.list(CONFIG.CALENDAR_ID, params);
  } catch (e) {
    throw new Error(
      'Failed to fetch calendar events. Make sure the Calendar Advanced Service ' +
      '(Google Calendar API v3) is enabled in your Apps Script project. ' +
      'Original error: ' + e.message
    );
  }

  const allEvents = response.items || [];

  // Determine the calendar owner's email to check attendee status
  let ownerEmail = '';
  try {
    ownerEmail = Session.getActiveUser().getEmail().toLowerCase();
  } catch (e) {
    Logger.log('Could not determine active user email: ' + e.message);
  }

  // Filter: remove all-day events and declined events
  const filtered = allEvents.filter(function(event) {
    // All-day events have event.start.date but no event.start.dateTime
    if (!event.start || !event.start.dateTime) {
      return false;
    }

    // Skip cancelled events
    if (event.status === 'cancelled') {
      return false;
    }

    // Skip events matching exclude keywords (also skips Zoom check implicitly)
    var titleLower = (event.summary || '').toLowerCase();
    for (var k = 0; k < CONFIG.EXCLUDE_KEYWORDS.length; k++) {
      if (titleLower.indexOf(CONFIG.EXCLUDE_KEYWORDS[k]) !== -1) {
        return false;
      }
    }

    // Skip "try not to book" holds
    if (titleLower.indexOf('try not to book') !== -1) {
      return false;
    }

    // Skip events the user has declined
    if (ownerEmail && event.attendees && event.attendees.length > 0) {
      const self = event.attendees.find(function(a) {
        return a.self === true || (a.email && a.email.toLowerCase() === ownerEmail);
      });
      if (self && self.responseStatus === 'declined') {
        return false;
      }
    }

    return true;
  });

  return filtered;
}

/**
 * Fetches events from all FYI_CALENDARS for the given date.
 * Includes all-day events (common for OOO/holiday calendars).
 * Returns a flat array of { shortName, title } objects.
 *
 * @param {Date} date
 * @returns {{shortName: string, title: string}[]}
 */
function fetchFyiEvents_(date) {
  var bounds = getDayBounds_(date);

  var params = {
    timeMin: bounds.start,
    timeMax: bounds.end,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
    showDeleted: false,
  };

  var result = [];

  for (var c = 0; c < CONFIG.FYI_CALENDARS.length; c++) {
    var cal = CONFIG.FYI_CALENDARS[c];
    var response;
    try {
      response = Calendar.Events.list(cal.id, params);
    } catch (e) {
      Logger.log('Warning: could not fetch FYI calendar "' + cal.shortName + '": ' + e.message);
      continue;
    }

    var items = response.items || [];
    for (var i = 0; i < items.length; i++) {
      var event = items[i];
      if (event.status === 'cancelled') continue;
      result.push({ shortName: cal.shortName, title: event.summary || '(No title)' });
    }
  }

  return result;
}

// =============================================================================
// TIME FORMATTING
// =============================================================================

/**
 * Formats a start/end time pair into the required string, e.g.:
 *   "9:00-9:45a"   (both AM)
 *   "1:15-2:00p"   (both PM)
 *   "11:30a-12:30p" (crosses noon)
 *
 * Rules:
 *  - No leading zeros on hours
 *  - Always show minutes (even :00)
 *  - 'a'/'p' suffix only at end of range, UNLESS the range crosses noon
 *
 * @param {Date} start
 * @param {Date} end
 * @returns {string}
 */
function formatTimeRange_(start, end) {
  var tz = CONFIG.TIMEZONE;
  var startHour = parseInt(Utilities.formatDate(start, tz, 'H'), 10);  // 0–23
  var startMin  = parseInt(Utilities.formatDate(start, tz, 'm'), 10);
  var endHour   = parseInt(Utilities.formatDate(end,   tz, 'H'), 10);
  var endMin    = parseInt(Utilities.formatDate(end,   tz, 'm'), 10);

  var startIsAm = startHour < 12;
  var endIsAm   = endHour < 12;
  var crossesNoon = startIsAm && !endIsAm;

  // Convert to 12-hour format
  var startH12 = startHour % 12 || 12;
  var endH12   = endHour   % 12 || 12;

  var startStr = startH12 + ':' + padTwo_(startMin);
  var endStr   = endH12   + ':' + padTwo_(endMin);

  if (crossesNoon) {
    return startStr + 'a-' + endStr + 'p';
  } else {
    var suffix = endIsAm ? 'a' : 'p';
    return startStr + '-' + endStr + suffix;
  }
}

/**
 * Pads a number to two digits: 5 -> "05", 30 -> "30".
 * @param {number} n
 * @returns {string}
 */
function padTwo_(n) {
  return n < 10 ? '0' + n : String(n);
}

// =============================================================================
// NOTES / AGENDA LINK DETECTION
// =============================================================================

/**
 * Looks for an attached or linked Google Doc in the event's attachments and
 * description. Returns an object { url, label } or null if not found.
 *
 * Label is "agenda" if the attachment title contains "agenda", else "notes".
 *
 * @param {Object} event - Calendar event resource.
 * @returns {{url: string, label: string}|null}
 */
function findNotesLink_(event) {
  // 1. Check event.attachments[] for Google Docs
  if (event.attachments && event.attachments.length > 0) {
    for (var i = 0; i < event.attachments.length; i++) {
      var att = event.attachments[i];
      var isDoc = (att.mimeType && att.mimeType.toLowerCase().indexOf('document') !== -1) ||
                  (att.fileUrl && att.fileUrl.indexOf('docs.google.com') !== -1);
      if (isDoc) {
        var attTitle = (att.title || '').toLowerCase();
        var label = attTitle.indexOf('agenda') !== -1 ? 'agenda' : 'notes';
        return { url: att.fileUrl, label: label };
      }
    }
  }

  // 2. Fall back to scanning the description for Google Doc URLs
  if (event.description) {
    var docUrlMatch = event.description.match(
      /https:\/\/docs\.google\.com\/document\/[^\s"<>)]+/
    );
    if (docUrlMatch) {
      var descLower = event.description.toLowerCase();
      var label = descLower.indexOf('agenda') !== -1 ? 'agenda' : 'notes';
      return { url: docUrlMatch[0], label: label };
    }
  }

  return null;
}

// =============================================================================
// ZOOM LINK DETECTION
// =============================================================================

/**
 * Returns true if the event contains a Zoom meeting link.
 *
 * Checks:
 *  - event.conferenceData.entryPoints[].uri
 *  - event.description
 *  - event.location
 *
 * @param {Object} event
 * @returns {boolean}
 */
function hasZoomLink_(event) {
  // Check conferenceData
  if (event.conferenceData && event.conferenceData.entryPoints) {
    for (var i = 0; i < event.conferenceData.entryPoints.length; i++) {
      var ep = event.conferenceData.entryPoints[i];
      if (ep.uri && ep.uri.indexOf('zoom.us') !== -1) {
        return true;
      }
    }
  }

  // Check description
  if (event.description && event.description.indexOf('zoom.us') !== -1) {
    return true;
  }

  // Check location
  if (event.location && event.location.indexOf('zoom.us') !== -1) {
    return true;
  }

  return false;
}

/**
 * Returns true if the event title contains any of the skip keywords,
 * meaning we should NOT flag it for a missing Zoom link.
 *
 * @param {Object} event
 * @returns {boolean}
 */
function shouldSkipZoomCheck_(event) {
  var title = event.summary || '';
  // Events with [brackets] are calendar holds — no Zoom expected
  if (/\[.*\]/.test(title)) {
    return true;
  }
  var titleLower = title.toLowerCase();
  for (var i = 0; i < CONFIG.SKIP_ZOOM_CHECK_KEYWORDS.length; i++) {
    if (titleLower.indexOf(CONFIG.SKIP_ZOOM_CHECK_KEYWORDS[i]) !== -1) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// DATE FORMATTING
// =============================================================================

/**
 * Returns a formatted date string like "Tuesday, March 24".
 * @param {Date} date
 * @returns {string}
 */
function formatDateHeading_(date) {
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  return days[date.getDay()] + ', ' + months[date.getMonth()] + ' ' + date.getDate();
}

// =============================================================================
// GOOGLE DOC CONSTRUCTION
// =============================================================================

/**
 * Builds and saves the agenda Google Doc.
 *
 * @param {Date} date - The agenda date.
 * @param {Object[]} events - Filtered calendar event resources.
 * @param {{shortName: string, title: string}[]} fyiItems - FYI calendar events.
 * @returns {GoogleAppsScript.Document.Document} The created document.
 */
function buildAgendaDoc_(date, events, fyiItems) {
  var dateHeading = formatDateHeading_(date);
  var docTitle = 'Agenda for ' + dateHeading;

  // Use the document this script is attached to (container-bound)
  var doc = DocumentApp.getActiveDocument();
  doc.setName(docTitle);
  var body = doc.getBody();

  // Clear existing content
  body.clear();

  // ── Title (H1) ────────────────────────────────────────────────────────────
  var titlePara = body.appendParagraph('🚨 Agenda for ' + dateHeading);
  titlePara.setHeading(DocumentApp.ParagraphHeading.HEADING1);

  // ── Fun Fact ──────────────────────────────────────────────────────────────
  body.appendParagraph('');
  body.appendParagraph('Fun fact: [add fun fact here]');

  // ── Action Items (H2) ─────────────────────────────────────────────────────
  body.appendParagraph('');
  var actionHeading = body.appendParagraph('Action Items:');
  actionHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);

  body.appendParagraph('[Admin: add action items here]');

  // ── Horizontal rule ───────────────────────────────────────────────────────
  body.appendParagraph('__________________________');

  // ── Events ────────────────────────────────────────────────────────────────
  body.appendParagraph(''); // blank line before events

  // Track which events are missing Zoom links (for QA section)
  var missingZoom = [];

  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    var title = event.summary || '(No title)';

    var startDate = new Date(event.start.dateTime);
    var endDate   = new Date(event.end.dateTime);
    var timeRange = formatTimeRange_(startDate, endDate);

    var notesLink = findNotesLink_(event);
    var zoomOk    = hasZoomLink_(event);
    var skipZoom  = shouldSkipZoomCheck_(event);

    if (!zoomOk && !skipZoom) {
      missingZoom.push(title);
    }

    // Append event as a bulleted list item: "9:00-9:45a: Core Services Leads"
    var eventItem = body.appendListItem(timeRange + ': ' + title);
    eventItem.setGlyphType(DocumentApp.GlyphType.BULLET);

    // If there's a notes/agenda link, append it as a hyperlink
    if (notesLink) {
      eventItem.appendText(' ');
      var label = '(' + notesLink.label + ')';
      var fullText = eventItem.getText() + label;
      var linkStart = fullText.lastIndexOf(label);
      var linkEnd   = linkStart + label.length - 1;
      eventItem.appendText(label);
      eventItem.editAsText().setLinkUrl(linkStart, linkEnd, notesLink.url);
    }
  }

  // ── FYI (H2) ──────────────────────────────────────────────────────────────
  body.appendParagraph('');
  var fyiHeading = body.appendParagraph('FYI:');
  fyiHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);

  if (fyiItems && fyiItems.length > 0) {
    // Group events by calendar short name, preserving order of first appearance
    var fyiGroups = {};
    var fyiOrder = [];
    for (var f = 0; f < fyiItems.length; f++) {
      var sn = fyiItems[f].shortName;
      if (!fyiGroups[sn]) {
        fyiGroups[sn] = [];
        fyiOrder.push(sn);
      }
      fyiGroups[sn].push(fyiItems[f].title);
    }
    for (var g = 0; g < fyiOrder.length; g++) {
      var calName = fyiOrder[g];
      var line = calName + ': ' + fyiGroups[calName].join('; ');
      var fyiItem = body.appendListItem(line);
      fyiItem.setGlyphType(DocumentApp.GlyphType.BULLET);
    }
  } else {
    body.appendParagraph('[Admin: add FYI items here]');
  }

  // ── Second horizontal rule ────────────────────────────────────────────────
  body.appendParagraph('');
  body.appendParagraph('__________________________');

  // ── QA (H2) ───────────────────────────────────────────────────────────────
  var qaHeading = body.appendParagraph('QA');
  qaHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);

  if (missingZoom.length === 0) {
    body.appendParagraph('✅ All meetings have Zoom links');
  } else {
    body.appendParagraph('⚠️ Missing Zoom links:');
    for (var j = 0; j < missingZoom.length; j++) {
      var bulletPara = body.appendParagraph('• ' + missingZoom[j]);
      // Indent slightly for visual clarity
      bulletPara.setIndentStart(18);
    }
  }

  // ── Save the document ─────────────────────────────────────────────────────
  doc.saveAndClose();

  // Re-open to return a live reference (saveAndClose makes it read-only)
  return DocumentApp.openById(doc.getId());
}
