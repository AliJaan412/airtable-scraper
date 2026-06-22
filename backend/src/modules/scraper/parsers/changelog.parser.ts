import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';

export interface ParsedActivity {
  uuid: string;
  issueId: string;
  baseId: string;
  tableId: string;
  columnType: string;
  oldValue: string | null;
  newValue: string | null;
  createdDate: Date;
  authoredBy: string;
  rawActivity: Record<string, any>;
}

const TRACKED_FIELD_NAMES = ['status', 'assignee', 'priority'];

function normaliseColumnType(fieldName: string, dataColumnType?: string): string {
  const lower = (fieldName + ' ' + (dataColumnType ?? '')).toLowerCase();
  if (lower.includes('status')) return 'status';
  if (lower.includes('assign') || dataColumnType === 'collaborator') return 'assignee';
  if (lower.includes('priority')) return 'priority';
  return lower.trim();
}

function isTracked(colType: string): boolean {
  return TRACKED_FIELD_NAMES.some((t) => colType.includes(t));
}

// Groups where the activity is an automated row creation (e.g. Sred.io syncing
// a ticket into Airtable). These are not human-authored field changes and should
// not produce changelog entries.
const SKIP_GROUP_TYPES = new Set(['apiRowCreate', 'rowCreate']);

function extractValue(val: any): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val.trim() || null;
  if (typeof val === 'object') {
    return val.name || val.text || val.email || val.value || JSON.stringify(val);
  }
  return String(val);
}

/** Parse a JSON array of activity objects returned from the internal Airtable API */
export function parseJsonActivities(
  activities: any[],
  issueId: string,
  baseId: string,
  tableId: string,
): ParsedActivity[] {
  const results: ParsedActivity[] = [];

  for (const activity of activities) {
    const colType = normaliseColumnType(
      activity.columnType || activity.fieldType || activity.column || activity.type || '',
    );

    if (!isTracked(colType)) continue;

    results.push({
      uuid: activity.id || activity.activityId || activity.rowActivityId || uuidv4(),
      issueId,
      baseId,
      tableId,
      columnType: colType,
      oldValue: extractValue(activity.fromValue ?? activity.oldValue ?? activity.previousValue ?? null),
      newValue: extractValue(activity.toValue ?? activity.newValue ?? activity.currentValue ?? null),
      createdDate: new Date(activity.createdTime || activity.timestamp || activity.created || Date.now()),
      authoredBy:
        activity.originatingUserId ||
        activity.authorId ||
        activity.userId ||
        activity.author?.id ||
        activity.createdBy ||
        'unknown',
      rawActivity: activity,
    });
  }

  return results;
}

/**
 * Try to extract JSON activity data embedded in <script> tags.
 * Airtable often serialises application state as window.__app or similar in the HTML.
 */
function extractJsonFromScripts(html: string): any[] {
  const patterns = [
    // Common patterns Airtable uses to embed data
    /window\.__initialData\s*=\s*({.+?});?\s*<\/script>/s,
    /window\.__app\s*=\s*({.+?});?\s*<\/script>/s,
    /"activities"\s*:\s*(\[.+?\])/s,
    /"rowActivities"\s*:\s*(\[.+?\])/s,
    /"comments"\s*:\s*(\[.+?\])/s,
    /"data"\s*:\s*(\[.+?\])/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) return parsed;
      // Walk common shapes
      const arr =
        parsed?.activities ||
        parsed?.rowActivities ||
        parsed?.data?.activities ||
        parsed?.result?.activities ||
        [];
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch {
      // Not valid JSON — try next pattern
    }
  }
  return [];
}

/**
 * Parse text content of an HTML element to detect status/assignee changes.
 * Returns null if no recognized change pattern is found.
 */
