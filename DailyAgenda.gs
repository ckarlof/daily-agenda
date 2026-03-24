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
  FOLDER_ID: '',                  // Google Drive folder ID to save docs into (empty = My Drive root)
  SKIP_ZOOM_CHECK_KEYWORDS: [     // Event titles containing these words won't be flagged for missing Zoom
    'lunch',
    'focus time',
    'block',
    'hold',
    'ooo',
    'out of office',
    'commute',
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
    const doc = buildAgendaDoc_(today, events);
    Logger.log('Daily agenda created: ' + doc.getUrl());
  } catch (e) {
    Logger.log('ERROR in createDailyAgenda: ' + e.message + '\n' + e.stack);
    throw e;
  }
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
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const params = {
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
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

    // Skip "try not to book" holds
    var titleLower = (event.summary || '').toLowerCase();
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
  var startHour = start.getHours();    // 0–23
  var startMin  = start.getMinutes();
  var endHour   = end.getHours();
  var endMin    = end.getMinutes();

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
 * Also returns true for 1:1 meetings (title contains " / " which is a common
 * naming pattern like "Chris / Andrew").
 * NOTE: We still include 1:1s in the Zoom check by default; pass
 * skipOneOnOnes=true if you want to exclude them.
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
 * @returns {GoogleAppsScript.Document.Document} The created document.
 */
function buildAgendaDoc_(date, events) {
  var dateHeading = formatDateHeading_(date);
  var docTitle = 'Agenda for ' + dateHeading;

  // Create the document
  var doc = DocumentApp.create(docTitle);
  var body = doc.getBody();

  // Clear any default content
  body.clear();

  // ── Title (H1) ────────────────────────────────────────────────────────────
  var titlePara = body.appendParagraph('🚨 Agenda for ' + dateHeading);
  titlePara.setHeading(DocumentApp.ParagraphHeading.HEADING1);

  // ── Fun Fact ──────────────────────────────────────────────────────────────
  body.appendParagraph(''); // blank line
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
  var fiyHeading = body.appendParagraph('FYI:');
  fiyHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);

  body.appendParagraph('[Admin: add FYI items here]');

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

  // ── Save / move the document ──────────────────────────────────────────────
  doc.saveAndClose();

  if (CONFIG.FOLDER_ID && CONFIG.FOLDER_ID.trim() !== '') {
    moveDocToFolder_(doc.getId(), CONFIG.FOLDER_ID);
  }

  // Re-open to return a live reference (saveAndClose makes it read-only)
  return DocumentApp.openById(doc.getId());
}

// =============================================================================
// DRIVE FOLDER MANAGEMENT
// =============================================================================

/**
 * Moves the document (by file ID) to the specified Drive folder,
 * removing it from its current parent(s).
 *
 * @param {string} docId - The Google Doc file ID.
 * @param {string} folderId - Target Google Drive folder ID.
 */
function moveDocToFolder_(docId, folderId) {
  try {
    var file   = DriveApp.getFileById(docId);
    var folder = DriveApp.getFolderById(folderId);

    // Add to target folder
    folder.addFile(file);

    // Remove from all current parents (typically "My Drive" root)
    var parents = file.getParents();
    while (parents.hasNext()) {
      var parent = parents.next();
      if (parent.getId() !== folderId) {
        parent.removeFile(file);
      }
    }
  } catch (e) {
    Logger.log('Warning: could not move doc to folder ' + folderId + ': ' + e.message);
  }
}