function parseActivityText(
  text: string,
): { colType: string; oldValue: string | null; newValue: string } | null {
  // "changed Status from 'Open' to 'In Progress'"
  const statusFrom = text.match(
    /changed\s+(?:the\s+)?(?:status|Status|field)\s+(?:\S+\s+)?from\s+["']?(.+?)["']?\s+to\s+["']?(.+?)["']?(?:\.|$)/i,
  );
  if (statusFrom) {
    return { colType: 'status', oldValue: statusFrom[1].trim(), newValue: statusFrom[2].trim() };
  }

  // "set Status to 'In Progress'" (no from value)
  const statusSet = text.match(/set\s+(?:the\s+)?(?:status|Status)\s+to\s+["']?(.+?)["']?(?:\.|$)/i);
  if (statusSet) {
    return { colType: 'status', oldValue: null, newValue: statusSet[1].trim() };
  }

  // "changed Assignee from 'Alice' to 'Bob'"
  const assigneeFrom = text.match(
    /(?:changed\s+(?:the\s+)?(?:assignee|assigned\s+to|assignment))\s+from\s+["']?(.+?)["']?\s+to\s+["']?(.+?)["']?(?:\.|$)/i,
  );
  if (assigneeFrom) {
    return { colType: 'assignee', oldValue: assigneeFrom[1].trim(), newValue: assigneeFrom[2].trim() };
  }

  // "assigned to 'Bob'" / "assigned 'Bob'"
  const assigned = text.match(/assigned\s+(?:to\s+)?["']?(.+?)["']?(?:\.|$)/i);
  if (assigned) {
    return { colType: 'assignee', oldValue: null, newValue: assigned[1].trim() };
  }

  // "unassigned"
  if (/unassigned/i.test(text)) {
    return { colType: 'assignee', oldValue: null, newValue: 'unassigned' };
  }

  return null;
}

/** Parse HTML response from /readRowActivitiesAndComments */
export function parseHtmlActivities(
  html: string,
  issueId: string,
  baseId: string,
  tableId: string,
): ParsedActivity[] {
  const results: ParsedActivity[] = [];

  // Strategy 1: Try to find JSON activity data embedded in <script> tags
  const fromScripts = extractJsonFromScripts(html);
  if (fromScripts.length > 0) {
    const parsed = parseJsonActivities(fromScripts, issueId, baseId, tableId);
    if (parsed.length > 0) return parsed;
  }

  const $ = cheerio.load(html);

  // Strategy 2: Broad element selector — Airtable uses various class patterns
  const candidateSelectors = [
    '[data-rowid]',
    '[data-activityid]',
    '.activityFeedItem',
    '.rowActivity',
    '.historyItem',
    '.activity-item',
    '.feed-item',
    '[class*="activity"]',
    '[class*="history"]',
    '[class*="Activity"]',
    '[class*="History"]',
    'li',  // fallback: many activity feeds use <li> elements
  ];

  const selector = candidateSelectors.join(', ');
  const elements: any[] = [];

  $(selector).each((_, el) => {
    // Avoid deeply nested duplicates — only include if not already inside another match
    const parent = $(el).parents(selector).first();
    if (parent.length === 0) elements.push(el);
  });

  for (const el of elements) {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const parsed = parseActivityText(text);
    if (!parsed) continue;

    const timeEl = $el.find('time, [datetime], [data-timestamp], .timestamp, .time').first();
    const authorEl = $el.find('[data-user], [data-userid], .author, .user, .name').first();

    const datetimeStr = timeEl.attr('datetime') || timeEl.attr('data-timestamp') || timeEl.text().trim();
    const createdDate = datetimeStr ? new Date(datetimeStr) : new Date();
    const authoredBy =
      $el.attr('data-userid') ||
      $el.attr('data-user') ||
      authorEl.attr('data-userid') ||
      authorEl.text().trim() ||
      'unknown';

    results.push({
      uuid: $el.attr('data-activityid') || $el.attr('data-rowid') || uuidv4(),
      issueId,
      baseId,
      tableId,
      columnType: parsed.colType,
      oldValue: parsed.oldValue,
      newValue: parsed.newValue,
      createdDate: isNaN(createdDate.getTime()) ? new Date() : createdDate,
      authoredBy,
      rawActivity: { htmlSnippet: $el.html() || '', text },
    });
  }

  // Strategy 3: Full-document text scan as last resort
  if (results.length === 0) {
    const bodyText = $('body').text();
    const lines = bodyText.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      const parsed = parseActivityText(line);
      if (!parsed) continue;

      results.push({
        uuid: uuidv4(),
        issueId,
        baseId,
        tableId,
        columnType: parsed.colType,
        oldValue: parsed.oldValue,
        newValue: parsed.newValue,
        createdDate: new Date(),
        authoredBy: 'unknown',
        rawActivity: { line },
      });
    }
  }

  return results;
}

/**
 * Parse one `diffRowHtml` string from `rowActivityInfoById`.
 * Returns one entry per tracked field change found in the HTML.
 *
 * HTML shape (per changed field):
 *   <div class="historicalCellContainer">
 *     <div class="micro strong caps" columnId="fldXXX">Status</div>
 *     <div class="historicalCellValue diff|nullToValue" data-columntype="select|collaborator">
 *       <!-- select: <span style="...greenLight1..."><div title="On Hold"> = new value -->
 *       <!-- select: <span style="...redLight1...text-decoration:line-through..."><div title="Pending Review"> = old value -->
 *       <!-- collaborator: <div class="flex-auto truncate">Ali Jaan</div> = new value -->
 *     </div>
 *   </div>
 */
function parseDiffHtml(html: string): Array<{
  fieldName: string;
  columnType: string;
  oldValue: string | null;
  newValue: string | null;
}> {
  const $ = cheerio.load(html);
  const results: Array<{ fieldName: string; columnType: string; oldValue: string | null; newValue: string | null }> = [];

  $('.historicalCellContainer').each((_, container) => {
    const $c = $(container);
    const fieldName = $c.find('div.micro').first().text().trim();
    const $cell = $c.find('.historicalCellValue').first();
    const dataType = ($cell.attr('data-columntype') ?? '').toLowerCase();
    const colType = normaliseColumnType(fieldName, dataType);

    if (!isTracked(colType)) return;

    const valueClass = $cell.attr('class') ?? '';
    let newValue: string | null = null;
    let oldValue: string | null = null;

    if (dataType === 'select') {
      // Use text-decoration:line-through (semantic = "removed") rather than greenLight1/redLight1
      // (color classes) — status colors are user-defined and change per workspace theme.
      $cell.find('span').each((_, span) => {
        const style = $(span).attr('style') ?? '';
        const title =
          $(span).find('[title]').attr('title') ??
          $(span).find('.flex-auto').text().trim() ??
          '';
        if (!title) return;
        if (style.includes('line-through')) oldValue = title;
        else newValue = title;
      });
    } else if (dataType === 'collaborator') {
      // Name lives in the last (innermost) .flex-auto.truncate — both the outer text wrapper
      // and the inner name div share this class; .last() avoids doubling via .text() on the wrapper.
      //
      // Use the 'strikethrough' CSS class (semantic = "removed") to identify the old person.
      // Color classes (colors-background-success / colors-background-negative) are avoided
      // because they are theme-dependent and can change.
      const collabName = (el: any): string => {
        const $nameDiv = $(el).find('.flex-auto.truncate').last();
        if (!$nameDiv.length) return '';
        const direct = $nameDiv.contents().filter(function () {
          return (this as any).nodeType === 3;
        }).text().trim();
        return direct || $nameDiv.clone().children().remove().end().text().trim();
      };

      // Works for both nullToValue (one pill, no strikethrough) and diff (two pills,
      // one with strikethrough = old, one without = new).
      $cell.find('.pill').each((_, pill) => {
        const cls = $(pill).attr('class') ?? '';
        const name = collabName(pill);
        if (!name) return;
        if (cls.includes('strikethrough')) oldValue = name;
        else newValue = name;
      });
    }

    if (newValue !== null || oldValue !== null) {
      results.push({ fieldName, columnType: colType, oldValue, newValue });
    }
  });

  return results;
}

/**
 * Parse the full readRowActivitiesAndComments response.
 * Response shape:
 * {
 *   msg: "SUCCESS",
 *   data: {
 *     orderedActivityAndCommentIds: string[],
 *     rowActivityInfoById: {
 *       [id]: { createdTime, originatingUserId, diffRowHtml, groupType, integrationInfo? }
 *     },
 *     rowActivityOrCommentUserObjById: { [userId]: { id, name, email } }
 *   }
 * }
 */
function parseReadRowActivitiesResponse(
  data: any,
  issueId: string,
  baseId: string,
  tableId: string,
): ParsedActivity[] {
  const orderedIds: string[] = data?.orderedActivityAndCommentIds ?? [];
  const activitiesById: Record<string, any> = data?.rowActivityInfoById ?? {};
  const usersById: Record<string, any> = data?.rowActivityOrCommentUserObjById ?? {};

  const results: ParsedActivity[] = [];

  for (const id of orderedIds) {
    const activity = activitiesById[id];
    if (!activity?.diffRowHtml) continue;

    // Skip automated row-create events — they carry initial values, not diffs
    if (SKIP_GROUP_TYPES.has(activity.groupType)) continue;

    const user = usersById[activity.originatingUserId] ?? {};
    const authoredBy: string = (user.name ?? user.email ?? activity.originatingUserId) || 'unknown';
    const createdDate = new Date(activity.createdTime ?? Date.now());

    const fieldChanges = parseDiffHtml(activity.diffRowHtml);

    for (const change of fieldChanges) {
      results.push({
        uuid: `${id}_${change.columnType}`,
        issueId,
        baseId,
        tableId,
        columnType: change.columnType,
        oldValue: change.oldValue,
        newValue: change.newValue,
        createdDate,
        authoredBy,
        rawActivity: { id, groupType: activity.groupType, integrationInfo: activity.integrationInfo },
      });
    }
  }

  return results;
}

/**
 * Parse Airtable's readRowComments response shape:
 * { msg: "SUCCESS", data: { orderedCommentIds: [...], commentsById: { id: entry, ... } } }
 *
 * Each entry in commentsById can be either a user-typed comment or a field-change activity.
 * Field-change entries have a `type` of "activity" and carry `oldValue`/`newValue`/`fieldName`.
 */
function parseReadRowCommentsResponse(
  data: any,
  issueId: string,
  baseId: string,
  tableId: string,
): ParsedActivity[] {
  const commentsById: Record<string, any> = data?.commentsById ?? {};
  const orderedIds: string[] = data?.orderedCommentIds ?? [];
  const usersById: Record<string, any> = data?.userObjsById ?? data?.usersById ?? {};

  const entries = orderedIds.map((id) => commentsById[id]).filter(Boolean);

  const results: ParsedActivity[] = [];

  for (const entry of entries) {
    // Skip plain text comments — we only care about field-change activities
    const entryType: string = (entry.type ?? entry.commentType ?? '').toLowerCase();
    if (entryType === 'comment' || entryType === 'text') continue;

    // Field name / column type detection
    const rawFieldName: string =
      entry.fieldName ?? entry.columnName ?? entry.field?.name ?? entry.column ?? '';
    const colType = normaliseColumnType(rawFieldName || entryType);
    if (!isTracked(colType)) continue;

    // Resolve author name or ID
    const authorId: string =
      entry.authorId ?? entry.userId ?? entry.createdBy ?? entry.originatingUserId ?? '';
    const userObj = usersById[authorId] ?? {};
    const authoredBy: string =
      (userObj.name ?? userObj.email ?? authorId) || 'unknown';

    results.push({
      uuid: entry.id ?? entry.activityId ?? uuidv4(),
      issueId,
      baseId,
      tableId,
      columnType: colType,
      oldValue: extractValue(entry.oldValue ?? entry.fromValue ?? entry.previousValue ?? null),
      newValue: extractValue(entry.newValue ?? entry.toValue ?? entry.currentValue ?? null),
      createdDate: new Date(entry.createdTime ?? entry.timestamp ?? entry.created ?? Date.now()),
      authoredBy,
      rawActivity: entry,
    });
  }

  return results;
}

/** Main entry point — handles JSON string, JSON object/array, or raw HTML string */
export function parseActivities(
  raw: any,
  issueId: string,
  baseId: string,
  tableId: string,
): ParsedActivity[] {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);

      // Airtable readRowActivitiesAndComments shape
      if (parsed?.msg === 'SUCCESS' && parsed?.data?.orderedActivityAndCommentIds !== undefined) {
        return parseReadRowActivitiesResponse(parsed.data, issueId, baseId, tableId);
      }
      // Airtable readRowComments shape
      if (parsed?.msg === 'SUCCESS' && parsed?.data?.commentsById !== undefined) {
        return parseReadRowCommentsResponse(parsed.data, issueId, baseId, tableId);
      }

      const arr = Array.isArray(parsed)
        ? parsed
        : parsed.activities || parsed.rowActivities || parsed.data || parsed.items || [];
      if (Array.isArray(arr)) return parseJsonActivities(arr, issueId, baseId, tableId);
    } catch {
      console.warn('Failed to parse activities as JSON, treating as HTML');
    }
    return parseHtmlActivities(raw, issueId, baseId, tableId);
  }

  if (Array.isArray(raw)) {
    return parseJsonActivities(raw, issueId, baseId, tableId);
  }

  if (typeof raw === 'object' && raw !== null) {
    if (raw?.msg === 'SUCCESS' && raw?.data?.commentsById !== undefined) {
      return parseReadRowCommentsResponse(raw.data, issueId, baseId, tableId);
    }
    const arr = raw.activities || raw.rowActivities || raw.data || raw.items || [];
    return parseJsonActivities(Array.isArray(arr) ? arr : [], issueId, baseId, tableId);
  }

  return [];
}
