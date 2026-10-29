/**
 * ============================================================================
 * EDULOW PRO v2.0 - CORE STUDENT MANAGEMENT SYSTEM ENGINE
 * ============================================================================
 * Developed for: St. Lawrence International School
 * Module: Student Information System (SIS)
 *
 * Features
 * 1. Intelligent CRUD (Create, Read, Update, Delete)
 * 2. Real-time Age & Financial Calculations
 * 3. Base64 Image Processing for Photos & Documents
 * 4. Advanced Search & Filtering
 * 5. Data Persistence via Backend API (Spring Boot / MySQL)
 * 6. Responsive UI Controllers & Modal Architecture
 * 7. Sibling Detection & Shared Sibling-Group IDs
 * ============================================================================
 *
 * ID SYSTEM EXPLANATION
 * ─────────────────────
 * Every student gets TWO identifiers:
 *
 *   regNo  →  PREFIX_X  (e.g. PSC_1, PSC_2, PSC_3 …) — PREFIX is whatever
 *             prefix Super Admin set for this school (falls back to "HRK"
 *             only when no school is logged in at all).
 *             Sequential, unique per student, assigned at registration.
 *             This is what appears in the MAIN TABLE and on the profile header.
 *
 *   id     →  For independent students : same as regNo  (PREFIX_X)
 *             For sibling students      : shared sibling-group code (00X)
 *
 * SIBLING-GROUP ID (stored as `id` on sibling records):
 *   - ALL members of the same family share ONE sibling-group code.
 *   - Format: 00X  where X is a sequential group counter (001, 002 …)
 *   - The group code is generated ONCE when the first sibling is detected
 *     and reused for every subsequent sibling added to that family.
 *   - The original (first-registered) student also gets their id updated
 *     to the same group code so everyone is linked symmetrically.
 *
 * DISPLAYED "SIBLING OF" STRING:
 *   Every member shows all OTHER members' first names, e.g.
 *   "Sibling of Muhammad Tahir, Timur and Aman"
 *   This string is re-computed and written back to ALL family members
 *   each time a new sibling joins the group.
 *
 * WHAT SHOWS WHERE:
 *   Main table   → regNo badge (PREFIX_X) for every student
 *   Full profile → regNo badge in header  +  Sibling ID (00X) in details
 *                  +  "Sibling of …" list for every family member
 * ============================================================================
 */

let API_STUDENTS = [];

"use strict";

// ============================================================================
// ⚙️  SETTINGS — CLASS / SECTION / FEE / FUND CONFIGURATION
// ----------------------------------------------------------------------------
// Class structure, sections, monthly tuition, and annual fund values are
// managed centrally on the Settings page (settings.html), which saves them
// to the backend (SchoolSettingsController, PUT /api/settings/{id}). This
// page mirrors that same backend row into CLASS_CONFIGS_CACHE so every
// dropdown/class-card here always reflects whatever was last saved in
// Settings — including changes saved from another tab/device, picked up
// automatically by the live-sync poll below.
//
// NOTE: localStorage is intentionally NOT used as a fallback/cache for this
// (or any other) data anymore. The ONLY key this app ever reads or writes
// in localStorage is 'softschool-theme' (light/dark mode — see initTheme()
// below). Every other value — classes, school info, staff, students — lives
// exclusively in the backend database and is held in memory (the *_CACHE
// variables below) between requests.
// ============================================================================
/*
 * Keep the backend URL configurable. When this page is served by the same
 * Spring Boot application on port 8080, relative URLs avoid CORS and
 * preflight surprises. A separate frontend can set
 * `window.SOFTSCHOOL_API_ORIGIN = 'https://softschool-production.up.railway.app'` before this file
 * loads.
 */
const configuredApiOrigin =
    typeof window !== 'undefined' &&
    typeof window.SOFTSCHOOL_API_ORIGIN === 'string'
        ? window.SOFTSCHOOL_API_ORIGIN.trim().replace(/\/+$/, '')
        : '';
const BACKEND_ORIGIN =
    configuredApiOrigin ||
    (typeof window !== 'undefined' && window.location.port === '8080'
        ? ''
        : 'https://167-86-120-247.sslip.io');

const SETTINGS_API_BASE = `${BACKEND_ORIGIN}/api/settings`;
const STAFF_API_BASE    = `${BACKEND_ORIGIN}/api/staff`;

// Sentinel value for the "All Students" master card in the View / Edit
// class-card selectors — means "no class filter applied".
const ALL_STUDENTS_KEY = '__ALL__';

const DEFAULT_CLASS_CONFIGS = [
   
];

// In-memory mirror of the backend's `classes` array, already converted to
// the {name, fee, fund, sections:[]} shape everything below expects.
// null = "haven't successfully fetched from the server yet".
let CLASS_CONFIGS_CACHE = null;

// In-memory mirror of the school's Teaching staff (for class-teacher/incharge
// badges — see getClassTeacher()). Populated by fetchStaffFromServer(); never
// persisted to localStorage. Empty array = "none fetched yet / none exist".
let STAFF_CACHE = [];
let staffEndpointUnavailable = false;

/**
 * Fetch the logged-in school's Teaching staff from the backend so
 * getClassTeacher() can look up class-incharge assignments. Mirrors
 * fetchClassConfigsFromServer()'s pattern exactly.
 *
 * Adjust the endpoint/response shape below if your backend's
 * StaffController differs — this assumes GET /api/staff?schoolId=... returns
 * an array of staff rows with a `role` field (or is pre-filtered) and
 * either an `inchargeAssignments` JSON string or assignedClass/assignedSection.
 */
async function fetchStaffFromServer() {
    try {
        if (staffEndpointUnavailable) return [];
        const schoolId = getCurrentSchoolId();
        if (!schoolId) return null; // demo / no school session — nothing to fetch
        /*
         * Staff lists are scoped with a query parameter. The old path-style
         * request is a write-only route in some versions of the
         * StaffController and returns 405.
         */
        const res = await fetch(`${STAFF_API_BASE}?schoolId=${encodeURIComponent(schoolId)}`);
        if (res.status === 404 || res.status === 405) {
            // Staff badges are optional; do not hammer an unavailable
            // endpoint on every live-sync interval.
            staffEndpointUnavailable = true;
            STAFF_CACHE = [];
            return [];
        }
        if (!res.ok) throw new Error(`GET staff -> ${res.status}`);
        const staff = await res.json();
        const list = Array.isArray(staff) ? staff : (Array.isArray(staff && staff.staff) ? staff.staff : []);
        STAFF_CACHE = list.filter(s => !s || !s.role || /teach/i.test(s.role));
        return STAFF_CACHE;
    } catch (err) {
        // Staff is supplementary to student CRUD. Keep the page usable if
        // that separate endpoint is temporarily unavailable.
        if (!staffEndpointUnavailable) {
            console.warn('fetchStaffFromServer: could not reach the server, using last cached staff list.', err.message);
        }
        return null;
    }
}

/**
 * Convert the backend's SchoolSettings.ClassFee shape into the shape used
 * throughout this file. Mirrors settings.js's _classesApiToLocal() exactly,
 * since that's the same backend row.
 */
function _classConfigsApiToLocal(apiClasses) {
    return (Array.isArray(apiClasses) ? apiClasses : []).map(c => ({
        name:     c.className || '',
        fee:      c.fee  != null ? c.fee  : 0,
        fund:     c.fund != null ? c.fund : 0,
        sections: (c.sections || '').split(',').map(s => s.trim()).filter(Boolean),
    }));
}

/**
 * Fetch the logged-in school's settings row from the backend and refresh
 * CLASS_CONFIGS_CACHE (from `classes`) and SCHOOL_INFO_CACHE (from the
 * school-info fields on that same row: address/phone/etc). Call this on
 * page load and on every live-sync poll tick so changes made on the
 * Settings page (even from another tab/device) show up here without a
 * manual reload. No localStorage involved anywhere in this path.
 */
async function fetchClassConfigsFromServer() {
    try {
        const schoolId = getCurrentSchoolId();
        if (!schoolId) return null; // demo / no school session — nothing to fetch
        const res = await fetch(`${SETTINGS_API_BASE}/${encodeURIComponent(schoolId)}`);
        if (!res.ok) throw new Error(`GET settings -> ${res.status}`);
        const settings = await res.json();
        CLASS_CONFIGS_CACHE = _classConfigsApiToLocal(settings && settings.classes);
        SCHOOL_INFO_CACHE = (settings && typeof settings === 'object') ? settings : {};
        return CLASS_CONFIGS_CACHE;
    } catch (err) {
        console.warn('fetchClassConfigsFromServer: could not reach the server, using last cached data.', err.message);
        return null;
    }
}

/** Read class configs: server cache first, then built-in defaults (no localStorage). */
function getClassConfigs() {
    if (Array.isArray(CLASS_CONFIGS_CACHE) && CLASS_CONFIGS_CACHE.length) {
        return CLASS_CONFIGS_CACHE;
    }
    return DEFAULT_CLASS_CONFIGS;
}

/** Build a quick lookup map: { [className]: configObject } */
function getClassConfigMap() {
    const map = {};
    getClassConfigs().forEach(c => { if (c && c.name) map[c.name] = c; });
    return map;
}

/** Lookup standard tuition fee for a given class. */
function getStandardFeeForClass(className) {
    const c = getClassConfigMap()[className];
    return c ? Number(c.fee) || 0 : 0;
}

/** Lookup annual fund amount for a given class (falls back to first class's fund). */
function getAnnualFundForClass(className) {
    const map = getClassConfigMap();
    if (className && map[className] && map[className].fund != null) {
        return Number(map[className].fund) || 0;
    }
    const first = getClassConfigs()[0];
    return first ? Number(first.fund) || 0 : 0;
}

// Back-compat shims (read live from settings each access)
const CLASS_STANDARD_FEES = new Proxy({}, {
    get: (_t, prop) => getStandardFeeForClass(prop),
    has: (_t, prop) => prop in getClassConfigMap(),
});
// ANNUAL_FUND_AMOUNT is now resolved per-class via getAnnualFundForClass().
// Kept as a getter for any legacy reads (returns the first class's fund).
const ANNUAL_FUND_AMOUNT = getAnnualFundForClass();

// --- GLOBAL STATE & CONFIGURATION ---
const DB_KEY        = 'edu_students';
const SIBLING_PREFIX = '00';       // prefix for sibling-group IDs

// ── BACKEND API CONFIG ──────────────────────────────────────────────────
// Spring Boot backend — StudentController.java exposes CRUD under this base.
const API_BASE = `${BACKEND_ORIGIN}/api/students`;
// PERFORMANCE FIX — see the comment on syncWithBackend() below: the 6s
// live-sync poll uses this lean endpoint (no photo/certData/hasSiblings)
// instead of API_BASE after the first load.
const SYNC_API_BASE = `${BACKEND_ORIGIN}/api/students/sync`;

// PERFORMANCE FIX — "Manage Students takes 1-2 minutes to load."
//
// The FIRST load used to call plain API_BASE, which returns complete
// Student entities including the photo and certData LONGTEXT columns.
// Those hold base64 images, and base64 is ~133% the size of the original
// file, so a 300-student school with photos was tens of megabytes that
// MySQL had to read off disk, Jackson had to serialise, the VPS had to
// ship from Europe to Asia, and the browser had to parse — all before the
// very first table row could appear.
//
// LIST_API_BASE returns every column this page renders EXCEPT photo and
// certData, plus a `hasPhoto` boolean. Photos are then loaded lazily and
// individually, one <img> at a time, from PHOTO_URL below — which the
// browser fetches in parallel AFTER the table is already on screen, and
// caches on disk so a second visit costs no network at all.
const LIST_API_BASE = `${BACKEND_ORIGIN}/api/students/list`;

// ── MEDIA TOKEN ────────────────────────────────────────────────────────────
// An <img src="…/api/students/{regNo}/photo"> request is made by the browser
// itself and CANNOT carry the Authorization header that the patched fetch()
// adds to every API call, so the server answered 401 and every photo stayed
// blank once photos lived in files instead of inline base64. The server now
// gives this page a short-lived, school-bound "media token"
// (GET /api/students/media-token, authenticated normally) that is appended as
// ?mt=… to the two image URLs. It is refreshed in the background before it
// expires. If the endpoint is unavailable, URLs are simply left as they were.
let SS_MEDIA_TOKEN = '';
let SS_MEDIA_TOKEN_PROMISE = null;

async function ssRefreshMediaToken() {
    const schoolId = getCurrentSchoolId();
    if (!schoolId) return SS_MEDIA_TOKEN;
    try {
        const res = await fetch(`${API_BASE}/media-token?schoolId=${encodeURIComponent(schoolId)}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data && data.token) SS_MEDIA_TOKEN = data.token;
    } catch (e) {
        console.warn('[media] token unavailable:', e && e.message ? e.message : e);
    }
    return SS_MEDIA_TOKEN;
}

function ssEnsureMediaToken() {
    if (SS_MEDIA_TOKEN) return Promise.resolve(SS_MEDIA_TOKEN);
    if (!SS_MEDIA_TOKEN_PROMISE) {
        SS_MEDIA_TOKEN_PROMISE = ssRefreshMediaToken().finally(() => { SS_MEDIA_TOKEN_PROMISE = null; });
    }
    return SS_MEDIA_TOKEN_PROMISE;
}

// Tokens last 60 minutes on the server; renew every 40.
setInterval(() => { ssRefreshMediaToken(); }, 40 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ssRefreshMediaToken();
});

/** Adds / replaces ?mt= on our own photo & B-Form URLs. Anything else is returned unchanged. */
function ssWithMediaToken(url) {
    if (!SS_MEDIA_TOKEN || typeof url !== 'string') return url;
    if (!/\/api\/students\/[^/?#]+\/(photo|bform)(\?|$)/.test(url)) return url;
    try {
        const u = new URL(url, window.location.href);
        u.searchParams.set('mt', SS_MEDIA_TOKEN);
        return u.toString();
    } catch (e) {
        return url;
    }
}

function ssDataUriToBlob(dataUri) {
    const comma = dataUri.indexOf(',');
    const mime = ((dataUri.slice(0, comma).match(/^data:([^;,]+)/)) || [])[1] || 'application/octet-stream';
    const bin = atob(dataUri.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

/** Uploads one file to /files/photo or /files/bform and returns the stored relative path. */
async function ssUploadStudentFile(fileOrBlob, kind /* 'photo' | 'bform' */, filename) {
    const schoolId = getCurrentSchoolId();
    if (!schoolId) throw new Error('No school session.');
    const fd = new FormData();
    fd.append('file', fileOrBlob, filename);
    const res = await fetch(`${API_BASE}/files/${kind}?schoolId=${encodeURIComponent(schoolId)}`, {
        method: 'POST',
        body: fd
    });
    if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`);
    const data = await res.json();
    if (!data || !data.path) throw new Error('Upload returned no path.');
    return data.path;
}

/**
 * URL of one student's photo, served as real image bytes by
 * StudentController#getStudentPhoto (not base64 text in a JSON payload).
 * Returns '' when the student has no photo on file, so every existing
 * `if (s.photo)` check on this page keeps behaving exactly as before.
 */
function studentPhotoUrl(student, schoolId) {
    if (!student) return '';
    const regNo = student.regNo || student.id;
    if (!regNo) return '';
    // New list responses expose the short managed path without exposing
    // legacy base64 content. Prefer that exact path when it is available.
    if (student.photoPath) {
        return resolveStoredFileSrc(student.photoPath, regNo, schoolId, 'photo');
    }
    if (!student.hasPhoto) return '';
    return `${API_BASE}/${encodeURIComponent(regNo)}/photo?schoolId=${encodeURIComponent(schoolId || '')}`;
}

/**
 * True when a value is an inline base64 payload rather than one of our
 * lazy photo URLs. Used on the save path so that re-saving a student whose
 * photo was never re-uploaded sends NO photo field at all — which
 * StudentController#copyUpdatableFields deliberately treats as "leave the
 * stored photo alone" — instead of overwriting the stored base64 with the
 * text of a URL.
 */
function isInlineDataUri(value) {
    return typeof value === 'string' && value.startsWith('data:');
}

// ── REVERTED — BASE64 STORAGE — photos & B-Forms are saved as inline
// base64 text in the student JSON again (Student.photo / Student.certData),
// instead of being uploaded to disk via StudentController#uploadPhoto/
// #uploadBform. Those two endpoints and FileStorageService still exist on
// the backend and still work (nothing there needed to change — it already
// natively supports base64 values for backward compatibility), they are
// simply no longer called from this page. This intentionally brings back
// the original 1-2 minute Manage Students first-load cost on schools with
// many photographed students; that trade-off was accepted deliberately.

/**
 * URL of one student's B-Form/certificate file, served as real bytes by
 * StudentController#getStudentBform — the certData equivalent of
 * studentPhotoUrl() above. Returns '' when there's nothing to show yet
 * (no regNo, e.g. a brand new admission that hasn't been saved).
 */
function studentBformUrl(student, schoolId) {
    if (!student) return '';
    const regNo = student.regNo || student.id;
    if (!regNo) return '';
    return ssWithMediaToken(`${API_BASE}/${encodeURIComponent(regNo)}/bform?schoolId=${encodeURIComponent(schoolId || '')}`);
}

/**
 * Resolves whatever is currently sitting in a "photo-like" field into
 * something safe to drop straight into an <img src="...">:
 *   - already a real URL (http/https) or a legacy base64 data: URI → used as-is
 *   - a bare server-relative path from a fresh upload this session
 *     (e.g. "photos/uuid.jpg", returned by PHOTO_UPLOAD_URL/BFORM_UPLOAD_URL)
 *     → turned into the proper GET /{regNo}/photo|/bform URL
 *   - empty/undefined → ''
 * Centralizing this means print views/exports never accidentally render a
 * bare relative path as an <img> src, which silently shows a broken image.
 */
function resolveStoredFileSrc(rawValue, regNo, schoolId, kind /* 'photo' | 'bform' */) {
    if (!rawValue) return '';
    if (rawValue.startsWith('data:')) {
        return rawValue;
    }
    if (rawValue.startsWith('http://') || rawValue.startsWith('https://')) {
        // Our own /photo and /bform URLs get the current media token (a token
        // baked into an older stored URL is replaced, never reused).
        return ssWithMediaToken(rawValue);
    }
    if (!regNo) return '';
    const endpoint = kind === 'bform' ? 'bform' : 'photo';
    return ssWithMediaToken(`${API_BASE}/${encodeURIComponent(regNo)}/${endpoint}?schoolId=${encodeURIComponent(schoolId || '')}`);
}

/**
 * Returns a usable browser URL for a stored file in a complete student row.
 * Complete rows normally contain a short managed path, while older rows can
 * still contain a data URI.
 */
function storedStudentFileSrc(student, kind) {
    if (!student) return '';
    const rawValue = kind === 'bform' ? student.certData : (student.photo || student.photoPath);
    return resolveStoredFileSrc(
        rawValue,
        student.regNo || student.id,
        getCurrentSchoolId(),
        kind
    );
}

/**
 * Reads a File as a "data:<mime>;base64,...." string. compressImage()
 * already produces this shape for images (via <canvas>.toDataURL); this is
 * the equivalent for files that can't go through a canvas — i.e. PDF
 * B-Forms — so they can be embedded as base64 exactly like images are.
 */
function fileToDataUri(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
        reader.readAsDataURL(file);
    });
}

/**
 * Fetch COMPLETE student records (photo + certData inline) on demand.
 *
 * The roster fetch above deliberately leaves the blobs behind, but the
 * Excel/photo-gallery export genuinely needs them embedded — and export is
 * a rare, deliberate action where a few seconds of waiting is fine, unlike
 * opening the page. So the export path calls this instead of getDatabase().
 */
async function fetchFullStudents() {
    const schoolId = (window.SoftSchoolAdmin
        && typeof window.SoftSchoolAdmin.getCurrentSchool === 'function'
        && (window.SoftSchoolAdmin.getCurrentSchool() || {}).schoolId) || '';
    if (!schoolId) return window.getDatabase ? window.getDatabase() : [];
    try {
        const res = await fetch(`${API_BASE}?schoolId=${encodeURIComponent(schoolId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        return Array.isArray(rows) ? rows : [];
    } catch (err) {
        console.warn('fetchFullStudents: falling back to the in-memory roster —', err.message);
        return window.getDatabase ? window.getDatabase() : [];
    }
}
window.fetchFullStudents = fetchFullStudents;

/**
 * Derive a short registration prefix from the logged-in school's name.
 * e.g. school prefix "PSC" set in Super Admin → "PSC_"  (so IDs read PSC_1, PSC_2, PSC_3 …)
 * Falls back to "HRK_" when no school session exists (demo / superadmin mode).
 *
 * IMPORTANT: this is re-read from the school's session/record every time the
 * page loads, so whatever prefix Super Admin has set for THIS school is what
 * gets used — it is never hardcoded to "HRK".
 */
function getSchoolPrefix() {
    if (window.SoftSchoolAdmin) {
        const school = window.SoftSchoolAdmin.getCurrentSchool();
        if (school) {
            // 1. Use the custom prefix set by superadmin (stored on the school record)
            if (school.prefix && school.prefix.trim().length > 0) {
                return school.prefix.trim().toUpperCase() + '_';
            }
            // 2. Derive from school name initials if no prefix was set
            if (school.name) {
                const words = school.name.trim().split(/[\s\.\-\/]+/);
                const initials = words
                    .filter(w => w.length > 0 && /[A-Za-z]/.test(w[0]))
                    .map(w => w[0].toUpperCase())
                    .join('');
                return (initials.slice(0, 4) || 'SCH') + '_';
            }
        }
    }
    return 'HRK_'; // final fallback (demo / superadmin mode, no school logged in)
}
const SYSTEM_PREFIX = getSchoolPrefix();

/**
 * The logged-in school's real School ID (School.schoolId, e.g. "SS_77_1") —
 * NOT the display prefix above. StudentController scopes every read/write by
 * this value (schools only ever see their own students), so every call to
 * the backend API must send it. Returns '' when no school session exists
 * (demo / superadmin mode) — callers should treat that as "can't sync yet".
 */
function getCurrentSchoolId() {
    if (window.SoftSchoolAdmin) {
        const school = window.SoftSchoolAdmin.getCurrentSchool();
        if (school && school.schoolId) return school.schoolId;
    }
    return '';
}

/**
 * Read the logged-in school's logo (Base64 data URL, set in Super Admin →
 * school → "School logo") for use in print-ready documents that build their
 * own standalone HTML (Admission Form, Student Record, Student List Report).
 * These pages open in a brand-new window via window.open()/document.write(),
 * so they can't rely on the .school-branding logo already injected into the
 * live page by access-control.js — each one needs its own copy of the URL.
 * Returns '' when no school is logged in / no logo was uploaded, so callers
 * can fall back to the default icon crest.
 */
function getSchoolLogoUrl() {
    try {
        if (window.SoftSchoolAdmin) {
            const school = window.SoftSchoolAdmin.getCurrentSchool();
            if (school && school.logo) return school.logo;
        }
    } catch (e) { /* ignore — fall back to icon */ }
    return '';
}

// The school's contact details (address/phone/etc.) live on the same
// SchoolSettings backend row as the class configs above, saved from the
// Settings page. SCHOOL_INFO_CACHE is populated by fetchClassConfigsFromServer()
// (and kept fresh by the live-sync poll) — this page never touches
// localStorage for it.
let SCHOOL_INFO_CACHE = {};

/** Read the school info object mirrored from the backend, safely. */
function getSchoolInfo() {
    return (SCHOOL_INFO_CACHE && typeof SCHOOL_INFO_CACHE === 'object') ? SCHOOL_INFO_CACHE : {};
}

/**
 * Read the logged-in school's contact PHONE NUMBER(S) — set on the Settings
 * page (School Info → Phone / Alternate Phone), never editable from here.
 * Used to stamp every printed document (Admission Form, Student Record,
 * Student List Report, School Leaving Certificate, Character Certificate)
 * with the school's real contact number. Combines the primary and alternate
 * numbers when both are set; returns '' if neither has been set yet.
 */
function getSchoolContactPhone() {
    const info    = getSchoolInfo();
    // The server row (and the Settings page) names these schoolPhone / schoolPhoneAlt;
    // older code paths used phone / phoneAlt — accept either so nothing shows "Not set".
    const primary = String(info.schoolPhone    || info.phone    || '').trim();
    const alt     = String(info.schoolPhoneAlt || info.phoneAlt || '').trim();
    if (primary && alt && primary !== alt) return `${primary} / ${alt}`;
    return primary || alt;
}

/**
 * Read the logged-in school's contact ADDRESS — set on the Settings page
 * (School Info → Address), never editable from here. Used alongside
 * getSchoolContactPhone() on every printed document so the school's real
 * address always appears, without this page ever letting anyone change it.
 */
function getSchoolContactAddress() {
    const info = getSchoolInfo();
    return String(info.schoolAddress || info.address || '').trim();
}

/**
 * Make sure the school's contact details are loaded BEFORE an ID card / certificate
 * is drawn. If the cache is empty (page just opened, or the first fetch was slow /
 * failed), fetch the Settings row now. Safe to call repeatedly; waits at most ~6s.
 */
async function ensureSchoolInfoLoaded() {
    if (getSchoolContactPhone() && getSchoolContactAddress()) return;
    try {
        await Promise.race([
            fetchClassConfigsFromServer(),
            new Promise(r => setTimeout(r, 6000))
        ]);
    } catch (e) { /* keep whatever we have */ }
}

/** Escape a string for safe use inside a RegExp (prefix may contain odd chars). */
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Orphan filter state — declared at top-level (script) scope, NOT inside the
// DOMContentLoaded closure below, because toggleUpdOrphanFilter/toggleVoOrphanFilter
// are defined later in this file OUTSIDE that closure and need to read/write
// these same bindings. Declaring them inside the closure caused
// "ReferenceError: voOrphanFilterActive is not defined" when the buttons were clicked.
let updOrphanFilterActive = false;
let voOrphanFilterActive = false;

/* ══════════════════════════════════════════════════════════════
   MANAGE RECORDS — "SORT BY" (gender / age range / record status)
   Declared at script scope (like the orphan filter above) so both the
   DOMContentLoaded closure and the window.* handlers can reach it.
   Rules: options ticked inside ONE group are OR-ed (Male OR Female),
   options from DIFFERENT groups are AND-ed (Female AND age 5–10).
   ══════════════════════════════════════════════════════════════ */
const voSortState = { gender: new Set(), age: new Set(), record: new Set(), missingFields: new Set() };

/* Age buckets: lower bound inclusive, upper bound exclusive (so a 5-year-old is in "5-10"). */
const VO_AGE_BUCKETS = [
    { key: '0-5',   min: 0,  max: 5 },
    { key: '5-10',  min: 5,  max: 10 },
    { key: '10-15', min: 10, max: 15 },
    { key: '15+',   min: 15, max: Infinity }
];

/* "Missing details" now means the two pictures only: the student photo and the B-Form picture.
   (To count more fields as missing again, push them onto `missing` / `missingKeys` in voGetRecordIssues.) */

function voAgeFromDob(dob) {
    if (!dob) return null;
    const d = new Date(dob);
    if (isNaN(d.getTime())) return null;
    const t = new Date();
    let age = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
    return age;
}

/* ── "Incorrect details" rules ─────────────────────────────────────────────
   Each check returns a short reason (or '') so the table can say WHY a value looks wrong. */
const VO_PLACEHOLDER_RE = /^(n\/?a|na|nil|none|null|unknown|unk|test|testing|dummy|abc+|xyz+|asdf+|qwerty+|x+|\.+|-+|\?+|no)$/i;
const VO_CLASS_TYPICAL_AGE = { montessori: 3, nursery: 4, prep: 5 };   // "Grade N" is typically N + 5
const VO_AGE_TOLERANCE = 4;                                            // years away from the class's typical age
const VO_MALE_RELATIONS = ['Father', 'Brother', 'Uncle'];
const VO_FEMALE_RELATIONS = ['Mother', 'Sister'];

/** '' when the digit string looks real, otherwise why it looks fake (same digits, 1234567, repeating pattern). */
function voDigitsLookFake(d) {
    if (!d || d.length < 4) return '';
    if (/^(\d)\1+$/.test(d)) return 'all digits are the same';
    let up = true, down = true;
    for (let i = 1; i < d.length; i++) {
        const diff = (Number(d[i]) - Number(d[i - 1]) + 10) % 10;
        if (diff !== 1) up = false;
        if (diff !== 9) down = false;
    }
    if (up || down) return 'sequential digits (like 1234567)';
    if (d.length >= 7 && new Set(d).size <= 2) return 'only repeats one or two digits';
    return '';
}

/** Pakistani mobile number check. Returns a reason string, or '' if it looks fine. */
function voPhoneProblem(raw) {
    let d = String(raw).replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('92')) d = '0' + d.slice(2);   // +92 3xx xxxxxxx
    else if (d.length === 10 && d.startsWith('3')) d = '0' + d;         // 3xx xxxxxxx
    if (!/^03\d{9}$/.test(d)) return 'is not a valid mobile number (should be 03XX-XXXXXXX)';
    if (Number(d[2]) > 5) return `has an unknown network code (03${d[2]}…)`;
    const fake = voDigitsLookFake(d.slice(4)) || (/^(\d)\1+$/.test(d) ? 'all digits are the same' : '');
    return fake ? `looks fake — ${fake}` : '';
}

/** 13-digit CNIC / B-Form check (format + obviously fake numbers). */
function voCnicProblem(raw) {
    const d = String(raw).replace(/\D/g, '');
    if (/[A-Za-z]/.test(String(raw)) || d.length !== 13) return `must have 13 digits (has ${d.length})`;
    if (d[0] === '0') return 'starts with 0, which is not a valid area code';
    const fake = voDigitsLookFake(d) || voDigitsLookFake(d.slice(5, 12));
    return fake ? `looks fake — ${fake}` : '';
}

/** Name check: numbers, symbols, too short, placeholder words, repeated letters. */
function voNameProblem(raw) {
    const v = String(raw).trim();
    if (/\d/.test(v)) return 'contains numbers';
    if (/[^\p{L}\p{M}\s.'’\-]/u.test(v)) return 'contains symbols';
    if (v.replace(/[\s.'’\-]/g, '').length < 3) return 'is too short';
    if (VO_PLACEHOLDER_RE.test(v)) return 'looks like a placeholder';
    if (/(.)\1{3,}/i.test(v)) return 'has repeated letters';
    return '';
}

function voAddressProblem(raw) {
    const v = String(raw).trim();
    if (v.length < 5) return 'is too short to be an address';
    if (/^[\d\s\-.,\/]+$/.test(v)) return 'has only numbers';
    if (VO_PLACEHOLDER_RE.test(v)) return 'looks like a placeholder';
    if (/(.)\1{4,}/i.test(v)) return 'has repeated characters';
    return '';
}

/** Returns { missing, missingKeys, incorrect, incorrectDetails } for one student record.
    incorrect = field labels; incorrectDetails = [{ key, label, reason }] (one reason per field). */
function voGetRecordIssues(s) {
    const missing = [], missingKeys = [], incorrect = [], incorrectDetails = [];
    const val = k => String(s[k] == null ? '' : s[k]).trim();
    const digits = k => val(k).replace(/\D/g, '');
    const seen = new Set();
    const flag = (key, label, reason) => {
        if (!reason || seen.has(key)) return;           // one reason per field is enough
        seen.add(key);
        incorrect.push(label);
        incorrectDetails.push({ key, label, reason });
    };

    // Missing pictures. The list endpoint only says whether a photo exists; the B-Form picture
    // (certData) arrives in a background load, so it is only judged once that has finished.
    const hasPhoto = s.hasPhoto === true || !!val('photoPath') || (!!val('photo') && !/placeholder\.com/i.test(val('photo')));
    if (!hasPhoto) { missing.push('Photo'); missingKeys.push('photo'); }
    const mediaReady = typeof window.ssStudentMediaReady !== 'function' || window.ssStudentMediaReady();
    if (mediaReady && !val('certData')) { missing.push('B-Form Picture'); missingKeys.push('certData'); }

    // Names
    [['fullName', 'Name'], ['guardianName', 'Guardian Name'], ['fatherFullName', 'Father Name']].forEach(([k, label]) => {
        if (val(k)) flag(k, label, voNameProblem(val(k)));
    });

    // Gender
    if (val('gender') && !['Male', 'Female', 'Other'].includes(val('gender'))) flag('gender', 'Gender', 'is not Male, Female or Other');

    // Date of birth
    if (val('dob')) {
        const dobDate = new Date(val('dob'));
        const age = voAgeFromDob(val('dob'));
        let reason = '';
        if (age === null) reason = 'is not a valid date';
        else if (age < 0) reason = 'is in the future';
        else if (age < 2) reason = `makes the student only ${age} year(s) old`;
        else if (age > 25) reason = `makes the student ${age} years old`;
        else {
            const adm = val('admissionDate') ? new Date(val('admissionDate')) : null;
            if (adm && !isNaN(adm.getTime()) && adm < dobDate) {
                reason = 'is after the admission date';
            } else {
                const cls = val('studentClass');
                const gm = /grade\s*(\d+)/i.exec(cls);
                const typical = gm ? Number(gm[1]) + 5 : VO_CLASS_TYPICAL_AGE[cls.toLowerCase()];
                if (typical !== undefined && Math.abs(age - typical) > VO_AGE_TOLERANCE) {
                    reason = `gives age ${age}, which is unusual for ${cls}`;
                }
            }
        }
        flag('dob', 'Date of Birth', reason);
    }

    // B-Form / CNICs: format, fake numbers, and the gender digit (odd = male, even = female)
    const genderDigitMismatch = (k, expectMale, who) => {
        const d = digits(k);
        if (d.length !== 13) return '';
        const isMale = Number(d[12]) % 2 === 1;
        return isMale === expectMale ? '' : `last digit says ${isMale ? 'male' : 'female'}, but ${who} is ${expectMale ? 'male' : 'female'}`;
    };
    if (val('studentBform')) {
        let r = voCnicProblem(val('studentBform'));
        if (!r && val('guardianCnic') && digits('studentBform') === digits('guardianCnic')) r = 'is the same as the Guardian CNIC';
        if (!r && (val('gender') === 'Male' || val('gender') === 'Female')) {
            r = genderDigitMismatch('studentBform', val('gender') === 'Male', 'the student');
        }
        flag('studentBform', 'B-Form', r);
    }
    if (val('guardianCnic')) {
        let r = voCnicProblem(val('guardianCnic'));
        if (!r && VO_MALE_RELATIONS.includes(val('guardianRole'))) r = genderDigitMismatch('guardianCnic', true, `the ${val('guardianRole').toLowerCase()}`);
        if (!r && VO_FEMALE_RELATIONS.includes(val('guardianRole'))) r = genderDigitMismatch('guardianCnic', false, `the ${val('guardianRole').toLowerCase()}`);
        flag('guardianCnic', 'Guardian CNIC', r);
    }
    if (val('fatherCnic')) {
        flag('fatherCnic', 'Father CNIC', voCnicProblem(val('fatherCnic')) || genderDigitMismatch('fatherCnic', true, 'the father'));
    }

    // Phones
    [['phone1', 'Primary Phone'], ['phone2', 'Secondary Phone']].forEach(([k, label]) => {
        if (val(k)) flag(k, label, voPhoneProblem(val(k)));
    });

    // Addresses
    [['permanentAddress', 'Permanent Address'], ['mailingAddress', 'Mailing Address']].forEach(([k, label]) => {
        if (val(k)) flag(k, label, voAddressProblem(val(k)));
    });

    // Fees: must be non-negative numbers; discounts can't be bigger than what they discount
    const amount = k => {
        const raw = val(k).replace(/,/g, '');
        return raw === '' ? null : Number(raw);
    };
    [['standardFee', 'Tuition Fee'], ['admissionFee', 'Admission Fee'], ['transportFee', 'Transport Fee'],
     ['tuitionDiscount', 'Tuition Discount'], ['transportDiscount', 'Transport Discount'],
     ['siblingDiscount', 'Sibling Discount'], ['arrears', 'Arrears']].forEach(([k, label]) => {
        const n = amount(k);
        if (n !== null && (isNaN(n) || n < 0)) flag(k, label, 'is not a valid amount');
    });
    const tf = amount('standardFee'), td = amount('tuitionDiscount');
    if (tf !== null && td !== null && !isNaN(tf) && !isNaN(td) && tf > 0 && td > tf) flag('tuitionDiscount', 'Tuition Discount', 'is more than the tuition fee');
    const trf = amount('transportFee'), trd = amount('transportDiscount');
    if (trf !== null && trd !== null && !isNaN(trf) && !isNaN(trd) && trd > trf) flag('transportDiscount', 'Transport Discount', 'is more than the transport fee');

    return { missing, missingKeys, incorrect, incorrectDetails };
}

/** True when the student passes every active Sort By option. */
function voMatchesSort(s) {
    const g = voSortState.gender, a = voSortState.age, r = voSortState.record;
    if (g.size && !g.has(s.gender)) return false;
    if (a.size) {
        const age = voAgeFromDob(s.dob);
        if (age === null) return false;
        if (![...a].some(key => { const b = VO_AGE_BUCKETS.find(x => x.key === key); return b && age >= b.min && age < b.max; })) return false;
    }
    if (r.size) {
        const issues = voGetRecordIssues(s);
        const f = voSortState.missingFields;
        const hasMissing = f.size
            ? issues.missingKeys.some(k => f.has(k))   // missing at least one of the ticked details
            : issues.missing.length > 0;               // nothing ticked → missing anything
        const hasIncorrect = issues.incorrect.length > 0;
        const ok = (r.has('missing') && hasMissing) || (r.has('incorrect') && hasIncorrect);
        if (!ok) return false;
    }
    return true;
}

function voSortIsActive() {
    return voSortState.gender.size + voSortState.age.size + voSortState.record.size > 0;
}

/** Small "Missing: …" / "Check: …" tags shown under the name while a Record Status option is on. */
function voIssueTagsHtml(s) {
    if (!voSortState.record.size) return '';
    const issues = voGetRecordIssues(s);
    const esc = v => SSValidate.escapeHtml(v);
    let out = '';
    if (voSortState.record.has('missing') && issues.missing.length) {
        const f = voSortState.missingFields;
        const labels = f.size ? issues.missing.filter((_, i) => f.has(issues.missingKeys[i])) : issues.missing;
        if (labels.length) {
            out += `<br><span class="vo-issue-tag is-missing" title="Missing details"><i class="fas fa-circle-exclamation"></i> Missing: ${esc(labels.join(', '))}</span>`;
        }
    }
    if (voSortState.record.has('incorrect') && issues.incorrectDetails.length) {
        const text = issues.incorrectDetails.map(d => `${d.label} ${d.reason}`).join(' • ');
        out += `<br><span class="vo-issue-tag is-incorrect" title="Incorrect details"><i class="fas fa-triangle-exclamation"></i> ${esc(text)}</span>`;
    }
    return out;
}

/** Reset every Sort By option and the button/pop-up UI (used when the modal re-opens or goes back to classes). */
function voResetSortUI() {
    voSortState.gender.clear(); voSortState.age.clear(); voSortState.record.clear(); voSortState.missingFields.clear();
    const subReset = document.getElementById('vo-missing-sub');
    if (subReset) subReset.hidden = true;
    document.querySelectorAll('#vo-sort-panel input[type="checkbox"], #vo-sort-panel input[type="radio"]').forEach(cb => { cb.checked = false; });
    const gsReset = document.getElementById('vo-gender-sub');
    if (gsReset) gsReset.hidden = true;
    voRefreshSortButton();
    const panel = document.getElementById('vo-sort-panel');
    if (panel) panel.hidden = true;
    const btn = document.getElementById('vo-sort-btn');
    if (btn) { btn.classList.remove('vo-sort-open'); btn.setAttribute('aria-expanded', 'false'); }
}

function voRefreshSortButton() {
    const btn = document.getElementById('vo-sort-btn');
    const badge = document.getElementById('vo-sort-count');
    const n = voSortState.gender.size + voSortState.age.size + voSortState.record.size;
    if (btn) btn.classList.toggle('active-filter', n > 0);
    if (badge) { badge.textContent = n; badge.hidden = n === 0; }
}

window.toggleVoSortPanel = function(ev) {
    if (ev) ev.stopPropagation();
    const panel = document.getElementById('vo-sort-panel');
    const btn = document.getElementById('vo-sort-btn');
    if (!panel || !btn) return;
    const open = panel.hidden;               // hidden now → opening
    panel.hidden = !open;
    btn.classList.toggle('vo-sort-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
};

window.voSortChanged = function() {
    voSortState.gender.clear(); voSortState.age.clear(); voSortState.record.clear(); voSortState.missingFields.clear();
    document.querySelectorAll('#vo-sort-panel input[type="checkbox"]:checked, #vo-sort-panel input[type="radio"]:checked').forEach(cb => {
        const set = voSortState[cb.dataset.group];
        if (set) set.add(cb.value);
    });
    // The Male / Female section only exists while "Sort by gender" is ticked (and holds a single choice).
    const genderOn = !!(document.getElementById('vo-gender-toggle') || {}).checked;
    const genderSub = document.getElementById('vo-gender-sub');
    if (genderSub) genderSub.hidden = !genderOn;
    if (!genderOn) {
        voSortState.gender.clear();
        document.querySelectorAll('#vo-gender-sub input[type="radio"]').forEach(r => { r.checked = false; });
    }
    // The "which details" section only exists while "Missing details" is ticked.
    const sub = document.getElementById('vo-missing-sub');
    const missingOn = voSortState.record.has('missing');
    if (sub) sub.hidden = !missingOn;
    if (!missingOn) {
        voSortState.missingFields.clear();
        document.querySelectorAll('#vo-missing-sub input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    }
    voRefreshSortButton();
    renderViewOnlyTable();
};

window.voClearSort = function() {
    voSortState.gender.clear(); voSortState.age.clear(); voSortState.record.clear(); voSortState.missingFields.clear();
    const subClear = document.getElementById('vo-missing-sub');
    if (subClear) subClear.hidden = true;
    document.querySelectorAll('#vo-sort-panel input[type="checkbox"], #vo-sort-panel input[type="radio"]').forEach(cb => { cb.checked = false; });
    const gsClear = document.getElementById('vo-gender-sub');
    if (gsClear) gsClear.hidden = true;
    voRefreshSortButton();
    renderViewOnlyTable();
};

/* Close the pop-up when clicking outside it or pressing Escape. */
document.addEventListener('click', function(e) {
    const panel = document.getElementById('vo-sort-panel');
    if (!panel || panel.hidden) return;
    if (e.target.closest && e.target.closest('#vo-sort-wrap')) return;
    window.toggleVoSortPanel();
});
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    const panel = document.getElementById('vo-sort-panel');
    if (panel && !panel.hidden) { window.toggleVoSortPanel(); e.stopPropagation(); }
}, true);

/* ══════════════════════════════════════════════════════════════
   IN-APP CONFIRM DIALOG — replaces native window.confirm() with a
   themed dialog that matches the rest of the app. Self-contained:
   injects its own markup + styles on first use, so no HTML edits
   are required. Usage: const ok = await ssConfirm("message", opts)
   ══════════════════════════════════════════════════════════════ */
function ssConfirm(message, opts = {}) {
    if (!document.getElementById('ss-confirm-styles')) {
        const style = document.createElement('style');
        style.id = 'ss-confirm-styles';
        style.textContent = `
.ss-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:10000;opacity:0;transition:opacity .2s ease;padding:20px;}
.ss-confirm-overlay.show{opacity:1;}
.ss-confirm-box{background:var(--bg-card,#1e293b);border:1px solid var(--border-subtle,rgba(148,163,184,.2));border-radius:var(--radius-lg,20px);box-shadow:0 24px 60px rgba(0,0,0,0.4);padding:26px 24px 22px;max-width:380px;width:100%;text-align:center;transform:translateY(14px) scale(.97);transition:transform .2s ease;font-family:inherit;}
.ss-confirm-overlay.show .ss-confirm-box{transform:translateY(0) scale(1);}
.ss-confirm-icon{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;margin:0 auto 14px;}
.ss-confirm-icon.ss-danger{background:rgba(239,68,68,.12);color:#ef4444;}
.ss-confirm-icon.ss-info{background:rgba(59,130,246,.12);color:#3b82f6;}
.ss-confirm-title{font-size:16px;font-weight:800;color:var(--text-primary,#e8ecf4);margin-bottom:8px;}
.ss-confirm-message{font-size:13px;color:var(--text-secondary,#8892a8);line-height:1.55;margin-bottom:20px;white-space:pre-line;}
.ss-confirm-actions{display:flex;gap:10px;}
.ss-confirm-btn{flex:1;padding:10px 14px;border-radius:var(--radius-md,12px);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;border:1px solid var(--border-subtle,rgba(148,163,184,.2));background:transparent;color:var(--text-secondary,#8892a8);transition:all .2s ease;}
.ss-confirm-btn:hover{background:rgba(255,255,255,.06);}
[data-theme="light"] .ss-confirm-btn:hover{background:rgba(0,0,0,.04);}
.ss-confirm-ok{border-color:transparent;background:#17716A;color:#fff;}
.ss-confirm-ok:hover{background:#145f59;}
.ss-confirm-ok.ss-danger-btn{background:#ef4444;}
.ss-confirm-ok.ss-danger-btn:hover{background:#dc2626;}
@media (max-width:480px){.ss-confirm-box{padding:22px 18px 18px;}}
`;
        document.head.appendChild(style);
    }

    return new Promise(resolve => {
        const danger = opts.danger !== false;
        const overlay = document.createElement('div');
        overlay.className = 'ss-confirm-overlay';
        overlay.innerHTML = `
            <div class="ss-confirm-box">
                <div class="ss-confirm-icon ${danger ? 'ss-danger' : 'ss-info'}">
                    <i class="fas ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'}"></i>
                </div>
                <h4 class="ss-confirm-title"></h4>
                <p class="ss-confirm-message"></p>
                <div class="ss-confirm-actions">
                    <button type="button" class="ss-confirm-btn ss-confirm-cancel"></button>
                    <button type="button" class="ss-confirm-btn ss-confirm-ok ${danger ? 'ss-danger-btn' : ''}"></button>
                </div>
            </div>`;
        overlay.querySelector('.ss-confirm-title').textContent = opts.title || 'Please Confirm';
        overlay.querySelector('.ss-confirm-message').textContent = message;
        overlay.querySelector('.ss-confirm-cancel').textContent = opts.cancelLabel || 'Cancel';
        overlay.querySelector('.ss-confirm-ok').textContent = opts.confirmLabel || 'Confirm';

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('show'));

        function close(result) {
            overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 200);
            document.removeEventListener('keydown', escHandler);
            resolve(result);
        }
        function escHandler(e) { if (e.key === 'Escape') close(false); }

        overlay.querySelector('.ss-confirm-cancel').addEventListener('click', () => close(false));
        overlay.querySelector('.ss-confirm-ok').addEventListener('click', () => close(true));
        overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
        document.addEventListener('keydown', escHandler);
    });
}
window.ssConfirm = ssConfirm;

document.addEventListener('DOMContentLoaded', () => {

    // UI References: Navigation & Layout
    const sidebar        = document.getElementById('sidebar');
    const openSidebarBtn = document.getElementById('open-sidebar');
    const closeSidebarBtn= document.getElementById('close-sidebar');

    // UI References: Admission Form Elements
    const admissionForm    = document.getElementById('student-admission-form');

    /* Father Details: hidden when the Guardian Relation is "Father" (the guardian's name/CNIC are used
       as the father's on save); shown when a different relation (Mother, Uncle, …) is chosen. */
    function syncFatherSection() {
        const sec  = document.getElementById('father-details-section');
        const role = admissionForm && admissionForm.querySelector('[name="guardianRole"]');
        if (!sec || !role) return;
        const show = !!role.value && role.value !== 'Father';
        sec.style.display = show ? '' : 'none';
    }
    if (admissionForm) {
        const roleSel = admissionForm.querySelector('[name="guardianRole"]');
        if (roleSel) roleSel.addEventListener('change', syncFatherSection);
        admissionForm.addEventListener('reset', () => setTimeout(syncFatherSection, 0));
        syncFatherSection();
    }
    const editIdHidden     = document.getElementById('edit-student-id');
    const previewImg       = document.getElementById('student-img-preview');
    const studentPhotoInput= document.getElementById('student-photo');
    const certUploadInput  = document.getElementById('cert-upload');
    const certDataHidden   = document.getElementById('cert-data');
    const certUploadStatus = document.getElementById('cert-upload-status');
    const studentPhotoError= document.getElementById('student-photo-error');
    const certUploadError  = document.getElementById('cert-upload-error');

    // RACE-FIX — "photo/B-Form shows in the form but is missing after Save":
    // the photo/B-Form upload to /files/photo|/files/bform runs async in the
    // background (see the 'change' handlers below), while the on-screen
    // preview updates instantly from the local base64 the moment a file is
    // picked. If the user hits Save before that background upload finishes,
    // previewImg.dataset.uploadedPath / certDataHidden.value are still
    // empty, so the submit handler below deletes studentData.photo entirely
    // (its documented "no new photo" signal) — which for a brand-new
    // student means no photo is saved at all, even though it looked
    // attached on screen. These hold the in-flight upload promise so the
    // submit handler can await it before reading the uploaded path.
    let pendingPhotoUpload = null;
    let pendingBformUpload = null;

    // UI References: Form Inputs for Calculation
    const dobInput         = document.getElementById('student-dob');
    const ageInput         = document.getElementById('student-age');
    const admissionDateInput=document.getElementById('admission-date');
    const rollNoInput      = document.getElementById('roll-no-input');
    const displayRegBadge  = document.getElementById('display-reg-no');

    // UI References: Finance
    const feeStandard      = document.getElementById('fee-standard');
    const feeAdmission     = document.getElementById('fee-admission');
    const feeTuitionDisc   = document.getElementById('fee-discount-tuition');
    const feeTransDisc     = document.getElementById('fee-discount-transport');
    const feeSiblingDisc   = document.getElementById('fee-discount-sibling');
    const transportFeeInput= document.querySelector('input[name="transportFee"]');
    const netTotalInput    = document.getElementById('fee-net-total');

    // UI References: Address & Logic
    const permAddress    = document.getElementById('perm-address');
    const mailAddress    = document.getElementById('mail-address');
    const copyAddressBtn = document.getElementById('copy-address-btn');
    const lifetimeCheck  = document.getElementById('is-lifetime');
    const expiryGroup    = document.getElementById('expiry-date-group');

    // UI References: Search
    const searchName   = document.getElementById('search-name');
    const searchFather  = document.getElementById('search-father');
    const searchClass   = document.getElementById('search-class');
    const searchId      = document.getElementById('search-id');

    // UI References: Books & Other Fees
    const takeBooksBtn   = document.getElementById('take-books-btn');
    const booksFeePanel  = document.getElementById('books-fee-panel');
    const feeBooks       = document.getElementById('fee-books');
    const feeBooksDisc   = document.getElementById('fee-books-discount');
    const addOtherFeeBtn = document.getElementById('add-other-fee-btn');
    const otherFeesContainer = document.getElementById('other-fees-container');
    const otherFeesDataHidden= document.getElementById('other-fees-data');

    // UI References: Annual Fund
    const annualFundEnabled = document.getElementById('annual-fund-enabled');
    const annualFundPanel   = document.getElementById('annual-fund-panel');
    const annualFundAmount  = document.getElementById('annual-fund-amount');

    // (Orphan filter state now declared at top-level scope — see above)

    // Plan-enforcement constants (used by renderPlanLimitBanners/checkExpiry,
    // called from updateDashboardStats() below during initial page load) —
    // declared here, before that first call, so they're not still in the
    // temporal dead zone when referenced. They used to live further down
    // near the plan-enforcement block, which is fine for function
    // declarations (hoisted) but NOT for const/let: those stay unusable
    // until the line that declares them actually runs.
    /** How many free slots remain before the "getting close to the limit" warning shows. */
    const LIMIT_WARNING_THRESHOLD = 5;
    /** Days before School.expiryDate the blinking subscription badge starts showing. */
    const EXPIRY_WARNING_DAYS = 30;

    // ── LIVE SYNC (REAL-TIME UPDATES, NO MANUAL RELOAD) ─────────────────────
    // Polls the Spring Boot backend on an interval and, only when the data has
    // actually changed, merges it in and re-renders — so admissions/edits/
    // deletes made from ANY device/tab show up here automatically.
    const LIVE_SYNC_INTERVAL_MS = 6000;   // how often to check the server
    let   liveSyncTimer         = null;
    let   lastServerSnapshot    = null;   // JSON fingerprint of last-seen server data
    let   isSyncing             = false;  // prevents overlapping fetches
    // BASE64 PHOTO/B-FORM FIX — see loadStudentMediaInBackground() below.
    let   studentMediaLoaded    = false;  // true once photo/certData base64 has been pulled for this session
    let   studentMediaLoading   = false;  // true while that background fetch is in flight
    window.ssStudentMediaReady = function() { return studentMediaLoaded; };  // used by Manage Records "Sort By"
    let   liveSyncFailStreak    = 0;      // backs off polling if server is unreachable
    let   suppressNextLiveToast = false;  // true right after THIS tab made its own save/delete

    // ── 1. CORE SYSTEM INITIALIZATION ───────────────────────────────────────

    // Ensure orphan-filter buttons always start in a known, inactive visual
    // state on page load, regardless of any leftover markup/classes.
    updOrphanFilterActive = false;
    voOrphanFilterActive = false;
    ['upd-orphan-filter-btn', 'vo-orphan-filter-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.remove('active-filter');
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    });

    if (admissionDateInput) admissionDateInput.valueAsDate = new Date();
    updateDashboardStats();

    // Pull the live roster from MySQL as soon as the page loads, so the
    // tables/dashboard reflect the database instead of a stale local cache.
    // Classes are fetched from Settings' backend row at the same time (they
    // used to come from localStorage, which Settings no longer writes to).
    // Then start polling in the background so this page never needs a manual
    // browser reload to pick up changes made elsewhere (see startLiveSync()).
    ssEnsureMediaToken(); // photo/B-Form URLs need it; runs in parallel, never blocks the page
    Promise.all([syncWithBackend(), fetchClassConfigsFromServer(), fetchStaffFromServer()]).then(() => {
        refreshClassUI();
        startLiveSync();
    });

    // ── THEME TOGGLE ─────────────────────────────────────────────────────────
    // 'softschool-theme' ('light' | 'dark') is the ONLY thing this app ever
    // stores in localStorage — everything else (students, classes, school
    // info, staff) lives in the backend database. See the block comment
    // near CLASS_CONFIGS_CACHE above for the full rationale.
    (function initTheme() {
        const toggleBtn = document.getElementById('theme-toggle');
        const root = document.documentElement;
        const stored = localStorage.getItem('softschool-theme');
        const savedTheme = (stored === 'light' || stored === 'dark') ? stored : 'dark';
        root.setAttribute('data-theme', savedTheme);
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const current = root.getAttribute('data-theme');
                const next = current === 'dark' ? 'light' : 'dark';
                root.setAttribute('data-theme', next);
                localStorage.setItem('softschool-theme', next);
            });
        }
    })();

    // ── HEADER DATE ──────────────────────────────────────────────────────────
    (function initDate() {
        const dateEl = document.getElementById('header-date');
        if (dateEl) {
            const now = new Date();
            const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
            dateEl.textContent = now.toLocaleDateString('en-US', options);
        }
    })();

    // ── 2. SIDEBAR & NAVIGATION CONTROLS ────────────────────────────────────

    // Create overlay for sidebar
    const sidebarOverlay = document.createElement('div');
    sidebarOverlay.className = 'sidebar-overlay';
    document.body.appendChild(sidebarOverlay);

    function closeSidebar() {
        sidebar.classList.remove('active');
        sidebarOverlay.classList.remove('active');
    }

    if (openSidebarBtn)  openSidebarBtn.addEventListener ('click', () => {
        sidebar.classList.add('active');
        sidebarOverlay.classList.add('active');
    });
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // ── 3. MODAL ARCHITECTURE ────────────────────────────────────────────────

    window.openModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        if (modalId === 'student-modal') {
            const isEdit = editIdHidden.value !== "";
            // New school with no current session / no classes yet: show the setup message instead of the form
            if (!isEdit && window.SoftSchoolSetupCheck && window.SoftSchoolSetupCheck.blockAdmission()) return;
            if (!isEdit && !canAdmitNewStudent()) {
                showToast("Limit Reached", `Your plan allows up to ${getStudentLimit()} active students. Upgrade your plan to register more.`, "danger");
                return;
            }
            if (!isEdit) {
                admissionForm.reset();
                editIdHidden.value = "";
                previewImg.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJQAAACUCAYAAAB1Va3RAAAACXBIWXMAAAsTAAALEwEAmpwYAAADu0lEQVR4nO3dy0pUYRSG4f9mZpYjSclS0DSIIAsZonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXf6S/8AvW7ZicAAAAASUVORK5CYII=";
                // BUGFIX -- a stale uploadedPath from a previously-open student
                // (their newly-picked photo's server path) was never cleared
                // when opening this form again for a brand-new admission. On
                // Save, that leftover path got attached to the NEW student
                // (see the admission-submit handler's 'if
                // (previewImg.dataset.uploadedPath)' check below) -- i.e. a
                // different student's photo silently ended up saved onto this
                // one, or a since-deleted path that 404s so no photo shows.
                delete previewImg.dataset.uploadedPath;
                document.getElementById('form-modal-title').innerHTML =
                    '<i class="fas fa-user-plus"></i> Student Admission Entry';
                document.getElementById('form-submit-btn').innerText = 'Finalize Admission';

                const nextRegNo = generateNextRegistrationNumber(admissionDateInput ? admissionDateInput.value : '');
                rollNoInput.value = '—';
                displayRegBadge.innerText = nextRegNo;
                admissionForm.dataset.pendingRegNo = nextRegNo;

                // New admission — never a sibling badge to show yet
                const newSiblingBadge = document.getElementById('edit-sibling-badge');
                if (newSiblingBadge) { newSiblingBadge.style.display = 'none'; newSiblingBadge.innerHTML = ''; }

                // New admission — no B-Form/certificate on file yet either
                if (certUploadStatus) certUploadStatus.style.display = 'none';

                if (booksFeePanel) {
                    booksFeePanel.style.display = 'none';
                    if (takeBooksBtn) takeBooksBtn.innerHTML = '<i class="fas fa-book"></i> Take Books';
                }
                resetOtherFeesUI([]);

                // Reset annual fund
                if (annualFundEnabled) {
                    annualFundEnabled.checked = false;
                    if (annualFundPanel) annualFundPanel.style.display = 'none';
                    if (annualFundAmount) annualFundAmount.value = ANNUAL_FUND_AMOUNT;
                }
            }
        }

        if (modalId === 'view-modal') {
            // Clear hidden search inputs (kept for backward compat)
            [searchName, searchFather, searchClass, searchId].forEach(inp => {
                if (inp) inp.value = '';
            });
            // Clear the new unified search bar
            const updSearch = document.getElementById('upd-search-input');
            if (updSearch) updSearch.value = '';
            // Always re-open on the class-cards stage
            updActiveClass = null;
            updActiveSection = null;
            updOrphanFilterActive = false;
            const updOrphanBtn = document.getElementById('upd-orphan-filter-btn');
            if (updOrphanBtn) {
                updOrphanBtn.classList.remove('active-filter');
                updOrphanBtn.setAttribute('aria-pressed', 'false');
                updOrphanBtn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
            }
            updRenderClassCards();
            updShowStage('classes');
        }

        if (modalId === 'bulk-transfer-modal' && window.btfReset) window.btfReset();

        if (modalId === 'view-only-modal') {
            if (window.voResetPromoteMode) window.voResetPromoteMode();
            const searchEl = document.getElementById('vo-search-name');
            if (searchEl) searchEl.value = '';
            // Always re-open on the class-cards stage
            voActiveClass = null;
            voActiveSection = null;
            voOrphanFilterActive = false;
            const voOrphanBtn = document.getElementById('vo-orphan-filter-btn');
            if (voOrphanBtn) {
                voOrphanBtn.classList.remove('active-filter');
                voOrphanBtn.setAttribute('aria-pressed', 'false');
                voOrphanBtn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
            }
            voResetSortUI();
            voRenderClassCards();
            voShowStage('classes');
        }

        // School phone/address are set on the Settings page only — this page
        // just fetches and displays them, every time a certificate modal opens.
        if (modalId === 'slc-modal' || modalId === 'character-modal') {
            const prefix = modalId === 'slc-modal' ? 'slc' : 'char';
            const phone   = getSchoolContactPhone();
            const address = getSchoolContactAddress();
            const telEl   = document.getElementById(`${prefix}-school-tel`);
            const addrEl  = document.getElementById(`${prefix}-school-address`);
            if (telEl)  telEl.textContent  = phone   || 'Loading…';
            if (addrEl) addrEl.textContent = address || 'Loading…';
            // Not in the cache yet? Fetch it now and fill it in (only then say "Not set").
            if (!phone || !address) {
                ensureSchoolInfoLoaded().then(() => {
                    if (telEl)  telEl.textContent  = getSchoolContactPhone()   || 'Not set in Settings';
                    if (addrEl) addrEl.textContent = getSchoolContactAddress() || 'Not set in Settings';
                });
            }
        }

        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    };

    window.closeModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
            if (modalId === 'student-modal') {
                editIdHidden.value = "";
                // BUGFIX -- third and last place this flag needs clearing:
                // if the form is closed (Cancel, backdrop click, X button)
                // without saving -- whether or not a new photo was picked --
                // nothing should carry over into whichever student this
                // modal is opened for next.
                delete previewImg.dataset.uploadedPath;
            }
        }
    };

    // ── 4. FORM LOGIC & CALCULATION ENGINES ──────────────────────────────────

    function calculateAge(dobString) {
        if (!dobString) return "";
        const dob   = new Date(dobString);
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
        return age >= 0 ? age + " Years" : "Invalid Date";
    }

    if (dobInput) {
        dobInput.addEventListener('change', () => {
            ageInput.value = calculateAge(dobInput.value);
        });
    }

    function getOtherFeesTotal() {
        try {
            const rows = JSON.parse(otherFeesDataHidden.value || '[]');
            return rows.reduce((sum, r) => sum + ((parseFloat(r.amount) || 0) - (parseFloat(r.discount) || 0)), 0);
        } catch (e) { return 0; }
    }

    function performFinancialAudit() {
        const v = el => (el && el.value !== undefined) ? (parseFloat(el.value) || 0) : 0;
        const standard     = v(feeStandard);
        const admission    = v(feeAdmission);
        const tDisc        = v(feeTuitionDisc);
        const trDisc       = v(feeTransDisc);
        const sibDisc      = v(feeSiblingDisc);
        const monthlyTrans = v(transportFeeInput);
        // NOTE: Books fee and Other fees are intentionally excluded from the
        // database net total — they appear only on the voucher at print time.
        const netTotal = (standard + admission + monthlyTrans) - (tDisc + trDisc + sibDisc);
        if (netTotalInput) netTotalInput.value = Math.max(0, netTotal).toFixed(0);
    }

    [feeStandard, feeAdmission, feeTuitionDisc, feeTransDisc, feeSiblingDisc, transportFeeInput, feeBooks, feeBooksDisc].forEach(el => {
        if (el) el.addEventListener('input', performFinancialAudit);
    });

    // ── TAKE BOOKS TOGGLE ────────────────────────────────────────────────────
    if (takeBooksBtn) {
        takeBooksBtn.addEventListener('click', () => {
            const isHidden = booksFeePanel.style.display === 'none' || booksFeePanel.style.display === '';
            booksFeePanel.style.display = isHidden ? 'grid' : 'none';
            takeBooksBtn.innerHTML = isHidden
                ? '<i class="fas fa-book-open"></i> Hide Books Fee'
                : '<i class="fas fa-book"></i> Take Books';
            performFinancialAudit();
        });
    }

    // ── OTHER FEES: DYNAMIC ROWS ─────────────────────────────────────────────

    function readOtherFeesFromDOM() {
        const rows = [];
        if (!otherFeesContainer) return rows;
        otherFeesContainer.querySelectorAll('.other-fee-row').forEach(rowEl => {
            rows.push({
                description: rowEl.querySelector('.other-fee-desc').value || '',
                amount:      rowEl.querySelector('.other-fee-amount').value || 0,
                discount:    rowEl.querySelector('.other-fee-discount').value || 0
            });
        });
        return rows;
    }

    function syncOtherFeesHidden() {
        otherFeesDataHidden.value = JSON.stringify(readOtherFeesFromDOM());
        performFinancialAudit();
    }

    function addOtherFeeRow(data = { description: '', amount: 0, discount: 0 }) {
        if (!otherFeesContainer) return;
        const row = document.createElement('div');
        row.className = 'other-fee-row';
        row.style.cssText = 'display:grid; grid-template-columns: 2fr 1fr 1fr auto; gap:12px; align-items:end; background:#f8fafc; padding:14px; border-radius:10px; border:1px solid var(--border-color);';
        row.innerHTML = `
            <div class="form-input-group">
                <label>Description</label>
                <input type="text" class="other-fee-desc" placeholder="e.g. Lab Fee" value="${data.description || ''}">
            </div>
            <div class="form-input-group">
                <label>Amount</label>
                <input type="number" class="other-fee-amount" value="${data.amount || 0}">
            </div>
            <div class="form-input-group">
                <label>Discount</label>
                <input type="number" class="other-fee-discount" value="${data.discount || 0}">
            </div>
            <button type="button" class="btn-icon delete remove-other-fee" title="Remove"><i class="fas fa-trash-alt"></i></button>
        `;
        otherFeesContainer.appendChild(row);

        row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', syncOtherFeesHidden));
        row.querySelector('.remove-other-fee').addEventListener('click', () => {
            row.remove();
            syncOtherFeesHidden();
        });
    }

    if (addOtherFeeBtn) {
        addOtherFeeBtn.addEventListener('click', () => addOtherFeeRow());
    }

    function resetOtherFeesUI(rows = []) {
        if (!otherFeesContainer) return;
        otherFeesContainer.innerHTML = '';
        rows.forEach(r => addOtherFeeRow(r));
        otherFeesDataHidden.value = JSON.stringify(rows);
    }

    if (copyAddressBtn) {
        copyAddressBtn.addEventListener('click', () => {
            mailAddress.value = permAddress.value;
            showToast("Address Synced", "Mailing address updated to match permanent address.", "info");
        });
    }

    if (lifetimeCheck) {
        lifetimeCheck.addEventListener('change', function() {
            expiryGroup.style.opacity      = this.checked ? "0.4" : "1";
            expiryGroup.style.pointerEvents= this.checked ? "none" : "all";
        });
    }

    // ── ANNUAL FUND TOGGLE ───────────────────────────────────────────────────
    if (annualFundEnabled) {
        annualFundEnabled.addEventListener('change', function() {
            annualFundPanel.style.display = this.checked ? 'block' : 'none';
        });
    }

    // ── CLASS / SECTION DROPDOWNS — POPULATED FROM SETTINGS ─────────────────
    const classSelect   = admissionForm ? admissionForm.querySelector('[name="studentClass"]') : null;
    const sectionSelect = document.getElementById('section-select');

    /**
     * Rebuild the Class <select> using the configs saved on the Settings page.
     * Preserves the currently-selected class if it still exists.
     */
    function populateClassDropdown() {
        if (!classSelect) return;
        const previous = classSelect.value;
        const configs  = getClassConfigs();
        classSelect.innerHTML =
            '<option value="">Select Class</option>' +
            configs.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        if (previous && configs.some(c => c.name === previous)) {
            classSelect.value = previous;
        }
    }

    /**
     * Rebuild the Section <select> for the currently-selected class.
     * Only shows sections configured in Settings. If the class has NO sections
     * configured, the field is hidden and required is removed so the form can submit.
     */
    function populateSectionDropdown(className) {
        if (!sectionSelect) return;
        const previous = sectionSelect.value;
        const cfg = getClassConfigMap()[className];
        // Only use configured sections — no fallback so "None" in settings = no sections
        const sections = (cfg && Array.isArray(cfg.sections) && cfg.sections.length)
            ? cfg.sections
            : [];

        const fieldGroup = document.getElementById('section-field-group');

        if (sections.length === 0) {
            // No sections configured: hide field, clear value, remove required
            sectionSelect.innerHTML = '<option value="">No sections configured</option>';
            sectionSelect.value = '';
            sectionSelect.removeAttribute('required');
            if (fieldGroup) fieldGroup.style.display = 'none';
        } else {
            // Sections available: show field, make it required
            sectionSelect.innerHTML =
                '<option value="">Select Section</option>' +
                sections.map(s => `<option value="${s}">${s}</option>`).join('');
            sectionSelect.setAttribute('required', '');
            if (fieldGroup) fieldGroup.style.display = '';
            if (previous && sections.includes(previous)) {
                sectionSelect.value = previous;
            }
        }
    }

    populateClassDropdown();
    populateSectionDropdown('');

    // NOTE: class-list changes made on the Settings page (even from another
    // tab/device) are picked up via the backend poll in pollClassConfigs()
    // (see startLiveSync()) — no localStorage 'storage' event needed here.

    if (classSelect) {
        classSelect.addEventListener('change', function() {
            // Rebuild sections list for the chosen class
            populateSectionDropdown(this.value);

            if (this.value) {
                rollNoInput.value = generateClassRollNumber(this.value);

                // Auto-populate standard tuition fee from settings
                const classFee = getStandardFeeForClass(this.value);
                feeStandard.value = classFee;

                // Auto-populate annual fund amount from settings
                if (annualFundAmount) {
                    annualFundAmount.value = getAnnualFundForClass(this.value);
                }

                performFinancialAudit();
            }
        });
    }

    // ── 5. MEDIA & FILE HANDLING ─────────────────────────────────────────────

    const MAX_UPLOAD_SIZE_BYTES = 200 * 1024; // 200KB
    const MAX_UPLOAD_SIZE_LABEL = "200KB";

    /** Hide/reset a field's inline error message. */
    function clearUploadError(errorEl) {
        if (!errorEl) return;
        errorEl.classList.remove('show');
        const span = errorEl.querySelector('span');
        if (span) span.textContent = '';
    }

    /** Show a field's inline error message (red, fade-in via CSS). */
    function showUploadError(errorEl, message) {
        if (!errorEl) return;
        const span = errorEl.querySelector('span');
        if (span) span.textContent = message;
        else errorEl.textContent = message;
        // Restart the fade-in animation even if it's already visible
        errorEl.classList.remove('show');
        void errorEl.offsetWidth; // force reflow to re-trigger CSS animation
        errorEl.classList.add('show');
    }

    /**
     * Validates a file's size against the 200KB limit.
     * On failure: clears the input, shows the red error message, and returns false.
     * On success: clears any prior error message and returns true.
     */
    function validateUploadSize(inputEl, file, errorEl) {
        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
            inputEl.value = ''; // clear the input so the rejected file isn't submitted
            showUploadError(errorEl, `File exceeds ${MAX_UPLOAD_SIZE_LABEL}. Choose a smaller file.`);
            showToast("File Too Large", `File exceeds ${MAX_UPLOAD_SIZE_LABEL}. Choose a smaller file.`, "danger");
            return false;
        }
        clearUploadError(errorEl);
        return true;
    }

    if (studentPhotoInput) {
    studentPhotoInput.addEventListener('change', function() {
        const file = this.files[0];
        if (!file) return;

        // RACE-FIX: wrap the whole async upload in a promise stashed on
        // pendingPhotoUpload, so admissionForm.onsubmit can await it if the
        // user hits Save before this finishes (see the note above).
        pendingPhotoUpload = (async () => {
            if (!validateUploadSize(this, file, studentPhotoError)) {
                return;
            }
            showToast("Processing", "Optimizing photo...", "info");
            // Face photo: 500px width is plenty
            const compressedBase64 = await compressImage(file, 500, 0.8);
            previewImg.src = compressedBase64; // local preview

            // FILE STORAGE: upload the compressed image to the server and
            // keep only the returned short path ("photos/uuid.jpg") as
            // Student.photo. If the upload fails for any reason, fall back to
            // sending the inline base64 exactly like before, so saving a
            // student is never blocked and no photo is ever lost.
            try {
                const photoBlob = ssDataUriToBlob(compressedBase64);
                previewImg.dataset.uploadedPath = await ssUploadStudentFile(photoBlob, 'photo', 'photo.jpg');
                showToast("Photo Ready", "Photo attached.", "success");
            } catch (uploadErr) {
                console.warn('Photo upload failed, keeping inline copy:', uploadErr);
                previewImg.dataset.uploadedPath = compressedBase64;
                showToast("Photo Ready", "Photo attached (saved inline).", "success");
            }
        })();
    });
}

// --- UPDATED B-FORM HANDLER ---
if (certUploadInput) {
    certUploadInput.addEventListener('change', function() {
        const file = this.files[0];
        if (!file) return;

        // RACE-FIX: same pattern as pendingPhotoUpload above — stash the
        // in-flight upload so admissionForm.onsubmit can wait for it.
        pendingBformUpload = (async () => {
            if (!validateUploadSize(this, file, certUploadError)) {
                return;
            }
            showToast("Processing", "Optimizing document...", "info");

            // FILE STORAGE: the compressed image (1600px keeps B-Form text
            // sharp) or the PDF is uploaded as a real file and only the
            // returned path ("bforms/uuid.pdf") is saved as certData. If the
            // upload fails, the inline base64 is used instead (old behaviour)
            // so the document is never lost.
            try {
                let dataUri = null;
                let storedValue;
                const isPdfFile = file.type === 'application/pdf';
                try {
                    if (isPdfFile) {
                        storedValue = await ssUploadStudentFile(file, 'bform', 'bform.pdf');
                    } else {
                        dataUri = await compressImage(file, 1600, 0.7);
                        storedValue = await ssUploadStudentFile(ssDataUriToBlob(dataUri), 'bform', 'bform.jpg');
                    }
                } catch (uploadErr) {
                    console.warn('B-Form upload failed, keeping inline copy:', uploadErr);
                    if (!dataUri) {
                        dataUri = isPdfFile ? await fileToDataUri(file) : await compressImage(file, 1600, 0.7);
                    }
                    storedValue = dataUri;
                }
                certDataHidden.value = storedValue;
                // A new file was just attached — the "already on file" note now
                // refers to a stale/replaced document, so hide it.
                if (certUploadStatus) certUploadStatus.style.display = 'none';
                showToast("File Ready", "Document attached.", "success");
            } catch (err) {
                console.error('B-Form processing failed:', err);
                showToast("Upload Failed", "Could not attach the document. Please try again.", "danger");
            }
        })();
    });
}

    // ── 6. DATA PERSISTENCE (CRUD) ───────────────────────────────────────────

    /**
     * Two-digit admission/appointment year used inside registration numbers
     * (e.g. "26" for 2026). Reads the year out of a yyyy-mm-dd date string
     * (as produced by a <input type="date">); falls back to today's year
     * when the date is missing/unparseable, so a badge can still be shown
     * before the user has picked a date.
     */
    function getRegNoYearSuffix(dateStr) {
        let d = dateStr ? new Date(dateStr) : new Date();
        if (isNaN(d.getTime())) d = new Date();
        return String(d.getFullYear()).slice(-2);
    }

    /**
     * Generate the next registration number using THIS school's own prefix
     * (set in Super Admin → school → "Registration prefix"; falls back to
     * name initials, then to "HRK" only if no school is logged in at all)
     * PLUS the 2-digit admission year.
     * Scans ALL records (including siblings) for the highest number already
     * used WITH THE CURRENT PREFIX AND YEAR, so switching a school's prefix
     * in Super Admin — or simply admitting into a new year — cleanly starts
     * a fresh sequence instead of silently reusing/colliding with old
     * numbers.
     * Format: PREFIX_YY_1, PREFIX_YY_2, PREFIX_YY_3 … (e.g. PSC_26_1,
     * PSC_26_2 …) — no leading zeros on the sequence number, starts at 1
     * for each prefix+year combination.
     */
    function generateNextRegistrationNumber(admissionDateStr) {
        const db = getDatabase();
        const yearSuffix = getRegNoYearSuffix(admissionDateStr);
        let maxSeq = 0;
        const prefixRegex = new RegExp('^' + escapeRegExp(SYSTEM_PREFIX) + yearSuffix + '_(\\d+)$');
        db.forEach(s => {
    // Check both regNo and id fields so we never collide
    [s.regNo, s.id].forEach(val => {
        if (val !== undefined && val !== null) {
            // Force val to a string to prevent .match is not a function error
            const strVal = String(val); 
            const match = strVal.match(prefixRegex);
            if (match) {
                const seq = parseInt(match[1], 10);
                if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
            }
        }
    });
});
        // next number — no leading zeros, starts at 1 for this prefix+year
        return `${SYSTEM_PREFIX}${yearSuffix}_${maxSeq + 1}`;
    }

    /**
     * The "next reg no" badge shown when the admission modal opens is cached in
     * admissionForm.dataset.pendingRegNo so it stays visible while the form is filled in.
     * If enough time passes — or another admission/import happens in another tab — before
     * the form is submitted, that cached number can go stale and collide with a regNo that
     * was assigned to someone else in the meantime. This re-validates against the live
     * database right before the regNo is actually used, and silently generates a fresh one
     * if the cached value is no longer free. This was the root cause of two different
     * students ending up with the same Reg No (which then made Delete/Edit sometimes act
     * on the wrong — already archived — record).
     *
     * Also re-validates the YEAR baked into the cached number: the badge is
     * first generated when the modal opens (using whatever admission date is
     * in the form at that moment, usually today), but the user is free to
     * change the admission date before submitting. If the final admission
     * date falls in a different year than the cached badge assumed, the
     * cached number is discarded and a fresh one is generated for the
     * correct year instead — so the registration number always matches the
     * student's actual admission year.
     */
    function resolveFreshRegNo(db, cachedRegNo, admissionDateStr) {
        const yearSuffix = getRegNoYearSuffix(admissionDateStr);
        const expectedYearPrefix = `${SYSTEM_PREFIX}${yearSuffix}_`;
        const cachedYearMatches = !!cachedRegNo && cachedRegNo.indexOf(expectedYearPrefix) === 0;
        const taken = cachedRegNo && db.some(s => s.regNo === cachedRegNo || s.id === cachedRegNo);
        return (cachedRegNo && cachedYearMatches && !taken) ? cachedRegNo : generateNextRegistrationNumber(admissionDateStr);
    }

    /**
     * Generate class-based roll number.
     * Sequential within each class, starting from 1.
     */
    function generateClassRollNumber(studentClass) {
        if (!studentClass) return '1';
        const db = getActiveDatabase();
        const classStudents = db.filter(s => s.studentClass === studentClass);
        let maxRoll = 0;
        classStudents.forEach(s => {
            const roll = parseInt(s.rollNo, 10);
            if (!isNaN(roll)) maxRoll = Math.max(maxRoll, roll);
        });
        return String(maxRoll + 1);
    }

    /**
     * Get (or create) the sibling-group ID for a family.
     *
     * Logic:
     *   - If the matched (original) student already has a persisted
     *     `siblingGroupId`, reuse it — everyone in that family already
     *     shares it.
     *   - Otherwise generate a brand-new 00X code (next available number,
     *     computed from every student's persisted `siblingGroupId`).
     *
     * Format: 001, 002, 003 … (always 3 digits after "00")
     */
    function getOrCreateSiblingGroupId(matchedStudent) {
        // BUGFIX (two unrelated families both getting group "001"):
        // This used to check `matchedStudent.id` for a "00" prefix instead
        // of the persisted `siblingGroupId` field. `id` is frontend-only
        // plumbing — on every fresh page load / first sync, it gets rebuilt
        // purely from regNo (see syncWithBackend()'s merge logic), which
        // silently resets EVERY student's `id` back to their own regNo,
        // even students already locked into a sibling group. So after any
        // reload, the old scan below always found zero ids starting with
        // "00", concluded no group existed yet, and handed out "001" again
        // — merging a brand-new, unrelated family into the first family's
        // group. `siblingGroupId` is an actual persisted column
        // (Student.java / StudentController), sent to and reloaded from
        // the backend every time, so it's the only value guaranteed to
        // survive a reload — use that instead.
        // Already has a persisted group id?
        if (matchedStudent.siblingGroupId) {
            return String(matchedStudent.siblingGroupId);
        }
        // Generate next group number — scan the persisted siblingGroupId
        // field (not the disposable `id` field) so this reflects every
        // group that has ever been created, survives reloads, and never
        // reuses a number that's already taken.
        const db = getDatabase();
        let maxGroup = 0;
        db.forEach(s => {
            if (s.siblingGroupId) {
                const match = String(s.siblingGroupId).match(/^00(\d+)$/);
                if (match) maxGroup = Math.max(maxGroup, parseInt(match[1], 10));
            }
        });
        return `${SIBLING_PREFIX}${String(maxGroup + 1).padStart(1, '0')}`;
        // Produces: 001, 002, 003 …
    }

    /**
     * Build the "Sibling of X, Y and Z" display string for one member,
     * given the full list of OTHER members' names.
     */
    function buildSiblingOfString(otherNames) {
        if (!otherNames || otherNames.length === 0) return '';
        if (otherNames.length === 1) return otherNames[0];
        const allButLast = otherNames.slice(0, -1);
        const last       = otherNames[otherNames.length - 1];
        return `${allButLast.join(', ')} and ${last}`;
    }

    /**
     * After any sibling addition/deletion, rebuild "siblingOf" strings for
     * every member of a family group so the text is always up-to-date.
     *
     * @param {Array}  db          — the full database array (mutated in place)
     * @param {string} groupId     — the shared 00X id of the family
     */
    function refreshSiblingOfStrings(db, groupId) {
        // Collect ALL members of this group (original + all siblings)
        const members = db.filter(s => s.id === groupId || s.regNo === undefined ? false : s.siblingGroupId === groupId);

        // Simpler: collect by groupId stored directly
        const groupMembers = db.filter(s => s.siblingGroupId === groupId);

        if (groupMembers.length === 0) return;

        // Only ACTIVE members count as a live sibling connection. A graduated
        // or dropped-out member should no longer be named in an active
        // sibling's "Sibling of ..." text, and should stop having active
        // members named in their own (their record keeps whatever it last
        // said, as a historical snapshot, instead of being rewritten here).
        const activeMembers = groupMembers.filter(isActiveStudent);
        const allNames = activeMembers.map(s => s.fullName);

        activeMembers.forEach(member => {
            const otherNames = allNames.filter(n => n !== member.fullName);
            member.siblingOf = buildSiblingOfString(otherNames);
        });
    }

    /**
     * Normalize a string for comparison (trim + lowercase)
     */
    function normalizeForCompare(value) {
        return (value || "").toString().trim().toLowerCase();
    }

    /**
     * Unified student search matcher — used by the View and Update search bars.
     * Supports the "~" (tilde) shortcut to search by Student Name AND Father /
     * Guardian Name together in one go, e.g. typing:
     *   Ali~Khan
     * finds students named "Ali" whose guardian's name includes "Khan".
     * Without a "~" it falls back to a general match across name, reg no,
     * student ID and guardian name.
     */
    function studentMatchesSearch(s, rawQuery) {
         const query = (rawQuery || '').toLowerCase().trim();
    if (!query) return true;

       const name     = (s.fullName || '').toLowerCase();
    const guardian = (s.guardianName || '').toLowerCase();
    // FIX: Force to string before calling toLowerCase
    const regNo    = String(s.regNo || '').toLowerCase(); 
    const id       = String(s.id || '').toLowerCase();

        if (query.includes('~')) {
            const [namePartRaw, fatherPartRaw] = query.split('~');
            const namePart   = (namePartRaw || '').trim();
            const fatherPart = (fatherPartRaw || '').trim();
            const nameOk   = !namePart   || name.includes(namePart);
            const fatherOk = !fatherPart || guardian.includes(fatherPart);
            return nameOk && fatherOk;
        }

        return name.includes(query) || guardian.includes(query) || regNo.includes(query) || id.includes(query);
    }

    /**
     * Check if the new student is a sibling of an existing record.
     * Match criteria: Father Full Name + Father CNIC ONLY. Guardian name/CNIC/role and
     * address are deliberately NOT used. Father details must be filled in on BOTH
     * records and be identical — a blank father name/CNIC never matches, so students
     * without father details are never offered as siblings.
     *
     * A graduated or dropped-out student is intentionally excluded from this
     * search: once a student has left the school (status !== 'active'), a
     * new admission that shares their guardian info should NOT be offered a
     * sibling link to them. Siblings should only ever be connected while
     * both records are on the live/active roster.
     */
    function fatherCnicDigits(value) {
        return (value || "").toString().replace(/\D/g, "");
    }

    function fatherDetailsMatch(a, b) {
        const nameA = normalizeForCompare(a.fatherFullName).replace(/\s+/g, " ");
        const nameB = normalizeForCompare(b.fatherFullName).replace(/\s+/g, " ");
        const cnicA = fatherCnicDigits(a.fatherCnic);
        const cnicB = fatherCnicDigits(b.fatherCnic);
        if (!nameA || !nameB || !cnicA || !cnicB) return false;
        return nameA === nameB && cnicA === cnicB;
    }

    function findGuardianMatch(newData, db) {
        return db.find(s =>
            isActiveStudent(s) &&
            fatherDetailsMatch(s, newData)
        ) || null;
    }

    /**
     * Backend is the single source of truth — no localStorage cache anymore.
     * getDatabase() simply reads the in-memory mirror (API_STUDENTS), which is
     * populated by syncWithBackend() on page load and kept current by every
     * apiSaveStudent()/apiDeleteStudent() call. saveDatabase() only updates
     * that in-memory mirror; callers are responsible for also pushing the
     * change to the backend (apiSaveStudent/apiDeleteStudent) where needed.
     */
    function getDatabase() {
        return Array.isArray(API_STUDENTS) ? API_STUDENTS : [];
    }
    function saveDatabase(d)  {
        API_STUDENTS = d; // in-memory mirror only — backend is the real store
    }
    // BUGFIX: getDatabase/saveDatabase are declared inside this
    // DOMContentLoaded closure, so they were only ever visible to code
    // written *inside* it. exportStudentsToExcel(), importStudentsFromExcel(),
    // slcSearchStudents() and charSearchStudents() are all defined further
    // down the file, OUTSIDE this closure (same pattern as `showToast` just
    // above), so calling the bare getDatabase()/saveDatabase() from any of
    // them threw an immediate "getDatabase is not defined" — which is why
    // clicking "Export Data" silently did nothing. Exposing them on
    // `window`, exactly like showToast already is, makes them reachable
    // from anywhere in the file.
    window.getDatabase  = getDatabase;
    window.saveDatabase = saveDatabase;
    // The column-mapping importer (outside this closure) also needs these.
    window.getActiveDatabase               = getActiveDatabase;
    window.getStudentLimit                 = getStudentLimit;
    window.generateNextRegistrationNumber  = generateNextRegistrationNumber;
    window.updateDashboardStats            = updateDashboardStats;
    window.SoftSchoolRefreshStudentViews   = function () {
        updateDashboardStats();
        if (typeof renderStudentTable === 'function')   renderStudentTable();
        if (typeof renderViewOnlyTable === 'function')  renderViewOnlyTable();
        if (typeof updRenderClassCards === 'function')  updRenderClassCards();
        if (typeof voRenderClassCards === 'function')   voRenderClassCards();
    };

    // ── ARCHIVE HELPERS ──────────────────────────────────────────────────────
    // A student with no `status` (or status "active") is on the live roster.
    // "graduated" / "dropped" students are excluded from every active list
    // (dashboard counters, class cards, roll numbers, search tables) and only
    // surface inside the Archive Center.
    function isActiveStudent(s)     { return !s.status || s.status === 'active'; }
    function getActiveDatabase() {
        return getDatabase().filter(s => !s.status || s.status === 'active');
    }
    function getGraduatedStudents() { return getDatabase().filter(s => s.status === 'graduated'); }
    function getDroppedStudents()   { return getDatabase().filter(s => s.status === 'dropped'); }

    // ── BACKEND SYNC HELPERS ─────────────────────────────────────────────────
    // Fields on the Java Student entity typed as Double. Form inputs / FormData
    // hand everything back as strings, so these need coercing before they're
    // sent to Spring, or Jackson throws a 400 (can't map "4500" (String) -> Double).
    const NUMERIC_FIELDS = [
        'standardFee', 'admissionFee', 'tuitionDiscount',
        'transportDiscount', 'siblingDiscount', 'transportFee', 'netPayable',
        'arrears', 'voucherBulkDiscount'
    ];
    const INTEGER_FIELDS = ['age', 'graduatedYear'];
    // Sent as "on" by FormData when checked, absent when unchecked — neither
    // is valid JSON for a Java Boolean, so this needs its own coercion pass
    // in toApiPayload() (see below).
    const BOOLEAN_FIELDS = ['isLifetime', 'voucherCustomFees'];

    /*
     * These are the properties represented by StudentController's Student
     * entity. The page also keeps UI-only properties (id, siblingGroupId,
     * hasSiblings, annual-fund controls, etc.) in memory. Sending those
     * properties to Jackson can cause an "unrecognized field" 400 before
     * StudentRepository.save() is reached.
     */
    const API_STUDENT_FIELDS = [
        'regNo', 'schoolId', 'fullName', 'rollNo', 'studentClass', 'section',
        'admissionClass', 'admissionDate', 'gender', 'dob', 'age', 'studentBform',
        'medicalIssues', 'orphanStatus', 'previousSchool', 'previousClass',
        'guardianName', 'guardianRole', 'guardianCnic', 'fatherFullName', 'fatherCnic',
        'phone1', 'phone2',
        'permanentAddress', 'mailingAddress', 'standardFee', 'admissionFee',
        'tuitionDiscount', 'transportDiscount', 'siblingDiscount',
        'transportMode', 'transportType', 'transportFee', 'netPayable',
        'arrears', 'voucherCustomFees', 'voucherCustomFeesMonth', 'voucherBulkDiscount', 'voucherNote',
        'otherFeesData', 'status', 'photo', 'certData',
        // Sibling link fields — now persisted server-side (Student.java).
        // hasSiblings is an array in memory but a JSON LONGTEXT column on the
        // backend, so it's serialized/parsed like otherFeesData already is
        // (see toApiPayload() and normalizeSiblingFieldsFromServer() below).
        'siblingGroupId', 'isSibling', 'siblingOf', 'hasSiblings',
        // Archive Center "Date Removed" (see deleteRecord()).
        'droppedDate',
        // Discount validity (see editStudentInfo()'s reset issue).
        'isLifetime', 'discountExpiry',
        // Graduation snapshot — set by confirmPromotion() when a student is
        // promoted out of the school's last configured class. Now persisted
        // server-side (Student.java) so the Archive Center's "graduated"
        // roster survives a reload/resync instead of only living as long as
        // the tab stayed open.
        'graduatedDate', 'graduatedYear', 'graduatedClass', 'graduatedSection'
    ];

    /**
     * hasSiblings travels over the wire as a JSON string (the backend column
     * is LONGTEXT, same pattern as otherFeesData) but every place in this
     * file that reads it expects a real array. Call this on any student
     * object that just came back from the server (a save response, or a
     * GET/poll) before it's merged into the in-memory database.
     */
    function normalizeSiblingFieldsFromServer(student) {
        if (student && typeof student.hasSiblings === 'string') {
            try {
                student.hasSiblings = JSON.parse(student.hasSiblings || '[]');
            } catch (e) {
                student.hasSiblings = [];
            }
        }
        return student;
    }

    /**
     * Build a payload safe to POST to the Spring Boot API.
     * - Drops the frontend's `id` field. In the browser `id` is a regNo/sibling
     *   group string (e.g. "PSC_1" or "003") used for local lookups, but the
     *   Java Student entity's `id` is an auto-generated Long primary key —
     *   sending the string would fail deserialization. The backend already
     *   re-associates the correct row using `regNo` (see StudentController).
     * - Coerces numeric-looking strings into real numbers for the Double fields.
     */
    function toApiPayload(studentData) {
        const payload = {};
        API_STUDENT_FIELDS.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(studentData, field)) {
                payload[field] = studentData[field];
            }
        });

        NUMERIC_FIELDS.forEach(f => {
            if (payload[f] !== undefined && payload[f] !== null && String(payload[f]).trim() !== '') {
                const n = parseFloat(payload[f]);
                payload[f] = isNaN(n) ? 0 : n;
            } else {
                delete payload[f];
            }
        });
        INTEGER_FIELDS.forEach(f => {
            if (payload[f] !== undefined && payload[f] !== null && String(payload[f]).trim() !== '') {
                const n = parseInt(payload[f], 10);
                payload[f] = isNaN(n) ? 0 : n;
            } else {
                delete payload[f];
            }
        });

        // hasSiblings is kept as an array in memory but the backend column is
        // a JSON LONGTEXT string (same pattern as otherFeesData) — encode it
        // on the way out.
        if (Array.isArray(payload.hasSiblings)) {
            payload.hasSiblings = JSON.stringify(payload.hasSiblings);
        }

        // Checkbox fields arrive as the string "on" (checked) or are simply
        // absent from FormData (unchecked) — neither survives Jackson's
        // Boolean deserialization, so coerce explicitly.
        BOOLEAN_FIELDS.forEach(f => {
            if (Object.prototype.hasOwnProperty.call(payload, f)) {
                payload[f] = (payload[f] === 'on' || payload[f] === true || payload[f] === 'true');
            }
        });

        // StudentController rejects any write without schoolId — always stamp
        // the logged-in school's real ID on the way out, regardless of what
        // (if anything) was already on the local record.
        payload.schoolId = getCurrentSchoolId();
        if (!payload.schoolId) {
            throw new Error('No school is selected. Sign in to a school before saving students.');
        }
        return payload;
    }

    /** Thin fetch() wrapper that throws a readable error on non-2xx responses. */
    async function apiRequest(method, url, body) {
        const headers = body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {};
        const res = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`${method} ${url} -> ${res.status} ${text}`);
        }
        const contentType = res.headers.get('content-type') || '';
        return contentType.includes('application/json') ? res.json() : null;
    }

    function getApiErrorMessage(err) {
        const message = err && err.message ? String(err.message) : '';
        if (message.includes('No school is selected')) {
            return 'Sign in to a school before saving students.';
        }
        if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
            return 'The server could not be reached. Nothing was saved.';
        }
        if (message.includes('400')) {
            return 'The server rejected the student data. Check the required fields.';
        }
        if (message.includes('401') || message.includes('403')) {
            return 'You are not authorized to save students for this school.';
        }
        return 'The server could not save this record. Nothing was saved.';
    }

    /** Save (create or update) a student in MySQL. Returns the row Spring saved. */
    async function apiSaveStudent(studentData) {
        const result = await apiRequest('POST', API_BASE, toApiPayload(studentData));
        // This tab already knows about the change it just made — invalidate
        // the change-detection fingerprint so the next background poll
        // re-syncs silently (no redundant "Live Update" toast for your own edit).
        lastServerSnapshot = null;
        suppressNextLiveToast = true;
        return result;
    }
    // BUGFIX: same closure-scope problem as getDatabase/saveDatabase above —
    // importStudentsFromExcel() (the "Import" side of Data Export & Import)
    // is defined outside this closure and calls apiSaveStudent() to push
    // each imported row to the backend. Without this it also failed with
    // "apiSaveStudent is not defined" the moment an import was run.
    window.apiSaveStudent = apiSaveStudent;
    // Sibling helpers the importer (outside this closure) reuses so import
    // and the manual "Mark as Sibling" flow always follow the same rules.
    window.isActiveStudent                  = isActiveStudent;
    window.buildSiblingOfString             = buildSiblingOfString;
    window.normalizeSiblingFieldsFromServer = normalizeSiblingFieldsFromServer;

    /** Remove a student on the backend (StudentController does a soft delete — status -> "dropped"). */
    async function apiDeleteStudent(regNo) {
        const schoolId = getCurrentSchoolId();
        const result = await apiRequest('DELETE', `${API_BASE}/${encodeURIComponent(regNo)}?schoolId=${encodeURIComponent(schoolId)}`);
        lastServerSnapshot = null;
        suppressNextLiveToast = true;
        return result;
    }

    /**
     * Pull the current roster from MySQL on page load and refresh the
     * in-memory mirror (API_STUDENTS) so every view (dashboard counters,
     * tables, archive) reflects the database instead of stale in-page state.
     *
     * Server rows are merged ON TOP OF whatever is currently in memory
     * (matched by regNo) so frontend-only bookkeeping the Student entity
     * doesn't persist yet (isSibling / siblingGroupId / hasSiblings /
     * booksFee / booksDiscount / annualFundEnabled) isn't wiped out every
     * time this runs. If you want those to be fully server-backed too, add
     * matching columns to Student.java.
     */
    /**
     * Find the nearest scrollable ancestor of an element (or null). Used so a
     * background refresh never yanks the user's scroll position back to the
     * top of a long student table.
     */
    function findScrollParent(el) {
        let node = el && el.parentElement;
        while (node && node !== document.body) {
            const style = getComputedStyle(node);
            if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
                return node;
            }
            node = node.parentElement;
        }
        return window; // fall back to page scroll
    }

    /** Run fn() while preserving the scroll position of whatever container holds tbodyId. */
    function withScrollPreserved(tbodyId, fn) {
        const tbody = document.getElementById(tbodyId);
        const scrollTarget = tbody ? findScrollParent(tbody) : null;
        const scrollTop = scrollTarget
            ? (scrollTarget === window ? window.scrollY : scrollTarget.scrollTop)
            : null;

        fn();

        if (scrollTarget && scrollTop != null) {
            if (scrollTarget === window) window.scrollTo(0, scrollTop);
            else scrollTarget.scrollTop = scrollTop;
        }
    }

    /**
     * BASE64 PHOTO / B-FORM FIX — "pics show everywhere, then vanish after a
     * page refresh".
     *
     * Photos and B-Forms ARE saved correctly (as base64 in students.photo /
     * students.certData). The problem was on the way back in: the first load
     * of this page uses the fast GET /api/students/list endpoint, which by
     * design leaves photo and certData out. Nothing ever filled them back in,
     * so after a refresh every student looked like they had no B-Form (and
     * the photo depended entirely on the list endpoint's hasPhoto flag).
     *
     * This runs once per page load, right after the fast roster is on
     * screen: it pulls the full records (photo + certData included, exactly
     * as stored in the database), copies ONLY those two fields onto the
     * in-memory students, and re-renders. The table still appears quickly;
     * the images and documents fill in behind it. If the request fails, the
     * flags are reset so the next background poll simply tries again.
     */
    async function loadStudentMediaInBackground(schoolId) {
        if (studentMediaLoaded || studentMediaLoading || !schoolId) return;
        studentMediaLoading = true;
        try {
            const full = await apiRequest('GET', `${API_BASE}?schoolId=${encodeURIComponent(schoolId)}`);
            if (!Array.isArray(full)) return;

            const byRegNo = new Map(full.map(s => [s.regNo, s]));
            let changed = false;
            getDatabase().forEach(s => {
                const f = byRegNo.get(s.regNo);
                if (!f) return;
                // Never overwrite something the user picked while this was
                // loading: only fill in a blank, or replace a display URL.
                if (f.photo && (!s.photo || /^https?:/i.test(s.photo))) {
                    s.photo = f.photo;
                    changed = true;
                }
                if (f.certData && !s.certData) {
                    s.certData = f.certData;
                    changed = true;
                }
            });
            studentMediaLoaded = true;
            if (voSortState.record.has('missing')) changed = true;   // re-check "missing picture" results now that B-Forms are known

            if (changed) {
                if (ssIsModalShown('view-modal')) withScrollPreserved('student-list-tbody', () => {
                    if (typeof renderStudentTable === 'function') renderStudentTable();
                });
                if (ssIsModalShown('view-only-modal')) withScrollPreserved('vo-student-tbody', () => {
                    if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
                });
            }
        } catch (err) {
            console.warn('loadStudentMediaInBackground: will retry on the next poll.', err.message);
        } finally {
            studentMediaLoading = false;
        }
    }

    /**
     * Pull the current roster from MySQL and — ONLY if something actually
     * changed since the last check — merge it in and re-render. This is what
     * powers real-time updates: any admission/edit/delete made elsewhere
     * (another tab, another admin, another device) shows up here within one
     * poll interval, with no manual browser refresh required.
     *
     * @param {boolean} isBackgroundPoll  true when called by the live-sync
     *        timer (suppresses noisy console warnings on transient failures).
     *
     * PERFORMANCE FIX — this used to call GET API_BASE (plain /api/students)
     * on every single poll, including every 6-second background tick for as
     * long as this page stayed open. Student.photo/certData/hasSiblings are
     * @Lob LONGTEXT columns (base64 images/files) that Hibernate fetches
     * eagerly, so every poll re-pulled every student's full blob set even
     * though those fields essentially never change between one 6-second
     * tick and the next — this, not the first page load, was the dominant
     * ongoing cost on this page (see StudentSyncDTO on the backend for the
     * full rationale).
     *
     * Fix: call the full endpoint (photo/certData/hasSiblings included)
     * only on the very first load. Every poll after that calls the lean
     * /api/students/sync endpoint instead. No extra merge logic is needed
     * to protect photo/certData/hasSiblings from being wiped — the merge
     * below already does `Object.assign({}, localMatch || {}, srv)`, and
     * since the /sync payload simply never has those keys at all, the
     * existing local values are left untouched automatically. (A student
     * created in another tab/device and never seen locally will show
     * without a photo until this tab's next full reload — the same
     * trade-off already accepted for every other field a background poll
     * can't originate on its own.)
     */
    async function syncWithBackend(isBackgroundPoll = false) {
        if (isSyncing) return;   // don't let overlapping polls stack up
        isSyncing = true;
        try {
            const schoolId = getCurrentSchoolId();
            if (!schoolId) {
                // No school session (demo / superadmin preview) — nothing to
                // scope the request to, so skip the call instead of sending
                // a schoolId-less request the backend will always reject.
                if (!isBackgroundPoll) console.warn('syncWithBackend: no logged-in school, staying on local cache.');
                return;
            }
            const isFirstLoad = lastServerSnapshot === null;
            // PERFORMANCE FIX — first load now uses the lean LIST endpoint
            // (no photo/certData blobs; see LIST_API_BASE above) instead of
            // the full one. Every poll after that still uses SYNC.
            const fetchBase = isFirstLoad ? LIST_API_BASE : SYNC_API_BASE;
            const serverStudents = await apiRequest('GET', `${fetchBase}?schoolId=${encodeURIComponent(schoolId)}`);
            if (!Array.isArray(serverStudents)) return;

            // Turn the `hasPhoto` flag the LIST endpoint returns into a real
            // <img src> URL, so every existing `s.photo` read on this page
            // keeps working untouched — it is just a URL now instead of a
            // multi-hundred-kilobyte base64 string. Students with no photo
            // get '' exactly as before, so `if (s.photo)` checks are
            // unaffected.
            if (isFirstLoad) {
                serverStudents.forEach(s => {
                    if (s && (s.hasPhoto || s.photoPath)) {
                        s.photo = studentPhotoUrl(s, schoolId);
                    }
                });
            }

            liveSyncFailStreak = 0;
            setLiveSyncIndicator('online');

            // Fetch photo/B-Form base64 in the background (once per page
            // load). The roster merge below is fully synchronous, so by the
            // time this request returns the students are already in memory.
            loadStudentMediaInBackground(schoolId);

            // Cheap fingerprint of the server response — if nothing changed,
            // skip the merge/render entirely so background polling never
            // causes flicker, lost scroll position, or reset filters.
            // PERFORMANCE FIX — this used to be
            //     const snapshot = JSON.stringify(serverStudents);
            // which, on the first load of a roster that still carried base64
            // photos, built a single string tens of megabytes long. That runs
            // synchronously on the main thread, so the tab visibly froze for
            // seconds every time. Now that the roster no longer carries the
            // blobs it would be cheaper anyway, but there is still no reason
            // to serialise the entire roster just to answer "did anything
            // change?" — a compact fingerprint over the fields that actually
            // move between polls does the same job in a fraction of the time
            // and a fraction of the memory.
            const snapshot = serverStudents.length + '|' + serverStudents.map(s => [
                s.regNo, s.status, s.fullName, s.studentClass, s.section,
                s.rollNo, s.netPayable, s.arrears, s.siblingGroupId, s.isSibling, s.siblingOf, s.droppedDate
            ].join('\u0001')).join('\u0002');
            if (snapshot === lastServerSnapshot) return;
            lastServerSnapshot = snapshot;

            const local        = getDatabase();
            const localByRegNo = new Map(local.map(s => [s.regNo, s]));

            // BUGFIX — "student details (gender, DOB, guardian CNIC, medical
            // notes, previous school, phone numbers, roll no, graduation/
            // drop info…) turn into 'Not Provided' a few seconds after the
            // page loads."
            //
            // GET /api/students/sync (StudentSyncDTO) deliberately carries
            // only the handful of fields that actually change between polls
            // — fees, discounts, arrears, voucher state, class/section — so
            // the 6-second background refresh stays fast. Every field it
            // does NOT carry still comes back as an explicit
            // "fieldName": null in the JSON (Spring's default Jackson
            // config serializes nulls rather than omitting the key), so
            // `Object.assign({}, localMatch, srv)` — spreading the smaller
            // sync payload last — was overwriting every one of those
            // omitted fields with null on EVERY poll, a few seconds after
            // every page load. This bug always existed in this merge, but
            // could never actually run before: /api/students/sync 404'd on
            // every call until it was added, so this code path was dead.
            // Fixing that 404 is what switched this on.
            //
            // Fix: only ever copy the fields SYNC_MERGE_FIELDS lists below
            // onto the existing local record. Every other field — rollNo,
            // gender, dob, studentBform, medicalIssues, orphanStatus,
            // previousSchool, previousClass, guardianRole, guardianCnic,
            // phone1, phone2, permanent/mailingAddress, graduation/dropped
            // info, photo, certData, hasSiblings — is left completely
            // untouched by a background poll, exactly as the comment on
            // StudentSyncDTO always intended. The FIRST load still uses the
            // full LIST endpoint and adopts everything it returns, since
            // there is no local copy yet to protect.
            const SYNC_MERGE_FIELDS = [
                'status', 'fullName', 'studentClass', 'section', 'guardianName',
                'admissionDate', 'standardFee', 'admissionFee', 'tuitionDiscount',
                'transportDiscount', 'siblingDiscount', 'transportMode', 'transportType',
                'transportFee', 'netPayable', 'otherFeesData', 'isLifetime', 'discountExpiry',
                'arrears', 'voucherCustomFees', 'voucherCustomFeesMonth', 'voucherBulkDiscount',
                'voucherNote', 'siblingGroupId', 'isSibling', 'siblingOf'
            ];

            const merged        = serverStudents.map(srv => {
                normalizeSiblingFieldsFromServer(srv);
                const localMatch = localByRegNo.get(srv.regNo);

                // First load (isFirstLoad, srv from /list) — or a student
                // this tab has never seen before (e.g. admitted by another
                // tab/admin after this page's first load) — has no local
                // copy to protect, so adopt the server record as-is, same
                // as before.
                let mergedStudent;
                if (isFirstLoad || !localMatch) {
                    mergedStudent = Object.assign({}, localMatch || {}, srv);
                    // BASE64 FIX: apiSaveStudent() resets lastServerSnapshot,
                    // so the poll right after every save re-enters this
                    // branch with the lean /list row (no certData, and a
                    // display-URL photo). Keep whatever real photo/B-Form
                    // this tab already holds instead of downgrading it.
                    if (localMatch) {
                        if (localMatch.photo && !/^https?:/i.test(localMatch.photo)) {
                            mergedStudent.photo = localMatch.photo;
                        }
                        if (localMatch.certData) {
                            mergedStudent.certData = localMatch.certData;
                        }
                    }
                } else {
                    // A background /sync poll with an existing local copy —
                    // start from everything already known locally, and copy
                    // over ONLY the fields sync is meant to refresh.
                    mergedStudent = Object.assign({}, localMatch);
                    SYNC_MERGE_FIELDS.forEach(field => {
                        if (Object.prototype.hasOwnProperty.call(srv, field)) {
                            mergedStudent[field] = srv[field];
                        }
                    });
                }
                // BUGFIX: `srv.id` is the Student entity's numeric database
                // primary key. The frontend has ALWAYS used `id` for its own
                // purposes instead — a student's regNo, or a shared "00X"
                // sibling-group code (see getOrCreateSiblingGroupId). Because
                // `srv` was spread last, its numeric id was silently
                // clobbering that string on every sync (page load, every
                // poll tick, and on window focus), which is what made
                // "Mark as Sibling" fail right after load: it calls
                // `matchedStudent.id.startsWith(...)`, and `.startsWith`
                // doesn't exist on a Number — an uncaught TypeError that
                // happens outside the click handler's try/catch, so the
                // whole action silently did nothing. Always keep the
                // frontend's own id (falling back to regNo for a student
                // this tab has never seen before, matching what a fresh
                // admission assigns).
                mergedStudent.id = (localMatch && localMatch.id !== undefined && localMatch.id !== null)
                    ? localMatch.id
                    : (srv.regNo || srv.id);
                return mergedStudent;
            });

            saveDatabase(merged);
            updateDashboardStats();

            // Only redraw a table that is actually on screen; each one is
            // rebuilt from scratch the moment its modal/stage is opened.
            if (ssIsModalShown('view-modal')) withScrollPreserved('student-list-tbody', () => {
                if (typeof renderStudentTable === 'function') renderStudentTable();
            });
            if (ssIsModalShown('view-only-modal')) withScrollPreserved('vo-student-tbody', () => {
                if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
            });

            // Only announce "live" updates for changes that arrived in the
            // background after the page had already loaded once — not for
            // the very first fetch on page load.
            if (isBackgroundPoll && !isFirstLoad && !suppressNextLiveToast && typeof showToast === 'function') {
                showToast('Live Update', 'Student records were updated.', 'info');
            }
            suppressNextLiveToast = false;
        } catch (err) {
            // Backend not reachable (e.g. Spring Boot not running) — keep working
            // off the local cache instead of breaking the page. Back off the
            // polling interval a bit so we don't hammer a dead server.
            liveSyncFailStreak++;
            setLiveSyncIndicator('offline');
            if (!isBackgroundPoll) {
                console.warn('syncWithBackend: could not reach the server, using local cache.', err.message);
            }
        } finally {
            isSyncing = false;
        }
    }

    /** Optional small visual indicator (id="live-sync-status") showing connection state. */
    function setLiveSyncIndicator(state) {
        const el = document.getElementById('live-sync-status');
        if (!el) return;
        el.classList.remove('live-sync-online', 'live-sync-offline');
        if (state === 'online') {
            el.classList.add('live-sync-online');
            el.title = 'Live — connected';
            el.innerHTML = '<i class="fas fa-circle"></i> Live';
        } else {
            el.classList.add('live-sync-offline');
            el.title = 'Offline — showing last-known data';
            el.innerHTML = '<i class="fas fa-circle"></i> Offline';
        }
    }

    /** Start polling the backend for changes. Safe to call more than once. */
    function startLiveSync() {
        stopLiveSync();
        liveSyncTimer = setInterval(() => {
            if (document.visibilityState !== 'visible') return; // save battery/bandwidth on hidden tabs
            // Back off (poll every 3rd tick) after repeated failures so a
            // downed server doesn't get hammered every 6 seconds forever.
            if (liveSyncFailStreak >= 3 && liveSyncFailStreak % 3 !== 0) {
                liveSyncFailStreak++;
                return;
            }
            syncWithBackend(true);
            pollClassConfigs();
            fetchStaffFromServer().then(fetched => {
                if (fetched !== null) { updRefreshTeacherBadge(); voRefreshTeacherBadge(); }
            });
        }, LIVE_SYNC_INTERVAL_MS);
    }

    /**
     * Re-render every place classes show up: the admission form's Class/
     * Section dropdowns and both class-card grids (Edit-modal + View-modal).
     * Safe to call at any time — each render function reads getClassConfigs()
     * fresh, so this always reflects whatever's currently in CLASS_CONFIGS_CACHE.
     */
    function refreshClassUI() {
        if (typeof populateClassDropdown === 'function') populateClassDropdown();
        if (typeof populateSectionDropdown === 'function') populateSectionDropdown(classSelect ? classSelect.value : '');
        if (typeof updRenderClassCards === 'function') updRenderClassCards();
        if (typeof voRenderClassCards === 'function') voRenderClassCards();
    }

    // Fingerprint of the last-fetched class list, so background polling only
    // re-renders when a class was actually added/edited/removed in Settings.
    let lastClassConfigsSnapshot = null;

    /** Poll tick: re-fetch classes from the backend, re-render only if changed. */
    async function pollClassConfigs() {
        const before = JSON.stringify(CLASS_CONFIGS_CACHE);
        const fetched = await fetchClassConfigsFromServer();
        if (fetched === null) return; // fetch failed — keep showing last-known classes
        const after = JSON.stringify(CLASS_CONFIGS_CACHE);
        if (after !== before) refreshClassUI();
    }

    function stopLiveSync() {
        if (liveSyncTimer) clearInterval(liveSyncTimer);
        liveSyncTimer = null;
    }

    // Expose for debugging / for other pages that may want to trigger a
    // manual refresh (e.g. a "Refresh now" button).
    window.SoftSchoolLiveSync = {
        start: startLiveSync,
        stop: stopLiveSync,
        refreshNow: () => syncWithBackend(false),
        isBusy: () => isSyncing      // lets the importer wait for an in-flight poll
    };

    // Refresh immediately the moment the tab regains focus/visibility or the
    // browser comes back online — covers the common case of someone editing
    // in another tab, then switching back to this one.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { syncWithBackend(true); pollClassConfigs(); }
    });
    window.addEventListener('focus', () => { syncWithBackend(true); pollClassConfigs(); });
    window.addEventListener('online', () => {
        liveSyncFailStreak = 0;
        syncWithBackend(true);
        pollClassConfigs();
    });

    // ── FORM SUBMISSION ──────────────────────────────────────────────────────

    /* SECURITY: schema for every free-typed field on the admission
       form (schema-based type/length/allow-list checks, per OWASP
       Input Validation Cheat Sheet). Dropdown/select/radio fields
       (class, section, gender, guardian role, orphan status,
       transport mode/type) are left to the existing HTML5 `required`
       checks since their values are already constrained to the
       options the page renders. Money fields are validated as
       non-negative decimals so a typed value like "1e9" or
       "-100abc" can't silently reach storage/financial totals. */
    const ADMISSION_SCHEMA = {
        fullName:          SSValidate.rules.name({ required: true, maxLength: 80, label: "Student full name" }),
        guardianName:      SSValidate.rules.name({ required: true, maxLength: 80, label: "Guardian name" }),
        studentBform:      SSValidate.rules.text({ required: true, maxLength: 15, pattern: /^\d{5}-\d{7}-\d$/, patternMessage: "B-Form number must look like XXXXX-XXXXXXX-X.", label: "Student B-Form number" }),
        guardianCnic:      SSValidate.rules.text({ required: true, maxLength: 15, pattern: /^\d{5}-\d{7}-\d$/, patternMessage: "Guardian CNIC must look like XXXXX-XXXXXXX-X.", label: "Guardian CNIC" }),
        fatherFullName:    SSValidate.rules.name({ required: false, maxLength: 80, label: "Father name" }),
        fatherCnic:        SSValidate.rules.text({ required: false, maxLength: 15, pattern: /^\d{5}-\d{7}-\d$/, patternMessage: "Father CNIC must look like XXXXX-XXXXXXX-X.", label: "Father CNIC" }),
        medicalIssues:     SSValidate.rules.note({ required: false, maxLength: 300, label: "Medical issues" }),
        previousSchool:    SSValidate.rules.name({ required: false, maxLength: 120, label: "Previous school" }),
        previousClass:     SSValidate.rules.text({ required: false, maxLength: 40, label: "Previous class" }),
        phone1:            SSValidate.rules.phone({ required: true, label: "Primary phone number" }),
        phone2:            SSValidate.rules.phone({ required: false, label: "Secondary phone number" }),
        permanentAddress:  SSValidate.rules.address({ required: true, maxLength: 300, label: "Permanent address" }),
        mailingAddress:    SSValidate.rules.address({ required: true, maxLength: 300, label: "Mailing address" }),
        transportFee:      SSValidate.rules.money({ required: false, max: 10000000, label: "Transport fee" }),
        admissionFee:      SSValidate.rules.money({ required: false, max: 10000000, label: "Admission fee" }),
        tuitionDiscount:   SSValidate.rules.money({ required: false, max: 10000000, label: "Tuition discount" }),
        transportDiscount: SSValidate.rules.money({ required: false, max: 10000000, label: "Transport discount" }),
        siblingDiscount:   SSValidate.rules.money({ required: false, max: 10000000, label: "Sibling discount" }),
        dob:               SSValidate.rules.date({ required: true, max: new Date().toISOString().slice(0, 10), label: "Date of birth" }),
        admissionDate:     SSValidate.rules.date({ required: true, label: "Admission date" }),
    };

    if (admissionForm) {
    admissionForm.onsubmit = async function(e) {
        e.preventDefault();

        // RACE-FIX — see pendingPhotoUpload/pendingBformUpload declaration
        // above: if the user picked a photo/B-Form and hit Save before the
        // background upload to /files/photo|/files/bform finished, wait for
        // it here so previewImg.dataset.uploadedPath / certDataHidden.value
        // are populated before the payload below is built. Without this,
        // a fast Save silently sent the record with no photo/B-Form at all,
        // even though the preview showed one attached.
        if (pendingPhotoUpload || pendingBformUpload) {
            showToast("Please wait", "Finishing file upload before saving...", "info");
            await Promise.all([pendingPhotoUpload, pendingBformUpload]);
        }

        const db         = getDatabase();
        const formData   = new FormData(admissionForm);
        const studentData= Object.fromEntries(formData);

        // Guardian IS the father → no separate father fields are shown, so the guardian's
        // name/CNIC are saved as the father's (this is what sibling detection compares).
        if (studentData.guardianRole === 'Father') {
            studentData.fatherFullName = studentData.guardianName || '';
            studentData.fatherCnic     = studentData.guardianCnic  || '';
        }

        // SECURITY: validate + canonicalize every free-typed field
        // before it touches storage/API/DOM. Rejects the submission
        // (instead of silently truncating/"fixing" it) and surfaces
        // the first error so the existing toast UI explains what to
        // fix, exactly like the page's other validation messages.
        const admissionCheck = SSValidate.validate(studentData, ADMISSION_SCHEMA);
        if (!admissionCheck.ok) {
            const firstError = Object.values(admissionCheck.errors)[0];
            showToast("Check the form", firstError, "danger");
            return;
        }
        Object.assign(studentData, admissionCheck.values);

        // ADMISSION CLASS — a brand-new student's selected class is saved as BOTH
        // the current class and the Admission Class. Editing never touches an
        // existing Admission Class (it is not a form field, so the saved value
        // is kept); promotion changes only the current class.
        if (!studentData['_editRegNo']) {
            studentData.admissionClass = studentData.studentClass || '';
        }

        // Standardize properties
        delete studentData['_editRegNo'];
        // CRITICAL — photos are now loaded lazily by URL (see LIST_API_BASE
        // and studentPhotoUrl above), so previewImg.src is a URL, not base64,
        // for any student whose photo was NOT re-uploaded in this session.
        // Assigning it unconditionally (as this line used to) would write the
        // text of that URL into the photo column and permanently destroy the
        // stored image.
        //
        // FILE-STORAGE MIGRATION — a freshly picked photo is uploaded to disk
        // the moment it's selected (see the studentPhotoInput 'change'
        // handler above), which stashes the server's relative path on
        // previewImg.dataset.uploadedPath. Only send a photo when that path
        // exists, i.e. the user actually picked (and successfully uploaded)
        // a new one this session — never the raw base64 preview and never
        // the display URL. Omitting the field entirely is already the
        // documented "keep what's on file" signal —
        // StudentController#copyUpdatableFields explicitly refuses to
        // overwrite photo/certData with a blank value for exactly this
        // reason.
        if (previewImg.dataset.uploadedPath) {
            studentData.photo = previewImg.dataset.uploadedPath;
        } else {
            delete studentData.photo;
        }
        studentData.age        = ageInput.value;
        studentData.netPayable = netTotalInput.value;
        studentData.rollNo     = rollNoInput.value;
        
        // NOTE: studentData.status is intentionally left untouched here.
        // The admission form has no status field, so FormData never
        // populates it — that's correct. A NEW admission gets 'active'
        // stamped in the "NEW ADMISSION" branch below, right before it's
        // created. For an UPDATE, leaving studentData.status alone means
        // `Object.assign({}, db[index], studentData)` keeps whatever
        // status the record already had (active/graduated/dropped).
        //
        // BUGFIX (fixed): this used to unconditionally set
        // studentData.status = 'active' right here, for BOTH new and
        // existing students. Because the form has no status field, that
        // condition was always true — so saving ANY edit to an existing
        // student (even one that had been promoted-out/graduated or
        // dropped) silently flipped them back to 'active', which is what
        // made graduated/archived students reappear on the live roster
        // ("re-enrolled") after being edited.

        // BUGFIX: FormData simply omits an unchecked checkbox rather than
        // sending "false" — so unchecking "Lifetime Discount" (to switch a
        // student over to a real expiry date) left studentData.isLifetime
        // absent, and `candidate = Object.assign({}, db[index], studentData)`
        // below would then keep the OLD `true` value from db[index] since
        // nothing overrode it. Stamp the real state explicitly so unchecking
        // it actually clears it.
        studentData.isLifetime = !!(lifetimeCheck && lifetimeCheck.checked);

        const existingId = editIdHidden.value.trim();

        if (existingId) {
            // UPDATING
            const index = db.findIndex(s => s.regNo === existingId || s.id === existingId);
            if (index === -1) {
                showToast("Error", "Could not find student.", "danger");
                return;
            }
            try {
                /*
                 * Write to the backend first. Previously the in-memory record
                 * was updated before the request, so a failed POST looked
                 * successful until the next refresh replaced it.
                 */
                const candidate = Object.assign({}, db[index], studentData);
                // BUGFIX — photo silently breaking after any edit to an
                // existing student that already had one on file.
                //
                // db[index].photo can hold a RESOLVED DISPLAY URL (e.g.
                // "https://.../api/students/PSC_3/photo?schoolId=...") —
                // see studentPhotoUrl()/syncWithBackend() above, which turns
                // the `hasPhoto` flag into a browsable URL for <img src>.
                // studentData.photo only exists here when a NEW file was
                // just uploaded this session (raw relative path, e.g.
                // "photos/uuid.jpg"); otherwise it's deleted (see the
                // admission-submit handler), so candidate.photo falls back
                // to whatever db[index].photo is — which, for any student
                // whose photo wasn't just re-uploaded, is that display URL.
                //
                // StudentController#copyUpdatableFields only refuses to
                // overwrite photo/certData when the incoming value is
                // BLANK — a URL isn't blank, so it was accepted as if it
                // were a real storage path: the actual file on disk got
                // deleted (path mismatch vs. what's really stored) and the
                // DB column got overwritten with the URL text itself. Every
                // later photo request then 404'd, since a URL doesn't match
                // FileStorageService#isManagedPath() and isn't valid
                // base64 either.
                //
                // Fix: never let a RESOLVED DISPLAY URL (http(s):) leave this
                // tab as `photo`/`certData` — that's display-only text from
                // db[index], never something to persist. Stripping it here
                // makes the request identical to "no photo field sent",
                // which is exactly the signal the backend already treats
                // correctly as "leave the stored photo alone".
                //
                // REVERTED — BASE64 STORAGE: a `data:` value is no longer
                // stripped here, because it's now the genuine, intended
                // value for a freshly-picked photo/B-Form (see
                // previewImg.dataset.uploadedPath / certDataHidden.value
                // above) — it must be sent through to the backend, not
                // discarded.
                if (candidate.photo && /^https?:/i.test(candidate.photo)) {
                    delete candidate.photo;
                }
                if (candidate.certData && /^https?:/i.test(candidate.certData)) {
                    delete candidate.certData;
                }
                // BASE64 FIX: now that every student holds its full photo /
                // B-Form base64 in memory, don't re-upload it on every edit
                // when nothing changed. Leaving the field out is the
                // backend's existing "keep what's on file" signal.
                const previousMedia = { photo: db[index].photo, certData: db[index].certData };
                if (!previewImg.dataset.uploadedPath) delete candidate.photo;
                if (candidate.certData && candidate.certData === previousMedia.certData) {
                    delete candidate.certData;
                }
                // OPTIMISTIC SAVE: update the local record and close the
                // modal immediately instead of waiting for the backend
                // round-trip. This was the delay you were seeing — a
                // photo/B-Form makes the POST body bigger, so the old code
                // (which awaited apiSaveStudent before closing the modal)
                // sat there until the upload finished. The sync now happens
                // in the background; the table already reflects the save,
                // and a toast tells you if it actually failed so nothing
                // is silently lost.
                db[index] = Object.assign({}, previousMedia, candidate, { id: db[index].id });
                saveDatabase(db);
                showToast("Updated", "Record updated successfully", "info");
                closeModal('student-modal');

                apiSaveStudent(candidate).then(saved => {
                    if (!saved) return;
                    normalizeSiblingFieldsFromServer(saved);
                    const dbNow = getDatabase();
                    const idxNow = dbNow.findIndex(s => s.regNo === candidate.regNo || s.id === candidate.id);
                    if (idxNow === -1) return;
                    dbNow[idxNow] = Object.assign({}, dbNow[idxNow], saved, { id: dbNow[idxNow].id });
                    saveDatabase(dbNow);
                    if (typeof renderStudentTable === 'function') renderStudentTable();
                    if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
                }).catch(err => {
                    console.error('Backend sync failed (update):', err);
                    showToast("Sync failed", getApiErrorMessage(err) + " — changes are saved locally, please check your connection and try again.", "danger");
                });
            } catch (err) {
                console.error('Backend sync failed (update):', err);
                showToast("Save failed", getApiErrorMessage(err), "danger");
                return;
            }
        } else {
            // NEW ADMISSION
            if (!canAdmitNewStudent()) {
                showToast("Limit Reached", `Your plan allows up to ${getStudentLimit()} active students. Upgrade your plan to register more.`, "danger");
                return;
            }
            const matchedStudent = findGuardianMatch(studentData, db);
            if (matchedStudent) {
                showSiblingDialog(matchedStudent.fullName, studentData, db, matchedStudent);
            } else {
                const regNo = resolveFreshRegNo(db, admissionForm.dataset.pendingRegNo, studentData.admissionDate);
                studentData.regNo = regNo;
                studentData.id    = regNo;
                // A brand-new admission always starts on the active roster.
                if (!studentData.status) {
                    studentData.status = 'active';
                }

                try {
                    // OPTIMISTIC SAVE — same reasoning as the update branch
                    // above: don't block the modal closing on the backend
                    // upload finishing.
                    const persistedStudent = Object.assign({}, studentData, { id: regNo });
                    db.push(persistedStudent);
                    saveDatabase(db);
                    showToast("Admission Complete", `${studentData.fullName} registered.`, "success");
                    closeModal('student-modal');
                    showAdmissionPrintPrompt(persistedStudent);

                    apiSaveStudent(studentData).then(saved => {
                        if (!saved) return;
                        const dbNow = getDatabase();
                        const idxNow = dbNow.findIndex(s => s.regNo === regNo || s.id === regNo);
                        if (idxNow === -1) return;
                        dbNow[idxNow] = Object.assign({}, dbNow[idxNow], saved, { id: regNo });
                        saveDatabase(dbNow);
                        if (typeof renderStudentTable === 'function') renderStudentTable();
                        if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
                    }).catch(err => {
                        console.error('Backend sync failed (new admission):', err);
                        showToast("Sync failed", getApiErrorMessage(err) + " — record is saved locally, please check your connection and try again.", "danger");
                    });
                } catch (err) {
                    console.error('Backend sync failed (new admission):', err);
                    showToast("Save failed", getApiErrorMessage(err), "danger");
                    return;
                }
            }
        }
        
        // REFRESH ALL VIEWS
        updateDashboardStats();
        if (typeof renderStudentTable === 'function') renderStudentTable();
        if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
    };
}

    /**
     * Sibling confirmation dialog
     */
    function showSiblingDialog(matchedName, studentData, db, matchedStudent) {
        const existing = document.getElementById('sibling-dialog-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'sibling-dialog-overlay';
        /* SECURITY: fullName/matchedName are user-entered strings —
           HTML-escaped here before being placed into innerHTML so a
           name like `<img src=x onerror=...>` can't execute as
           markup (stored/reflected XSS defense). */
        const safeStudentName = SSValidate.escapeHtml(studentData.fullName);
        const safeMatchedName = SSValidate.escapeHtml(matchedName);
        const safeFatherName  = SSValidate.escapeHtml((matchedStudent && matchedStudent.fatherFullName) || studentData.fatherFullName || '—');
        const safeFatherCnic  = SSValidate.escapeHtml((matchedStudent && matchedStudent.fatherCnic) || studentData.fatherCnic || '—');
        overlay.innerHTML = `
            <div class="sibling-dialog-box">
                <div class="sibling-dialog-icon">
                    <i class="fas fa-user-friends"></i>
                </div>
                <h3 class="sibling-dialog-title">Sibling Detected</h3>
                <p class="sibling-dialog-body">
                    The father details for <strong>${safeStudentName}</strong> match an existing record for:
                </p>
                <div class="sibling-match-card">
                    <i class="fas fa-user-graduate"></i>
                    <span>${safeMatchedName}</span>
                </div>
                <p class="sibling-dialog-body" style="font-size:0.85rem;margin:6px 0 10px;">
                    Father: <strong>${safeFatherName}</strong> &nbsp;·&nbsp; CNIC: <strong>${safeFatherCnic}</strong>
                </p>
                <p class="sibling-dialog-question">
                    Would you like to register <strong>${safeStudentName}</strong>
                    as a sibling of <strong>${safeMatchedName}</strong>?
                </p>
                <div class="sibling-dialog-actions">
                    <button id="sibling-yes-btn" class="sibling-btn-yes">
                        <i class="fas fa-check-circle"></i> Yes, Mark as Sibling
                    </button>
                    <button id="sibling-no-btn" class="sibling-btn-no">
                        <i class="fas fa-times-circle"></i> No, Register Independently
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // ── YES: register as sibling ─────────────────────────────────────────
        document.getElementById('sibling-yes-btn').addEventListener('click', async () => {
            // BUGFIX: everything below used to run OUTSIDE this try/catch —
            // only the final save loop was guarded. That meant if any step
            // before the save (e.g. getOrCreateSiblingGroupId) threw, the
            // click did absolutely nothing: no save, no toast, no console
            // hint beyond an uncaught error — which is exactly what made
            // "Mark as Sibling" look silently broken. Everything now runs
            // inside the try block so a real failure is always visible.
            try {
                // Work on a copy until every affected record has been accepted by
                // the backend. This prevents a partial sibling update from looking
                // saved when one of the POST requests fails.
                const workingDb = db.map(student => ({
                    ...student,
                    hasSiblings: Array.isArray(student.hasSiblings)
                        ? student.hasSiblings.map(sibling => ({ ...sibling }))
                        : student.hasSiblings
                }));
                const workingMatchedStudent = workingDb.find(student =>
                    student.regNo === matchedStudent.regNo || student.id === matchedStudent.id
                ) || { ...matchedStudent };

                // 1. Get or create the shared sibling-group id (00X)
                const groupId = getOrCreateSiblingGroupId(matchedStudent);

                // 2. Generate a real registration number (school prefix) for the new student
                const newRegNo = resolveFreshRegNo(workingDb, admissionForm.dataset.pendingRegNo, studentData.admissionDate);

                // 3. Configure the NEW student
                const newSibling = {
                    ...studentData,
                    regNo: newRegNo,
                    id: groupId,   // shared 00X — NOT shown in main table
                    isSibling: true,
                    siblingGroupId: groupId,
                    // This is always a brand-new admission (this whole dialog
                    // only appears from the "NEW ADMISSION" branch), so it
                    // always starts active — same as the non-sibling path.
                    status: studentData.status || 'active'
                };

                // 4. If the ORIGINAL student is not yet in a group, update their id too
                const originalIndex = workingDb.findIndex(s =>
                    s.id === workingMatchedStudent.id || s.regNo === workingMatchedStudent.regNo
                );
                if (originalIndex !== -1) {
                    if (!workingDb[originalIndex].siblingGroupId) {
                        // First time a sibling is added — bring the original into the group
                        workingDb[originalIndex].id             = groupId;
                        workingDb[originalIndex].isSibling      = true;
                        workingDb[originalIndex].siblingGroupId = groupId;
                        if (!workingDb[originalIndex].hasSiblings) workingDb[originalIndex].hasSiblings = [];
                    }
                    // Record the new student in the original's hasSiblings list
                    workingDb[originalIndex].hasSiblings.push({
                        name : newSibling.fullName,
                        regNo: newRegNo
                    });
                }

                // 5. Also build hasSiblings on the new student (pointing back to all others).
                // Only ACTIVE members of the group are listed — a graduated or
                // dropped-out family member should not show up as a connected
                // sibling on a brand-new (active) admission.
                const groupMembersBeforeAdd = workingDb.filter(s => s.siblingGroupId === groupId && isActiveStudent(s));
                newSibling.hasSiblings = groupMembersBeforeAdd.map(s => ({
                    name : s.fullName,
                    regNo: s.regNo
                }));

                // 6. Save the new student
                workingDb.push(newSibling);

                // 7. Refresh "Sibling of …" strings for EVERY group member
                refreshSiblingOfStrings(workingDb, groupId);

                const membersToSave = workingDb.filter(s => s.siblingGroupId === groupId);
                for (const member of membersToSave) {
                    const saved = await apiSaveStudent(member);
                    const index = workingDb.findIndex(s => s.regNo === member.regNo);
                    if (index !== -1 && saved) {
                        normalizeSiblingFieldsFromServer(saved);
                        workingDb[index] = Object.assign({}, workingDb[index], saved, { id: workingDb[index].id });
                    }
                }
                db.splice(0, db.length, ...workingDb);
                saveDatabase(db);
                overlay.remove();
                showToast("Sibling Registered", `${newSibling.fullName} linked as sibling. Group ID: ${groupId}`, "success");
                closeModal('student-modal');
                showAdmissionPrintPrompt(newSibling);
                updateDashboardStats();
                renderStudentTable();
            } catch (err) {
                console.error('Backend sync failed (sibling registration):', err);
                showToast("Save failed", getApiErrorMessage(err), "danger");
            }
        });

        // ── NO: register independently ───────────────────────────────────────
        document.getElementById('sibling-no-btn').addEventListener('click', async () => {
            const regNo       = resolveFreshRegNo(db, admissionForm.dataset.pendingRegNo, studentData.admissionDate);
            studentData.regNo = regNo;
            studentData.id    = regNo;
            // Brand-new admission — always starts active.
            if (!studentData.status) {
                studentData.status = 'active';
            }

            try {
                const saved = await apiSaveStudent(studentData);
                const persistedStudent = Object.assign({}, studentData, saved || {}, { id: regNo });
                db.push(persistedStudent);
                saveDatabase(db);
                overlay.remove();
                showToast("Admission Complete", `${persistedStudent.fullName} registered independently.`, "success");
                closeModal('student-modal');
                showAdmissionPrintPrompt(persistedStudent);
                updateDashboardStats();
                renderStudentTable();
            } catch (err) {
                console.error('Backend sync failed (independent registration):', err);
                showToast("Save failed", getApiErrorMessage(err), "danger");
            }
        });
    }

    /**
     * "Finalize Admission" follow-up — ask whether to print the Admission Form.
     * Shown right after a NEW student is successfully registered.
     */
    function showAdmissionPrintPrompt(studentData) {
        const existing = document.getElementById('admission-print-dialog-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'admission-print-dialog-overlay';
        overlay.innerHTML = `
            <div class="admission-print-dialog-box">
                <div class="admission-print-dialog-icon">
                    <i class="fas fa-print"></i>
                </div>
                <h3 class="admission-print-dialog-title">Admission Finalized</h3>
                <p class="admission-print-dialog-body">
                    Would you like to print the Admission Form for
                    <strong>${escapeHtmlForPrint(studentData.fullName || 'this student')}</strong>?
                </p>
                <div class="admission-print-dialog-actions">
                    <button id="admission-print-yes-btn" class="admission-print-btn-yes">
                        <i class="fas fa-print"></i> Print Admission Form
                    </button>
                    <button id="admission-print-no-btn" class="admission-print-btn-no">
                        <i class="fas fa-times"></i> Close / Not Now
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('admission-print-yes-btn').addEventListener('click', () => {
            printAdmissionForm(studentData);
            overlay.remove();
        });

        document.getElementById('admission-print-no-btn').addEventListener('click', () => {
            overlay.remove();
        });

        // Allow closing by clicking the dark backdrop
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    /** Minimal HTML-escaping helper used when injecting student data into markup. */
    function escapeHtmlForPrint(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Build and open a print-ready Admission Form for the freshly-registered student.
     * Includes all text fields captured during admission + the student's photo.
     * Deliberately EXCLUDES the uploaded certificate / B-Form document image.
     */
    function printAdmissionForm(studentData) {
    const esc = escapeHtmlForPrint;

    // System Data
    const schoolEl = document.querySelector('.school-name');
    const schoolName = schoolEl ? schoolEl.textContent.trim() : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
    const schoolLogoUrl = getSchoolLogoUrl();
    const crestInner = schoolLogoUrl ? `<img src="${esc(schoolLogoUrl)}" alt="School Logo">` : `<i class="fas fa-graduation-cap"></i>`;
    // Phone/address are set on the Settings page only — this print view just
    // fetches and displays them, never lets anyone edit them here.
    const schoolPhone   = getSchoolContactPhone();
    const schoolAddress = getSchoolContactAddress();
    const schoolContactLine = [schoolAddress, schoolPhone].filter(Boolean).map(esc).join('  &bull;  ');
    const academicSession = getCurrentAcademicSession(); // Uses the helper in your JS
    const printedOn = new Date().toLocaleDateString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric'
    }) + '  ·  ' + new Date().toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true
    });

    // Student Data Mapping
    // FILE-STORAGE MIGRATION — right after a fresh admission, studentData.photo
    // (if set at all) is the short relative path a just-completed upload
    // returned (e.g. "photos/uuid.jpg"), not something an <img> can load
    // directly. resolveStoredFileSrc() turns that into the real
    // GET /{regNo}/photo URL; it passes through legacy base64/http(s) values
    // unchanged, so nothing else about this print view needs to change.
    const photoSrc = (studentData.photo && !/placeholder\.com/i.test(studentData.photo))
        ? resolveStoredFileSrc(studentData.photo, studentData.regNo || studentData.id, getCurrentSchoolId(), 'photo')
        : '';
    const registrationNo = studentData.regNo || studentData.id || '—';
    const dobISO = studentData.dob || '';
    const dateOfBirth = studentData.dob ? new Date(studentData.dob).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const admissionDate = studentData.admissionDate ? new Date(studentData.admissionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    // ── Fee & Transport figures (formatted, blank-safe) ──
    const fmtRs = (v) => (v === undefined || v === null || v === '') ? '—' : ('Rs. ' + Number(v).toLocaleString('en-PK'));
    const transportMode = studentData.transportMode || 'Private (Self)';
    const transportType = studentData.transportType && studentData.transportType !== 'None' ? studentData.transportType : 'N/A';
    const totalDiscount = [studentData.tuitionDiscount, studentData.transportDiscount, studentData.siblingDiscount]
        .map(v => Number(v) || 0).reduce((a, b) => a + b, 0);

    // ── Siblings section (only rendered when the student has a sibling link) ──
    // Two independent signals, same as the on-screen Profile view:
    //   • studentData.isSibling / .siblingOf / .siblingGroupId — this student IS a
    //     sibling of one or more names already in the system (reverse-lookup string).
    //   • studentData.hasSiblings — {name, regNo}[] of the other student(s) in the
    //     same sibling group; looked up against the live DB for current class/section.
    const rawSiblingList = Array.isArray(studentData.hasSiblings) ? studentData.hasSiblings : [];
    let siblingsSectionHtml = '';
    {
        let fullDb = [];
        try { fullDb = getDatabase(); } catch (e) { fullDb = []; }

        // A sibling row only counts as a live connection while the OTHER
        // student is still active. If they've since graduated or dropped
        // out, they're dropped from this list — a graduated/dropped student
        // is no longer shown as "connected" to an active sibling. (If we
        // can't find the record at all — e.g. it was deleted — leave it
        // shown rather than silently hiding data we can't verify.)
        const siblingList = rawSiblingList.filter(sib => {
            const matched = fullDb.find(s => s.regNo === sib.regNo || s.id === sib.regNo);
            return !matched || isActiveStudent(matched);
        });
        const isSiblingLinked = !!(studentData.isSibling && studentData.siblingOf && isActiveStudent(studentData));

        if (siblingList.length > 0 || isSiblingLinked) {
        const siblingOfNoticeHtml = isSiblingLinked ? `
            <div class="sibling-of-notice">
                <i class="fas fa-user-friends"></i>
                <span>This student is a <strong>sibling of ${esc(studentData.siblingOf)}</strong>${studentData.siblingGroupId ? ` &nbsp;·&nbsp; Sibling Group ID: <strong>${esc(studentData.siblingGroupId)}</strong>` : ''}</span>
            </div>` : '';

        const siblingRowsHtml = siblingList.map(sib => {
            const matched = fullDb.find(s => s.regNo === sib.regNo || s.id === sib.regNo) || null;
            const sibClass   = matched && matched.studentClass ? matched.studentClass : '—';
            const sibSection = matched && matched.section      ? matched.section      : '—';
            return `
                    <tr>
                        <td>${esc(sib.regNo || '—')}</td>
                        <td>${esc(sib.name || '—')}</td>
                        <td>${esc(sibClass)}</td>
                        <td>${esc(sibSection)}</td>
                    </tr>`;
        }).join('');

        const siblingTableHtml = siblingList.length > 0 ? `
            <table class="sibling-table" ${isSiblingLinked ? 'style="margin-top:9px;"' : ''}>
                <thead>
                    <tr>
                        <th>Reg. No.</th>
                        <th>Full Name</th>
                        <th>Class</th>
                        <th>Section</th>
                    </tr>
                </thead>
                <tbody>${siblingRowsHtml}
                </tbody>
            </table>` : '';

        siblingsSectionHtml = `
        <section class="section">
            <div class="section-label"><span class="num">5</span><span class="txt">Sibling Information</span></div>
            ${siblingOfNoticeHtml}
            ${siblingTableHtml}
        </section>`;
        }
    }

    const safeFileName = (studentData.fullName || 'student').replace(/[^a-z0-9]+/gi, '_');

    const printWin = window.open('', '_blank', 'width=1000,height=1000');

    printWin.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Admission Form — ${esc(studentData.fullName)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
    <style>
        @page { size: A4; margin: 0; }
        :root {
            --ink-900:#0f172a; --ink-700:#1e293b; --ink-500:#475569; --ink-400:#64748b;
            --line:#e2e8f0; --line-strong:#cbd5e1; --surface:#ffffff; --surface-tint:#f8fafc;
            --steel:#4682b4; --steel-dark:#2c5c80; --steel-deep:#1f4a6b; --steel-light:#eaf3fa; --steel-line:#bcd7ea;
            --accent:#2c5c80; --gold:#a97c1f;
        }
        * { box-sizing:border-box; margin:0; padding:0; }
        html, body { width:210mm; }
        body { font-family:'Inter', sans-serif; color:var(--ink-700); background:#dce8f0; }

        /* ── On-screen toolbar (hidden on print / capture) ── */
        .toolbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:center; gap:10px;
            padding:12px 16px; background:#0f172a; box-shadow:0 2px 10px rgba(0,0,0,.25); }
        .toolbar-hint { color:#94a3b8; font-size:12px; margin-right:auto; padding-left:4px; }
        .tb-btn { display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer; padding:9px 16px;
            border-radius:7px; font-family:'Inter',sans-serif; font-weight:600; font-size:12.5px; transition:opacity .15s; }
        .tb-btn:hover { opacity:.88; }
        .tb-btn:disabled { opacity:.55; cursor:default; }
        .tb-print { background:var(--steel); color:#fff; }
        .tb-share { background:#25D366; color:#fff; }
        .tb-close { background:#334155; color:#e2e8f0; }

        .page-frame { width:210mm; min-height:297mm; margin:14px auto; padding:7mm; background:linear-gradient(160deg, var(--steel) 0%, var(--steel-dark) 55%, var(--steel-deep) 100%); border-radius:10px; display:flex; }
        .page { width:100%; min-height:calc(297mm - 14mm); padding:10mm 12mm; position:relative; margin:0; background:#fff; border-radius:6px; box-shadow:0 1px 3px rgba(15,23,42,0.15); display:flex; flex-direction:column; }
        .page::before { content:""; position:absolute; top:6px; left:6px; right:6px; bottom:6px; border:1px solid var(--steel-line); border-radius:4px; pointer-events:none; }
        .corner { position:absolute; width:20px; height:20px; pointer-events:none; }
        .corner-tl { top:12px; left:12px; border-top:2.2px solid var(--gold); border-left:2.2px solid var(--gold); }
        .corner-tr { top:12px; right:12px; border-top:2.2px solid var(--gold); border-right:2.2px solid var(--gold); }
        .corner-bl { bottom:12px; left:12px; border-bottom:2.2px solid var(--gold); border-left:2.2px solid var(--gold); }
        .corner-br { bottom:12px; right:12px; border-bottom:2.2px solid var(--gold); border-right:2.2px solid var(--gold); }
        .watermark { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-32deg); font-size:70px; font-weight:800; letter-spacing:6px; color:var(--steel); opacity:0.045; text-transform:uppercase; white-space:nowrap; pointer-events:none; z-index:0; }
        .doc-header, .title-bar, .section, .declaration, .doc-footer { position:relative; z-index:1; }
        .doc-header { display:flex; align-items:flex-start; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid var(--steel-line); }
        .crest { width:46px; height:46px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:19px;
            background:linear-gradient(135deg, var(--steel) 0%, var(--steel-deep) 100%); box-shadow:0 3px 10px rgba(31,74,107,0.4); border:1.6px solid var(--gold); }
        .crest img { width:100%; height:100%; object-fit:cover; border-radius:50%; }
        .school-name-title { font-size:18px; font-weight:800; color:var(--ink-900); line-height:1.15; }
        .school-sub { font-size:9px; color:var(--steel-dark); text-transform:uppercase; margin-top:2px; letter-spacing:0.5px; }
        .meta-badge { text-align:right; border:1px solid var(--steel-line); padding:5px 10px; border-radius:4px; background:var(--steel-light); }
        .meta-label { font-size:7.5px; text-transform:uppercase; color:var(--steel-dark); font-weight:600; display:block; }
        .meta-value { font-family:'Roboto Mono', monospace; font-size:10px; color:var(--ink-900); }
        .title-bar { margin-top:10px; padding:8px 0; border-top:2.2px solid var(--steel); border-bottom:1px solid var(--steel-line); text-align:center; background:linear-gradient(180deg, var(--steel-light) 0%, #ffffff 100%); }
        .title-bar h1 { font-size:15px; letter-spacing:2.5px; font-weight:800; text-transform:uppercase; color:var(--steel-deep); }
        .section { margin-top:10px; }
        .section-label { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
        .section-label .num { width:16px; height:16px; border-radius:3px; background:var(--steel-dark); color:#fff; font-size:9px; font-weight:700; display:flex; align-items:center; justify-content:center; }
        .section-label .txt { font-size:9.5px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; color:var(--ink-900); }
        .section-label::after { content:""; flex:1; height:1px; background:linear-gradient(90deg, var(--steel-line), transparent); }
        .profile-grid { display:grid; grid-template-columns:1fr 108px; gap:14px; }
        .field-grid { display:grid; grid-template-columns:1fr 1fr 1fr; column-gap:14px; row-gap:7px; }
        .field { display:flex; align-items:baseline; gap:5px; border-bottom:1px solid var(--line-strong); padding-bottom:2.5px; }
        .f-label { font-size:7.2px; text-transform:uppercase; color:var(--ink-400); font-weight:700; white-space:nowrap; }
        .f-value { font-size:10px; font-weight:500; color:var(--ink-900); }
        .photo-box { width:108px; height:132px; border:1.4px dashed var(--steel-line); border-radius:3px; background:var(--steel-light); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:var(--steel-dark); }
        .panel { border:1px solid var(--steel-line); border-radius:4px; padding:8px 12px; background:#fff; }
        .panel-title { font-size:8px; font-weight:700; color:var(--accent); margin-bottom:6px; text-transform:uppercase; padding-bottom:4px; border-bottom:1px solid var(--line); }
        .row-3 { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; background:var(--steel-light); border:1px solid var(--steel-line); padding:8px 14px; border-radius:4px; }
        .row-4 { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; background:var(--steel-light); border:1px solid var(--steel-line); padding:8px 14px; border-radius:4px; }
        .fee-summary-row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:7px; padding:7px 12px; background:var(--surface-tint); border:1px dashed var(--steel-line); border-radius:4px; }
        .fee-summary-row .net-label { font-size:8.5px; font-weight:700; text-transform:uppercase; color:var(--steel-dark); }
        .fee-summary-row .net-value { font-family:'Roboto Mono', monospace; font-size:13px; font-weight:700; color:var(--accent); }
        .sibling-table { width:100%; border-collapse:collapse; border:1px solid var(--steel-line); border-radius:4px; overflow:hidden; }
        .sibling-table th, .sibling-table td { border:1px solid var(--steel-line); padding:5px 10px; text-align:left; }
        .sibling-table th { background:var(--steel-light); font-size:7.6px; text-transform:uppercase; letter-spacing:0.6px; color:var(--steel-dark); font-weight:700; }
        .sibling-table td { font-size:9.5px; color:var(--ink-900); font-weight:500; }
        .sibling-table tbody tr:nth-child(even) { background:var(--surface-tint); }
        .sibling-of-notice { display:flex; align-items:center; gap:8px; font-size:9.2px; font-weight:500; color:var(--ink-900); background:var(--steel-light); border:1px solid var(--steel-line); border-left:3px solid var(--gold); border-radius:0 4px 4px 0; padding:7px 12px; }
        .sibling-of-notice i { color:var(--gold); font-size:11px; }
        .declaration { margin-top:11px; padding:9px 14px; border-left:3px solid var(--steel); background:var(--steel-light); font-size:8.5px; font-style:italic; border-radius:0 4px 4px 0; }
        .doc-footer { margin-top:auto; padding-top:14px; }
        .sign-row { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:22px; }
        .sign-block { text-align:center; }
        .sign-line { border-bottom:1.4px dotted var(--ink-400); height:26px; }
        .sign-label { font-size:8.3px; font-weight:600; text-transform:uppercase; margin-top:5px; color:var(--steel-dark); }
        @media print {
            .toolbar { display:none !important; }
            html, body { width:210mm; height:297mm; background:#fff; }
            body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .page-frame { width:210mm; height:297mm; min-height:297mm; padding:4mm; margin:0; border-radius:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .page { height:100%; min-height:0; box-shadow:none; border-radius:2px; }
        }
    </style>
</head>
<body>
    <div class="toolbar no-print">
        <span class="toolbar-hint"><i class="fas fa-circle-info"></i> Review the form below, then print or share it.</span>
        <button class="tb-btn tb-print" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
        <button class="tb-btn tb-share" id="admShareBtn" onclick="shareAdmissionForm()"><i class="fab fa-whatsapp"></i> Share on WhatsApp</button>
        <button class="tb-btn tb-close" onclick="window.close()"><i class="fas fa-times"></i> Close</button>
    </div>
    <div class="page-frame" id="admPageFrame">
    <div class="page">
        <div class="corner corner-tl"></div>
        <div class="corner corner-tr"></div>
        <div class="corner corner-bl"></div>
        <div class="corner corner-br"></div>
        <div class="watermark">${esc(schoolName).split(' ').slice(0,2).join(' ')}</div>
        <header class="doc-header">
            <div style="display:flex; gap:10px; align-items:center;">
                <div class="crest">${crestInner}</div>
                <div>
                    <div class="school-name-title">${esc(schoolName)}</div>
                    <div class="school-sub">Official Admission Record</div>
                    ${schoolContactLine ? `<div class="school-sub" style="text-transform:none;letter-spacing:0;margin-top:1px;">${schoolContactLine}</div>` : ''}
                </div>
            </div>
            <div class="meta-badge">
                <span class="meta-label">Printed On</span>
                <span class="meta-value">${printedOn}</span>
            </div>
        </header>

        <div class="title-bar">
            <h1>Official Admission Form</h1>
            <div style="font-size:8.5px; text-transform:uppercase; color:var(--ink-400);">Academic Session ${academicSession}</div>
        </div>

        <section class="section">
            <div class="section-label"><span class="num">1</span><span class="txt">Student Profile</span></div>
            <div class="profile-grid">
                <div class="field-grid">
                    <div class="field" style="grid-column: span 3;">
                        <span class="f-label">Full Name:</span>
                        <span class="f-value">${esc(studentData.fullName)}</span>
                    </div>
                    <div class="field" style="grid-column: span 2;">
                        <span class="f-label">Reg No / B-Form:</span>
                        <span class="f-value" style="font-family:monospace;">${esc(registrationNo)} | ${esc(studentData.studentBform)}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">Gender:</span>
                        <span class="f-value">${esc(studentData.gender)}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">Class / Section:</span>
                        <span class="f-value">${esc(studentData.studentClass)} - ${esc(studentData.section || 'N/A')}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">Admission Date:</span>
                        <span class="f-value">${admissionDate}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">DOB / Age:</span>
                        <span class="f-value">${dateOfBirth} | ${esc(studentData.age)}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">Orphan Status:</span>
                        <span class="f-value">${esc(studentData.orphanStatus || 'Not Orphan')}</span>
                    </div>
                    <div class="field" style="grid-column: span 2;">
                        <span class="f-label">Medical Issues / Allergies:</span>
                        <span class="f-value">${esc(studentData.medicalIssues || 'None')}</span>
                    </div>
                </div>
                <div class="photo-box">
                    ${photoSrc ? `<img src="${photoSrc}" style="width:100%; height:100%; object-fit:cover;">` : '<div style="font-size:8px;">AFFIX PHOTO</div>'}
                </div>
            </div>
        </section>

        <section class="section">
            <div class="section-label"><span class="num">2</span><span class="txt">Academic History</span></div>
            <div class="row-3">
                <div class="field"><span class="f-label">Previous School:</span><span class="f-value">${esc(studentData.previousSchool || 'None')}</span></div>
                <div class="field"><span class="f-label">Last Class:</span><span class="f-value">${esc(studentData.previousClass || 'N/A')}</span></div>
                <div class="field"><span class="f-label">Roll No:</span><span class="f-value">${esc(studentData.rollNo)}</span></div>
            </div>
        </section>

        <section class="section">
            <div class="section-label"><span class="num">3</span><span class="txt">Guardian & Contact</span></div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
                <div class="panel">
                    <div class="panel-title">Guardian Details</div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">Name:</span><span class="f-value">${esc(studentData.guardianName)}</span></div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">Relation:</span><span class="f-value">${esc(studentData.guardianRole)}</span></div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">CNIC:</span><span class="f-value">${esc(studentData.guardianCnic)}</span></div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">Father Name:</span><span class="f-value">${esc(studentData.fatherFullName || '—')}</span></div>
                    <div class="field"><span class="f-label">Father CNIC:</span><span class="f-value">${esc(studentData.fatherCnic || '—')}</span></div>
                </div>
                <div class="panel">
                    <div class="panel-title">Contact Information</div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">Phones:</span><span class="f-value">${esc(studentData.phone1)} / ${esc(studentData.phone2)}</span></div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">Permanent Address:</span><span class="f-value" style="font-size:9px;">${esc(studentData.permanentAddress)}</span></div>
                    <div class="field"><span class="f-label">Mailing Address:</span><span class="f-value" style="font-size:9px;">${esc(studentData.mailingAddress || 'Same as permanent')}</span></div>
                </div>
            </div>
        </section>

        <section class="section">
            <div class="section-label"><span class="num">4</span><span class="txt">Transport &amp; Fee Summary</span></div>
            <div class="row-4">
                <div class="field"><span class="f-label">Transport:</span><span class="f-value">${esc(transportMode)} (${esc(transportType)})</span></div>
                <div class="field"><span class="f-label">Transport Fee:</span><span class="f-value">${fmtRs(studentData.transportFee)}</span></div>
                <div class="field"><span class="f-label">Standard Tuition Fee:</span><span class="f-value">${fmtRs(studentData.standardFee)}</span></div>
                <div class="field"><span class="f-label">Admission Fee:</span><span class="f-value">${fmtRs(studentData.admissionFee)}</span></div>
            </div>
            <div class="fee-summary-row">
                <span class="net-label">Total Discounts Applied: <span style="font-family:'Roboto Mono',monospace; color:var(--ink-900); font-weight:700;">${fmtRs(totalDiscount)}</span>${studentData.isLifetime ? ' &nbsp;·&nbsp; Lifetime' : (studentData.discountExpiry ? ` &nbsp;·&nbsp; Valid Until ${esc(studentData.discountExpiry)}` : '')}</span>
                <span class="net-label">Net Payable (First Month): <span class="net-value">${fmtRs(studentData.netPayable)}</span></span>
            </div>
        </section>
        ${siblingsSectionHtml}

        <section class="declaration">
            <div style="font-weight:700; color:var(--accent); text-transform:uppercase; margin-bottom:5px; font-size:8.3px;">Guardian Declaration</div>
            I, ${esc(studentData.guardianName)}, do hereby declare that the information provided is correct. I agree to abide by all school rules and regulations.
        </section>

        <footer class="doc-footer">
            <div class="sign-row">
                <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Guardian Signature</div></div>
                <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Principal Stamp</div></div>
            </div>
        </footer>
    </div>
    </div>

    <script>
        async function shareAdmissionForm() {
            const btn = document.getElementById('admShareBtn');
            const oldHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...';
            try {
                const target = document.getElementById('admPageFrame');
                const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
                const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
                if (!blob) throw new Error('Capture failed');
                const filename = 'Admission_Form_${esc(safeFileName)}.png';
                const file = new File([blob], filename, { type: 'image/png' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Admission Form',
                        text: 'Admission Form for ${esc(studentData.fullName || "")}'
                    });
                    return;
                }

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 4000);

                const msg = encodeURIComponent('Admission Form for ${esc(studentData.fullName || "student")}.\\n(The form image has been downloaded — please attach "' + filename + '" in WhatsApp.)');
                window.open('https://wa.me/?text=' + msg, '_blank');
            } catch (err) {
                console.error('Share failed', err);
                showToast('Share Failed', 'The admission form image could not be generated.', 'danger');
            } finally {
                btn.disabled = false;
                btn.innerHTML = oldHtml;
            }
        }
    <\/script>
</body>
</html>`);
    printWin.document.close();
    printWin.focus();
}

    window.printAdmissionFormForStudent = function(regNo) {
        const db = getDatabase();
        const s = db.find(x => x.regNo === regNo) || db.find(x => x.id === regNo);
        if (!s) {
            showToast("Not Found", "Could not locate this student's record to print.", "danger");
            return;
        }
        printAdmissionForm(s);
    };

    /**
     * Build and open a print-ready, WhatsApp-shareable "Complete Student Record"
     * — the same information shown in the on-screen Profile modal (Academic,
     * Personal, Guardian & Contact, Finance & Transport, sibling links), laid
     * out on a single branded A4 page with the school name/logo, instead of
     * relying on the browser's raw window.print() of the live modal DOM.
     */
    function printStudentRecord(studentData) {
        const esc = escapeHtmlForPrint;
        const s = studentData;

        const schoolEl = document.querySelector('.school-name');
        const schoolName = schoolEl ? schoolEl.textContent.trim() : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
        const schoolLogoUrl = getSchoolLogoUrl();
        const recCrestInner = schoolLogoUrl ? `<img src="${esc(schoolLogoUrl)}" alt="School Logo">` : `<i class="fas fa-id-card-clip"></i>`;
        // Phone/address are set on the Settings page only — this print view just
        // fetches and displays them, never lets anyone edit them here.
        const schoolPhone   = getSchoolContactPhone();
        const schoolAddress = getSchoolContactAddress();
        const schoolContactLine = [schoolAddress, schoolPhone].filter(Boolean).map(esc).join('  &bull;  ');
        const printedOn = new Date().toLocaleDateString('en-US', {
            day: '2-digit', month: 'short', year: 'numeric'
        }) + '  ·  ' + new Date().toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: true
        });

        const safeVal = v => (v !== undefined && v !== null && v !== '') ? esc(v) : '—';
        const fmtRs = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? '—' : ('Rs. ' + Number(v).toLocaleString('en-PK'));
        const photoSrc = (s.photo && !/placeholder\.com/i.test(s.photo))
            ? resolveStoredFileSrc(s.photo, s.regNo || s.id, getCurrentSchoolId(), 'photo')
            : '';
        const registrationNo = s.regNo || s.id || '—';

        // ── Sibling info (mirrors the Profile modal's two independent signals) ──
        // Same rule as the Profile modal: a graduated/dropped-out member of
        // the family group is no longer shown as a live sibling connection.
        let recFullDb = [];
        try { recFullDb = getDatabase(); } catch (e) { recFullDb = []; }
        const isSiblingLinked = !!(s.isSibling && s.siblingOf && isActiveStudent(s));
        const hasSiblingsList = (Array.isArray(s.hasSiblings) ? s.hasSiblings : []).filter(sib => {
            const matched = recFullDb.find(rs => rs.regNo === sib.regNo || rs.id === sib.regNo);
            return !matched || isActiveStudent(matched);
        });
        let siblingHtml = '';
        if (isSiblingLinked || hasSiblingsList.length > 0) {
            const linkedNotice = isSiblingLinked ? `
                <div class="sibling-of-notice">
                    <i class="fas fa-user-friends"></i>
                    <span>Sibling of <strong>${esc(s.siblingOf)}</strong>${s.siblingGroupId ? ` &nbsp;·&nbsp; Sibling Group ID: <strong>${esc(s.siblingGroupId)}</strong>` : ''}</span>
                </div>` : '';
            const hasRows = hasSiblingsList.map(sib => `
                    <tr><td>${esc(sib.regNo || '—')}</td><td>${esc(sib.name || '—')}</td></tr>`).join('');
            const hasTable = hasSiblingsList.length > 0 ? `
                <table class="sibling-table" ${isSiblingLinked ? 'style="margin-top:9px;"' : ''}>
                    <thead><tr><th>Reg. No.</th><th>Full Name</th></tr></thead>
                    <tbody>${hasRows}</tbody>
                </table>` : '';
            siblingHtml = `
        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-people-roof"></i></span><span class="rec-txt">Sibling Information</span></div>
            ${linkedNotice}${hasTable}
        </section>`;
        }

        // ── Books / other fees / discounts (same math as the on-screen profile) ──
        const booksFee = parseFloat(s.booksFee || 0);
        const booksDiscount = parseFloat(s.booksDiscount || 0);
        let otherFeesArr = [];
        try { otherFeesArr = JSON.parse(s.otherFeesData || '[]'); } catch (e) { otherFeesArr = []; }
        otherFeesArr = otherFeesArr.filter(f => (parseFloat(f.amount || 0) > 0 || parseFloat(f.discount || 0) > 0));

        const otherFeeRowsHtml = otherFeesArr.map(f => `
                <div class="rec-field"><span class="rec-flabel">${esc(f.description || 'Other Fee')}:</span><span class="rec-fvalue">${fmtRs(f.amount)}</span></div>`).join('');
        const otherDiscountsTotal = otherFeesArr.reduce((sum, f) => sum + (parseFloat(f.discount || 0)), 0);

        const totalDiscount = [s.tuitionDiscount, s.transportDiscount, s.siblingDiscount, booksDiscount]
            .map(v => Number(v) || 0).reduce((a, b) => a + b, 0) + otherDiscountsTotal;

        // ── Certificate-on-file note (the actual document is viewed separately) ──
        const certNoticeHtml = s.certData ? `
            <div class="rec-field"><span class="rec-flabel">B-Form / Certificate:</span><span class="rec-fvalue" style="color:var(--sg-dark);"><i class="fas fa-check-circle"></i> On file with the school office</span></div>`
            : `<div class="rec-field"><span class="rec-flabel">B-Form / Certificate:</span><span class="rec-fvalue">Not on file</span></div>`;

        const safeFileName = (s.fullName || 'student').replace(/[^a-z0-9]+/gi, '_');

        const printWin = window.open('', '_blank', 'width=1000,height=1000');

        printWin.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Student Record — ${esc(s.fullName)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
    <style>
        @page { size: A4; margin: 0; }
        :root {
            --ink-900:#0f172a; --ink-700:#1e293b; --ink-500:#475569; --ink-400:#64748b;
            --line:#e2e8f0; --line-strong:#cbd5e1; --surface:#ffffff; --surface-tint:#f6fbf8;
            /* ── Sea Green palette (deliberately distinct from the Admission Form's steel-blue theme) ── */
            --sg:#2e8b57; --sg-dark:#1f6b44; --sg-deep:#134d32; --sg-light:#e8f7ee; --sg-line:#bfe3cd;
            --accent:#1f6b44; --amber:#b9791f;
        }
        * { box-sizing:border-box; margin:0; padding:0; }
        html, body { width:210mm; }
        body { font-family:'Inter', sans-serif; color:var(--ink-700); background:#dcefe3; }

        .toolbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:center; gap:10px;
            padding:12px 16px; background:#0f172a; box-shadow:0 2px 10px rgba(0,0,0,.25); }
        .toolbar-hint { color:#94a3b8; font-size:12px; margin-right:auto; padding-left:4px; }
        .tb-btn { display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer; padding:9px 16px;
            border-radius:7px; font-family:'Inter',sans-serif; font-weight:600; font-size:12.5px; transition:opacity .15s; }
        .tb-btn:hover { opacity:.88; }
        .tb-btn:disabled { opacity:.55; cursor:default; }
        .tb-print { background:var(--sg); color:#fff; }
        .tb-share { background:#25D366; color:#fff; }
        .tb-close { background:#334155; color:#e2e8f0; }

        /* ── Different frame treatment: no gradient border frame like the Admission
           Form — instead a flat card with a bold top ribbon and a left rail. ── */
        .page-frame { width:210mm; min-height:297mm; margin:14px auto; padding:0; background:transparent; display:flex; }
        .page { width:100%; min-height:297mm; padding:0; position:relative; margin:0; background:#fff; border-radius:8px; box-shadow:0 1px 3px rgba(15,23,42,0.15); display:flex; flex-direction:column; overflow:hidden; }
        .rec-ribbon { height:9mm; width:100%; background:linear-gradient(90deg, var(--sg-deep) 0%, var(--sg) 55%, var(--sg-dark) 100%); flex-shrink:0; }
        .rec-body { padding:9mm 12mm 10mm; display:flex; flex-direction:column; flex:1; position:relative; }
        .rec-railtext { position:absolute; top:50%; right:-38px; transform:translateY(-50%) rotate(90deg); transform-origin:center; font-size:9px; letter-spacing:3px; text-transform:uppercase; color:var(--sg-line); font-weight:700; opacity:0.7; white-space:nowrap; pointer-events:none; }
        .watermark { position:absolute; bottom:14mm; right:8mm; font-size:52px; font-weight:800; letter-spacing:4px; color:var(--sg); opacity:0.05; text-transform:uppercase; white-space:nowrap; pointer-events:none; z-index:0; transform:rotate(-8deg); }
        .rec-header, .rec-title-wrap, .rec-section, .rec-footer { position:relative; z-index:1; }
        .rec-header { display:flex; align-items:center; justify-content:space-between; padding-bottom:9px; border-bottom:2px solid var(--sg-light); }
        .rec-crest { width:44px; height:44px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:18px;
            background:linear-gradient(135deg, var(--sg) 0%, var(--sg-deep) 100%); box-shadow:0 3px 10px rgba(19,77,50,0.35); overflow:hidden; }
        .rec-crest img { width:100%; height:100%; object-fit:cover; border-radius:12px; }
        .rec-school-name { font-size:17px; font-weight:800; color:var(--ink-900); line-height:1.15; }
        .rec-school-sub { font-size:8.6px; color:var(--sg-dark); text-transform:uppercase; margin-top:2px; letter-spacing:0.6px; font-weight:600; }
        .rec-meta-pill { display:flex; align-items:center; gap:6px; border:1px solid var(--sg-line); padding:5px 12px; border-radius:999px; background:var(--sg-light); }
        .rec-meta-pill i { color:var(--sg-dark); font-size:10px; }
        .rec-meta-value { font-family:'Roboto Mono', monospace; font-size:9.5px; color:var(--ink-900); }

        /* ── Title block: centered avatar + name, unlike the Admission Form's boxed title-bar ── */
        .rec-title-wrap { display:flex; align-items:center; gap:14px; margin-top:14px; padding:10px 4px 12px; }
        .rec-avatar { width:64px; height:64px; border-radius:50%; flex-shrink:0; overflow:hidden; border:3px solid var(--sg-light); box-shadow:0 0 0 2px var(--sg); background:var(--sg-light); display:flex; align-items:center; justify-content:center; color:var(--sg-dark); font-size:10px; text-align:center; }
        .rec-avatar img { width:100%; height:100%; object-fit:cover; object-position:center top; }
        .rec-title-name { font-size:19px; font-weight:800; color:var(--ink-900); letter-spacing:0.2px; }
        .rec-title-tags { margin-top:5px; display:flex; gap:6px; flex-wrap:wrap; }
        .rec-tag { display:inline-flex; align-items:center; gap:5px; font-size:8.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--sg-deep); background:var(--sg-light); border:1px solid var(--sg-line); padding:3px 9px; border-radius:999px; }

        .rec-section { margin-top:12px; }
        .rec-section-label { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
        .rec-ico { width:20px; height:20px; border-radius:50%; background:var(--sg); color:#fff; font-size:9.5px; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 2px 5px rgba(46,139,87,0.35); }
        .rec-txt { font-size:9.8px; font-weight:800; letter-spacing:1.1px; text-transform:uppercase; color:var(--sg-deep); }
        .rec-section-label::after { content:""; flex:1; height:1px; background:linear-gradient(90deg, var(--sg-line), transparent); }

        .rec-field-grid { display:grid; grid-template-columns:1fr 1fr 1fr; column-gap:14px; row-gap:8px; }
        .rec-field { display:flex; align-items:baseline; gap:5px; border-bottom:1px solid var(--line-strong); padding-bottom:3px; }
        .rec-flabel { font-size:7.2px; text-transform:uppercase; color:var(--ink-400); font-weight:700; white-space:nowrap; }
        .rec-fvalue { font-size:10px; font-weight:500; color:var(--ink-900); }

        .rec-panel { border:1px solid var(--sg-line); border-radius:8px; padding:9px 13px; background:var(--surface-tint); }
        .rec-panel-title { font-size:8px; font-weight:800; color:var(--sg-dark); margin-bottom:7px; text-transform:uppercase; padding-bottom:4px; border-bottom:1px solid var(--sg-line); letter-spacing:0.4px; }

        .rec-fee-summary { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px; padding:9px 14px; background:var(--sg-deep); border-radius:8px; }
        .rec-fee-summary .rec-net-label { font-size:8.3px; font-weight:700; text-transform:uppercase; color:#bfe3cd; }
        .rec-fee-summary .rec-net-value { font-family:'Roboto Mono', monospace; font-size:14px; font-weight:800; color:#fff; }
        .rec-fee-summary .rec-net-label span.disc-val { font-family:'Roboto Mono',monospace; color:#fff; font-weight:700; }

        .sibling-table { width:100%; border-collapse:collapse; border:1px solid var(--sg-line); border-radius:6px; overflow:hidden; }
        .sibling-table th, .sibling-table td { border:1px solid var(--sg-line); padding:5px 10px; text-align:left; }
        .sibling-table th { background:var(--sg-light); font-size:7.6px; text-transform:uppercase; letter-spacing:0.6px; color:var(--sg-dark); font-weight:700; }
        .sibling-table td { font-size:9.5px; color:var(--ink-900); font-weight:500; }
        .sibling-table tbody tr:nth-child(even) { background:var(--surface-tint); }
        .sibling-of-notice { display:flex; align-items:center; gap:8px; font-size:9.2px; font-weight:500; color:var(--ink-900); background:var(--sg-light); border:1px solid var(--sg-line); border-left:3px solid var(--sg); border-radius:0 6px 6px 0; padding:7px 12px; }
        .sibling-of-notice i { color:var(--sg-dark); font-size:11px; }

        .rec-footer { margin-top:auto; padding-top:14px; text-align:center; }
        .rec-footer-rule { height:2px; background:linear-gradient(90deg, transparent, var(--sg), transparent); margin-bottom:10px; }
        .rec-footer p { font-size:7.6px; color:var(--ink-400); text-transform:uppercase; letter-spacing:0.6px; }

        @media print {
            .toolbar { display:none !important; }
            html, body { width:210mm; height:297mm; background:#fff; }
            body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .page-frame { width:210mm; height:297mm; min-height:297mm; padding:0; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .page { height:100%; min-height:0; box-shadow:none; border-radius:0; }
        }
    </style>
</head>
<body>
    <div class="toolbar no-print">
        <span class="toolbar-hint"><i class="fas fa-circle-info"></i> Review the record below, then print or share it.</span>
        <button class="tb-btn tb-print" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
        <button class="tb-btn tb-share" id="recShareBtn" onclick="shareStudentRecordImage()"><i class="fab fa-whatsapp"></i> Share on WhatsApp</button>
        <button class="tb-btn tb-close" onclick="window.close()"><i class="fas fa-times"></i> Close</button>
    </div>
    <div class="page-frame" id="recPageFrame">
    <div class="page">
        <div class="rec-ribbon"></div>
        <div class="rec-body">
        <div class="watermark">${esc(schoolName).split(' ').slice(0,2).join(' ')}</div>
        <header class="rec-header">
            <div style="display:flex; gap:10px; align-items:center;">
                <div class="rec-crest">${recCrestInner}</div>
                <div>
                    <div class="rec-school-name">${esc(schoolName)}</div>
                    <div class="rec-school-sub">Complete Student Record</div>
                    ${schoolContactLine ? `<div class="rec-school-sub" style="text-transform:none;letter-spacing:0;margin-top:1px;">${schoolContactLine}</div>` : ''}
                </div>
            </div>
            <div class="rec-meta-pill">
                <i class="fas fa-clock"></i>
                <span class="rec-meta-value">${printedOn}</span>
            </div>
        </header>

        <div class="rec-title-wrap">
            <div class="rec-avatar">
                ${photoSrc ? `<img src="${photoSrc}">` : '<span>NO<br>PHOTO</span>'}
            </div>
            <div>
                <div class="rec-title-name">${esc(s.fullName)}</div>
                <div class="rec-title-tags">
                    <span class="rec-tag"><i class="fas fa-hashtag"></i> ${esc(registrationNo)}</span>
                    <span class="rec-tag"><i class="fas fa-graduation-cap"></i> ${esc(s.studentClass || 'N/A')}${s.section ? ' - ' + esc(s.section) : ''}</span>
                    ${s.orphanStatus === 'Orphan' ? '<span class="rec-tag" style="color:#b91c1c;background:#fef2f2;border-color:#fecaca;"><i class="fas fa-heart"></i> Orphan</span>' : ''}
                </div>
            </div>
        </div>

        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-graduation-cap"></i></span><span class="rec-txt">Academic Information</span></div>
            <div class="rec-field-grid">
                <div class="rec-field"><span class="rec-flabel">Registration No.:</span><span class="rec-fvalue" style="font-family:monospace;">${safeVal(registrationNo)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Roll No. (Class):</span><span class="rec-fvalue">${safeVal(s.rollNo)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Class / Section:</span><span class="rec-fvalue">${safeVal(s.studentClass)}${s.section ? ' - ' + esc(s.section) : ''}</span></div>
                <div class="rec-field"><span class="rec-flabel">Admission Date:</span><span class="rec-fvalue">${safeVal(s.admissionDate)}</span></div>
                ${s.siblingGroupId ? `<div class="rec-field"><span class="rec-flabel">Sibling Group ID:</span><span class="rec-fvalue">${esc(s.siblingGroupId)}</span></div>` : ''}
            </div>
        </section>

        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-user"></i></span><span class="rec-txt">Personal Data</span></div>
            <div class="rec-field-grid">
                <div class="rec-field"><span class="rec-flabel">Gender:</span><span class="rec-fvalue">${safeVal(s.gender)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Date of Birth:</span><span class="rec-fvalue">${safeVal(s.dob)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Computed Age:</span><span class="rec-fvalue">${safeVal(s.age)}</span></div>
                <div class="rec-field"><span class="rec-flabel">B-Form / CNIC:</span><span class="rec-fvalue">${safeVal(s.studentBform)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Orphan Status:</span><span class="rec-fvalue">${safeVal(s.orphanStatus)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Previous School:</span><span class="rec-fvalue">${safeVal(s.previousSchool)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Previous Class:</span><span class="rec-fvalue">${safeVal(s.previousClass)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Admission Class:</span><span class="rec-fvalue">${safeVal(s.admissionClass)}</span></div>
                <div class="rec-field" style="grid-column: span 2;"><span class="rec-flabel">Medical Conditions:</span><span class="rec-fvalue">${safeVal(s.medicalIssues)}</span></div>
                ${certNoticeHtml}
            </div>
        </section>

        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-address-book"></i></span><span class="rec-txt">Guardian & Contact</span></div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
                <div class="rec-panel">
                    <div class="rec-panel-title">Guardian Details</div>
                    <div class="rec-field" style="margin-bottom:7px;"><span class="rec-flabel">Name:</span><span class="rec-fvalue">${safeVal(s.guardianName)}</span></div>
                    <div class="rec-field" style="margin-bottom:7px;"><span class="rec-flabel">Relation:</span><span class="rec-fvalue">${safeVal(s.guardianRole)}</span></div>
                    <div class="rec-field" style="margin-bottom:7px;"><span class="rec-flabel">CNIC:</span><span class="rec-fvalue">${safeVal(s.guardianCnic)}</span></div>
                    <div class="rec-field" style="margin-bottom:7px;"><span class="rec-flabel">Father Name:</span><span class="rec-fvalue">${safeVal(s.fatherFullName)}</span></div>
                    <div class="rec-field"><span class="rec-flabel">Father CNIC:</span><span class="rec-fvalue">${safeVal(s.fatherCnic)}</span></div>
                </div>
                <div class="rec-panel">
                    <div class="rec-panel-title">Contact Information</div>
                    <div class="rec-field" style="margin-bottom:7px;"><span class="rec-flabel">Phones:</span><span class="rec-fvalue">${safeVal(s.phone1)} / ${safeVal(s.phone2)}</span></div>
                    <div class="rec-field"><span class="rec-flabel">Permanent Address:</span><span class="rec-fvalue" style="font-size:9px;">${safeVal(s.permanentAddress)}</span></div>
                </div>
            </div>
        </section>

        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-sack-dollar"></i></span><span class="rec-txt">Finance & Transport</span></div>
            <div class="rec-field-grid">
                <div class="rec-field"><span class="rec-flabel">Tuition Fee:</span><span class="rec-fvalue">${fmtRs(s.standardFee)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Admission Fee:</span><span class="rec-fvalue">${fmtRs(s.admissionFee || 0)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Transport Fee:</span><span class="rec-fvalue">${fmtRs(s.transportFee)}</span></div>
                ${booksFee > 0 ? `<div class="rec-field"><span class="rec-flabel">Books Fee:</span><span class="rec-fvalue">${fmtRs(booksFee)}</span></div>` : ''}
                ${otherFeeRowsHtml}
            </div>
            <div class="rec-fee-summary">
                <span class="rec-net-label">Total Discount: <span class="disc-val">${fmtRs(totalDiscount)}</span></span>
                <span class="rec-net-label">Net Payable: <span class="rec-net-value">${fmtRs(s.netPayable)}</span></span>
            </div>
        </section>
        ${siblingHtml}

        <footer class="rec-footer">
            <div class="rec-footer-rule"></div>
            <p>This is a system-generated record from the Student Management System &nbsp;·&nbsp; ${esc(schoolName)}</p>
        </footer>
        </div>
    </div>
    </div>

    <script>
        async function shareStudentRecordImage() {
            const btn = document.getElementById('recShareBtn');
            const oldHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...';
            try {
                const target = document.getElementById('recPageFrame');
                const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
                const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
                if (!blob) throw new Error('Capture failed');
                const filename = 'Student_Record_${esc(safeFileName)}.png';
                const file = new File([blob], filename, { type: 'image/png' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Student Record',
                        text: 'Student Record for ${esc(s.fullName || "")}'
                    });
                    return;
                }

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 4000);

                const msg = encodeURIComponent('Student Record for ${esc(s.fullName || "student")}.\\n(The record image has been downloaded — please attach "' + filename + '" in WhatsApp.)');
                window.open('https://wa.me/?text=' + msg, '_blank');
            } catch (err) {
                console.error('Share failed', err);
                showToast('Share Failed', 'The student record image could not be generated.', 'danger');
            } finally {
                btn.disabled = false;
                btn.innerHTML = oldHtml;
            }
        }
    <\/script>
</body>
</html>`);
        printWin.document.close();
        printWin.focus();
    }

    /**
     * Print the "Complete Student Record" for an EXISTING student, looked up by
     * regNo (falls back to id) from the live database. Used by the "Print
     * Record" button in the Student Profile modal footer, replacing the old
     * raw window.print() of the on-screen modal (which had no dedicated print
     * layout, no school letterhead, and printed the surrounding page chrome).
     */
    window.printStudentRecordForStudent = function(regNo) {
        const db = getDatabase();
        const s = db.find(x => x.regNo === regNo) || db.find(x => x.id === regNo);
        if (!s) {
            showToast("Not Found", "Could not locate this student's record to print.", "danger");
            return;
        }
        printStudentRecord(s);
    };

    // ── FOOTER "PRINT RECORD" BUTTON HANDLER ─────────────────────────────────
    // Prints the Complete Student Record for whichever student's profile is
    // currently open (tracked via profile-modal's data-current-reg-no).
    window.printCurrentStudentRecord = function() {
        const modal = document.getElementById('profile-modal');
        const regNo = modal ? modal.dataset.currentRegNo : null;
        if (regNo) window.printStudentRecordForStudent(regNo);
    };

    // ── CLASS / SECTION / WHOLE-SCHOOL STUDENT LIST PRINT ────────────────────
    /**
     * Build and open a print-ready "Student List" report — a compact table
     * (numbering, name, guardian name, combined Class-Section e.g. "2-A",
     * B-Form / CNIC No., Guardian CNIC, Contact No.) for either:
     *   - the ENTIRE school   → call with (ALL_STUDENTS_KEY, null)
     *   - one class, all sections → call with (className, null) or (className, 'ALL')
     *   - one class + one specific section → call with (className, sectionLetter)
     * Triggered from the small print buttons on the class/section selector
     * cards in the Manage Records / Update Record modals.
     */
    function buildStudentListReport(filterClass, filterSection) {
        const esc = escapeHtmlForPrint;
        const db = getActiveDatabase();

        let list = db;
        let scopeLabel = 'All Students — Every Class & Section';

        if (filterClass && filterClass !== ALL_STUDENTS_KEY) {
            list = list.filter(s => s.studentClass === filterClass);
            if (filterSection && filterSection !== 'ALL') {
                list = list.filter(s => s.section === filterSection);
                scopeLabel = `${filterClass} — Section ${filterSection}`;
            } else {
                scopeLabel = `${filterClass} — All Sections`;
            }
        }

        // Sort by class (if mixed), then section, then roll number, then name.
        list = list.slice().sort((a, b) => {
            const ca = (a.studentClass || '').localeCompare(b.studentClass || '', undefined, { numeric: true });
            if (ca !== 0) return ca;
            const sa = (a.section || '').localeCompare(b.section || '');
            if (sa !== 0) return sa;
            const ra = parseInt(a.rollNo) || 0, rb = parseInt(b.rollNo) || 0;
            if (ra !== rb) return ra - rb;
            return (a.fullName || '').localeCompare(b.fullName || '');
        });

        const schoolEl = document.querySelector('.school-name');
        const schoolName = schoolEl ? schoolEl.textContent.trim() : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
        const schoolLogoUrl = getSchoolLogoUrl();
        const slCrestInner = schoolLogoUrl ? `<img src="${esc(schoolLogoUrl)}" alt="School Logo">` : `<i class="fas fa-users"></i>`;
        // Phone/address are set on the Settings page only — this print view just
        // fetches and displays them, never lets anyone edit them here.
        const schoolPhone   = getSchoolContactPhone();
        const schoolAddress = getSchoolContactAddress();
        const schoolContactLine = [schoolAddress, schoolPhone].filter(Boolean).map(esc).join('  &bull;  ');
        const printedOn = new Date().toLocaleDateString('en-US', {
            day: '2-digit', month: 'short', year: 'numeric'
        }) + '  ·  ' + new Date().toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: true
        });

        const rowsHtml = list.length === 0
            ? `<tr><td colspan="9" class="sl-empty">No student records found for this selection.</td></tr>`
            : list.map((s, idx) => {
                const classSection = `${s.studentClass || '—'}${s.section ? '-' + s.section : ''}`;
                return `
                <tr>
                    <td class="sl-num">${idx + 1}</td>
                    <td class="sl-name">${esc(s.fullName || '—')}</td>
                    <td>${esc(s.guardianName || '—')}</td>
                    <td class="sl-center"><span class="sl-chip">${esc(classSection)}</span></td>
                    <td class="sl-mono">${esc(s.studentBform || '—')}</td>
                    <td class="sl-mono">${esc(s.guardianCnic || '—')}</td>
                    <td>${esc(s.fatherFullName || '—')}</td>
                    <td class="sl-mono">${esc(s.fatherCnic || '—')}</td>
                    <td class="sl-mono">${esc(s.phone1 || '—')}</td>
                </tr>`;
            }).join('');

        const printWin = window.open('', '_blank', 'width=1100,height=850');
        if (!printWin) {
            showToast('Pop-up Blocked', 'Please allow pop-ups to print the student list.', 'danger');
            return;
        }

        printWin.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Student List — ${esc(scopeLabel)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        @page { size: A4 landscape; margin: 10mm; }
        :root {
            --ink-900:#0f172a; --ink-700:#1e293b; --ink-500:#475569; --ink-400:#64748b;
            --line:#e2e8f0; --line-strong:#cbd5e1;
            --sg:#2e8b57; --sg-dark:#1f6b44; --sg-deep:#134d32; --sg-light:#e8f7ee; --sg-line:#bfe3cd;
        }
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'Inter', sans-serif; color:var(--ink-700); background:#dcefe3; }

        .toolbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:center; gap:10px;
            padding:12px 16px; background:#0f172a; box-shadow:0 2px 10px rgba(0,0,0,.25); }
        .toolbar-hint { color:#94a3b8; font-size:12px; margin-right:auto; padding-left:4px; }
        .tb-btn { display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer; padding:9px 16px;
            border-radius:7px; font-family:'Inter',sans-serif; font-weight:600; font-size:12.5px; transition:opacity .15s; }
        .tb-btn:hover { opacity:.88; }
        .tb-print { background:var(--sg); color:#fff; }
        .tb-share { background:#25D366; color:#fff; }
        .tb-close { background:#334155; color:#e2e8f0; }

        .sl-page { width:277mm; min-height:190mm; margin:16px auto; padding:10mm 12mm; background:#fff;
            border-radius:8px; box-shadow:0 1px 3px rgba(15,23,42,0.15); }

        .sl-header { display:flex; align-items:center; justify-content:space-between; padding-bottom:10px; border-bottom:2px solid var(--sg-light); }
        .sl-crest { width:44px; height:44px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:18px;
            background:linear-gradient(135deg, var(--sg) 0%, var(--sg-deep) 100%); box-shadow:0 3px 10px rgba(19,77,50,0.35); overflow:hidden; }
        .sl-crest img { width:100%; height:100%; object-fit:cover; border-radius:12px; }
        .sl-school-name { font-size:17px; font-weight:800; color:var(--ink-900); line-height:1.15; }
        .sl-school-sub { font-size:8.6px; color:var(--sg-dark); text-transform:uppercase; margin-top:2px; letter-spacing:0.6px; font-weight:600; }
        .sl-meta-pill { display:flex; align-items:center; gap:6px; border:1px solid var(--sg-line); padding:5px 12px; border-radius:999px; background:var(--sg-light); }
        .sl-meta-pill i { color:var(--sg-dark); font-size:10px; }
        .sl-meta-value { font-family:'Roboto Mono', monospace; font-size:9.5px; color:var(--ink-900); }

        .sl-title-row { display:flex; align-items:baseline; justify-content:space-between; margin-top:14px; margin-bottom:10px; }
        .sl-title { font-size:15px; font-weight:800; color:var(--ink-900); display:flex; align-items:center; gap:8px; }
        .sl-title i { color:var(--sg-dark); }
        .sl-count { font-size:10.5px; font-weight:700; color:var(--sg-dark); background:var(--sg-light); border:1px solid var(--sg-line); padding:3px 10px; border-radius:999px; }

        table.sl-table { width:100%; border-collapse:collapse; }
        table.sl-table thead th { background:var(--sg-deep); color:#fff; font-size:9px; text-transform:uppercase; letter-spacing:0.5px;
            font-weight:700; text-align:left; padding:7px 9px; }
        table.sl-table thead th.sl-center, table.sl-table td.sl-center { text-align:center; }
        table.sl-table tbody td { font-size:10.5px; padding:6px 9px; border-bottom:1px solid var(--line); color:var(--ink-900); }
        table.sl-table tbody tr:nth-child(even) { background:#f6fbf8; }
        table.sl-table td.sl-num { color:var(--ink-400); font-weight:600; width:28px; }
        table.sl-table td.sl-name { font-weight:700; }
        table.sl-table td.sl-mono { font-family:'Roboto Mono', monospace; font-size:9.5px; }
        table.sl-table td.sl-empty { text-align:center; padding:40px; color:var(--ink-400); }
        .sl-chip { display:inline-block; font-size:9.5px; font-weight:700; color:var(--sg-deep); background:var(--sg-light);
            border:1px solid var(--sg-line); padding:2px 9px; border-radius:999px; }

        .sl-footer { margin-top:16px; padding-top:10px; text-align:center; }
        .sl-footer-rule { height:2px; background:linear-gradient(90deg, transparent, var(--sg), transparent); margin-bottom:8px; }
        .sl-footer p { font-size:7.6px; color:var(--ink-400); text-transform:uppercase; letter-spacing:0.6px; }

        @media print {
            .toolbar { display:none !important; }
            body { background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .sl-page { width:100%; min-height:0; margin:0; padding:0; box-shadow:none; border-radius:0; }
            table.sl-table thead { display:table-header-group; }
            table.sl-table tr { page-break-inside:avoid; }
        }
    </style>
</head>
<body>
    <div class="toolbar no-print">
        <span class="toolbar-hint"><i class="fas fa-circle-info"></i> Review the list below, then print or share it.</span>
        <button class="tb-btn tb-share" onclick="shareStudentList()"><i class="fab fa-whatsapp"></i> Share</button>
        <button class="tb-btn tb-print" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
        <button class="tb-btn tb-close" onclick="window.close()"><i class="fas fa-times"></i> Close</button>
    </div>
    <div class="sl-page">
        <header class="sl-header">
            <div style="display:flex; gap:10px; align-items:center;">
                <div class="sl-crest">${slCrestInner}</div>
                <div>
                    <div class="sl-school-name">${esc(schoolName)}</div>
                    <div class="sl-school-sub">Student List Report</div>
                    ${schoolContactLine ? `<div class="sl-school-sub" style="text-transform:none;letter-spacing:0;margin-top:1px;">${schoolContactLine}</div>` : ''}
                </div>
            </div>
            <div class="sl-meta-pill">
                <i class="fas fa-calendar-day"></i>
                <span class="sl-meta-value">${esc(printedOn)}</span>
            </div>
        </header>

        <div class="sl-title-row">
            <div class="sl-title"><i class="fas fa-layer-group"></i> ${esc(scopeLabel)}</div>
            <div class="sl-count"><i class="fas fa-user-graduate"></i> ${list.length} Student${list.length === 1 ? '' : 's'}</div>
        </div>

        <table class="sl-table">
            <thead>
                <tr>
                    <th style="width:28px;">#</th>
                    <th>Student Name</th>
                    <th>Guardian / Father Name</th>
                    <th class="sl-center">Class-Section</th>
                    <th>B-Form / CNIC No.</th>
                    <th>Guardian CNIC</th>
                    <th>Father Name</th>
                    <th>Father CNIC</th>
                    <th>Contact No.</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>

        <div class="sl-footer">
            <div class="sl-footer-rule"></div>
            <p>Generated by SoftSchool · ${esc(schoolName)}</p>
        </div>
    </div>
    <script>
        var shareListData   = ${JSON.stringify(list.map(s => ({
            name: s.fullName || '—',
            guardian: s.guardianName || '—',
            cls: `${s.studentClass || '—'}${s.section ? '-' + s.section : ''}`,
            phone: s.phone1 || ''
        })))};
        var shareListLabel  = ${JSON.stringify(scopeLabel)};
        var shareListSchool = ${JSON.stringify(schoolName)};

        /* Share this list — Web Share API first (WhatsApp, Messages, Email, etc.
           on mobile), falling back to a WhatsApp Web link with the text prefilled. */
        function shareStudentList() {
            var lines = shareListData.map(function(s, i) {
                return (i + 1) + '. ' + s.name + ' (' + s.cls + ')' + (s.phone ? ' - ' + s.phone : '');
            });
            var text = '*' + shareListSchool + '*\n*Student List — ' + shareListLabel + '*\n' +
                'Total: ' + shareListData.length + ' student(s)\n\n' + lines.join('\n');

            if (navigator.share) {
                navigator.share({ title: 'Student List — ' + shareListLabel, text: text })
                    .catch(function(err) {
                        // Ignore the user simply cancelling the native share sheet.
                        if (err && err.name === 'AbortError') return;
                        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
                    });
            } else {
                window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
            }
        }
    </script>
</body>
</html>
        `);
        printWin.document.close();
    }

    /** Public entry point wired to the print buttons on the class/section cards. */
    window.printStudentListReport = function(filterClass, filterSection) {
        buildStudentListReport(filterClass, filterSection);
    };

    // ── 7. TABLE RENDERING ───────────────────────────────────────────────────

    /**
     * Render the Students Table.
     * Main table ALWAYS shows the PREFIX_X reg number — never the 00X sibling id.
     */
    // ── State for update database modal tabs ──────────────────────────────────
    let updActiveClass   = null;
    let updActiveSection = null;

    /**
     * Get the class teacher for a given class+section from STAFF_CACHE — the
     * in-memory mirror of the backend's Teaching staff list, populated by
     * fetchStaffFromServer() on page load and kept fresh by the live-sync
     * poll. No localStorage involved: this used to read staff data out of
     * shared-data.js's localStorage-backed store, which is why it silently
     * broke whenever that key went stale; it now always reflects the DB.
     */
    function getClassTeacher(className, section) {
        try {
            const allTeachers = Array.isArray(STAFF_CACHE) ? STAFF_CACHE : [];

            for (const s of allTeachers) {
                // Check inchargeAssignments JSON (new format)
                if (s.inchargeAssignments) {
                    try {
                        const arr = JSON.parse(s.inchargeAssignments);
                        if (Array.isArray(arr)) {
                            const match = arr.find(a =>
                                a.cls === className &&
                                (section === 'ALL' || !section || a.section === section || a.section === '')
                            );
                            if (match) return s.name || s.fullName || null;
                        }
                    } catch(e) {}
                }
                // Fallback: check assignedClass/assignedSection fields
                if (s.assignedClass === className &&
                    (section === 'ALL' || !section || s.assignedSection === section || !s.assignedSection)) {
                    return s.name || s.fullName || null;
                }
            }
            return null;
        } catch(e) { return null; }
    }

    /** Update the class teacher badge in the update modal */
    function updRefreshTeacherBadge() {
        const badge   = document.getElementById('upd-class-teacher-badge');
        const nameEl  = document.getElementById('upd-teacher-name');
        const topName = document.getElementById('upd-class-incharge-name');
        const topWrap = document.getElementById('upd-class-incharge-top');

        // "All Students" view has no single class, so hide the incharge readout
        if (!updActiveClass || updActiveClass === ALL_STUDENTS_KEY) {
            if (badge) badge.style.display = 'none';
            if (topWrap) topWrap.style.display = 'none';
            return;
        }
        if (topWrap) topWrap.style.display = '';

        const teacher = getClassTeacher(updActiveClass, updActiveSection);
        // Inline badge next to sections (only when assigned)
        if (badge && nameEl) {
            if (teacher) {
                nameEl.textContent = teacher;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
        // Top-row badge — always visible, shows assigned name or "Not Assigned"
        if (topName && topWrap) {
            topName.textContent = teacher || 'Not Assigned';
            topWrap.classList.toggle('upd-class-incharge-top--none', !teacher);
        }
    }

    /** Update the class teacher badge in the view-only modal */
    function voRefreshTeacherBadge() {
        const badge   = document.getElementById('vo-class-teacher-badge');
        const nameEl  = document.getElementById('vo-teacher-name');
        const topName = document.getElementById('vo-class-incharge-name');
        const topWrap = document.getElementById('vo-class-incharge-top');

        // "All Students" view has no single class, so hide the incharge readout
        if (!voActiveClass || voActiveClass === ALL_STUDENTS_KEY) {
            if (badge) badge.style.display = 'none';
            if (topWrap) topWrap.style.display = 'none';
            return;
        }
        if (topWrap) topWrap.style.display = '';

        const teacher = getClassTeacher(voActiveClass, voActiveSection);
        if (badge && nameEl) {
            if (teacher) {
                nameEl.textContent = teacher;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
        if (topName && topWrap) {
            topName.textContent = teacher || 'Not Assigned';
            topWrap.classList.toggle('upd-class-incharge-top--none', !teacher);
        }
    }

    /** Show one of the three Edit-modal stages: 'classes' | 'sections' | 'table' */
    function updShowStage(stage) {
        ['classes', 'sections', 'table'].forEach(s => {
            const el = document.getElementById('upd-stage-' + s);
            if (el) el.classList.toggle('hidden', s !== stage);
        });
    }

    /**
     * Render the class-cards grid for the Edit modal — an "All Students" master
     * card plus one card per class configured in Settings (edu_class_configs),
     * regardless of whether that class has any students yet.
     */
    function updRenderClassCards() {
        const configs = getClassConfigs();
        const db      = getActiveDatabase();
        const grid    = document.getElementById('upd-classes-grid');
        if (!grid) return;

        let html = `
            <div class="msc-class-card msc-class-card--all" onclick="updOpenAllStudents()">
                <div class="class-name"><i class="fas fa-users"></i> All Students</div>
                <div class="class-meta">Every class &amp; section</div>
                <div class="class-count"><i class="fas fa-user-graduate"></i> ${db.length} students</div>
            </div>
        `;

        if (configs.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:32px 12px;color:var(--text-muted);">
                <i class="fas fa-school" style="font-size:2rem;margin-bottom:10px;display:block;opacity:0.4;"></i>
                No classes configured yet. Add classes in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.
            </div>`;
        } else {
            configs.forEach(c => {
                const count    = db.filter(s => s.studentClass === c.name).length;
                const sections = (Array.isArray(c.sections) && c.sections.length) ? c.sections.join(', ') : 'No sections configured';
                html += `
                    <div class="msc-class-card" onclick="updOpenClass('${c.name}')">
                        <div class="class-name">${c.name}</div>
                        <div class="class-meta">Sections: ${sections}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${count} students</div>
                    </div>
                `;
            });
        }

        grid.innerHTML = html;
    }

    /** Render the section-cards grid for the active class in the Edit modal */
    function updRenderSectionCards() {
        const grid    = document.getElementById('upd-sections-grid');
        const titleEl = document.getElementById('upd-sections-title');
        if (titleEl) titleEl.textContent = updActiveClass;
        if (!grid) return;

        const cfg      = getClassConfigMap()[updActiveClass];
        const sections = (cfg && Array.isArray(cfg.sections) && cfg.sections.length) ? cfg.sections : [];
        const db       = getActiveDatabase();
        const classStu = db.filter(s => s.studentClass === updActiveClass);
        const allTeacher = getClassTeacher(updActiveClass, 'ALL');

        let html = `
            <div class="msc-incharge-header" style="grid-column:1/-1;">
                <i class="fas fa-chalkboard-teacher"></i>
                <span>Class Incharge: <strong>${allTeacher || 'Not Assigned'}</strong></span>
            </div>
            <div class="msc-class-card msc-class-card--all" onclick="updOpenSection('ALL')">
                <div class="class-name"><i class="fas fa-layer-group"></i> All Sections</div>
                <div class="class-meta">All ${classStu.length} students</div>
                <div class="class-count"><i class="fas fa-users"></i> ${classStu.length} students</div>
            </div>
        `;

        if (sections.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:24px 12px;color:var(--text-muted);">
                No sections configured for this class in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.
            </div>`;
        } else {
            sections.forEach(sec => {
                const cnt = classStu.filter(s => s.section === sec).length;
                const t   = getClassTeacher(updActiveClass, sec);
                html += `
                    <div class="msc-class-card" onclick="updOpenSection('${sec}')">
                        <div class="class-name">Section ${sec}</div>
                        <div class="class-meta">${t ? 'Incharge: ' + t : 'No incharge assigned'}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${cnt} students</div>
                    </div>
                `;
            });
        }

        grid.innerHTML = html;
    }

    /** "All Students" card clicked — skip class/section filtering entirely */
    window.updOpenAllStudents = function() {
        updActiveClass   = ALL_STUDENTS_KEY;
        updActiveSection = null;
        const srch = document.getElementById('upd-search-input');
        if (srch) srch.value = '';
        const titleEl = document.getElementById('upd-table-context-title');
        if (titleEl) titleEl.textContent = 'All Students';
        updShowStage('table');
        updRefreshTeacherBadge();
        renderStudentTable();
    };

    /** A class card was clicked — move to the section-cards stage */
    window.updOpenClass = function(className) {
        updActiveClass   = className;
        updActiveSection = null;
        updRenderSectionCards();
        updShowStage('sections');
    };

    /** A section card (or "All Sections") was clicked — show the student table */
    window.updOpenSection = function(section) {
        updActiveSection = section;
        const srch = document.getElementById('upd-search-input');
        if (srch) srch.value = '';
        const titleEl = document.getElementById('upd-table-context-title');
        if (titleEl) {
            titleEl.textContent = section === 'ALL'
                ? `${updActiveClass} — All Sections`
                : `${updActiveClass} — Section ${section}`;
        }
        updShowStage('table');
        updRefreshTeacherBadge();
        renderStudentTable();
    };

    /** Back button: table -> sections (or straight to classes if we came from "All Students") */
    window.updBackToSections = function() {
        if (updActiveClass === ALL_STUDENTS_KEY) { window.updBackToClasses(); return; }
        updActiveSection = null;
        updRenderSectionCards();
        updShowStage('sections');
    };

    /** Back button: sections -> classes */
    window.updBackToClasses = function() {
    updActiveClass = null;
    updActiveSection = null;
    updOrphanFilterActive = false; // Reset filter
    const updOrphanBtn = document.getElementById('upd-orphan-filter-btn');
    if (updOrphanBtn) {
        updOrphanBtn.classList.remove('active-filter');
        updOrphanBtn.setAttribute('aria-pressed', 'false');
        updOrphanBtn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    }
    updRenderClassCards();
    updShowStage('classes');
};

    // PERFORMANCE FIX — "the student list makes the page hang."
    //
    // This renderer built a <tr> for EVERY matching student and handed the
    // browser one enormous innerHTML string. With several hundred students
    // that is thousands of DOM nodes plus (previously) a base64 <img> inlined
    // into each one, on the main thread, blocking everything. It also ran on
    // every 6-second live-sync tick and on every keystroke in the search box.
    //
    // Now only a window of rows is rendered, with a "Show more" row at the
    // bottom. The window resets whenever the filters change, so a search
    // always shows its best matches immediately.
    //
    // IMPORTANT EXCEPTION: promote mode is deliberately exempt below. The
    // promotion flow reads every .promote-checkbox out of the DOM, so
    // rendering only part of the list there would silently promote only the
    // visible students — a data bug, not a rendering one.
    const STUDENT_TABLE_PAGE_SIZE = 100;
    let _studentTableVisibleCount = STUDENT_TABLE_PAGE_SIZE;
    let _studentTableFilterKey = '';

    // PERFORMANCE — shared helpers for the two big tables (Edit + View-only).
    //
    // 1. Rows are now built into an ARRAY and written to the DOM with ONE
    //    innerHTML assignment. The old `tbody.innerHTML += row` re-parsed the
    //    whole growing table once per student (quadratic) — that is what made
    //    "All Students" slow to open, and it grows worse with every student.
    // 2. "Show more" no longer redraws the rows already on screen: it only
    //    appends the next page with insertAdjacentHTML.
    // 3. The "Show more" row is watched by an IntersectionObserver, so the next
    //    100 students load by themselves as you scroll near the bottom (the
    //    button stays as a fallback).
    // 4. Typing in the search box is debounced so every keystroke doesn't
    //    rebuild the table.
    function ssDebounce(fn, ms) {
        let t = null;
        return function () {
            const args = arguments, ctx = this;
            clearTimeout(t);
            t = setTimeout(() => fn.apply(ctx, args), ms);
        };
    }
    function ssIsModalShown(id) {
        const m = document.getElementById(id);
        return !!(m && m.style.display && m.style.display !== 'none');
    }
    function ssMoreRowHtml(rowId, colCount, remaining, onclick) {
        return `<tr id="${rowId}"><td colspan="${colCount}" style="text-align:center;padding:18px;">
            <button type="button" class="btn btn-secondary" onclick="${onclick}()" style="padding:8px 20px;font-size:13px;">
                Show ${Math.min(remaining, STUDENT_TABLE_PAGE_SIZE)} more <span style="opacity:.65;">(${remaining} remaining)</span>
            </button></td></tr>`;
    }
    const _moreObservers = {};
    function ssWatchMoreRow(key, rowId, loadFn) {
        if (_moreObservers[key]) { _moreObservers[key].disconnect(); _moreObservers[key] = null; }
        const row = document.getElementById(rowId);
        if (!row || typeof IntersectionObserver === 'undefined') return;
        const obs = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) {
                obs.disconnect();
                _moreObservers[key] = null;
                loadFn();
            }
        }, { rootMargin: '400px 0px' });
        obs.observe(row);
        _moreObservers[key] = obs;
    }

    // ----- Edit table (student-list-tbody) -----
    let _updState = null;   // { filtered, showClassCol, promoteMode } of the last render

    function updRowHtml(s, idx, showClassCol, promoteMode) {
        const displayId = s.regNo || s.id;
        // SECURITY: escape at render time.
        const siblingTag = (s.isSibling && s.siblingOf)
            ? `<br><span class="sibling-tag"><i class="fas fa-user-friends"></i> Sibling of ${SSValidate.escapeHtml(s.siblingOf)}</span>`
            : '';
        // Promote mode defaults to "everyone listed is selected" every time.
        const checkboxCell = promoteMode
            ? `<td><input type="checkbox" class="promote-checkbox" data-regno="${s.regNo}" checked style="width:18px;height:18px;"></td>`
            : '';
        const statusCell = promoteMode
            ? `<td>${s.promoted
                    ? '<span class="promotion-status-badge promoted"><i class="fas fa-check-circle"></i> Promoted</span>'
                    : '<span class="promotion-status-badge pending"><i class="fas fa-hourglass-half"></i> Not Promoted</span>'}</td>`
            : '';
        const classSectionCell = showClassCol
            ? `${s.studentClass || '—'}${s.section ? ' ' + s.section : ''}`
            : (s.section || '—');
        const safeFullName     = SSValidate.escapeHtml(s.fullName);
        const safeGuardianName = SSValidate.escapeHtml(s.guardianName);
        const safeDisplayId    = SSValidate.escapeHtml(displayId);
        const safeRollNo       = SSValidate.escapeHtml(s.rollNo || '—');
        const safeClassSection = SSValidate.escapeHtml(classSectionCell);
        const safeGender       = SSValidate.escapeHtml(s.gender);
        const safeRegNoAttr    = String(s.regNo || '').replace(/['"\\]/g, '');
        return `
            <tr class="${s.orphanStatus === 'Orphan' ? 'orphan-highlight' : ''}">
                ${checkboxCell}
                <td class="msc-sr-cell">${idx + 1}</td>
                <td><span class="hrk-id-badge">${safeDisplayId}</span></td>
                <td>${safeRollNo}</td>
                <td>
                    <strong>${safeFullName}</strong>
                    ${s.orphanStatus === 'Orphan' ? ' <i class="fas fa-heart" style="color:#ef4444; font-size:10px;" title="Orphan"></i>' : ''}
                    ${siblingTag}
                </td>
                <td>${safeGuardianName}</td>
                <td><span class="class-chip">${safeClassSection}</span></td>
                <td>${safeGender}</td>
                ${statusCell}
                <td>
                    <div class="action-btn-group">
                        <button class="btn-icon view" onclick="viewFullProfile('${safeRegNoAttr}')" title="View Profile"><i class="fas fa-eye"></i></button>
                        <button class="btn-icon edit" onclick="editStudentInfo('${safeRegNoAttr}')" title="Edit Record"><i class="fas fa-user-edit"></i></button>
                        <button class="btn-icon delete" onclick="deleteRecord('${safeRegNoAttr}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </td>
            </tr>`;
    }

    window.showMoreStudents = function() {
        const tbody = document.getElementById('student-list-tbody');
        if (!tbody || !_updState || _updState.promoteMode) return;
        const filtered = _updState.filtered;
        const from = Math.min(_studentTableVisibleCount, filtered.length);
        _studentTableVisibleCount += STUDENT_TABLE_PAGE_SIZE;
        const to = Math.min(_studentTableVisibleCount, filtered.length);

        const oldRow = document.getElementById('upd-more-row');
        if (oldRow) oldRow.remove();

        let html = '';
        for (let i = from; i < to; i++) html += updRowHtml(filtered[i], i, _updState.showClassCol, false);
        if (to < filtered.length) html += ssMoreRowHtml('upd-more-row', 10, filtered.length - to, 'showMoreStudents');
        tbody.insertAdjacentHTML('beforeend', html);
        if (to < filtered.length) ssWatchMoreRow('upd', 'upd-more-row', window.showMoreStudents);
    };

    window.renderStudentTable = function() {
        const db = getActiveDatabase();
        const tbody = document.getElementById('student-list-tbody');
        if (!tbody) return;

        const useTabFilter = (updActiveClass !== null && updActiveClass !== ALL_STUDENTS_KEY);
        const qUnified = (document.getElementById('upd-search-input') ? document.getElementById('upd-search-input').value : '').toLowerCase().trim();

        let filtered = db;
        if (useTabFilter && updActiveClass) {
            filtered = filtered.filter(s => s.studentClass === updActiveClass);
        }
        if (useTabFilter && updActiveSection && updActiveSection !== 'ALL') {
            filtered = filtered.filter(s => s.section === updActiveSection);
        }
        if (updOrphanFilterActive) {
            filtered = filtered.filter(s => s.orphanStatus === 'Orphan');
        }
        if (qUnified) {
            filtered = filtered.filter(s => studentMatchesSearch(s, qUnified));
        }
        filtered.sort((a, b) => (parseInt(a.rollNo) || 0) - (parseInt(b.rollNo) || 0));

        const showClassCol = (updActiveClass === ALL_STUDENTS_KEY);
        const updClassColHeader = document.getElementById('upd-class-col-header');
        if (updClassColHeader) updClassColHeader.textContent = showClassCol ? 'Class' : 'Section';

        const promoteMode = document.body.classList.contains('promote-mode-active');

        // Reset the visible window whenever the filter context changes.
        const filterKey = [updActiveClass, updActiveSection, updOrphanFilterActive, qUnified, promoteMode].join('|');
        if (filterKey !== _studentTableFilterKey) {
            _studentTableFilterKey = filterKey;
            _studentTableVisibleCount = STUDENT_TABLE_PAGE_SIZE;
        }

        if (_moreObservers.upd) { _moreObservers.upd.disconnect(); _moreObservers.upd = null; }
        _updState = { filtered, showClassCol, promoteMode };

        if (filtered.length === 0) {
            const colCount = promoteMode ? 11 : 10;
            const emptyMsg = updOrphanFilterActive
                ? '<i class="fas fa-child" style="font-size:22px;display:block;margin-bottom:10px;opacity:0.6;"></i>No orphan records found.'
                : 'No matching records found.';
            tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;padding:50px;color:#94a3b8;">${emptyMsg}</td></tr>`;
            return;
        }

        // Promote mode renders the FULL list on purpose (the promotion flow
        // reads every .promote-checkbox from the DOM) — but now in one pass.
        const shown = promoteMode ? filtered.length : Math.min(_studentTableVisibleCount, filtered.length);
        const parts = new Array(shown);
        for (let i = 0; i < shown; i++) parts[i] = updRowHtml(filtered[i], i, showClassCol, promoteMode);
        let html = parts.join('');
        if (!promoteMode && shown < filtered.length) {
            html += ssMoreRowHtml('upd-more-row', 10, filtered.length - shown, 'showMoreStudents');
        }
        tbody.innerHTML = html;
        if (!promoteMode && shown < filtered.length) ssWatchMoreRow('upd', 'upd-more-row', window.showMoreStudents);
    };


    // ── VIEW-ONLY TABLE (read-only directory with class/section tabs) ─────────

    // State for view-only modal tabs
    let voActiveClass   = null;  // currently selected class name
    let voActiveSection = null;  // currently selected section, or 'ALL'

    /** Show one of the three View-only modal stages: 'classes' | 'sections' | 'table' */
    function voShowStage(stage) {
        ['classes', 'sections', 'table'].forEach(s => {
            const el = document.getElementById('vo-stage-' + s);
            if (el) el.classList.toggle('hidden', s !== stage);
        });
    }

    /**
     * Render the class-cards grid for the View-only modal — an "All Students"
     * master card plus one card per class configured in Settings, regardless
     * of whether that class currently has any students.
     */
    function voRenderClassCards() {
        const configs = getClassConfigs();
        const db      = getActiveDatabase();
        const grid    = document.getElementById('vo-classes-grid');
        if (!grid) return;

        let html = `
            <div class="msc-class-card msc-class-card--all" onclick="voOpenAllStudents()">
                <button type="button" class="msc-print-btn" onclick="event.stopPropagation(); printStudentListReport('${ALL_STUDENTS_KEY}', null);" title="Print full school student list"><i class="fas fa-print"></i></button>
                <div class="class-name"><i class="fas fa-users"></i> All Students</div>
                <div class="class-meta">Every class &amp; section</div>
                <div class="class-count"><i class="fas fa-user-graduate"></i> ${db.length} students</div>
            </div>
        `;

        if (configs.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:32px 12px;color:var(--text-muted);">
                <i class="fas fa-school" style="font-size:2rem;margin-bottom:10px;display:block;opacity:0.4;"></i>
                No classes configured yet. Add classes in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.
            </div>`;
        } else {
            configs.forEach(c => {
                const count    = db.filter(s => s.studentClass === c.name).length;
                const sections = (Array.isArray(c.sections) && c.sections.length) ? c.sections.join(', ') : 'No sections configured';
                html += `
                    <div class="msc-class-card" onclick="voOpenClass('${c.name}')">
                        <button type="button" class="msc-print-btn" onclick="event.stopPropagation(); printStudentListReport('${c.name}', null);" title="Print ${c.name} student list"><i class="fas fa-print"></i></button>
                        <div class="class-name">${c.name}</div>
                        <div class="class-meta">Sections: ${sections}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${count} students</div>
                    </div>
                `;
            });
        }

        grid.innerHTML = html;
    }

    /** Render the section-cards grid for the currently active class */
    function voRenderSectionCards() {
        const grid    = document.getElementById('vo-sections-grid');
        const titleEl = document.getElementById('vo-sections-title');
        if (titleEl) titleEl.textContent = voActiveClass;
        if (!grid) return;

        const cfg      = getClassConfigMap()[voActiveClass];
        const sections = (cfg && Array.isArray(cfg.sections) && cfg.sections.length) ? cfg.sections : [];
        const db       = getActiveDatabase();
        const classStudents = db.filter(s => s.studentClass === voActiveClass);
        const allTeacher = getClassTeacher(voActiveClass, 'ALL');

        let html = `
            <div class="msc-incharge-header" style="grid-column:1/-1;">
                <i class="fas fa-chalkboard-teacher"></i>
                <span>Class Incharge: <strong>${allTeacher || 'Not Assigned'}</strong></span>
            </div>
            <div class="msc-class-card msc-class-card--all" onclick="voOpenSection('ALL')">
                <button type="button" class="msc-print-btn" onclick="event.stopPropagation(); printStudentListReport('${voActiveClass}', 'ALL');" title="Print ${voActiveClass} — all sections student list"><i class="fas fa-print"></i></button>
                <div class="class-name"><i class="fas fa-layer-group"></i> All Sections</div>
                <div class="class-meta">All ${classStudents.length} students</div>
                <div class="class-count"><i class="fas fa-users"></i> ${classStudents.length} students</div>
            </div>
        `;

        if (sections.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:24px 12px;color:var(--text-muted);">
                No sections configured for this class in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.
            </div>`;
        } else {
            sections.forEach(sec => {
                const cnt = classStudents.filter(s => s.section === sec).length;
                const t   = getClassTeacher(voActiveClass, sec);
                html += `
                    <div class="msc-class-card" onclick="voOpenSection('${sec}')">
                        <button type="button" class="msc-print-btn" onclick="event.stopPropagation(); printStudentListReport('${voActiveClass}', '${sec}');" title="Print ${voActiveClass} — Section ${sec} student list"><i class="fas fa-print"></i></button>
                        <div class="class-name">Section ${sec}</div>
                        <div class="class-meta">${t ? 'Incharge: ' + t : 'No incharge assigned'}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${cnt} students</div>
                    </div>
                `;
            });
        }

        grid.innerHTML = html;
    }

    /** "All Students" card clicked — skip class/section filtering entirely */
    window.voOpenAllStudents = function() {
        voActiveClass   = ALL_STUDENTS_KEY;
        voActiveSection = null;
        const srch = document.getElementById('vo-search-name');
        if (srch) srch.value = '';
        const titleEl = document.getElementById('vo-table-context-title');
        if (titleEl) titleEl.textContent = 'All Students';
        voShowStage('table');
        renderViewOnlyTable();
    };

    /** A class card was clicked — move to the section-cards stage */
    window.voOpenClass = function(className) {
        voActiveClass   = className;
        voActiveSection = null;
        voRenderSectionCards();
        voShowStage('sections');
    };

    /** A section card (or "All Sections") was clicked — show the student table */
    window.voOpenSection = function(section) {
        voActiveSection = section;
        const srch = document.getElementById('vo-search-name');
        if (srch) srch.value = '';
        const titleEl = document.getElementById('vo-table-context-title');
        if (titleEl) {
            titleEl.textContent = section === 'ALL'
                ? `${voActiveClass} — All Sections`
                : `${voActiveClass} — Section ${section}`;
        }
        voShowStage('table');
        renderViewOnlyTable();
    };

    /** Back button: table -> sections (or straight to classes if we came from "All Students") */
    window.voBackToSections = function() {
        if (window.voResetPromoteMode) window.voResetPromoteMode();
        if (voActiveClass === ALL_STUDENTS_KEY) { window.voBackToClasses(); return; }
        voActiveSection = null;
        voRenderSectionCards();
        voShowStage('sections');
    };

    /** Back button: sections -> classes */
    window.voBackToClasses = function() {
    if (window.voResetPromoteMode) window.voResetPromoteMode();
    voActiveClass = null;
    voActiveSection = null;
    voOrphanFilterActive = false; // Reset filter
    const voOrphanBtn = document.getElementById('vo-orphan-filter-btn');
    if (voOrphanBtn) {
        voOrphanBtn.classList.remove('active-filter');
        voOrphanBtn.setAttribute('aria-pressed', 'false');
        voOrphanBtn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    }
    voResetSortUI();
    voRenderClassCards();
    voShowStage('classes');
};

    // ----- View-only table (vo-student-tbody) — now paginated like the edit table -----
    let _voVisibleCount = STUDENT_TABLE_PAGE_SIZE;
    let _voFilterKey = '';
    let _voState = null;

    function voRowHtml(s, idx, showClassCol, voPromoteMode) {
        const displayId = s.regNo || s.id;
        const siblingTag = (s.isSibling && s.siblingOf)
            ? `<br><span class="sibling-tag"><i class="fas fa-user-friends"></i> Sibling of ${SSValidate.escapeHtml(s.siblingOf)}</span>`
            : '';
        const classSectionCell = showClassCol
            ? `${s.studentClass || '—'}${s.section ? ' ' + s.section : ''}`
            : (s.section || '—');
        const safeFullName     = SSValidate.escapeHtml(s.fullName);
        const safeGuardianName = SSValidate.escapeHtml(s.guardianName);
        const safeDisplayId    = SSValidate.escapeHtml(displayId);
        const safeRollNo       = SSValidate.escapeHtml(s.rollNo || '—');
        const safeClassSection = SSValidate.escapeHtml(classSectionCell);
        const safeGender       = SSValidate.escapeHtml(s.gender);
        const safeRegNoAttr    = String(s.regNo || '').replace(/['"\\]/g, '');
        const voCheckboxCell = voPromoteMode
            ? `<td><input type="checkbox" class="vo-promote-checkbox" data-regno="${safeRegNoAttr}" checked style="width:18px;height:18px;"></td>`
            : '';
        const voStatusCell = voPromoteMode
            ? `<td>${s.promoted
                    ? '<span class="promotion-status-badge promoted"><i class="fas fa-check-circle"></i> Promoted</span>'
                    : '<span class="promotion-status-badge pending"><i class="fas fa-hourglass-half"></i> Not Promoted</span>'}</td>`
            : '';
        return `
            <tr class="${s.orphanStatus === 'Orphan' ? 'orphan-highlight' : ''}">
                ${voCheckboxCell}
                <td class="msc-sr-cell">${idx + 1}</td>
                <td><span class="hrk-id-badge">${safeDisplayId}</span></td>
                <td>${safeRollNo}</td>
                <td>
                    <strong>${safeFullName}</strong>
                    ${s.orphanStatus === 'Orphan' ? ' <i class="fas fa-heart" style="color:#ef4444; font-size:10px;" title="Orphan"></i>' : ''}
                    ${siblingTag}
                    ${voIssueTagsHtml(s)}
                </td>
                <td>${safeGuardianName}</td>
                <td><span class="class-chip">${safeClassSection}</span></td>
                <td>${safeGender}</td>
                ${voStatusCell}
                <td style="text-align:center;">
                    <div class="action-btn-group">
                        <button class="btn-icon view" onclick="viewFullProfile('${safeRegNoAttr}')" title="View Profile"><i class="fas fa-eye"></i></button>
                        <button class="btn-icon more-actions" type="button" onclick="toggleStudentActionMenu(event, '${safeRegNoAttr}')" title="More actions" aria-haspopup="true" aria-expanded="false"><i class="fas fa-ellipsis-vertical"></i></button>
                    </div>
                </td>
            </tr>`;
    }

    window.showMoreViewOnlyStudents = function() {
        const tbody = document.getElementById('vo-student-tbody');
        if (!tbody || !_voState || _voState.voPromoteMode) return;
        const filtered = _voState.filtered;
        const from = Math.min(_voVisibleCount, filtered.length);
        _voVisibleCount += STUDENT_TABLE_PAGE_SIZE;
        const to = Math.min(_voVisibleCount, filtered.length);

        const oldRow = document.getElementById('vo-more-row');
        if (oldRow) oldRow.remove();

        let html = '';
        for (let i = from; i < to; i++) html += voRowHtml(filtered[i], i, _voState.showClassCol, false);
        if (to < filtered.length) html += ssMoreRowHtml('vo-more-row', 8, filtered.length - to, 'showMoreViewOnlyStudents');
        tbody.insertAdjacentHTML('beforeend', html);
        if (to < filtered.length) ssWatchMoreRow('vo', 'vo-more-row', window.showMoreViewOnlyStudents);
    };

    window.renderViewOnlyTable = function() {
        try { if (typeof voRefreshTeacherBadge === 'function') voRefreshTeacherBadge(); } catch(e) {}

        const db = getActiveDatabase();
        const tbody = document.getElementById('vo-student-tbody');
        if (!tbody) return;

        const qName = (document.getElementById('vo-search-name') ? document.getElementById('vo-search-name').value : '').toLowerCase().trim();

        let filtered = db;
        if (voActiveClass && voActiveClass !== ALL_STUDENTS_KEY) {
            filtered = filtered.filter(s => s.studentClass === voActiveClass);
            if (voActiveSection && voActiveSection !== 'ALL') {
                filtered = filtered.filter(s => s.section === voActiveSection);
            }
        }
        if (voOrphanFilterActive) {
            filtered = filtered.filter(s => s.orphanStatus === 'Orphan');
        }
        if (voSortIsActive()) {
            filtered = filtered.filter(voMatchesSort);
        }
        if (qName) {
            filtered = filtered.filter(s => studentMatchesSearch(s, qName));
        }

        const voPromoteMode = document.body.classList.contains('vo-promote-mode-active');

        if (_moreObservers.vo) { _moreObservers.vo.disconnect(); _moreObservers.vo = null; }

        if (filtered.length === 0) {
            _voState = null;
            const voMediaPending = voSortState.record.has('missing') && typeof window.ssStudentMediaReady === 'function' && !window.ssStudentMediaReady();
            const emptyMsg = voSortIsActive()
                ? '<i class="fas fa-arrow-down-wide-short" style="font-size:22px;display:block;margin-bottom:10px;opacity:0.6;"></i>' + (voMediaPending ? 'Still checking B-Form pictures… this list will update in a moment.' : 'No students match the selected sort options.')
                : voOrphanFilterActive
                    ? '<i class="fas fa-child" style="font-size:22px;display:block;margin-bottom:10px;opacity:0.6;"></i>No orphan records found.'
                    : 'No matching records found.';
            tbody.innerHTML = `<tr><td colspan="${voPromoteMode ? 10 : 8}" style="text-align:center;padding:50px;color:#94a3b8;">${emptyMsg}</td></tr>`;
            return;
        }

        filtered.sort((a, b) => (parseInt(a.rollNo) || 0) - (parseInt(b.rollNo) || 0));

        const showClassCol = (voActiveClass === ALL_STUDENTS_KEY);
        const voClassColHeader = document.getElementById('vo-class-col-header');
        if (voClassColHeader) voClassColHeader.textContent = showClassCol ? 'Class' : 'Section';

        // Reset the visible window whenever the filter context changes.
        const filterKey = [voActiveClass, voActiveSection, voOrphanFilterActive, qName, voPromoteMode, [...voSortState.gender].join(), [...voSortState.age].join(), [...voSortState.record].join(), [...voSortState.missingFields].join()].join('|');
        if (filterKey !== _voFilterKey) {
            _voFilterKey = filterKey;
            _voVisibleCount = STUDENT_TABLE_PAGE_SIZE;
        }
        _voState = { filtered, showClassCol, voPromoteMode };

        // Promote mode must render everyone (it reads checkboxes from the DOM).
        const shown = voPromoteMode ? filtered.length : Math.min(_voVisibleCount, filtered.length);
        const parts = new Array(shown);
        for (let i = 0; i < shown; i++) parts[i] = voRowHtml(filtered[i], i, showClassCol, voPromoteMode);
        let html = parts.join('');
        if (!voPromoteMode && shown < filtered.length) {
            html += ssMoreRowHtml('vo-more-row', 8, filtered.length - shown, 'showMoreViewOnlyStudents');
        }
        tbody.innerHTML = html;
        if (!voPromoteMode && shown < filtered.length) ssWatchMoreRow('vo', 'vo-more-row', window.showMoreViewOnlyStudents);
    };
    // Wire view-only search to re-render
    const voSearchEl = document.getElementById('vo-search-name');
    if (voSearchEl) voSearchEl.addEventListener('input', ssDebounce(() => window.renderViewOnlyTable(), 150));

    // Wire update-database search bar
    const updSearchEl = document.getElementById('upd-search-input');
    if (updSearchEl) updSearchEl.addEventListener('input', ssDebounce(() => window.renderStudentTable(), 150));

    // NOTE: class-card re-rendering when Settings changes classes (even from
    // another tab/device) already happens via refreshClassUI(), called from
    // the backend poll tick in pollClassConfigs() — see startLiveSync().

    // ── STUDENT ID CARD GENERATOR (Manage Records) ────────────────────────────
    // Triggered by the "Generate ID Cards" button on the Manage Records
    // student-table stage. Builds one printable ID card per student in
    // whichever scope is currently selected there — a single section, a
    // whole class (all sections), or the whole school ("All Students") —
    // and lets the admin download every card as a PNG sized exactly
    // 638 x 1012 px (standard vertical CR80 ID card size at 300 DPI) or send them to
    // a print-ready, cut-to-size sheet.

    const IDC_CARD_PIXEL_WIDTH  = 638;  // 2.125in @ 300 DPI (vertical CR80 card)
    const IDC_CARD_PIXEL_HEIGHT = 1012; // 3.375in @ 300 DPI
    const IDC_CAPTURE_SCALE     = 3;    // render the ~300x476 on-screen card 3x, then resize to the exact target below

    // The list of students the generator was last opened for, kept around so
    // Download All / Print All / a single card's download button don't need
    // to re-derive the class/section filter after the modal is open.
    let idcCurrentStudents = [];

    /** Resolve the same "class/section/all" filter the Manage Records table stage is
     *  currently showing, ignoring its free-text search box — the generator always
     *  produces cards for the WHOLE selected group, not just a filtered-down search. */
    function idcGetStudentsForCurrentVoScope() {
        const db = getActiveDatabase();
        let list = db;
        if (voActiveClass && voActiveClass !== ALL_STUDENTS_KEY) {
            list = list.filter(s => s.studentClass === voActiveClass);
            if (voActiveSection && voActiveSection !== 'ALL') {
                list = list.filter(s => s.section === voActiveSection);
            }
        }
        return list.slice().sort((a, b) => {
            const ca = (a.studentClass || '').localeCompare(b.studentClass || '', undefined, { numeric: true });
            if (ca !== 0) return ca;
            const sa = (a.section || '').localeCompare(b.section || '');
            if (sa !== 0) return sa;
            const ra = parseInt(a.rollNo) || 0, rb = parseInt(b.rollNo) || 0;
            if (ra !== rb) return ra - rb;
            return (a.fullName || '').localeCompare(b.fullName || '');
        });
    }

    /**
     * Build a REAL, scannable Code 128 barcode as an inline SVG string from
     * an ID string (the student's Reg./ID number). The bar pattern comes from
     * JsBarcode's encoder; we draw it ourselves as plain <rect>s so this stays
     * synchronous (no DOM element needed) and renders cleanly through
     * html2canvas. A 10-module quiet zone is added on both sides, which
     * scanners need in order to lock on. If JsBarcode failed to load, or the
     * text can't be encoded, it falls back to a decorative (non-scannable)
     * bar pattern so the card layout is never broken.
     */
    function idcBuildBarcodeSvg(text) {
        const VIEW_H = 60, QUIET = 10;
        const str = String(text || '').trim() || '0';

        let binary = '';
        try {
            if (typeof JsBarcode !== 'undefined') {
                const out = {};
                JsBarcode(out, str, { format: 'CODE128' });
                binary = out.encodings.map(e => e.data).join('');
            }
        } catch (err) {
            console.error('Code 128 encoding failed for', str, err);
        }

        if (binary) {
            let bars = '';
            let i = 0;
            while (i < binary.length) {
                if (binary[i] === '1') {
                    let j = i;
                    while (j < binary.length && binary[j] === '1') j++;
                    bars += `<rect x="${QUIET + i}" y="0" width="${j - i}" height="${VIEW_H}" fill="#000000"/>`;
                    i = j;
                } else {
                    i++;
                }
            }
            const viewW = binary.length + QUIET * 2;
            return `<svg viewBox="0 0 ${viewW} ${VIEW_H}" preserveAspectRatio="none" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
        }

        // Fallback: decorative only (not scannable).
        const VIEW_W = 480;
        let seed = 0;
        for (let k = 0; k < str.length; k++) seed = (seed * 131 + str.charCodeAt(k) + 7) >>> 0;
        const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        let bars = '';
        let x = 0;
        while (x < VIEW_W) {
            const w = 2 + Math.floor(rand() * 6);
            if (rand() > 0.42) bars += `<rect x="${x}" y="0" width="${w}" height="${VIEW_H}" fill="#0f172a"/>`;
            x += w;
        }
        return `<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
    }

    /** Build the inner HTML for one ID card (front side) from a student record. */
    function idcBuildCardHtml(s, qrPlaceholderId) {
        const esc = SSValidate.escapeHtml;

        const schoolEl   = document.querySelector('.school-name');
        const schoolName = schoolEl ? schoolEl.textContent.trim() : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
        const logoUrl    = getSchoolLogoUrl();

        const photoSrc      = storedStudentFileSrc(s, 'photo');
        const displayId     = s.regNo || s.id || '—';
        const contactNumber = s.phone1 || s.phone2 || '—';
        const address       = s.permanentAddress || s.address || '—';

        const logoInner = logoUrl
            ? `<img src="${esc(logoUrl)}" alt="Logo">`
            : `<i class="fas fa-graduation-cap"></i>`;
        const photoInner = photoSrc
            ? `<img data-photo-src="${esc(photoSrc)}" alt="${esc(s.fullName)}" crossorigin="anonymous" decoding="async">`
            : `<i class="fas fa-user"></i>`;

        return `
            <div class="idc-card-header">
                <div class="idc-card-logo">${logoInner}</div>
                <div class="idc-card-header-text">
                    <div class="idc-card-school-name">${esc(schoolName)}</div>
                    <div class="idc-card-doc-label">Student Identity Card</div>
                </div>
            </div>
            <div class="idc-card-body">
                <div class="idc-card-photo">${photoInner}</div>
                <div class="idc-card-info">
                    <div class="idc-card-name">${esc(s.fullName || '—')}</div>
                    <span class="idc-card-idbadge">ID: ${esc(displayId)}</span>
                    <div class="idc-card-rows">
                        <div class="idc-card-row"><span class="idc-label">Class:</span><span class="idc-value">${esc(s.studentClass || '—')}</span></div>
                        <div class="idc-card-row"><span class="idc-label">Section:</span><span class="idc-value">${esc(s.section || '—')}</span></div>
                        <div class="idc-card-row"><span class="idc-label">Guardian:</span><span class="idc-value">${esc(s.guardianName || '—')}</span></div>
                        <div class="idc-card-row"><span class="idc-label">Contact:</span><span class="idc-value">${esc(contactNumber)}</span></div>
                        <div class="idc-card-row idc-row-clamp"><span class="idc-label">Address:</span><span class="idc-value idc-value-clamp">${esc(address)}</span></div>
                    </div>
                </div>
            </div>
            <div class="idc-card-barcode-wrap">
                <div class="idc-card-barcode-label">Scan for Attendance</div>
                <div class="idc-card-front-qr-box" id="${qrPlaceholderId}"><i class="fas fa-qrcode idc-card-front-qr-fallback"></i></div>
                <div class="idc-card-barcode-text">${esc(displayId)}</div>
            </div>
        `;
    }

    /** Build the inner HTML for the BACK of one ID card — school contact
     *  details plus a "for attendance" barcode along the bottom (the mirror
     *  of the QR strip on the front). */
    function idcBuildBackCardHtml(s) {
        const esc = SSValidate.escapeHtml;

        const schoolEl   = document.querySelector('.school-name');
        const schoolName = schoolEl ? schoolEl.textContent.trim() : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
        const logoUrl       = getSchoolLogoUrl();
        const schoolPhone   = getSchoolContactPhone() || 'Not set in Settings';
        const schoolAddress = getSchoolContactAddress() || 'Not set in Settings';
        const displayId     = s.regNo || s.id || '—';

        const logoInner = logoUrl
            ? `<img src="${esc(logoUrl)}" alt="Logo">`
            : `<i class="fas fa-graduation-cap"></i>`;

        return `
            <div class="idc-card-header">
                <div class="idc-card-logo">${logoInner}</div>
                <div class="idc-card-header-text">
                    <div class="idc-card-school-name">${esc(schoolName)}</div>
                    <div class="idc-card-doc-label">School Contact &amp; Attendance</div>
                </div>
            </div>
            <div class="idc-card-back-body">
                <div class="idc-back-contact-col">
                    <div class="idc-back-section-label">School Address</div>
                    <div class="idc-back-line"><i class="fas fa-map-marker-alt"></i><span>${esc(schoolAddress)}</span></div>
                    <div class="idc-back-section-label" style="margin-top:2px;">Contact Number</div>
                    <div class="idc-back-line"><i class="fas fa-phone"></i><span>${esc(schoolPhone)}</span></div>
                    <div class="idc-back-note">If found, please return this card to the school address above. This card remains the property of ${esc(schoolName)}.</div>
                </div>
            </div>
            <div class="idc-card-barcode-wrap">
                <div class="idc-card-barcode-label">Scan for Attendance</div>
                ${idcBuildBarcodeSvg(displayId)}
                <div class="idc-card-barcode-text">${esc(displayId)}</div>
            </div>
            <div class="idc-software-brand">
                <span class="idc-software-logo">S</span>
                <span>Powered by <strong>SoftSchool</strong></span>
            </div>
        `;
    }

    /** Sanitize a student's regNo/id for safe use as a DOM id / attribute. */
    function idcSafeId(regNo) {
        return String(regNo).replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    /** Populate the ID card grid for a given list of students and show the overlay. */
    function idcRenderGrid(students) {
        const grid  = document.getElementById('idc-cards-grid');
        const empty = document.getElementById('idc-empty-state');
        if (!grid) return;

        if (students.length === 0) {
            grid.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';

        grid.innerHTML = students.map((s, idx) => {
            const displayId = s.regNo || s.id || `row${idx}`;
            const safeId    = idcSafeId(displayId);
            const safeName  = SSValidate.escapeHtml(`${s.fullName || 'Unnamed'} — ${s.studentClass || ''}${s.section ? ' ' + s.section : ''}`);
            const qrId      = `idc-qr-${safeId}`;
            return `
                <div class="idc-pair" data-reg="${safeId}">
                    <div class="idc-pair-header">
                        <span class="idc-pair-name" title="${safeName}">${safeName}</span>
                        <button type="button" class="idc-pair-download-btn" onclick="downloadStudentIdCardPair('${safeId}')">
                            <i class="fas fa-download"></i> Both Sides
                        </button>
                    </div>
                    <div class="idc-pair-row">
                        <div class="idc-card-thumb" data-reg="${safeId}" data-side="front">
                            <span class="idc-side-tag">Front</span>
                            <button type="button" class="idc-card-thumb-download" title="Download front side" onclick="downloadSingleIdCard('${safeId}','front')">
                                <i class="fas fa-download"></i>
                            </button>
                            <div class="idc-card" id="idc-card-front-${safeId}">
                                ${idcBuildCardHtml(s, qrId)}
                            </div>
                        </div>
                        <div class="idc-card-thumb" data-reg="${safeId}" data-side="back">
                            <span class="idc-side-tag">Back</span>
                            <button type="button" class="idc-card-thumb-download" title="Download back side" onclick="downloadSingleIdCard('${safeId}','back')">
                                <i class="fas fa-download"></i>
                            </button>
                            <div class="idc-card idc-card-back" id="idc-card-back-${safeId}">
                                ${idcBuildBackCardHtml(s)}
                            </div>
                        </div>
                    </div>
                </div>`;
        }).join('');

        // Everything heavy is now LAZY (only cards near the screen get their QR + photo),
        // so opening the grid is instant and scrolling never freezes, even with hundreds of students.
        idcSetupLazyPrepare(grid, students);
    }

    let idcPairObserver = null;

    /** Draw the QR + load the photo only for cards near the viewport. */
    function idcSetupLazyPrepare(grid, students) {
        if (idcPairObserver) { idcPairObserver.disconnect(); idcPairObserver = null; }

        if (window.IdPhotoAlign) IdPhotoAlign.applyToCards(grid); // photos: lazy + queued inside the module

        // Fit long names on one line (now, and again once fonts have loaded).
        requestAnimationFrame(() => idcFitNames(grid));
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => idcFitNames(grid));
        else grid.querySelectorAll('img[data-photo-src]').forEach(im => { im.onerror = () => { const i = document.createElement('i'); i.className = 'fas fa-user'; im.replaceWith(i); }; im.src = im.getAttribute('data-photo-src'); });

        const pairs = grid.querySelectorAll('.idc-pair');
        if (!('IntersectionObserver' in window)) {
            // Old browser: fill QR codes a few at a time so the page stays responsive.
            let i = 0;
            (function step() {
                const end = Math.min(pairs.length, i + 4);
                for (; i < end; i++) idcPrepareQrForPair(pairs[i]);
                if (i < pairs.length) setTimeout(step, 30);
            })();
            return;
        }
        idcPairObserver = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (!e.isIntersecting) return;
                idcPairObserver.unobserve(e.target);
                idcPrepareQrForPair(e.target);
            });
        }, { root: (window.IdPhotoAlign ? IdPhotoAlign.scrollParent(pairs[0]) : null), rootMargin: '600px 0px' });
        pairs.forEach(p => idcPairObserver.observe(p));
    }

    function idcPrepareQrForPair(pairEl) {
        if (!pairEl || pairEl.dataset.qr === '1') return;
        pairEl.dataset.qr = '1';
        idcFitNames(pairEl);
        const st = idcFindStudent(pairEl.dataset.reg);
        if (st) idcInitQrCodes([st]);
    }

    /** Make sure ONE card is fully ready (QR drawn + photo aligned) before it is captured. */

    /**
     * Long names: shrink the font (down to a floor) until the whole name fits on ONE line,
     * instead of being cut off with "…". Short names keep the normal size.
     */
    function idcFitName(el) {
        if (!el) return;
        el.style.fontSize = '';                                  // start from the normal size
        const boxW = el.clientWidth;
        if (!boxW) return;                                       // not laid out yet (hidden) — will be retried
        if (el.scrollWidth <= boxW) return;                      // already fits
        const MIN = 7.5;
        const base = parseFloat(getComputedStyle(el).fontSize) || 15;
        let size = Math.max(MIN, Math.floor(base * (boxW / el.scrollWidth) * 2) / 2);
        el.style.fontSize = size + 'px';
        while (el.scrollWidth > el.clientWidth && size > MIN) { // fine-tune for rounding
            size -= 0.5;
            el.style.fontSize = size + 'px';
        }
    }
    function idcFitNames(root) {
        (root || document).querySelectorAll('.idc-card-name').forEach(idcFitName);
    }
    
    async function idcPrepareCard(cardEl) {
        const pair = cardEl && cardEl.closest ? cardEl.closest('.idc-pair') : null;
        if (!pair) return;
        idcPrepareQrForPair(pair);
        idcFitNames(pair);                      // long names → smaller font, one line
        if (window.IdPhotoAlign) await IdPhotoAlign.ensure(pair, 10000);
    }

    /**
     * Draw the "for attendance" QR code into each FRONT card's placeholder.
     * Runs after idcRenderGrid() has inserted the markup into the DOM, since
     * QRCode.js draws directly into a live element rather than returning a
     * string. The QR simply encodes the student's Reg./ID number — the same
     * value an attendance scanner would look up — so it stays scannable and
     * useful, not just decorative like the back's barcode.
     */
    function idcInitQrCodes(students) {
        if (typeof QRCode === 'undefined') return; // library failed to load (e.g. offline) — CSS fallback icon stays visible
        students.forEach(s => {
            const displayId = s.regNo || s.id;
            if (!displayId) return;
            const el = document.getElementById(`idc-qr-${idcSafeId(displayId)}`);
            if (!el) return;
            el.innerHTML = ''; // clear the fallback icon before drawing
            try {
                new QRCode(el, {
                    text: String(displayId),
                    width: 240,
                    height: 240,
                    colorDark: '#062a1a',   // near-black green: high contrast so it scans from further away
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.L   // lowest error correction = fewest modules = each module printed larger
                });
            } catch (err) {
                console.error('QR generation failed for', displayId, err);
                el.innerHTML = '<i class="fas fa-qrcode idc-card-front-qr-fallback"></i>';
            }
        });
    }

    /** "Generate ID Cards" button on the Manage Records table stage. */
    window.voOpenIdCardGenerator = async function() {
        await ensureSchoolInfoLoaded(); // school phone/address must be loaded before the back of the card is drawn
        idcCurrentStudents = idcGetStudentsForCurrentVoScope();

        const label = document.getElementById('idc-toolbar-label');
        if (label) {
            if (voActiveClass === ALL_STUDENTS_KEY) {
                label.textContent = `Student ID Cards — All Students (${idcCurrentStudents.length})`;
            } else if (!voActiveSection || voActiveSection === 'ALL') {
                label.textContent = `Student ID Cards — ${voActiveClass} — All Sections (${idcCurrentStudents.length})`;
            } else {
                label.textContent = `Student ID Cards — ${voActiveClass} — Section ${voActiveSection} (${idcCurrentStudents.length})`;
            }
        }

        const downloadBtn = document.getElementById('idc-download-all-btn');
        const printBtn    = document.getElementById('idc-print-all-btn');
        const hasStudents = idcCurrentStudents.length > 0;
        if (downloadBtn) downloadBtn.style.display = hasStudents ? '' : 'none';
        if (printBtn)    printBtn.style.display    = hasStudents ? '' : 'none';

        if (!hasStudents) {
            showToast('No Students', 'There are no students in this selection to generate ID cards for.', 'danger');
        }

        idcRenderGrid(idcCurrentStudents);

        const overlay = document.getElementById('idc-overlay');
        if (overlay) overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    window.closeIdCardGenerator = function() {
        const overlay = document.getElementById('idc-overlay');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = 'auto';
    };

    /**
     * Capture one .idc-card DOM node (rendered on-screen at ~300x476) and
     * return a PNG blob at the exact print resolution (638 x 1012 px / vertical CR80
     * @ 300 DPI), regardless of how large the on-screen preview is. html2canvas
     * renders at IDC_CAPTURE_SCALE for crisp text/edges, then a plain <canvas>
     * resize step stretches that render to the exact final pixel dimensions
     * so every downloaded/printed card is pixel-identical in size.
     */
    
    async function idcCaptureCardCanvas(cardEl) {
        if (!cardEl || typeof html2canvas === 'undefined') return null;
        await idcPrepareCard(cardEl); // QR + aligned photo ready (cards off-screen are prepared on demand)
        const rawCanvas = await html2canvas(cardEl, {
            scale: IDC_CAPTURE_SCALE,
            backgroundColor: '#ffffff',
            useCORS: true,
            logging: false,
            imageTimeout: 8000,
            // html2canvas copies the whole page before drawing; with hundreds of cards that copy took seconds per
            // download. Skip every element that is not this card (or its parent/child) — identical image, ~50x faster.
            ignoreElements: (n) => { if (!document.body.contains(n)) return false; return !(n === cardEl || cardEl.contains(n) || n.contains(cardEl)); }
        });
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width  = IDC_CARD_PIXEL_WIDTH;
        finalCanvas.height = IDC_CARD_PIXEL_HEIGHT;
        const ctx = finalCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(rawCanvas, 0, 0, IDC_CARD_PIXEL_WIDTH, IDC_CARD_PIXEL_HEIGHT);
        return finalCanvas;
    }

    async function idcCaptureCardBlob(cardEl) {
        const canvas = await idcCaptureCardCanvas(cardEl);
        if (!canvas) return null;
        return new Promise(res => canvas.toBlob(res, 'image/png'));
    }

    function idcFilenameFor(s, side) {
        const safeName = String(s.fullName || 'Student').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
        const safeId   = String(s.regNo || s.id || '').replace(/[^a-z0-9]+/gi, '_');
        const sidePart = side === 'back' ? 'Back' : 'Front';
        return `ID_Card_${sidePart}_${safeName}${safeId ? '_' + safeId : ''}.png`;
    }

    function idcTriggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function idcFindStudent(safeId) {
        return idcCurrentStudents.find(x => idcSafeId(x.regNo || x.id) === safeId);
    }

    function idcCardElFor(safeId, side) {
        return document.getElementById(`idc-card-${side}-${safeId}`);
    }

    /** Small per-card download button inside the grid — one side at a time. */
    window.downloadSingleIdCard = async function(safeId, side) {
        const s = idcFindStudent(safeId);
        const cardEl = idcCardElFor(safeId, side);
        if (!s || !cardEl) return;
        try {
            const blob = await idcCaptureCardBlob(cardEl);
            if (!blob) throw new Error('capture failed');
            idcTriggerDownload(blob, idcFilenameFor(s, side));
        } catch (err) {
            console.error('ID card capture failed', err);
            showToast('Generation Failed', `Could not generate the ${side} of the ID card for ${s.fullName || 'this student'}.`, 'danger');
        }
    };

    /** "Both Sides" button on a single student's pair header. */
    window.downloadStudentIdCardPair = async function(safeId) {
        const s = idcFindStudent(safeId);
        if (!s) return;
        const frontEl = idcCardElFor(safeId, 'front');
        const backEl  = idcCardElFor(safeId, 'back');
        try {
            const frontBlob = await idcCaptureCardBlob(frontEl);
            if (frontBlob) idcTriggerDownload(frontBlob, idcFilenameFor(s, 'front'));
            await new Promise(r => setTimeout(r, 200));
            const backBlob = await idcCaptureCardBlob(backEl);
            if (backBlob) idcTriggerDownload(backBlob, idcFilenameFor(s, 'back'));
        } catch (err) {
            console.error('ID card capture failed', err);
            showToast('Generation Failed', `Could not generate the ID card for ${s.fullName || 'this student'}.`, 'danger');
        }
    };

    /** Toolbar "Download PDF" — captures the front and back of every card in the current scope and saves them together as ONE PDF. Each page is exactly one card (2.125in x 3.375in, vertical CR80) holding the 638x1012 px image, front then back for each student, so the file can go straight to a card printer or be printed on any printer at true size. */
    window.downloadAllIdCards = async function() {
        if (!idcCurrentStudents.length) return;

        const PDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (!PDFCtor) {
            showToast('PDF Library Missing', 'The PDF library did not load. Check your internet connection and reload the page.', 'danger');
            return;
        }

        const btn = document.getElementById('idc-download-all-btn');
        const progress = document.getElementById('idc-progress');
        const progressText = document.getElementById('idc-progress-text');
        if (btn) btn.disabled = true;
        if (progress) progress.style.display = 'flex';

        const CARD_W_IN = 2.125, CARD_H_IN = 3.375;
        const doc = new PDFCtor({ orientation: 'portrait', unit: 'in', format: [CARD_W_IN, CARD_H_IN], compress: true });
        let pageCount = 0, failed = 0;
        const total = idcCurrentStudents.length * 2;
        let done = 0;

        for (const s of idcCurrentStudents) {
            const safeId = idcSafeId(s.regNo || s.id);
            for (const side of ['front', 'back']) {
                done++;
                if (progressText) progressText.textContent = `Adding card ${done} of ${total} to PDF…`;
                try {
                    const canvas = await idcCaptureCardCanvas(idcCardElFor(safeId, side));
                    if (!canvas) throw new Error('capture failed');
                    // JPEG at high quality keeps the PDF a sensible size even for a whole school.
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                    if (pageCount > 0) doc.addPage([CARD_W_IN, CARD_H_IN], 'portrait');
                    doc.addImage(dataUrl, 'JPEG', 0, 0, CARD_W_IN, CARD_H_IN, undefined, 'FAST');
                    pageCount++;
                } catch (err) {
                    console.error('ID card capture failed for', safeId, side, err);
                    failed++;
                }
                await new Promise(r => setTimeout(r, 0)); // let the browser repaint the progress text
            }
        }

        if (pageCount > 0) {
            if (progressText) progressText.textContent = 'Building PDF…';
            await new Promise(r => setTimeout(r, 0));
            const scope = (voActiveClass === ALL_STUDENTS_KEY)
                ? 'All_Students'
                : [voActiveClass, (voActiveSection && voActiveSection !== 'ALL') ? 'Section_' + voActiveSection : 'All_Sections'].join('_');
            const safeScope = String(scope).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
            doc.save(`ID_Cards_${safeScope}.pdf`);
        }

        if (progress) progress.style.display = 'none';
        if (btn) btn.disabled = false;

        if (pageCount === 0) {
            showToast('PDF Failed', 'Could not generate any ID cards for the PDF.', 'danger');
        } else if (failed === 0) {
            showToast('PDF Ready', `Downloaded 1 PDF with ${pageCount} pages (front + back for ${idcCurrentStudents.length} student${idcCurrentStudents.length === 1 ? '' : 's'}).`, 'success');
        } else {
            showToast('PDF Downloaded With Gaps', `${pageCount} pages saved; ${failed} card${failed === 1 ? '' : 's'} could not be generated.`, 'danger');
        }
    };

    /** Toolbar "Print All" — opens the print window immediately with a loading screen (so there's no blank/frozen-looking wait before anything appears), then captures each student's front and back one at a time, yielding back to the browser between each so the tab actually repaints and the "Preparing X of Y" progress stays visibly live instead of the page looking stuck. Groups students onto pages (2 or 3 per page, per the "Per page" selector), each page showing that student's front and back side by side so a printed sheet can be cut straight into complete, ready-to-use cards. Every card prints at its true physical size (2.125in x 3.375in = 638x1012px @ 300 DPI, vertical CR80). */
    window.printAllIdCards = async function() {
        if (!idcCurrentStudents.length) return;

        // Open the print window right away, synchronously, so (a) it isn't
        // blocked as a delayed pop-up and (b) the person sees *something*
        // immediately instead of staring at the toolbar for several seconds
        // while every card is captured in the background.
        const printWin = window.open('', '_blank', 'width=1000,height=800');
        if (!printWin) {
            showToast('Pop-up Blocked', 'Please allow pop-ups to print the ID cards.', 'danger');
            return;
        }
        printWin.document.write(`
<!DOCTYPE html>
<html>
<head>
<title>Student ID Cards — Print</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        color: #475569;
        background: #f8fafc;
    }
    .idc-loading { text-align: center; }
    .idc-loading-spinner {
        width: 34px; height: 34px;
        margin: 0 auto 14px;
        border: 4px solid #d1fae5;
        border-top-color: #16a34a;
        border-radius: 50%;
        animation: idc-spin 0.8s linear infinite;
    }
    @keyframes idc-spin { to { transform: rotate(360deg); } }
    #idc-loading-text { font-size: 14px; font-weight: 600; }
</style>
</head>
<body>
    <div class="idc-loading">
        <div class="idc-loading-spinner"></div>
        <div id="idc-loading-text">Preparing your ID cards for printing…</div>
    </div>
</body>
</html>`);
        printWin.document.close();

        // Give the browser an actual chance to paint that loading screen
        // before the (CPU-heavy, single-threaded) card capturing below
        // starts — otherwise the capture work can run back-to-back with no
        // yield in between and the new tab appears to just sit there blank.
        await new Promise(r => setTimeout(r, 60));

        const btn = document.getElementById('idc-print-all-btn');
        const progress = document.getElementById('idc-progress');
        const progressText = document.getElementById('idc-progress-text');
        const perPageSelect = document.getElementById('idc-print-per-page');
        const perPage = Math.max(1, parseInt(perPageSelect && perPageSelect.value, 10) || 3);
        if (btn) btn.disabled = true;
        if (progress) progress.style.display = 'flex';

        const total = idcCurrentStudents.length * 2;
        let done = 0;
        const updateProgressLabel = () => {
            const label = `Preparing ${done} of ${total}…`;
            if (progressText) progressText.textContent = label;
            // Keep the print window's own loading text in sync too, in case
            // it takes a while — so it never looks stuck or frozen.
            try {
                const loadingEl = printWin.document.getElementById('idc-loading-text');
                if (loadingEl) loadingEl.textContent = label;
            } catch (err) { /* print window may already be mid-navigation; ignore */ }
        };

        const captureDataUrl = async (cardEl) => {
            if (!cardEl) return null;
            try {
                const blob = await idcCaptureCardBlob(cardEl);
                if (!blob) return null;
                return await new Promise(res => {
                    const reader = new FileReader();
                    reader.onload = () => res(reader.result);
                    reader.readAsDataURL(blob);
                });
            } catch (err) {
                console.error(err);
                return null;
            }
        };

        // Capture card-by-card (front + back together) rather than firing
        // every capture at once: html2canvas's actual drawing work is
        // synchronous and single-threaded, so blasting the whole batch at
        // once just queues it all back-to-back with no chance for the
        // browser to repaint — which is what made the print tab look
        // frozen. A short yield between students keeps the UI (and the
        // "Preparing X of Y" text, in both windows) visibly responsive.
        const pairs = [];
        for (const s of idcCurrentStudents) {
            const safeId = idcSafeId(s.regNo || s.id);
            const [front, back] = await Promise.all([
                captureDataUrl(idcCardElFor(safeId, 'front')),
                captureDataUrl(idcCardElFor(safeId, 'back'))
            ]);
            done += 2;
            updateProgressLabel();
            if (front || back) pairs.push({ front, back, name: s.fullName || 'Student' });
            await new Promise(r => setTimeout(r, 0)); // yield so the browser can repaint before the next card
        }

        if (progress) progress.style.display = 'none';
        if (btn) btn.disabled = false;

        if (pairs.length === 0) {
            showToast('Print Failed', 'Could not generate any ID cards to print.', 'danger');
            try { printWin.close(); } catch (err) { /* ignore */ }
            return;
        }

        // Group students into pages of `perPage`. Each page is a 2-column
        // (front | back) grid with one row per student, so cutting along the
        // grid lines yields complete, correctly paired front/back cards.
        const pages = [];
        for (let i = 0; i < pairs.length; i += perPage) pages.push(pairs.slice(i, i + perPage));

        const cardImg = (src, label) => src
            ? `<img class="idc-print-card" src="${src}" alt="${label}">`
            : `<div class="idc-print-card idc-print-card-missing">${label} unavailable</div>`;

        const pagesHtml = pages.map((group, pageIdx) => {
            const rows = group.map(p => `${cardImg(p.front, 'Front')}${cardImg(p.back, 'Back')}`).join('');
            const isLast = pageIdx === pages.length - 1;
            return `
    <div class="idc-print-page${isLast ? '' : ' idc-print-page-break'}">
        <div class="idc-print-page-label">Front &amp; Back — ${group.map(p => SSValidate.escapeHtml(p.name)).join(', ')}</div>
        <div class="idc-print-grid">${rows}</div>
    </div>`;
        }).join('');

        printWin.document.open();
        printWin.document.write(`
<!DOCTYPE html>
<html>
<head>
<title>Student ID Cards — Print</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 6mm; }
    body { background: #fff; }
    .idc-print-page {
        padding-top: 2mm;
    }
    .idc-print-page-break {
        break-after: page;
        page-break-after: always;
    }
    .idc-print-page-label {
        font-family: Arial, sans-serif;
        font-size: 10px;
        font-weight: 700;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 3mm;
    }
    /* 2 columns (front | back), one row per student — matches how the
       cards should be cut apart. Each card prints at its true physical,
       vertical CR80 size: 2.125in x 3.375in (source image is 638 x 1012 px,
       i.e. exactly 300 DPI at this size). */
    .idc-print-grid {
        display: grid;
        grid-template-columns: repeat(2, 2.125in);
        grid-auto-rows: 3.375in;
        column-gap: 10mm;
        row-gap: 6mm;
        justify-content: center;
    }
    .idc-print-card {
        width: 2.125in;
        height: 3.375in;
        object-fit: contain;
        border: 1px dashed #cbd5e1; /* cut guide — doesn't print if the printer ignores light dashed lines; kept for visual cutting reference on-screen */
    }
    .idc-print-card-missing {
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        font-size: 11px;
        color: #94a3b8;
        border: 1px dashed #cbd5e1;
    }
    @media print {
        .idc-print-card, .idc-print-card-missing { border-color: #e2e8f0; }
    }
</style>
</head>
<body>
${pagesHtml}
    <script>
        window.onload = function() {
            setTimeout(function() { window.focus(); window.print(); }, 300);
        };
    <\/script>
</body>
</html>`);
        printWin.document.close();
    };

    // ── PROMOTE ALL STUDENTS ─────────────────────────────────────────────────

    // Fallback progression, only used if no classes have been configured yet
    // in Settings (edu_class_configs).
    const CLASS_PROGRESSION = [
        "Montessori", "Nursery", "Prep",
        "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5",
        "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10"
    ];

    /**
     * The real class ladder is whatever the school configured on the Settings
     * page (could stop at Grade 5, Grade 10, or anywhere else). Promoting a
     * student out of the LAST class in this list is what triggers graduation.
     */
    function getClassProgression() {
        const configs = getClassConfigs();
        if (Array.isArray(configs) && configs.length) return configs.map(c => c.name);
        return CLASS_PROGRESSION;
    }

    function getNextClass(currentClass) {
        const progression = getClassProgression();
        const idx = progression.indexOf(currentClass);
        if (idx === -1 || idx === progression.length - 1) return null; // unknown or final (graduating) class
        return progression[idx + 1];
    }

    // Session status is derived in sessions.html: when a session is marked
    // current, later date ranges are "Next"; otherwise today's date determines
    // the current range and the nearest future range is next.
    async function getNextAcademicSession() {
        const schoolId = getCurrentSchoolId();
        if (!schoolId) throw new Error('Sign in to a school before promoting students.');

        const rows = await apiRequest(
            'GET',
            `${BACKEND_ORIGIN}/api/sessions?schoolId=${encodeURIComponent(schoolId)}`
        );
        if (!Array.isArray(rows)) return null;

        const monthKey = value => {
            const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value || '').trim());
            return match ? (Number(match[1]) * 12 + Number(match[2]) - 1) : null;
        };
        const validSessions = rows.map(session => ({
            ...session,
            _startKey: monthKey(session.startMonth),
            _endKey: monthKey(session.endMonth)
        })).filter(session =>
            session._startKey !== null &&
            session._endKey !== null &&
            session._endKey >= session._startKey
        );
        if (!validSessions.length) return null;

        const compare = (a, b) =>
            (a._startKey - b._startKey) || (a._endKey - b._endKey);
        const markedCurrent = validSessions.find(session =>
            session.currentSession === true ||
            String(session.currentSession).toLowerCase() === 'true'
        );

        let nextSessions;
        if (markedCurrent) {
            nextSessions = validSessions.filter(session =>
                session.id !== markedCurrent.id && compare(session, markedCurrent) > 0
            );
        } else {
            const now = new Date();
            const todayKey = now.getFullYear() * 12 + now.getMonth();
            nextSessions = validSessions.filter(session =>
                !(session._startKey <= todayKey && todayKey <= session._endKey) &&
                session._endKey >= todayKey
            );
        }

        nextSessions.sort(compare);
        return nextSessions[0] || null;
    }

    window.togglePromoteMode = function() {
        const active = document.body.classList.toggle('promote-mode-active');
        const header = document.getElementById('promote-checkbox-header');
        const statusHeader = document.getElementById('promote-status-header');
        const actionsBar = document.getElementById('promote-actions-bar');
        const promoteBtn = document.getElementById('promote-all-btn');

        if (header) header.style.display = active ? '' : 'none';
        if (statusHeader) statusHeader.style.display = active ? '' : 'none';
        if (actionsBar) actionsBar.style.display = active ? 'flex' : 'none';
        if (promoteBtn) promoteBtn.style.display = active ? 'none' : '';

        renderStudentTable();
    };

    // ── PROMOTE MODE for Manage Records (mirrors Update Records) ─────────────
    function voApplyPromoteUI(active) {
        const set = (id, show, display) => {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? display : 'none';
        };
        set('vo-promote-checkbox-header', active, '');
        set('vo-promote-status-header', active, '');
        set('vo-promote-actions-bar', active, 'flex');
        const btn = document.getElementById('vo-promote-all-btn');
        if (btn) btn.style.display = active ? 'none' : '';
    }

    window.toggleVoPromoteMode = function() {
        const active = document.body.classList.toggle('vo-promote-mode-active');
        voApplyPromoteUI(active);
        if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
    };

    // Silently leave promote mode (used when navigating away / reopening).
    window.voResetPromoteMode = function() {
        document.body.classList.remove('vo-promote-mode-active');
        voApplyPromoteUI(false);
    };

    // scope: undefined/'upd' = Update Records table, 'vo' = Manage Records table
    window.confirmPromotion = async function(scope) {
        const isVo = scope === 'vo';
        const checkboxes = document.querySelectorAll(isVo ? '.vo-promote-checkbox' : '.promote-checkbox');
        const selectedRegNos = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.regno);

        if (selectedRegNos.length === 0) {
            showToast("No Students Selected", "Select at least one student to promote.", "warning");
            return;
        }

        let nextSession;
        try {
            nextSession = await getNextAcademicSession();
        } catch (err) {
            console.error('Could not check the next academic session:', err);
            showToast(
                "Session Check Failed",
                err && err.message ? err.message : "Could not check for a new session. Please try again.",
                "danger"
            );
            return;
        }
        if (!nextSession) {
            showToast(
                "No New Session Found",
                "No new session found, please create new session first.",
                "danger"
            );
            return;
        }

        const db = getDatabase();
        const selectedStudents = db.filter(s => selectedRegNos.includes(s.regNo));

        // How many of the selected students are being promoted OUT of the
        // school's last configured class — those are the ones that will land
        // in the Archive Center as "graduated", so they're what counts against
        // the plan's archiveStudentLimit.
        const willGraduateCount = selectedStudents.filter(s => !getNextClass(s.studentClass)).length;

        if (willGraduateCount > 0 && !canArchiveMoreStudents(willGraduateCount)) {
            const limit = getArchiveLimit();
            const used  = getGraduatedStudents().length + getDroppedStudents().length;
            showToast(
                "Archive Limit Reached",
                `This would move ${willGraduateCount} student(s) into the archive, but your plan only allows ${limit} archived students (currently ${used}). Deselect some students or upgrade your plan.`,
                "danger"
            );
            return;
        }

        const nextSessionLabel = `${nextSession.startMonth} to ${nextSession.endMonth}`;
        const promoteConfirmed = await ssConfirm(
            `Copy ${selectedRegNos.length} selected student(s) into the next session (${nextSessionLabel}) at their next class level?`,
            { title: 'Promote Students', confirmLabel: 'Promote', danger: false }
        );
        if (!promoteConfirmed) return;

        const todayISO = new Date().toISOString().slice(0, 10);
        const thisYear = new Date().getFullYear();
        const nextSessionAdmissionDate = `${nextSession.startMonth}-01`;
        let promotedCount = 0;
        let graduatedCount = 0;
        let failedCount = 0;
        let financeTransferFailedCount = 0;
        const copies = [];
        const graduates = [];
        const sessionExitDate = (() => {
            const parts = /^(\d{4})-(\d{2})$/.exec(nextSession.startMonth || '');
            if (!parts) return todayISO;
            return new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, 0))
                .toISOString().slice(0, 10);
        })();

        selectedStudents.forEach(student => {
            const nextClass = getNextClass(student.studentClass);
            if (nextClass) {
                // Each academic year gets its own student row. Keep the source
                // row unchanged for its original session and start the copied
                // record on the first day of the next session.
                const copy = { ...student };
                copy.admissionClass = copy.admissionClass || student.studentClass;
                copy.studentClass = nextClass;
                copy.admissionDate = nextSessionAdmissionDate;
                copy.status = 'active';
                copy.droppedDate = null;
                copy.graduatedDate = null;
                copy.graduatedYear = null;
                copy.graduatedClass = null;
                copy.graduatedSection = null;
                copy.promoted = false;
                copy.regNo = generateNextRegistrationNumber(nextSessionAdmissionDate);
                copy.id = copy.regNo;
                copy.rollNo = generateClassRollNumber(nextClass);

                // A photo URL is only a display URL, not the file contents or
                // stored path expected by the student API. Keep real paths and
                // inline data, but do not store a stale API URL on the copy.
                if (typeof copy.photo === 'string' && /^https?:/i.test(copy.photo)) {
                    delete copy.photo;
                }
                const sourceUpdate = {
                    ...student,
                    status: 'promoted',
                    // The source record ends immediately before the next
                    // session, keeping it in historical reports without
                    // counting it again alongside its new-session copy.
                    droppedDate: sessionExitDate
                };
                if (typeof sourceUpdate.photo === 'string' && /^https?:/i.test(sourceUpdate.photo)) {
                    delete sourceUpdate.photo;
                }
                const sourceRollback = {
                    ...student,
                    status: student.status || 'active',
                    droppedDate: student.droppedDate || null
                };
                if (typeof sourceRollback.photo === 'string' && /^https?:/i.test(sourceRollback.photo)) {
                    delete sourceRollback.photo;
                }
                copies.push({
                    source: student,
                    copy,
                    sourceUpdate,
                    sourceRollback
                });
                // Reserve IDs/roll numbers while preparing the remaining copies.
                db.push(copy);
            } else {
                // The final configured class still graduates instead of being
                // copied into another class.
                graduates.push({
                    source: student,
                    update: {
                        ...student,
                        status: 'graduated',
                        graduatedDate: todayISO,
                        graduatedYear: thisYear,
                        graduatedClass: student.studentClass,
                        graduatedSection: student.section || ''
                    }
                });
            }
        });

        // Mark the source inactive before creating its copy so the server's
        // student-capacity check counts the promotion as a transfer, not an
        // extra enrolment. If copy creation fails, restore the source record.
        for (const item of copies) {
            let sourceMarked = false;
            let copySaved = false;
            try {
                await apiSaveStudent(item.sourceUpdate);
                sourceMarked = true;
                const saved = await apiSaveStudent(item.copy);
                copySaved = true;
                if (saved) normalizeSiblingFieldsFromServer(saved);
                Object.assign(item.source, item.sourceUpdate, { promoted: true });
                promotedCount++;

                // Move the student's fee ledgers, voucher history, unpaid
                // fines, pending custom fees, and carried balance to the new
                // registration number after both student records exist.
                const financeTransferPayload = {
                    schoolId: getCurrentSchoolId(),
                    sourceRegNo: item.source.regNo,
                    targetRegNo: item.copy.regNo,
                    nextSessionMonth: nextSession.startMonth
                };
                let financeTransfer = null;
                let financeTransferError = null;
                // The endpoint is idempotent, so retry once for a transient
                // network failure or a response lost after the server commit.
                for (let attempt = 0; attempt < 2 && !financeTransfer; attempt++) {
                    try {
                        financeTransfer = await apiRequest(
                            'POST',
                            `${BACKEND_ORIGIN}/api/finance/promote-student-finances`,
                            financeTransferPayload
                        );
                        if (!financeTransfer || financeTransfer.success !== true) {
                            throw new Error('The server did not confirm the finance transfer.');
                        }
                    } catch (transferErr) {
                        financeTransferError = transferErr;
                        financeTransfer = null;
                    }
                }
                if (financeTransfer) {
                    item.copy.arrears = Number(financeTransfer.carryForwardAmount) || 0;
                } else {
                    financeTransferFailedCount++;
                    console.error(
                        'Student was promoted, but finance history transfer failed for',
                        item.source.regNo,
                        financeTransferError
                    );
                }
            } catch (err) {
                failedCount++;
                if (!copySaved) {
                    const draftIndex = db.indexOf(item.copy);
                    if (draftIndex !== -1) {
                        db.splice(draftIndex, 1);
                    }
                }
                if (sourceMarked && !copySaved) {
                    try {
                        await apiSaveStudent(item.sourceRollback);
                    } catch (rollbackErr) {
                        console.error('Could not restore source student after failed copy', item.source.regNo, rollbackErr);
                    }
                }
                console.error('Backend sync failed (promotion) for', item.source.regNo, err);
            }
        }

        // Save graduating students in place, matching the existing archive flow.
        for (const item of graduates) {
            try {
                const saved = await apiSaveStudent(item.update);
                if (saved) normalizeSiblingFieldsFromServer(saved);
                Object.assign(item.source, item.update, { promoted: true });
                graduatedCount++;
            } catch (err) {
                failedCount++;
                console.error('Backend sync failed (graduation) for', item.source.regNo, err);
            }
        }
        saveDatabase(db);

        const failureNote = failedCount > 0
            ? ` ${failedCount} record(s) could not be saved to the server.`
            : '';
        const financeFailureNote = financeTransferFailedCount > 0
            ? ` Finance history and pending balances could not be transferred for ${financeTransferFailedCount} student(s); their new student records were created.`
            : '';
        showToast(
            failedCount > 0 || financeTransferFailedCount > 0 ? "Promotion Partially Complete" : "Promotion Complete",
            `${promotedCount} student(s) copied into ${nextSessionLabel} and promoted.` + (graduatedCount ? ` ${graduatedCount} graduated and moved to the Archive Center.` : '') + failureNote + financeFailureNote,
            failedCount > 0 || financeTransferFailedCount > 0 ? "danger" : "success"
        );

        if (isVo) {
            toggleVoPromoteMode();
            if (typeof renderStudentTable === 'function') renderStudentTable();
        } else {
            togglePromoteMode();
            if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
        }
        updateDashboardStats();
    };

    // ── BULK TRANSFER ────────────────────────────────────────────────────────
    // Pick class -> section (same flow as Manage Records), filter by gender /
    // search, tick students, then move them to another class + section.
    let btfActiveClass   = null;
    let btfActiveSection = null;
    let btfGender        = 'ALL';
    const btfSelected    = new Set();

    function btfShowStage(stage) {
        ['classes', 'sections', 'table'].forEach(n => {
            const el = document.getElementById('btf-stage-' + n);
            if (el) el.classList.toggle('hidden', n !== stage);
        });
    }

    function btfRenderClassCards() {
        const grid = document.getElementById('btf-classes-grid');
        if (!grid) return;
        const esc = SSValidate.escapeHtml;
        const configs = getClassConfigs();
        const db = getActiveDatabase();

        let html = `
            <div class="msc-class-card msc-class-card--all" data-class="${ALL_STUDENTS_KEY}">
                <div class="class-name"><i class="fas fa-users"></i> All Students</div>
                <div class="class-meta">Every class &amp; section</div>
                <div class="class-count"><i class="fas fa-user-graduate"></i> ${db.length} students</div>
            </div>`;
        if (configs.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:32px 12px;color:var(--text-muted);">No classes configured yet. Add classes in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.</div>`;
        } else {
            configs.forEach(c => {
                const count = db.filter(s => s.studentClass === c.name).length;
                const secs  = (Array.isArray(c.sections) && c.sections.length) ? c.sections.join(', ') : 'No sections configured';
                html += `
                    <div class="msc-class-card" data-class="${esc(c.name)}">
                        <div class="class-name">${esc(c.name)}</div>
                        <div class="class-meta">Sections: ${esc(secs)}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${count} students</div>
                    </div>`;
            });
        }
        grid.innerHTML = html;
        grid.querySelectorAll('.msc-class-card').forEach(card => {
            card.addEventListener('click', () => btfOpenClass(card.dataset.class));
        });
    }

    function btfRenderSectionCards() {
        const grid = document.getElementById('btf-sections-grid');
        const titleEl = document.getElementById('btf-sections-title');
        if (titleEl) titleEl.textContent = btfActiveClass;
        if (!grid) return;
        const esc = SSValidate.escapeHtml;
        const cfg = getClassConfigMap()[btfActiveClass];
        const sections = (cfg && Array.isArray(cfg.sections)) ? cfg.sections : [];
        const classStudents = getActiveDatabase().filter(s => s.studentClass === btfActiveClass);

        let html = `
            <div class="msc-class-card msc-class-card--all" data-section="ALL">
                <div class="class-name"><i class="fas fa-layer-group"></i> All Sections</div>
                <div class="class-meta">All ${classStudents.length} students</div>
                <div class="class-count"><i class="fas fa-users"></i> ${classStudents.length} students</div>
            </div>`;
        if (sections.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:24px 12px;color:var(--text-muted);">No sections configured for this class in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.</div>`;
        } else {
            sections.forEach(sec => {
                const cnt = classStudents.filter(s => s.section === sec).length;
                html += `
                    <div class="msc-class-card" data-section="${esc(sec)}">
                        <div class="class-name">Section ${esc(sec)}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${cnt} students</div>
                    </div>`;
            });
        }
        grid.innerHTML = html;
        grid.querySelectorAll('.msc-class-card').forEach(card => {
            card.addEventListener('click', () => btfOpenSection(card.dataset.section));
        });
    }

    window.btfReset = function() {
        btfActiveClass = null;
        btfActiveSection = null;
        btfGender = 'ALL';
        btfSelected.clear();
        const srch = document.getElementById('btf-search-name');
        if (srch) srch.value = '';
        btfSyncGenderButtons();
        btfRenderClassCards();
        btfShowStage('classes');
    };

    function btfSyncGenderButtons() {
        document.querySelectorAll('#btf-gender-seg .archive-seg-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.val === btfGender);
        });
    }

    function btfOpenClass(className) {
        btfActiveClass = className;
        btfActiveSection = null;
        if (className === ALL_STUDENTS_KEY) {
            btfEnterTable('All Students');
            return;
        }
        btfRenderSectionCards();
        btfShowStage('sections');
    }

    function btfOpenSection(section) {
        btfActiveSection = section;
        btfEnterTable(section === 'ALL'
            ? `${btfActiveClass} — All Sections`
            : `${btfActiveClass} — Section ${section}`);
    }

    function btfEnterTable(title) {
        btfSelected.clear();
        btfGender = 'ALL';
        btfSyncGenderButtons();
        const srch = document.getElementById('btf-search-name');
        if (srch) srch.value = '';
        const t = document.getElementById('btf-table-context-title');
        if (t) t.textContent = title;
        btfPopulateDestClasses();
        btfShowStage('table');
        btfRenderTable();
    }

    window.btfBackToClasses = function() {
        btfActiveClass = null;
        btfActiveSection = null;
        btfSelected.clear();
        btfRenderClassCards();
        btfShowStage('classes');
    };

    window.btfBackToSections = function() {
        btfSelected.clear();
        if (btfActiveClass === ALL_STUDENTS_KEY) { window.btfBackToClasses(); return; }
        btfActiveSection = null;
        btfRenderSectionCards();
        btfShowStage('sections');
    };

    window.btfSetGender = function(val) {
        btfGender = val;
        btfSyncGenderButtons();
        btfRenderTable();
    };

    /** Students currently listed (class/section scope + gender + search) */
    function btfVisibleStudents() {
        let list = getActiveDatabase();
        if (btfActiveClass && btfActiveClass !== ALL_STUDENTS_KEY) {
            list = list.filter(s => s.studentClass === btfActiveClass);
            if (btfActiveSection && btfActiveSection !== 'ALL') {
                list = list.filter(s => s.section === btfActiveSection);
            }
        }
        if (btfGender !== 'ALL') list = list.filter(s => s.gender === btfGender);
        const q = (document.getElementById('btf-search-name')?.value || '').toLowerCase().trim();
        if (q) list = list.filter(s => studentMatchesSearch(s, q));
        return list;
    }

    window.btfRenderTable = function() {
        const tbody = document.getElementById('btf-student-tbody');
        if (!tbody) return;
        const esc = SSValidate.escapeHtml;
        const list = btfVisibleStudents();

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted);">No matching students found.</td></tr>`;
        } else {
            tbody.innerHTML = list.map((s, i) => `
                <tr>
                    <td><input type="checkbox" class="btf-checkbox" data-regno="${esc(String(s.regNo))}" ${btfSelected.has(s.regNo) ? 'checked' : ''} style="width:18px;height:18px;"></td>
                    <td class="msc-sr-cell">${i + 1}</td>
                    <td><span class="hrk-id-badge">${esc(s.regNo || s.id || '')}</span></td>
                    <td>${esc(s.rollNo || '—')}</td>
                    <td><strong>${esc(s.fullName || s.studentName || s.name || '')}</strong></td>
                    <td>${esc(s.guardianName || s.fatherName || '—')}</td>
                    <td><span class="class-chip">${esc((s.studentClass || '—') + (s.section ? ' - ' + s.section : ''))}</span></td>
                    <td>${esc(s.gender || '—')}</td>
                </tr>`).join('');
            tbody.querySelectorAll('.btf-checkbox').forEach(cb => {
                cb.addEventListener('change', () => {
                    if (cb.checked) btfSelected.add(cb.dataset.regno);
                    else btfSelected.delete(cb.dataset.regno);
                    btfUpdateSelectionUI();
                });
            });
        }
        btfUpdateSelectionUI();
    };

    function btfUpdateSelectionUI() {
        const countEl = document.getElementById('btf-selected-count');
        if (countEl) countEl.textContent = btfSelected.size;
        const all = document.getElementById('btf-select-all');
        if (all) {
            const visible = btfVisibleStudents();
            all.checked = visible.length > 0 && visible.every(s => btfSelected.has(s.regNo));
        }
    }

    window.btfToggleAll = function(checked) {
        btfVisibleStudents().forEach(s => {
            if (checked) btfSelected.add(s.regNo);
            else btfSelected.delete(s.regNo);
        });
        btfRenderTable();
    };

    function btfPopulateDestClasses() {
        const sel = document.getElementById('btf-dest-class');
        if (!sel) return;
        const esc = SSValidate.escapeHtml;
        sel.innerHTML = '<option value="">Select class…</option>' +
            getClassConfigs().map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
        btfPopulateDestSections();
    }

    window.btfPopulateDestSections = function() {
        const cls = document.getElementById('btf-dest-class')?.value;
        const sel = document.getElementById('btf-dest-section');
        if (!sel) return;
        const esc = SSValidate.escapeHtml;
        const cfg = cls ? getClassConfigMap()[cls] : null;
        const sections = (cfg && Array.isArray(cfg.sections)) ? cfg.sections : [];
        if (!cls) {
            sel.innerHTML = '<option value="">Section…</option>';
        } else if (sections.length === 0) {
            sel.innerHTML = '<option value="">No sections</option>';
        } else {
            sel.innerHTML = '<option value="">Select section…</option>' +
                sections.map(x => `<option value="${esc(x)}">Section ${esc(x)}</option>`).join('');
        }
    };

    window.btfConfirmTransfer = async function() {
        const destClass = document.getElementById('btf-dest-class')?.value || '';
        const destSection = document.getElementById('btf-dest-section')?.value || '';
        const cfg = destClass ? getClassConfigMap()[destClass] : null;
        const hasSections = !!(cfg && Array.isArray(cfg.sections) && cfg.sections.length);

        if (btfSelected.size === 0) {
            showToast('No Students Selected', 'Tick at least one student to transfer.', 'warning');
            return;
        }
        if (!destClass) {
            showToast('Choose Destination', 'Select the class to transfer the students to.', 'warning');
            return;
        }
        if (hasSections && !destSection) {
            showToast('Choose Section', 'Select the destination section.', 'warning');
            return;
        }

        const db = getDatabase();
        const targetSection = hasSections ? destSection : '';
        const toMove = db.filter(s =>
            btfSelected.has(s.regNo) && (!s.status || s.status === 'active') &&
            !(s.studentClass === destClass && (s.section || '') === targetSection)
        );
        const skipped = btfSelected.size - toMove.length;

        if (toMove.length === 0) {
            showToast('Nothing to Transfer', 'All selected students are already in that class and section.', 'warning');
            return;
        }

        const label = targetSection ? `${destClass} — Section ${targetSection}` : destClass;
        const ok = await ssConfirm(
            `Transfer ${toMove.length} student(s) to ${label}?` +
            (skipped ? ` (${skipped} already there will be skipped.)` : ''),
            { title: 'Bulk Transfer', confirmLabel: 'Transfer', danger: false }
        );
        if (!ok) return;

        // Fee question — only relevant for students whose CLASS changes (a
        // section-only move keeps the same class standard fee).
        const classChangers = toMove.filter(st => st.studentClass !== destClass);
        let updateFees = false;
        if (classChangers.length > 0) {
            const stdFee = getStandardFeeForClass(destClass);
            updateFees = await ssConfirm(
                `Update fees for ${classChangers.length} student(s) moving to ${destClass}?\n\n` +
                `Their standard tuition fee will be set to the ${destClass} standard fee (Rs. ${stdFee.toLocaleString()}). ` +
                `Each student's existing discounts (tuition, transport, sibling) stay applied, and the net payable is recalculated.`,
                { title: 'Update Fees?', confirmLabel: 'Yes, update fees', cancelLabel: 'No, keep current fees', danger: false }
            );
        }

        // Roll numbers: students changing CLASS get the next free roll number in
        // the new class (counted up locally so a batch never duplicates);
        // students only changing SECTION keep their roll number.
        let maxRoll = 0;
        db.forEach(s => {
            if ((!s.status || s.status === 'active') && s.studentClass === destClass) {
                const r = parseInt(s.rollNo, 10);
                if (!isNaN(r)) maxRoll = Math.max(maxRoll, r);
            }
        });

        let feesUpdatedCount = 0;
        toMove.forEach(s => {
            const classChanged = s.studentClass !== destClass;
            if (classChanged && !s.admissionClass) s.admissionClass = s.studentClass;   // Admission Class never changes on a move
            if (classChanged) {
                maxRoll += 1;
                s.rollNo = String(maxRoll);
            }
            s.studentClass = destClass;
            s.section = targetSection;

            if (updateFees && classChanged) {
                // Same maths as the admission/edit form's performFinancialAudit():
                // net = (standard + admission + transport) - (tuition + transport + sibling discounts)
                const num = v => parseFloat(v) || 0;
                s.standardFee = getStandardFeeForClass(destClass);
                const net = (num(s.standardFee) + num(s.admissionFee) + num(s.transportFee))
                          - (num(s.tuitionDiscount) + num(s.transportDiscount) + num(s.siblingDiscount));
                s.netPayable = Math.max(0, net).toFixed(0);
                // Annual fund is also set per class in Settings.
                if (s.annualFundEnabled === 'on' || s.annualFundEnabled === true) {
                    s.annualFundAmount = getAnnualFundForClass(destClass);
                }
                // Tuition is now carried by standardFee alone. A leftover
                // "Tuition Fee" row in the student's Other Fees list (the old
                // class's amount) would show up as a second, stale Tuition Fee
                // box on the profile, so drop tuition rows — every other
                // other-fee row (lab fee, etc.) is left untouched.
                try {
                    const rows = JSON.parse(s.otherFeesData || '[]');
                    if (Array.isArray(rows)) {
                        const kept = rows.filter(r => !/tuition/i.test(String((r && r.description) || '')));
                        if (kept.length !== rows.length) s.otherFeesData = JSON.stringify(kept);
                    }
                } catch (e) { /* unparseable other-fees data — leave as is */ }
                feesUpdatedCount++;
            }
        });

        saveDatabase(db);

        let failed = 0;
        for (const s of toMove) {
            try {
                const saved = await apiSaveStudent(s);
                if (saved) normalizeSiblingFieldsFromServer(saved);
            } catch (err) {
                failed++;
                console.error('Backend sync failed (bulk transfer) for', s.regNo, err);
            }
        }

        showToast(
            'Transfer Complete',
            `${toMove.length} student(s) moved to ${label}.` +
            (feesUpdatedCount ? ` Fees updated for ${feesUpdatedCount} student(s) (discounts kept).` : '') +
            (failed ? ` ${failed} record(s) could not be saved to the server — check your connection, they may revert.` : ''),
            failed ? 'danger' : 'success'
        );

        btfSelected.clear();
        btfRenderTable();
        if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
        if (typeof renderStudentTable === 'function') renderStudentTable();
        updateDashboardStats();
    };

    // ── ARCHIVE CENTER ───────────────────────────────────────────────────────
    // Two archives: "graduated" (promoted out of the school's final configured
    // class) and "dropped" (removed via the Delete button). Both are read-only
    // browsing views — records live permanently in the same DB_KEY store, just
    // filtered out of every active list by their `status` field.

    /** Open the Archive Center inline page (same pattern as Certificates / Data I-O) */
    window.openArchivePage = function() {
        _hideMainSections();
        const certView   = document.getElementById('cert-page-view');
        const dataIoView = document.getElementById('data-io-page-view');
        const archiveView= document.getElementById('archive-page-view');
        if (certView)    certView.style.display = 'none';
        if (dataIoView)  dataIoView.style.display = 'none';
        if (archiveView) archiveView.style.display = 'block';
        archiveBackToHub();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.closeArchivePage = function() {
        const archiveView = document.getElementById('archive-page-view');
        if (archiveView) archiveView.style.display = 'none';
        _showMainSections();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    function archiveShowStage(stage) {
        ['hub', 'graduated', 'dropped'].forEach(s => {
            const el = document.getElementById('archive-stage-' + s);
            if (el) el.classList.toggle('hidden', s !== stage);
        });
    }

    window.archiveBackToHub = function() {
        archiveShowStage('hub');
    };

    /** Section filter state for the graduated "class roster" table: 'BOTH' | 'A' | 'B' | any configured section value */
    let archiveGradSection = 'BOTH';
    window.archiveSetGradSection = function(val) {
        archiveGradSection = val;
        document.querySelectorAll('#archive-grad-section-seg .archive-seg-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.val === val);
        });
        renderArchiveGraduatedTable();
    };

    window.archiveOpenGraduated = function() {
        archiveShowStage('graduated');
        archiveGradSection = 'BOTH';
        document.querySelectorAll('#archive-grad-section-seg .archive-seg-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.val === 'BOTH');
        });
        const classSearch = document.getElementById('archive-grad-class-search');
        if (classSearch) classSearch.value = '';
        archivePopulateGradClassFilter();
        renderArchiveGraduatedTable();
    };

    window.archiveOpenDropped = function() {
        archiveShowStage('dropped');
        const dropSearch = document.getElementById('archive-drop-search');
        if (dropSearch) dropSearch.value = '';
        renderArchiveDroppedTable();
    };

    /** Populate the class dropdown for the graduated "class roster" filter bar */
    function archivePopulateGradClassFilter() {
        const sel = document.getElementById('archive-grad-class-filter');
        if (!sel) return;

        const configNames = getClassConfigs().map(c => c.name);
        const grads       = getGraduatedStudents();
        const classNames  = configNames.slice();
        grads.forEach(s => {
            if (s.graduatedClass && !classNames.includes(s.graduatedClass)) classNames.push(s.graduatedClass);
        });

        const current = sel.value;
        sel.innerHTML = `<option value="${ALL_STUDENTS_KEY}">All Classes</option>` +
            classNames.map(c => `<option value="${c}">${c}</option>`).join('');
        if (current && Array.from(sel.options).some(o => o.value === current)) sel.value = current;
    }

    /** Single merged table inside Graduated: full roster across ALL graduating batches, filterable by class / section / year */
    window.renderArchiveGraduatedTable = function() {
        const tbody = document.getElementById('archive-grad-tbody');
        const label = document.getElementById('archive-grad-this-year-label');
        if (!tbody) return;

        const classSel = document.getElementById('archive-grad-class-filter');
        const yearSel  = document.getElementById('archive-grad-year-filter');
        const qEl      = document.getElementById('archive-grad-class-search');

        const classVal = classSel ? classSel.value : ALL_STUDENTS_KEY;
        const yearVal  = yearSel ? yearSel.value : '0';
        const q        = qEl ? qEl.value.toLowerCase().trim() : '';

        if (label) label.textContent = yearVal === '0' ? new Date().getFullYear() : '';

        let list = getGraduatedStudents();

        if (classVal && classVal !== ALL_STUDENTS_KEY) {
            list = list.filter(s => s.graduatedClass === classVal);
        }
        if (archiveGradSection === 'A' || archiveGradSection === 'B' ||
            (archiveGradSection !== 'BOTH' && archiveGradSection)) {
            list = list.filter(s => s.graduatedSection === archiveGradSection);
        }
        if (yearVal !== 'ALL') {
            const targetYear = new Date().getFullYear() - parseInt(yearVal, 10);
            list = list.filter(s => Number(s.graduatedYear) === targetYear);
        }
        if (q) list = list.filter(s => studentMatchesSearch(s, q));

        list.sort((a, b) =>
            (Number(b.graduatedYear) || 0) - (Number(a.graduatedYear) || 0) ||
            (a.fullName || '').localeCompare(b.fullName || '')
        );

        renderArchiveTableRows(tbody, list, 'graduated');
    };

    /** Dropped Out: single searchable table, newest removal first */
    window.renderArchiveDroppedTable = function() {
        const tbody = document.getElementById('archive-drop-tbody');
        if (!tbody) return;

        const qEl = document.getElementById('archive-drop-search');
        const q   = qEl ? qEl.value.toLowerCase().trim() : '';

        let list = getDroppedStudents();
        if (q) list = list.filter(s => studentMatchesSearch(s, q));
        list.sort((a, b) => new Date(b.droppedDate || 0) - new Date(a.droppedDate || 0));

        renderArchiveTableRows(tbody, list, 'dropped');
    };

    /** Shared row-renderer for all three archive tables */
    function renderArchiveTableRows(tbody, list, kind) {
        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:50px;color:#94a3b8;">No ${kind === 'graduated' ? 'graduated' : 'dropped-out'} students found.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map((s, idx) => {
            const displayId = s.regNo || s.id;
            const cls    = kind === 'graduated' ? (s.graduatedClass   || s.studentClass || '—') : (s.studentClass || '—');
            const sec    = kind === 'graduated' ? (s.graduatedSection || s.section      || '—') : (s.section      || '—');
            const dateVal= kind === 'graduated' ? (s.graduatedDate    || '—')                    : (s.droppedDate  || '—');

            return `
                <tr>
                    <td class="msc-sr-cell">${idx + 1}</td>
                    <td><span class="hrk-id-badge">${displayId}</span></td>
                    <td><strong>${s.fullName || '—'}</strong></td>
                    <td>${s.guardianName || '—'}</td>
                    <td><span class="class-chip">${cls}</span></td>
                    <td><span class="class-chip">${sec}</span></td>
                    <td>${dateVal}</td>
                    <td style="text-align:center;">
                        <div class="action-btn-group">
                            <button class="btn-icon view" onclick="viewFullProfile('${s.regNo}')" title="View Profile">
                                <i class="fas fa-eye"></i>
                            </button>
                            ${kind === 'dropped' ? `<button class="btn-icon reactivate" onclick="reactivateStudent('${s.regNo}')" title="Reactivate Student">
                                <i class="fas fa-user-check"></i>
                            </button>` : ''}
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }

    /**
     * Reactivate a dropped-out student — moves them back onto the live/active
     * roster (status -> 'active') so they reappear in the dashboard counters,
     * class cards, and every search/print/share list. Mirrors deleteRecord's
     * pattern: update local cache immediately, then best-effort sync to MySQL.
     */
    window.reactivateStudent = async function(studentId) {
        const db    = getDatabase();
        const index = db.findIndex(s => s.regNo === studentId || s.id === studentId);
        if (index === -1) {
            showToast("Error", "Could not find that student to reactivate.", "danger");
            return;
        }

        const student = db[index];
        const reactivateConfirmed = await ssConfirm(
            `Reactivate ${student.fullName || 'this student'} and move them back to the active roster?`,
            { title: 'Reactivate Student', confirmLabel: 'Reactivate', danger: false }
        );
        if (!reactivateConfirmed) return;

        student.status = 'active';
        delete student.droppedDate;
        saveDatabase(db);

        showToast("Success", `${student.fullName || 'Student'} has been reactivated.`, "success");
        updateDashboardStats();
        if (typeof renderStudentTable === 'function') renderStudentTable();
        if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
        if (typeof renderArchiveDroppedTable === 'function') renderArchiveDroppedTable();

        // Best-effort sync so the backend record stops showing as "dropped" too.
        try {
            if (student.regNo) await apiSaveStudent(student);
        } catch (err) {
            console.error('Backend reactivate failed:', err);
            showToast("Offline", "Reactivated locally — couldn't reach the server.", "danger");
        }
    };

    // ── 8. EDIT STUDENT ──────────────────────────────────────────────────────

   window.editStudentInfo = function(studentId) {
    const db = getDatabase();
    // Match against the ACTIVE roster first — this button only ever appears next to an
    // active student's row, so a duplicate regNo on an already-archived record must never
    // be picked up instead of the real active student.
    let student = db.find(s => s.regNo === studentId && isActiveStudent(s));
    if (!student) student = db.find(s => s.regNo === studentId); // fallback, shouldn't normally be needed

    if (!student) {
        showToast("Error", "Student record not found.", "danger");
        return;
    }

    closeModal('view-modal');
    closeModal('profile-modal');

    // Reset the form so no stale values linger from a previous new-admission session
    admissionForm.reset();

    // CRITICAL FIX: clear pendingRegNo so the submit handler never treats this
    // as a new registration or triggers the sibling detection path
    delete admissionForm.dataset.pendingRegNo;

    // Set the hidden field strictly to regNo — this is what flags UPDATE mode
    editIdHidden.value = student.regNo;

    // Populate form fields — skip system/computed fields that must be preserved
    // exactly from the stored record and must not be overwritten by FormData
    const SKIP_FIELDS = new Set([
        '_editRegNo', 'regNo', 'id', 'siblingGroupId',
        'isSibling', 'siblingOf', 'hasSiblings', 'promoted',
        'photo', 'age', 'netPayable', 'rollNo', 'certData', 'otherFeesData'
    ]);

    // Populate class first so section dropdown can be built before section is restored
    if (classSelect && student.studentClass) {
        classSelect.value = student.studentClass;
        try { populateSectionDropdown(student.studentClass); } catch(e) {}
    }

    Object.keys(student).forEach(key => {
        if (SKIP_FIELDS.has(key)) return;
        const input = admissionForm.querySelector(`[name="${key}"]`);
        if (input) {
            if (input.type === 'checkbox') {
                input.checked = (student[key] === 'on' || student[key] === true);
            } else if (input.type === 'radio') {
                // Radio groups share a name, so find the specific option that
                // matches the stored value rather than setting .value on the
                // first radio the querySelector happens to find.
                const radios = admissionForm.querySelectorAll(`[name="${key}"]`);
                radios.forEach(r => { r.checked = (r.value === student[key]); });
            } else {
                input.value = student[key] ?? '';
            }
        }
    });

    syncFatherSection();

    // The Lifetime Discount checkbox only dims/enables the expiry-date field
    // via its 'change' listener — setting .checked programmatically above
    // doesn't fire that event, so sync the visual state explicitly here too.
    if (lifetimeCheck && expiryGroup) {
        expiryGroup.style.opacity       = lifetimeCheck.checked ? "0.4" : "1";
        expiryGroup.style.pointerEvents = lifetimeCheck.checked ? "none" : "all";
    }

    // Orphan Status defaults to "Not Orphan" for legacy records saved before
    // this field existed (student.orphanStatus will be undefined for those).
    if (!student.orphanStatus) {
        const defaultOrphanRadio = admissionForm.querySelector('[name="orphanStatus"][value="Not Orphan"]');
        if (defaultOrphanRadio) defaultOrphanRadio.checked = true;
    }

    // FIX: student.photo may be a bare relative path returned by the last
    // save response (e.g. "photos/uuid.jpg") rather than a browsable URL —
    // resolveStoredFileSrc() turns that into GET /{regNo}/photo, same as
    // every other photo-rendering spot on this page. Assigning student.photo
    // directly (as this used to) silently broke the preview for any photo
    // uploaded/saved earlier in the same session, before a full page reload.
    previewImg.src = student.photo
        ? resolveStoredFileSrc(student.photo, student.regNo || student.id, getCurrentSchoolId(), 'photo')
        : "https://via.placeholder.com/150?text=No+Photo";
    // BUGFIX -- this is the OTHER place a stale uploadedPath survived:
    // editing Student A (uploading a new photo sets this dataset flag),
    // then editing Student B without a full page reload used to carry
    // A's just-uploaded path over onto B's save. Every time this form is
    // populated for editing, the flag must be cleared -- a real new photo
    // pick for THIS student sets it again on its own.
    delete previewImg.dataset.uploadedPath;
    displayRegBadge.innerText = student.regNo;
    rollNoInput.value = student.rollNo || '';

    // CRITICAL FIX: certData (B-Form / certificate upload) was being skipped
    // during populate (it's in SKIP_FIELDS, like photo) but — unlike photo —
    // was never restored into its hidden input afterwards. That meant every
    // "Save Changes" on an existing student silently wiped their previously
    // uploaded B-Form/certificate from the database, because the empty
    // hidden input got submitted and overwrote the stored value. Restore it
    // here so it's preserved unless the user deliberately uploads a new file.
    certDataHidden.value = student.certData || '';
    if (certUploadStatus) {
        certUploadStatus.style.display = student.certData ? 'flex' : 'none';
    }

    // Highlighted "Sibling of …" badge shown right below the name/reg-no area
    const editSiblingBadge = document.getElementById('edit-sibling-badge');
    if (editSiblingBadge) {
        if (student.isSibling && student.siblingOf) {
            editSiblingBadge.style.display = 'inline-flex';
            editSiblingBadge.innerHTML = `<i class="fas fa-user-friends"></i> Sibling of ${student.siblingOf}`;
        } else {
            editSiblingBadge.style.display = 'none';
            editSiblingBadge.innerHTML = '';
        }
    }

    // Books fee panel — show if there's existing books data
    const hasBooks = (parseFloat(student.booksFee || 0) > 0) || (parseFloat(student.booksDiscount || 0) > 0);
    if (booksFeePanel) {
        booksFeePanel.style.display = hasBooks ? 'grid' : 'none';
        if (takeBooksBtn) {
            takeBooksBtn.innerHTML = hasBooks
                ? '<i class="fas fa-book-open"></i> Hide Books Fee'
                : '<i class="fas fa-book"></i> Take Books';
        }
    }

    // Annual fund — restore state
    if (annualFundEnabled) {
        const hasAnnual = student.annualFundEnabled === 'on' || student.annualFundEnabled === true;
        annualFundEnabled.checked = hasAnnual;
        if (annualFundPanel) annualFundPanel.style.display = hasAnnual ? 'block' : 'none';
        if (annualFundAmount) annualFundAmount.value = ANNUAL_FUND_AMOUNT;
    }

    // Other fees rows
    let existingOtherFees = [];
    try { existingOtherFees = JSON.parse(student.otherFeesData || '[]'); } catch (e) { existingOtherFees = []; }
    resetOtherFeesUI(existingOtherFees);

    document.getElementById('form-modal-title').innerHTML = '<i class="fas fa-user-edit"></i> Edit Student Profile';
    document.getElementById('form-submit-btn').innerText  = 'Save Changes';

    ageInput.value = calculateAge(student.dob);
    performFinancialAudit();

    const modal = document.getElementById('student-modal');
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
};
    // ── 9. DELETE STUDENT ────────────────────────────────────────────────────


    // ── DISCHARGE DATE PROMPT (shown when deactivating a student) ───────────
    // Uses the #discharge-dialog-overlay markup in manage-students.html
    // (styles: "DISCHARGE DATE DIALOG" in manage-students.css). The date
    // field defaults to today and can be typed or picked from the calendar.
    // Resolves with the chosen yyyy-mm-dd string on Confirm, or null on
    // Cancel / Esc / backdrop click.
    function ssDischargeDatePrompt(studentName) {
        const overlay   = document.getElementById('discharge-dialog-overlay');
        const input     = document.getElementById('discharge-date-input');
        const errEl     = document.getElementById('discharge-date-error');
        const nameEl    = document.getElementById('discharge-student-name');
        const cancelBtn = document.getElementById('discharge-cancel-btn');
        const okBtn     = document.getElementById('discharge-confirm-btn');
        if (!overlay || !input || !cancelBtn || !okBtn) {
            console.error('Discharge dialog markup is missing from the page.');
            return Promise.resolve(null);
        }

        // Local-time "today" (toISOString() would be UTC and can be off by a day).
        const now = new Date();
        const today = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');

        input.value = today;
        input.classList.remove('invalid');
        errEl.textContent = '';
        nameEl.textContent = studentName || 'this student';

        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
        setTimeout(() => input.focus(), 50);

        return new Promise(resolve => {
            function close(result) {
                overlay.classList.remove('show');
                overlay.setAttribute('aria-hidden', 'true');
                cancelBtn.removeEventListener('click', onCancel);
                okBtn.removeEventListener('click', onConfirm);
                overlay.removeEventListener('click', onBackdrop);
                input.removeEventListener('input', onInput);
                document.removeEventListener('keydown', onKey, true);
                resolve(result);
            }
            function onCancel()   { close(null); }
            function onBackdrop(e){ if (e.target === overlay) close(null); }
            function onInput()    { input.classList.remove('invalid'); errEl.textContent = ''; }
            function onConfirm() {
                const val = input.value;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || isNaN(new Date(val).getTime())) {
                    input.classList.add('invalid');
                    errEl.textContent = 'Please select a valid discharge date.';
                    return;
                }
                close(val);
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.stopPropagation(); close(null); }
                else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
            }

            cancelBtn.addEventListener('click', onCancel);
            okBtn.addEventListener('click', onConfirm);
            overlay.addEventListener('click', onBackdrop);
            input.addEventListener('input', onInput);
            document.addEventListener('keydown', onKey, true);
        });
    }

    window.deleteRecord = async function(studentId) {
        // Dropping a student moves them into the Archive Center ("dropped"),
        // so it counts against the plan's archiveStudentLimit just like a
        // graduation does.
        if (!canArchiveMoreStudents(1)) {
            showToast("Archive Limit Reached", `Your plan allows up to ${getArchiveLimit()} archived students. Upgrade your plan to remove more students.`, "danger");
            return;
        }
        // Ask for the discharge date (defaults to today, can be changed).
        // Returns the chosen yyyy-mm-dd string, or null if cancelled.
        const _dischargeStudent = getDatabase().find(x => x.regNo === studentId || x.id === studentId);
        const dischargeDate = await ssDischargeDatePrompt(_dischargeStudent ? _dischargeStudent.fullName : '');
        if (!dischargeDate) return;

        const db    = getDatabase();
        const index = db.findIndex(s => s.regNo === studentId || s.id === studentId);
        if (index === -1) {
            showToast("Error", "Could not find that student to delete.", "danger");
            return;
        }
        const student = db[index];
        const regNo   = student.regNo;

        // Move into the Archive Center's "dropped" list instead of wiping the
        // record outright — mirrors the graduation path (status + a *Date
        // stamp, record stays in db). Without setting droppedDate here, the
        // Archive Center had nothing to show but "-" in the Date column.
        student.status      = 'dropped';
        student.droppedDate = dischargeDate;   // date chosen in the discharge-date box
        saveDatabase(db);

        showToast("Success", "Student deactivated with discharge date " + dischargeDate, "success");
        closeModal('student-modal');
        updateDashboardStats();
        renderStudentTable();
        if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
        if (typeof renderArchiveDroppedTable === 'function') renderArchiveDroppedTable();

        // BUGFIX: this used to call apiDeleteStudent(), which hits the
        // DELETE endpoint — but that endpoint only ever sets status =
        // "dropped" on the backend row; it has no way to receive or store a
        // date. So droppedDate never reached the database at all, and the
        // Archive Center's "Date Removed" column was showing whatever stale
        // value happened to survive in the browser's memory (which is what
        // made it look like the admission date after a refresh/resync).
        // apiSaveStudent() (POST) sends the full record — status AND
        // droppedDate together — so both are actually persisted. Mirrors
        // the same pattern reactivateStudent() already uses below.
        try {
            const saved = await apiSaveStudent(student);
            if (saved) normalizeSiblingFieldsFromServer(saved);
        } catch (err) {
            console.error('Backend delete failed:', err);
            showToast("Offline", "Removed locally — couldn't reach the server.", "danger");
        }
    };

    // ── STUDENT ROW ACTION MENU (three-dot menu in Manage Records) ───────────
    // One shared floating menu appended to <body> so it is never clipped by the
    // scrolling table wrapper. Actions: Update Record, View Record Form,
    // View Admission Form, Deactivate (same flow as deleteRecord()).
    let ssActionMenuEl = null;
    let ssActionMenuBtn = null;

    function closeStudentActionMenu() {
        if (ssActionMenuEl) ssActionMenuEl.classList.remove('open');
        if (ssActionMenuBtn) {
            ssActionMenuBtn.classList.remove('menu-open');
            ssActionMenuBtn.setAttribute('aria-expanded', 'false');
        }
        ssActionMenuBtn = null;
    }

    function ensureStudentActionMenu() {
        if (ssActionMenuEl) return ssActionMenuEl;
        const el = document.createElement('div');
        el.id = 'student-action-menu';
        el.className = 'student-action-menu';
        el.setAttribute('role', 'menu');
        el.innerHTML = `
            <button type="button" class="sam-item sam-update" role="menuitem" data-action="update"><i class="fas fa-user-pen"></i><span>Update Record</span></button>
            <button type="button" class="sam-item sam-record" role="menuitem" data-action="record"><i class="fas fa-address-card"></i><span>View Record Form</span></button>
            <button type="button" class="sam-item sam-admission" role="menuitem" data-action="admission"><i class="fas fa-file-signature"></i><span>View Admission Form</span></button>
            <div class="sam-divider"></div>
            <button type="button" class="sam-item sam-danger" role="menuitem" data-action="deactivate"><i class="fas fa-user-slash"></i><span>Deactivate</span></button>`;
        el.addEventListener('click', function(e) {
            const item = e.target.closest('.sam-item');
            if (!item) return;
            const regNo = el.dataset.regNo;
            const action = item.dataset.action;
            closeStudentActionMenu();
            if (!regNo) return;
            if (action === 'update') {
                window.editStudentInfo(regNo);
                // The admission/edit modal sits earlier in the DOM than the
                // directory modal, so lift it above while editing from here.
                const m = document.getElementById('student-modal');
                if (m) m.style.zIndex = '5500';
            } else if (action === 'record') {
                // Opens the printable "Complete Student Record" page
                // (Print / Share on WhatsApp / Close toolbar).
                window.printStudentRecordForStudent(regNo);
            } else if (action === 'admission') {
                window.printAdmissionFormForStudent(regNo);
            } else if (action === 'deactivate') {
                window.deleteRecord(regNo);
            }
        });
        document.body.appendChild(el);

        document.addEventListener('click', function(e) {
            if (!ssActionMenuEl || !ssActionMenuEl.classList.contains('open')) return;
            if (e.target.closest('#student-action-menu') || e.target.closest('.btn-icon.more-actions')) return;
            closeStudentActionMenu();
        });
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeStudentActionMenu(); });
        window.addEventListener('resize', closeStudentActionMenu);
        document.addEventListener('scroll', closeStudentActionMenu, true);

        ssActionMenuEl = el;
        return el;
    }

    window.toggleStudentActionMenu = function(event, regNo) {
        event.stopPropagation();
        const btn = event.currentTarget;
        const menu = ensureStudentActionMenu();
        if (ssActionMenuBtn === btn && menu.classList.contains('open')) {
            closeStudentActionMenu();
            return;
        }
        closeStudentActionMenu();
        menu.dataset.regNo = regNo;
        ssActionMenuBtn = btn;
        btn.classList.add('menu-open');
        btn.setAttribute('aria-expanded', 'true');

        // Position: below the button, right-aligned; flip up / clamp if needed.
        menu.style.visibility = 'hidden';
        menu.classList.add('open');
        const r  = btn.getBoundingClientRect();
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        let left = r.right - mw;
        let top  = r.bottom + 6;
        if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
        left = Math.min(Math.max(8, left), window.innerWidth - mw - 8);
        menu.style.left = left + 'px';
        menu.style.top  = top + 'px';
        menu.style.visibility = '';
    };

    // ── 10. FULL PROFILE VIEW ────────────────────────────────────────────────

    /**
     * viewFullProfile — look up by regNo (what the table buttons pass in).
     */
    window.viewFullProfile = function(regNo) {
        const db = getDatabase();
        // Find by regNo first, fall back to id
        const s = db.find(x => x.regNo === regNo) || db.find(x => x.id === regNo);
        if (!s) return;

        const safeVal = v => (v && v !== "") ? v : '<span style="color:#cbd5e1">Not Provided</span>';

        // ── Sibling ID row (00X) — profile only ──
        const siblingIdRow = (s.isSibling && s.siblingGroupId)
            ? `<div class="detail-item">
                   <label>Sibling Group ID</label>
                   <span class="hrk-id-badge" style="font-size:0.85rem;background:#d97706;">${s.siblingGroupId}</span>
               </div>`
            : '';

        // ── "Sibling of …" row ──
        const siblingOfRow = (s.isSibling && s.siblingOf)
            ? `<div class="detail-item full-width-detail">
                   <label>Sibling Status</label>
                   <span class="sibling-tag" style="font-size:0.9rem;padding:5px 12px;">
                       <i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}
                   </span>
               </div>`
            : '';

        // ── hasSiblings list ──
        const hasSiblingsRows = (s.hasSiblings && s.hasSiblings.length > 0)
            ? s.hasSiblings.map(sib =>
                `<div class="detail-item full-width-detail">
                    <label>Has Sibling</label>
                    <span class="sibling-tag sibling-tag--has">
                        <i class="fas fa-user-friends"></i> ${sib.name}
                        <span style="margin-left:8px;opacity:0.75;font-size:0.78rem;">(Reg: ${sib.regNo})</span>
                    </span>
                </div>`
              ).join('')
            : '';

        // ── Certificate viewer (B-Form / School Certificate uploaded in admission form) ──
        // IMPORTANT: only the student's regNo/id is passed into these onclick handlers — never
        // the raw base64 certData. viewCertificate()/downloadCertificate() resolve the record and
        // turn certData into a short-lived Blob URL under the hood. This is the fix for the
        // View/Download bug: modern Chrome silently blocks window.open()/top-frame navigation to
        // data: URIs, and Safari's <a download> support for data: URIs is unreliable — Blob URLs
        // work consistently across all of them.
        let certViewer = '';
        let bformActionBtn = '';
        if (s.certData) {
            const certRegNo = s.regNo || s.id;
            // FILE-STORAGE MIGRATION — s.certData is now usually a relative
            // server path ("bforms/uuid.pdf"/".jpg"), not an inline base64
            // data URI. Support both shapes: legacy rows still carry the
            // full data: URI and can be inspected/rendered directly; new
            // rows need their type inferred from the file extension and
            // their preview built from studentBformUrl() instead.
            const certIsDataUri = s.certData.startsWith('data:');
            const isPdf = certIsDataUri
                ? s.certData.startsWith('data:application/pdf')
                : /\.pdf$/i.test(s.certData);
            const isImage = certIsDataUri ? s.certData.startsWith('data:image') : !isPdf;
            const bformPreviewSrc = certIsDataUri
                ? s.certData
                : studentBformUrl(s, getCurrentSchoolId());

            bformActionBtn = `
                <div class="profile-section-title"><i class="fas fa-id-card"></i> B-Form / School Certificate (from Admission Form)</div>
                <div style="padding:18px 25px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
                    <button type="button" class="btn-primary-submit" onclick="viewCertificate('${certRegNo}')"
                        style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:8px;border:none;cursor:pointer;">
                        <i class="fas fa-eye"></i> View B-Form
                    </button>
                    <button type="button" onclick="downloadCertificate('${certRegNo}')"
                        class="btn-secondary" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:8px;border:none;cursor:pointer;">
                        <i class="fas fa-download"></i> Download B-Form
                    </button>
                </div>`;

            if (isImage) {
                certViewer = `
                    <div class="profile-section-title"><i class="fas fa-certificate"></i> School Certificate / B-Form</div>
                    <div style="padding:20px 25px;">
                        <img src="${bformPreviewSrc}" alt="Certificate" class="cert-preview-img"
                             onclick="viewCertificate('${certRegNo}')" title="Click to view full page">
                        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:8px;">
                            <i class="fas fa-search-plus"></i> Click to open full size
                        </p>
                    </div>`;
            } else if (isPdf) {
                certViewer = `
                    <div class="profile-section-title"><i class="fas fa-certificate"></i> School Certificate / B-Form</div>
                    <div style="padding:20px 25px;">
                        <div class="cert-pdf-card" onclick="viewCertificate('${certRegNo}')" title="Click to view full page">
                            <i class="fas fa-file-pdf"></i>
                            <div>
                                <strong>PDF Document Attached</strong>
                                <p>Click to open the full-page viewer</p>
                            </div>
                        </div>
                    </div>`;
            }
        }

        // ── Books fee row ──
        const booksRow = (parseFloat(s.booksFee||0) > 0 || parseFloat(s.booksDiscount||0) > 0)
            ? `<div class="detail-item"><label>Books Fee</label><span>Rs. ${safeVal(s.booksFee) || '0'}</span></div>`
            : '';
        const booksDiscRow = (parseFloat(s.booksDiscount||0) > 0)
            ? `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>Books Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(s.booksDiscount).toFixed(0)}</span></div>`
            : '';

        // ── Other fees rows ──
        let otherFeesRows = '';
        let otherFeesArr = [];
        try { otherFeesArr = JSON.parse(s.otherFeesData || '[]'); } catch (e) { otherFeesArr = []; }
        otherFeesArr.forEach(f => {
            // Skip placeholder / empty rows: must have at least a real amount or a discount > 0
            const amt  = parseFloat(f.amount   || 0);
            const disc = parseFloat(f.discount || 0);
            if (amt <= 0 && disc <= 0) return;
            otherFeesRows += `<div class="detail-item"><label>${f.description || 'Other Fee'}</label><span>Rs. ${parseFloat(f.amount||0).toFixed(0)}</span></div>`;
            if (parseFloat(f.discount||0) > 0) {
                otherFeesRows += `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>${f.description || 'Other Fee'} Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(f.discount).toFixed(0)}</span></div>`;
            }
        });

        // ── Discount validity ──
        const totalDiscountAmt = parseFloat(s.tuitionDiscount||0) + parseFloat(s.transportDiscount||0) + parseFloat(s.siblingDiscount||0) + parseFloat(s.booksDiscount||0) + otherFeesArr.reduce((sum,f)=>sum+(parseFloat(f.discount||0)),0);
        const isLifetimeDiscount = (s.isLifetime === true || s.isLifetime === 'on');
        let discountValidityRow = '';
        if (totalDiscountAmt > 0) {
            let validityText;
            if (isLifetimeDiscount) {
                validityText = 'Life Time';
            } else if (s.discountExpiry) {
                const expDate = new Date(s.discountExpiry);
                validityText = !isNaN(expDate)
                    ? expDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : s.discountExpiry;
            } else {
                validityText = 'Not Set';
            }
            discountValidityRow = `<div class="detail-item"><label>Discount Valid Until</label><span>${validityText}</span></div>`;
        }

        const profileContent = `
            <div class="profile-card-header">
                <div class="profile-header-decor"></div>
                <div class="profile-avatar-ring">
                    <img src="${resolveStoredFileSrc(s.photo, s.regNo || s.id, getCurrentSchoolId(), 'photo')}" class="profile-main-img"
                         onclick="openPhotoViewer(this)" title="Click to view full-size photo"
                         onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(s.fullName)}&background=3b82f6&color=fff&bold=true'">
                </div>
                <h2 class="profile-name-title">${s.fullName}</h2>
                ${(s.isSibling && s.siblingOf) ? `<div class="sibling-tag" style="margin:2px 0 8px;"><i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}</div>` : ''}
                <div class="profile-header-badges">
                    <span class="hrk-id-badge">${s.regNo || s.id}</span>
                    ${s.studentClass ? `<span class="profile-class-badge"><i class="fas fa-graduation-cap"></i> ${s.studentClass}${s.section ? ' – ' + s.section : ''}</span>` : ''}
                </div>
            </div>

            <div class="profile-section-title">Academic Information</div>
            <div class="profile-details-grid">
                <div class="detail-item">
                    <label>Registration No.</label>
                    <span class="hrk-id-badge" style="font-size:0.85rem;">${safeVal(s.regNo || s.id)}</span>
                </div>
                <div class="detail-item"><label>Roll Number (Class)</label><span>${safeVal(s.rollNo)}</span></div>
                <div class="detail-item"><label>Class</label><span>${safeVal(s.studentClass)}</span></div>
                <div class="detail-item"><label>Section</label><span>${safeVal(s.section)}</span></div>
                <div class="detail-item"><label>Admission Date</label><span>${safeVal(s.admissionDate)}</span></div>
                ${siblingIdRow}
                ${siblingOfRow}
                ${hasSiblingsRows}
            </div>

            <div class="profile-section-title">Personal Data</div>
            <div class="profile-details-grid">
                <div class="detail-item"><label>Gender</label><span>${safeVal(s.gender)}</span></div>
                <div class="detail-item"><label>Date of Birth</label><span>${safeVal(s.dob)}</span></div>
                <div class="detail-item"><label>Computed Age</label><span>${safeVal(s.age)}</span></div>
                <div class="detail-item"><label>B-Form / CNIC</label><span>${safeVal(s.studentBform)}</span></div>
                <div class="detail-item full-width-detail"><label>Medical Conditions</label><span>${safeVal(s.medicalIssues)}</span></div>
                <div class="detail-item"><label>Orphan Status</label><span>${safeVal(s.orphanStatus)}</span></div>
                <div class="detail-item"><label>Previous School Attended</label><span>${safeVal(s.previousSchool)}</span></div>
                <div class="detail-item"><label>Previous Class</label><span>${safeVal(s.previousClass)}</span></div>
                <div class="detail-item"><label>Admission Class</label><span>${safeVal(s.admissionClass)}</span></div>
            </div>

            <div class="profile-section-title">Guardian & Contact</div>
            <div class="profile-details-grid">
                <div class="detail-item"><label>Guardian Name</label><span>${safeVal(s.guardianName)}</span></div>
                <div class="detail-item"><label>Relation</label><span>${safeVal(s.guardianRole)}</span></div>
                <div class="detail-item"><label>Guardian CNIC</label><span>${safeVal(s.guardianCnic)}</span></div>
                <div class="detail-item"><label>Father Name</label><span>${safeVal(s.fatherFullName)}</span></div>
                <div class="detail-item"><label>Father CNIC</label><span>${safeVal(s.fatherCnic)}</span></div>
                <div class="detail-item"><label>Contact 1</label><span>${safeVal(s.phone1)}</span></div>
                <div class="detail-item"><label>Contact 2</label><span>${safeVal(s.phone2)}</span></div>
                <div class="detail-item full-width-detail"><label>Permanent Address</label><span>${safeVal(s.permanentAddress)}</span></div>
            </div>

            <div class="profile-section-title">Finance & Transport</div>
            <div class="profile-details-grid">
                <div class="detail-item"><label>Tuition Fee</label><span>Rs. ${safeVal(s.standardFee)}</span></div>
                <div class="detail-item"><label>Admission Fee</label><span>Rs. ${safeVal(s.admissionFee) || '0'}</span></div>
                <div class="detail-item"><label>Transport Fee</label><span>Rs. ${safeVal(s.transportFee)}</span></div>
                ${booksRow}
                ${otherFeesRows}
                ${parseFloat(s.tuitionDiscount||0) > 0 ? `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>Tuition Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(s.tuitionDiscount).toFixed(0)}</span></div>` : ''}
                ${parseFloat(s.transportDiscount||0) > 0 ? `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>Transport Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(s.transportDiscount).toFixed(0)}</span></div>` : ''}
                ${parseFloat(s.siblingDiscount||0) > 0 ? `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>Sibling Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(s.siblingDiscount).toFixed(0)}</span></div>` : ''}
                ${booksDiscRow}
                <div class="detail-item total-discount-item">
                    <label>Total Discount</label>
                    <span class="total-discount-value">− Rs. ${(parseFloat(s.tuitionDiscount||0) + parseFloat(s.transportDiscount||0) + parseFloat(s.siblingDiscount||0) + parseFloat(s.booksDiscount||0) + otherFeesArr.reduce((sum,f)=>sum+(parseFloat(f.discount||0)),0)).toFixed(0)}</span>
                </div>
                ${discountValidityRow}
                <div class="detail-item net-payable-item">
                    <label>Net Payable</label>
                    <span class="net-payable-value">Rs. ${s.netPayable}</span>
                </div>
            </div>
            ${certViewer}
            ${bformActionBtn}
        `;

        document.getElementById('profile-content').innerHTML = profileContent;
        const profileModal = document.getElementById('profile-modal');
        profileModal.dataset.currentRegNo = s.regNo || s.id;
        profileModal.style.display = 'block';
    };

    // ── CERTIFICATE / B-FORM VIEWER & DOWNLOAD ENGINE ────────────────────────
    //
    // WHY THIS EXISTS:
    // certData is stored as a base64 "data:" URI. Feeding that raw string straight into
    // window.open(...) or an <a href="data:..."> is what was breaking View/Download:
    //   • Chrome (and most Chromium browsers) silently block top-frame navigation to
    //     data: URIs — window.open('data:...') just opens a blank tab, no error shown to
    //     the user, only a console warning ("Not allowed to navigate top frame to data URL").
    //   • Safari's handling of <a download href="data:...."> for large payloads is
    //     inconsistent — it will often just navigate/preview instead of saving the file.
    // The fix: decode the base64 payload into a real Blob and hand out a short-lived
    // blob: Object URL instead. Blob URLs are same-origin, are not subject to the data:
    // navigation block, and are supported identically across Chrome, Edge, Firefox and Safari.

    let _certViewerBlobUrl  = null; // currently active blob: URL shown in the full-page viewer
    let _certViewerFilename = null; // filename to use if the user downloads straight from the viewer

    /** Decode a "data:<mime>;base64,xxxx" string into a real Blob object. */
    function certDataUrlToBlob(dataUrl) {
        const commaIdx = dataUrl.indexOf(',');
        const header   = dataUrl.slice(0, commaIdx);
        const base64   = dataUrl.slice(commaIdx + 1);
        const mimeMatch = header.match(/data:(.*?);base64/);
        const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

        const binary = atob(base64);
        const len    = binary.length;
        const bytes  = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }

    /**
     * Look up a student by regNo (falls back to id) and build a
     * {blob, isPdf, filename} bundle for their certData.
     *
     * FILE-STORAGE MIGRATION — certData now usually holds a relative server
     * path ("bforms/uuid.pdf") rather than the file's base64 content, so the
     * real bytes have to be fetched from StudentController#getStudentBform
     * instead of decoded locally. Legacy rows that still carry a full
     * "data:" URI (saved before this migration) are still decoded locally
     * exactly as before — no backfill/migration script required.
     */
    async function resolveCertForStudent(regNo) {
        const db = getDatabase();
        const s = db.find(x => x.regNo === regNo) || db.find(x => x.id === regNo);
        if (!s || !s.certData) return null;

        if (s.certData.startsWith('data:')) {
            const isPdf    = s.certData.startsWith('data:application/pdf');
            const blob     = certDataUrlToBlob(s.certData);
            const filename = `bform_${s.regNo || s.id}${isPdf ? '.pdf' : '.png'}`;
            return { blob, isPdf, filename };
        }

        const url = studentBformUrl(s, getCurrentSchoolId());
        if (!url) return null;
        let response;
        try {
            response = await fetch(url);
        } catch (e) {
            return null;
        }
        if (!response.ok) return null;
        const blob  = await response.blob();
        const isPdf = /\.pdf$/i.test(s.certData) || blob.type === 'application/pdf';
        const filename = `bform_${s.regNo || s.id}${isPdf ? '.pdf' : '.png'}`;
        return { blob, isPdf, filename };
    }

    /** Open the student's certificate / B-Form in the in-page, full-screen viewer. Works for both images and PDFs. */
    window.viewCertificate = async function(regNo) {
        const cert = await resolveCertForStudent(regNo);
        if (!cert) { showToast("No File", "No certificate / B-Form is attached for this student.", "danger"); return; }

        // Free the previous blob before creating a new one, so repeated opens don't leak memory
        if (_certViewerBlobUrl) { URL.revokeObjectURL(_certViewerBlobUrl); _certViewerBlobUrl = null; }

        _certViewerBlobUrl  = URL.createObjectURL(cert.blob);
        _certViewerFilename = cert.filename;

        const overlay = document.getElementById('cert-viewer-overlay');
        const imgEl   = document.getElementById('cert-viewer-image');
        const pdfEl   = document.getElementById('cert-viewer-pdf');
        const nameEl  = document.getElementById('cert-viewer-filename');
        if (!overlay || !imgEl || !pdfEl) return;

        if (cert.isPdf) {
            pdfEl.src = _certViewerBlobUrl;
            pdfEl.style.display = 'block';
            imgEl.style.display = 'none';
            imgEl.removeAttribute('src');
        } else {
            imgEl.src = _certViewerBlobUrl;
            imgEl.style.display = 'block';
            pdfEl.style.display = 'none';
            pdfEl.removeAttribute('src');
        }

        if (nameEl) nameEl.textContent = cert.filename;

        overlay.classList.add('active');
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    /** Close the full-page certificate viewer and release its Blob URL. */
    window.closeCertViewer = function() {
        const overlay = document.getElementById('cert-viewer-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.style.display = 'none';
        }

        // The viewer is opened FROM WITHIN another modal (e.g. "View Student").
        // Only unlock body scroll if no other modal is still open behind it —
        // otherwise the page behind the still-open modal would start scrolling.
        const anyModalStillOpen = Array.from(document.querySelectorAll('.modal-overlay'))
            .some(m => m.style.display === 'block' || m.style.display === 'flex');
        document.body.style.overflow = anyModalStillOpen ? 'hidden' : 'auto';

        if (_certViewerBlobUrl) { URL.revokeObjectURL(_certViewerBlobUrl); _certViewerBlobUrl = null; }
        _certViewerFilename = null;

        const imgEl = document.getElementById('cert-viewer-image');
        const pdfEl = document.getElementById('cert-viewer-pdf');
        if (imgEl) imgEl.removeAttribute('src');
        if (pdfEl) pdfEl.removeAttribute('src');
    };

    // Close the viewer with the Escape key, same as the other modals in this app
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('cert-viewer-overlay');
            if (overlay && overlay.classList.contains('active')) window.closeCertViewer();
        }
    });

    // ── STUDENT PHOTO FULL-SIZE VIEWER ───────────────────────────────────────
    //
    // Lets the user click a student's photo — in the "Manage Records" profile
    // card (profile-avatar-ring) or the Update Record / admission edit form
    // (student-img-preview) — and see it enlarged in a full-screen overlay.
    // Kept as its own overlay/id pair (photo-viewer-*) rather than reusing
    // cert-viewer-* so opening a photo never fights with an already-open
    // certificate/B-Form viewer.

    /**
     * Open the full-size photo viewer.
     * @param {HTMLImageElement|string} imgOrSrc  Either the clicked <img> element
     *        (preferred — lets us read its current .src and find a nearby name)
     *        or a raw image URL string.
     * @param {string} [label]  Optional display name; auto-detected from the
     *        surrounding profile card when omitted.
     */
    window.openPhotoViewer = function(imgOrSrc, label) {
        const src = typeof imgOrSrc === 'string' ? imgOrSrc : (imgOrSrc && imgOrSrc.src);

        // Nothing real to enlarge yet — placeholder/no-photo/avatar-initials image.
        const isPlaceholder = !src || /placeholder\.com/i.test(src) || /ui-avatars\.com/i.test(src);
        if (isPlaceholder) {
            try { showToast('No Photo', 'No photo has been uploaded for this student yet.', 'info'); } catch (e) {}
            return;
        }

        let name = label;
        if (!name && imgOrSrc && typeof imgOrSrc.closest === 'function') {
            const card = imgOrSrc.closest('.profile-card-header');
            const nameEl = card && card.querySelector('.profile-name-title');
            if (nameEl) name = nameEl.textContent.trim();
        }
        if (!name) name = 'Student Photo';

        const overlay = document.getElementById('photo-viewer-overlay');
        const imgEl   = document.getElementById('photo-viewer-image');
        const nameEl  = document.getElementById('photo-viewer-filename');
        if (!overlay || !imgEl) return;

        imgEl.src = src;
        if (nameEl) {
            const safeName = (typeof SSValidate !== 'undefined' && SSValidate.escapeHtml) ? SSValidate.escapeHtml(name) : name;
            nameEl.innerHTML = `<i class="fas fa-image"></i> ${safeName}`;
        }

        overlay.classList.add('active');
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    /** Close the full-size photo viewer. */
    window.closePhotoViewer = function() {
        const overlay = document.getElementById('photo-viewer-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.style.display = 'none';
        }

        // Only unlock body scroll if no other modal is still open behind it —
        // same reasoning as closeCertViewer() above.
        const anyModalStillOpen = Array.from(document.querySelectorAll('.modal-overlay'))
            .some(m => m.style.display === 'block' || m.style.display === 'flex');
        document.body.style.overflow = anyModalStillOpen ? 'hidden' : 'auto';

        const imgEl = document.getElementById('photo-viewer-image');
        if (imgEl) imgEl.removeAttribute('src');
    };

    // Close the photo viewer with the Escape key too.
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('photo-viewer-overlay');
            if (overlay && overlay.classList.contains('active')) window.closePhotoViewer();
        }
    });

    /**
     * Download a student's certificate / B-Form as a real file save.
     * Builds (or re-uses, if the viewer already has this exact file open) a blob: Object URL
     * and clicks a temporary, invisible <a download> against it — the only download method that
     * behaves consistently across Chrome, Edge, Firefox and Safari for locally-generated files.
     */
    window.downloadCertificate = async function(regNo) {
        let blobUrl  = _certViewerBlobUrl;
        let filename = _certViewerFilename;
        let isReusedUrl = !!blobUrl;

        if (!blobUrl) {
            const cert = await resolveCertForStudent(regNo);
            if (!cert) { showToast("No File", "No certificate / B-Form is attached for this student.", "danger"); return; }
            blobUrl  = URL.createObjectURL(cert.blob);
            filename = cert.filename;
        }

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Only revoke a URL we created just for this call — the viewer owns and revokes its own
        if (!isReusedUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);

        showToast("Downloading", `${filename} is downloading…`, "success");
    };

    // ── FOOTER SHARE BUTTON HANDLER ──────────────────────────────────────────
    window.shareCurrentProfile = function() {
        const modal = document.getElementById('profile-modal');
        const regNo = modal ? modal.dataset.currentRegNo : null;
        if (regNo) window.shareStudentProfile(regNo);
    };

    // ── FOOTER "PRINT ADMISSION FORM" BUTTON HANDLER ─────────────────────────
    // Prints the official Admission Form for whichever student's profile is
    // currently open (tracked via profile-modal's data-current-reg-no).
    window.printCurrentAdmissionForm = function() {
        const modal = document.getElementById('profile-modal');
        const regNo = modal ? modal.dataset.currentRegNo : null;
        if (regNo) window.printAdmissionFormForStudent(regNo);
    };

    // ── SHARE STUDENT PROFILE (Web Share API + clipboard fallback) ──────────
    window.shareStudentProfile = async function(regNo) {
        const db = getDatabase();
        const s  = db.find(x => (x.regNo || x.id) === regNo);
        if (!s) { showToast && showToast("Error", "Student not found.", "danger"); return; }

        const line = (label, val) => (val !== undefined && val !== null && val !== '') ? `${label}: ${val}\n` : '';
        const text =
            `📘 STUDENT PROFILE — ST. LAWRENCE INTERNATIONAL SCHOOL\n` +
            `────────────────────────────────────────\n` +
            line('Name',         s.fullName) +
            line('Reg No.',      s.regNo || s.id) +
            line('Roll No.',     s.rollNo) +
            line('Class',        s.studentClass) +
            line('Section',      s.section) +
            line('Gender',       s.gender) +
            line('Date of Birth',s.dob) +
            line('Age',          s.age) +
            line('Guardian',     s.guardianName) +
            line('Relation',     s.guardianRole) +
            line('Father Name',  s.fatherFullName) +
            line('Father CNIC',  s.fatherCnic) +
            line('Contact',      s.phone1) +
            line('Address',      s.permanentAddress) +
            `────────────────────────────────────────\n` +
            line('Tuition Fee',  s.standardFee     ? 'Rs. ' + s.standardFee     : '') +
            line('Transport',    s.transportFee    ? 'Rs. ' + s.transportFee    : '') +
            line('Net Payable',  s.netPayable      ? 'Rs. ' + s.netPayable      : '');

        const title = `Student Profile — ${s.fullName}`;
        try {
            if (navigator.share) {
                await navigator.share({ title, text });
                return;
            }
        } catch (e) { /* user cancelled — fall through */ }
        try {
            await navigator.clipboard.writeText(text);
            showToast && showToast("Copied", "Student profile copied to clipboard.", "success");
        } catch (e) {
            // Final fallback: open a print/preview window
            const w = window.open('', '_blank');
            if (w) {
                w.document.write('<pre style="font-family:monospace;padding:20px;white-space:pre-wrap;">'
                    + text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</pre>');
                w.document.close();
            } else {
                showToast('Pop-up Blocked', 'Please allow pop-ups to view the student profile, or try sharing again.', 'warning');
            }
        }
    };


    function updateDashboardStats() {
        const db      = getActiveDatabase();
        const total   = db.length;
        const males   = db.filter(s => s.gender === "Male").length;
        const females = db.filter(s => s.gender === "Female").length;

        const countTotal  = document.getElementById('counter-total');
        const countMale   = document.getElementById('counter-male');
        const countFemale = document.getElementById('counter-female');

        if (countTotal)  countTotal.innerText  = total;
        if (countMale)   countMale.innerText   = males;
        if (countFemale) countFemale.innerText = females;

        // Keep the plan's usage banners / locked-out "New Admission" card in
        // sync every time the roster changes (see PLAN ENFORCEMENT block below).
        renderPlanLimitBanners();
    }

    // ============================================================================
    // PLAN ENFORCEMENT — feature locks, student/archive limits, subscription expiry
    // ----------------------------------------------------------------------------
    // Driven entirely by the School record Super Admin configured for this school
    // (School.java / SchoolAuthController.SchoolPublicView): `locks`,
    // `studentLimit`, `archiveStudentLimit`, `expiryDate`.
    //
    // FEATURE LOCKS: whole-module locks (the "students" key locking this entire
    // page) are already enforced by access-control.js's page guard, which
    // redirects away before this file even runs if Student Management itself is
    // locked. The only feature key from access-control.js's real FEATURES
    // catalog (SSA.FEATURES, extended in superadmin.js) that applies to
    // something INSIDE this page is "bform_pic" (Student B-Form Picture), tagged
    // on the #bform-upload-group wrapper below via data-feature="bform_pic".
    // Lock-checking itself is delegated to window.SoftSchoolAdmin.isFeatureLocked
    // (the same function every other page uses) so this page never drifts out of
    // sync with the real catalog.
    //
    // USAGE LIMITS: studentLimit caps ACTIVE students, archiveStudentLimit caps
    // graduated+dropped students. Either can be left blank/0 on the school or
    // plan to mean "unlimited".
    // ============================================================================

    function getCurrentSchoolRecord() {
        try {
            if (window.SoftSchoolAdmin) return window.SoftSchoolAdmin.getCurrentSchool();
        } catch (e) { /* ignore — demo / no session */ }
        return null;
    }

    /**
     * True if ANY of a comma-separated list of feature keys is locked for this
     * school. Delegates to SoftSchoolAdmin.isFeatureLocked (access-control.js) —
     * the same check every other page uses — so this stays correct even if that
     * function's normalization logic (array vs comma-string locks, blocked
     * status, etc.) changes later.
     */
    function isFeatureLocked(keysCsv) {
        const school = getCurrentSchoolRecord();
        if (!school) return false;
        const keys = String(keysCsv || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.isFeatureLocked === 'function') {
            return keys.some(k => window.SoftSchoolAdmin.isFeatureLocked(school, k));
        }
        // Fallback if access-control.js somehow isn't loaded.
        const raw = String(school.locks || '');
        const locked = new Set(raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean));
        return keys.some(k => locked.has(k));
    }

    /** Active-student cap from the school record. null = unlimited. */
    function getStudentLimit() {
        const school = getCurrentSchoolRecord();
        const n = school ? Number(school.studentLimit) : NaN;
        return (Number.isFinite(n) && n > 0) ? n : null;
    }
    /** Archived-student (graduated + dropped) cap from the school record. null = unlimited. */
    function getArchiveLimit() {
        const school = getCurrentSchoolRecord();
        const n = school ? Number(school.archiveStudentLimit) : NaN;
        return (Number.isFinite(n) && n > 0) ? n : null;
    }

    /** Is there room to register one more ACTIVE student right now? */
    function canAdmitNewStudent() {
        const limit = getStudentLimit();
        return limit === null || getActiveDatabase().length < limit;
    }
    /** Is there room to move `count` more students into the archive (graduated/dropped)? */
    function canArchiveMoreStudents(count) {
        const limit = getArchiveLimit();
        if (limit === null) return true;
        const used = getGraduatedStudents().length + getDroppedStudents().length;
        return (used + (count || 1)) <= limit;
    }

    /**
     * Blur/fade every data-feature element that Super Admin has locked for this
     * plan, strip its click handler, and wire up the "Not available in this
     * plan" hover tooltip via the data-tooltip attribute (see CSS). Runs once
     * on load — the lock list doesn't change without a fresh page/session.
     */
    function applyFeatureLocks() {
        document.querySelectorAll('[data-feature]').forEach(el => {
            if (!isFeatureLocked(el.dataset.feature)) return;
            el.classList.add('feature-locked');
            el.setAttribute('data-tooltip', 'Not available in this plan');
            el.onclick = null; // strip any inline onclick="..." on the element itself
            el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); }, true);
            // Also disable any real form controls nested inside (e.g. the file
            // input in #bform-upload-group) so the lock can't be bypassed by
            // interacting with the control directly rather than the wrapper.
            el.querySelectorAll('input, button, select, textarea').forEach(ctrl => {
                ctrl.disabled = true;
            });
        });
    }

    /**
     * Refresh the two usage-limit banners (active-student cap on the Manage
     * Students home, archive cap on the Archive Center) and grey out "New
     * Admission" once the active-student cap is hit. Called after every
     * roster mutation via updateDashboardStats().
     */
    function renderPlanLimitBanners() {
        const studentBanner = document.getElementById('student-limit-banner');
        if (studentBanner) {
            const limit = getStudentLimit();
            const used  = getActiveDatabase().length;
            if (limit === null) {
                studentBanner.style.display = 'none';
            } else {
                const remaining = limit - used;
                if (remaining <= 0) {
                    studentBanner.className   = 'plan-limit-banner danger';
                    studentBanner.innerHTML   = `<i class="fas fa-ban"></i> Student limit reached (${used}/${limit}). Upgrade your plan to register more students.`;
                    studentBanner.style.display = 'flex';
                } else if (remaining <= LIMIT_WARNING_THRESHOLD) {
                    studentBanner.className   = 'plan-limit-banner warning';
                    studentBanner.innerHTML   = `<i class="fas fa-triangle-exclamation"></i> Only ${remaining} student slot${remaining === 1 ? '' : 's'} left before you reach your plan's limit of ${limit}.`;
                    studentBanner.style.display = 'flex';
                } else {
                    studentBanner.style.display = 'none';
                }
            }
        }

        const archiveBanner = document.getElementById('archive-limit-banner');
        if (archiveBanner) {
            const limit = getArchiveLimit();
            const used  = getGraduatedStudents().length + getDroppedStudents().length;
            if (limit === null) {
                archiveBanner.style.display = 'none';
            } else {
                const remaining = limit - used;
                if (remaining <= 0) {
                    archiveBanner.className   = 'plan-limit-banner danger';
                    archiveBanner.innerHTML   = `<i class="fas fa-ban"></i> Archive limit reached (${used}/${limit}). No more students can be graduated or dropped until you upgrade your plan.`;
                    archiveBanner.style.display = 'flex';
                } else if (remaining <= LIMIT_WARNING_THRESHOLD) {
                    archiveBanner.className   = 'plan-limit-banner warning';
                    archiveBanner.innerHTML   = `<i class="fas fa-triangle-exclamation"></i> Only ${remaining} archive slot${remaining === 1 ? '' : 's'} left before you reach your plan's limit of ${limit}.`;
                    archiveBanner.style.display = 'flex';
                } else {
                    archiveBanner.style.display = 'none';
                }
            }
        }

        // Grey out "New Admission" once the active-student cap is hit — separate
        // class from .feature-locked so it's never confused with a Super-Admin lock.
        const addCard = document.getElementById('card-add-student');
        if (addCard) addCard.classList.toggle('feature-locked-limit', !canAdmitNewStudent());
    }

    /**
     * Small blinking badge, fixed to the corner of the viewport (doesn't shift
     * any layout), warning that the school's subscription is about to expire.
     */
    function renderSubscriptionExpiryBadge() {
        const badge = document.getElementById('subscription-expiry-badge');
        const text  = document.getElementById('subscription-expiry-text');
        if (!badge || !text) return;

        const school = getCurrentSchoolRecord();
        if (!school || !school.expiryDate) { badge.style.display = 'none'; return; }

        const expiry = new Date(school.expiryDate + 'T00:00:00');
        if (isNaN(expiry.getTime())) { badge.style.display = 'none'; return; }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

        if (daysLeft < 0) {
            text.textContent = 'Subscription expired';
            badge.style.display = 'flex';
        } else if (daysLeft <= EXPIRY_WARNING_DAYS) {
            text.textContent = daysLeft === 0
                ? 'Subscription expires today'
                : `Subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    function showToast(title, body, type = "success") {
        const toast = document.getElementById('toast-msg');
        if (!toast) return;

        document.getElementById('toast-title').innerText = title;
        document.getElementById('toast-body').innerText  = body;

        const types = { success:"#27ae60", danger:"#e74c3c", info:"#3498db", warning:"#f39c12" };
        toast.querySelector('.toast-indicator').style.background = types[type] || types.success;

        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4000);
    }
    // Expose globally so functions defined outside this closure (e.g. the
    // Data Export & Import handlers) can also show themed toasts instead
    // of falling back to a plain browser alert().
    window.showToast = showToast;

    window.exportToCSV = function() {
        const db = getDatabase();
        if (db.length === 0) { showToast("No Data", "No student data available to export.", "warning"); return; }

        const headers = ["RegNo","FullName","Class","Guardian","Phone","NetPayable","SiblingGroupID"];
        let csv = headers.join(",") + "\n";

        db.forEach(s => {
            const row = [
                s.regNo || s.id,
                s.fullName,
                s.studentClass,
                s.guardianName,
                s.phone1,
                s.netPayable,
                s.siblingGroupId || ''
            ];
            csv += row.map(v => `"${v}"`).join(",") + "\n";
        });

        const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `EDULOW_RECORDS_${new Date().toLocaleDateString()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    [searchName, searchFather, searchClass, searchId].forEach(inp => {
        if (inp) inp.addEventListener('input', () => renderStudentTable());
    });

    document.querySelectorAll('.mask-cnic').forEach(input => {
        input.addEventListener('input', e => {
            let v = e.target.value.replace(/\D/g, '');
            let f = "";
            if (v.length > 0) {
                f += v.substring(0, 5);
                if (v.length > 5)  f += "-" + v.substring(5, 12);
                if (v.length > 12) f += "-" + v.substring(12, 13);
            }
            e.target.value = f;
        });
    });

    // ── PLAN ENFORCEMENT: initial pass ──────────────────────────────────────
    applyFeatureLocks();
    renderPlanLimitBanners();
    renderSubscriptionExpiryBadge();

}); // End DOMContentLoaded

/**
 * ============================================================================
 * END OF SCRIPT — EDULOW PRO SIS ENGINE
 * ============================================================================
 */
/* ============================================================================
   CERTIFICATES — PAGE VIEW, MANUAL INPUT & PRINT
============================================================================ */

/* Open the certificate page view (hides main sections, shows cert page) */
function openCertPage() {
    _hideMainSections();
    document.getElementById('data-io-page-view').style.display = 'none';
    const archiveView = document.getElementById('archive-page-view');
    if (archiveView) archiveView.style.display = 'none';
    document.getElementById('cert-page-view').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Close the certificate page view and restore main sections */
function closeCertPage() {
    document.getElementById('cert-page-view').style.display = 'none';
    document.getElementById('data-io-page-view').style.display = 'none';
    _showMainSections();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Helpers: toggle only the real "home" sections, never the inline page-views */
const _INLINE_PAGE_VIEW_IDS = ['cert-page-view', 'data-io-page-view', 'archive-page-view'];
function _hideMainSections() {
    document.querySelectorAll('main > section').forEach(s => {
        if (_INLINE_PAGE_VIEW_IDS.includes(s.id)) return;
        s.style.display = 'none';
    });
}
function _showMainSections() {
    document.querySelectorAll('main > section').forEach(s => {
        if (_INLINE_PAGE_VIEW_IDS.includes(s.id)) return;
        s.style.display = '';
    });
}

/* ============================================================
   ENHANCED SLC — Search, fill, conduct, print
   ============================================================ */

/* ============================================================
   CLASS STATUS — "Passed class" / "Enrolled in" (Leaving + Character certificates)
   Pick one of the two options, then pick the class; the certificate wording follows.
   Until both are chosen the certificates keep their original wording.
   ============================================================ */
const SLC_DEFAULT_MAIN_PARA = 'has successfully completed the recommended course of study at this institution and has accordingly left the rolls of this school.';

function csEsc(v) {
    return (typeof SSValidate !== 'undefined' && SSValidate.escapeHtml) ? SSValidate.escapeHtml(String(v)) : String(v);
}

/** { mode: 'passed' | 'enrolled' | '', cls: 'Grade 3' | '' } for the "slc" or "char" modal. */
function csGetStatus(prefix) {
    const picked = document.querySelector(`input[name="${prefix}-cs-mode"]:checked`);
    const sel = document.getElementById(`${prefix}-cs-class`);
    return { mode: picked ? picked.value : '', cls: sel ? String(sel.value || '').trim() : '' };
}

/** Fill the class <select> from the classes saved in Settings (a student's own class is kept even if it was removed there). */
function csPopulateClasses(prefix, preferred) {
    const sel = document.getElementById(`${prefix}-cs-class`);
    if (!sel) return;
    const wanted = (preferred && preferred !== '—') ? String(preferred) : sel.value;
    let names = [];
    try { names = getClassConfigs().map(c => c && c.name).filter(Boolean); } catch (e) { names = []; }
    if (wanted && !names.includes(wanted)) names = [wanted, ...names];

    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Select class…';
    sel.appendChild(ph);
    names.forEach(n => {
        const o = document.createElement('option');
        o.value = n; o.textContent = n;
        sel.appendChild(o);
    });
    sel.value = wanted && names.includes(wanted) ? wanted : '';
}

function csRefresh(prefix) {
    if (prefix === 'slc') slcApplyClassStatus();
    else charRenderParagraph();
}

/** One of the two options was chosen → show the class picker (pre-selecting the student's own class) and update the certificate. */
function csModeChanged(prefix) {
    const { mode } = csGetStatus(prefix);
    const wrap = document.getElementById(`${prefix}-cs-class-wrap`);
    const label = document.getElementById(`${prefix}-cs-class-label`);
    if (wrap) wrap.classList.toggle('is-open', !!mode);
    if (label) label.textContent = mode === 'passed' ? 'Class passed' : mode === 'enrolled' ? 'Enrolled in class' : 'Select class';
    const s = prefix === 'slc' ? window.__slcCurrentStudent : window.__charCurrentStudent;
    const ownClass = s ? (s.class || s.studentClass || '') : '';
    csPopulateClasses(prefix, ownClass);
    csRefresh(prefix);
}

function csClassChanged(prefix) { csRefresh(prefix); }

/** A different student was loaded → if a status is already chosen, default the class to that student's class. */
function csSyncToStudent(prefix, s) {
    if (!csGetStatus(prefix).mode) return;
    csPopulateClasses(prefix, s ? (s.class || s.studentClass || '') : '');
}

window.csModeChanged = csModeChanged;
window.csClassChanged = csClassChanged;

/* Search bar for SLC modal */
function slcSearchStudents() {
    const input    = document.getElementById('slc-search-input');
    const dropdown = document.getElementById('slc-search-results');
    if (!input || !dropdown) return;
    const query = input.value.trim().toLowerCase();

    dropdown.innerHTML = '';
    if (!query) { dropdown.classList.remove('open'); return; }

    const students = getDatabase();
    let matches;

    if (query.includes('~')) {
        // Combined search: "Student Name~Guardian Name"
        const [namePartRaw, guardianPartRaw] = query.split('~');
        const namePart     = (namePartRaw || '').trim();
        const guardianPart = (guardianPartRaw || '').trim();
        matches = students.filter(s => {
    const name     = (s.name || s.fullName || '').toLowerCase();
    const guardian = (s.fatherName || s.guardianName || '').toLowerCase();
    // FIX: Force to string
    const regNo    = String(s.regNo || '').toLowerCase();
    const id       = String(s.id || '').toLowerCase();
    return name.includes(query) || guardian.includes(query) || regNo.includes(query) || id.includes(query);
}).slice(0, 8);
    } else {
        matches = students.filter(s => {
    const name     = (s.name || s.fullName || '').toLowerCase();
    const guardian = (s.fatherName || s.guardianName || '').toLowerCase();
    // FIX: Force to string
    const regNo    = String(s.regNo || '').toLowerCase();
    const id       = String(s.id || '').toLowerCase();
    return name.includes(query) || guardian.includes(query) || regNo.includes(query) || id.includes(query);
}).slice(0, 8);
    }

    if (!matches.length) {
        dropdown.innerHTML = '<div class="slc-dropdown-item"><span class="slc-di-name" style="color:var(--text-secondary)">No students found</span></div>';
        dropdown.classList.add('open');
        return;
    }

    matches.forEach(s => {
        const sName     = s.name || s.fullName || 'Unknown';
        const sGuardian = s.fatherName || s.guardianName || '—';
        const sId       = s.regNo || s.id || '—';
        const sClass    = s.class || s.studentClass || '—';
        const item = document.createElement('div');
        item.className = 'slc-dropdown-item';
        item.innerHTML = `
            <div class="slc-di-name"><i class="fas fa-user-graduate"></i> ${sName}</div>
            <div class="slc-di-meta">ID: ${sId} &nbsp;|&nbsp; Class: ${sClass} &nbsp;|&nbsp; Guardian: ${sGuardian}</div>`;
        item.addEventListener('click', () => {
            input.value = sName;
            dropdown.classList.remove('open');
            slcFillFromStudent(s);
        });
        dropdown.appendChild(item);
    });
    dropdown.classList.add('open');
}

/* Close SLC dropdown when clicking outside */
document.addEventListener('click', e => {
    const input    = document.getElementById('slc-search-input');
    const dropdown = document.getElementById('slc-search-results');
    if (input && dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

/* Generate certificate manually when student isn't in the database */
function slcManualGenerate() {
    const idVal    = (document.getElementById('slc-manual-id')?.value || '').trim();
    const namesVal = (document.getElementById('slc-manual-names')?.value || '').trim();

    let studentName = namesVal;
    let guardianName = '';
    if (namesVal.includes('~')) {
        const [n, g] = namesVal.split('~');
        studentName  = (n || '').trim();
        guardianName = (g || '').trim();
    }

    if (!studentName) {
        showToast('Missing Name', 'Please enter at least the student name (use Student~Guardian format if you want to add the guardian too).', 'warning');
        return;
    }

    const leavingInput = document.getElementById('slc-leaving-date-input');
    const manualStudent = {
        name: studentName,
        fatherName: guardianName || '—',
        regNo: idVal || '—',
        id: idVal || '—',
        admissionDate: '—',
        dob: '—',
        class: '—',
        leavingDate: leavingInput && leavingInput.value ? leavingInput.value : ''
    };

    slcFillFromStudent(manualStudent);
}

/* Fill certificate from a student object */
function slcFillFromStudent(s) {
    const today     = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
    const certNo    = 'SLC-' + String(Math.floor(1000 + Math.random() * 9000));
    const studentName  = s.name || s.fullName || '—';
    const regNo        = s.regNo || s.id || '—';
    const fatherName   = s.fatherName || s.guardianName || '—';
    const admissionDate= s.admissionDate || s.dateOfAdmission || '—';
    const dob          = s.dob || s.dateOfBirth || '—';
    const studentClass = s.class || s.studentClass || '—';

    // Date the student actually left the school (from record if available, else today; editable via input)
    const rawLeavingDate = s.leavingDate || s.dateOfLeaving || s.leftDate || '';
    const leavingDateInput = document.getElementById('slc-leaving-date-input');
    let leavingDateDisplay;
    if (rawLeavingDate) {
        leavingDateDisplay = new Date(rawLeavingDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
        if (leavingDateInput) leavingDateInput.value = rawLeavingDate;
    } else {
        leavingDateDisplay = today;
        if (leavingDateInput) leavingDateInput.value = new Date().toISOString().slice(0, 10);
    }

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    setText('slc-name-display', studentName);
    setText('slc-leaving-date', leavingDateDisplay);   // date student left the school
    setText('slc-issue-date', today);                  // date this certificate/voucher was generated
    setText('slc-cert-no', certNo);

    // Remember for share filename
    window.__slcCurrentName = studentName;
    window.__slcCurrentStudent = s;

    // School name from header if present
    const schoolEl = document.querySelector('.school-name');
    if (schoolEl) setText('slc-school-name', schoolEl.textContent);

    // School phone/address come from Settings only — never editable here.
    setText('slc-school-tel', getSchoolContactPhone() || 'Not set in Settings');
    setText('slc-school-address', getSchoolContactAddress() || 'Not set in Settings');

    csSyncToStudent('slc', s);
    slcApplyClassStatus();

    document.getElementById('slc-empty-state').style.display = 'none';
    document.getElementById('slc-preview').style.display     = 'block';
    const printBtn = document.getElementById('slc-print-btn'); if (printBtn) printBtn.style.display = '';
    const shareBtn = document.getElementById('slc-share-btn'); if (shareBtn) shareBtn.style.display = '';
}

/* (Re)build the Leaving Certificate wording from the loaded student + the Class Status choice */
function slcApplyClassStatus() {
    const s = window.__slcCurrentStudent;
    if (!s) return;
    const studentName   = s.name || s.fullName || '—';
    const regNo         = s.regNo || s.id || '—';
    const fatherName    = s.fatherName || s.guardianName || '—';
    const admissionDate = s.admissionDate || s.dateOfAdmission || '—';
    const dob           = s.dob || s.dateOfBirth || '—';
    const studentClass  = s.class || s.studentClass || '—';

    const { mode, cls } = csGetStatus('slc');
    const chosen = !!(mode && cls);
    const c = csEsc(cls);

    // Main sentence under the name
    const mainEl = document.getElementById('slc-main-para');
    if (mainEl) {
        if (chosen && mode === 'passed') {
            mainEl.innerHTML = `has successfully completed the recommended course of study at this institution, having <strong>passed ${c}</strong>, and has accordingly left the rolls of this school.`;
        } else if (chosen && mode === 'enrolled') {
            mainEl.innerHTML = `has been a student of this institution, <strong>enrolled in ${c}</strong>, and has accordingly left the rolls of this school.`;
        } else {
            mainEl.textContent = SLC_DEFAULT_MAIN_PARA;
        }
    }

    // Class sentence in the record paragraph
    let classSentence;
    if (chosen && mode === 'passed') {
        classSentence = `The student passed <strong>${c}</strong> before leaving this institution. `;
    } else if (chosen && mode === 'enrolled') {
        classSentence = `At the time of leaving, the student was enrolled in <strong>${c}</strong>. `;
    } else {
        classSentence = `At the time of leaving, the student was enrolled in <strong>Class ${studentClass}</strong>. `;
    }

    const recordEl = document.getElementById('slc-record-para');
    if (recordEl) {
        recordEl.innerHTML =
            `For official record, <strong>${studentName}</strong> (Student ID <strong>${regNo}</strong>), ` +
            `son/daughter of <strong>${fatherName}</strong>, was born on <strong>${dob}</strong> and ` +
            `was admitted to this institution on <strong>${admissionDate}</strong>. ` +
            classSentence +
            `The school administration wishes him/her continued success in all future academic and personal endeavours.`;
    }
}

/* Let the user manually override the "Date of Leaving" shown on the certificate */
function slcUpdateLeavingDate() {
    const input = document.getElementById('slc-leaving-date-input');
    if (!input || !input.value) return;
    const display = new Date(input.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
    const el = document.getElementById('slc-leaving-date');
    if (el) el.textContent = display;
}

/* Capture SLC certificate as an image blob using html2canvas */
async function slcCaptureBlob() {
    const doc = document.getElementById('slc-document');
    if (!doc || typeof html2canvas === 'undefined') return null;
    const canvas = await html2canvas(doc, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    return new Promise(res => canvas.toBlob(res, 'image/png'));
}

/* Share SLC certificate as image (Web Share API → fallback to WhatsApp / download) */
async function shareSLC() {
    const name = (window.__slcCurrentName || 'student').replace(/[^a-z0-9]+/gi, '_');
    const filename = `School_Leaving_Certificate_${name}.png`;
    const shareBtn = document.getElementById('slc-share-btn');
    const oldHtml = shareBtn ? shareBtn.innerHTML : '';
    if (shareBtn) { shareBtn.disabled = true; shareBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...'; }
    try {
        const blob = await slcCaptureBlob();
        if (!blob) throw new Error('Capture failed');
        const file = new File([blob], filename, { type: 'image/png' });

        // 1) Native share with file (mobile WhatsApp, etc.)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'School Leaving Certificate',
                text: `School Leaving Certificate for ${window.__slcCurrentName || ''}`
            });
            return;
        }

        // 2) Fallback: download image + open WhatsApp Web with a prefilled message
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);

        const msg = encodeURIComponent(
            `School Leaving Certificate for ${window.__slcCurrentName || 'student'}.\n` +
            `(The certificate image has been downloaded — please attach "${filename}" in WhatsApp.)`
        );
        window.open(`https://wa.me/?text=${msg}`, '_blank');
    } catch (err) {
        console.error('Share failed', err);
        showToast('Share Failed', 'The certificate image could not be generated.', 'danger');
    } finally {
        if (shareBtn) { shareBtn.disabled = false; shareBtn.innerHTML = oldHtml; }
    }
}

/* No-op kept for backward compatibility (conduct dropdown removed) */
function slcUpdateConduct() { /* removed: conduct & performance no longer shown */ }


/* Print the SLC */
function printSLC() {
    const doc = document.getElementById('slc-document');
    if (!doc) return;

    const printWin = window.open('', '_blank', 'width=1180,height=820');
    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
<title>School Leaving Certificate</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cormorant Garamond',Georgia,serif;background:#eef2f7;padding:24px;display:flex;justify-content:center;align-items:center;min-height:100vh}
.slc-cert-outer.slc-landscape{position:relative;background:#fff;width:1050px;height:740px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.18);border-radius:6px;color:#0f172a}

/* Decorative blue geometric corner shapes (like reference) */
.slc-geo{position:absolute;background:#3b6fb8;z-index:0}
.slc-geo-tl{top:-60px;left:-60px;width:260px;height:260px;transform:rotate(45deg);background:linear-gradient(135deg,#5a8acd,#3b6fb8)}
.slc-geo-tl2{top:-30px;left:80px;width:140px;height:140px;transform:rotate(45deg);background:#7ba6dd;opacity:.7}
.slc-geo-bl{bottom:-80px;left:-40px;width:280px;height:280px;transform:rotate(45deg);background:linear-gradient(135deg,#3b6fb8,#2c5797)}
.slc-geo-bl2{bottom:40px;left:-40px;width:120px;height:120px;transform:rotate(45deg);background:#7ba6dd;opacity:.6}
.slc-geo-tr{top:-70px;right:-60px;width:260px;height:260px;transform:rotate(45deg);background:linear-gradient(135deg,#3b6fb8,#5a8acd)}
.slc-geo-tr2{top:80px;right:-50px;width:140px;height:140px;transform:rotate(45deg);background:#7ba6dd;opacity:.7}
.slc-geo-br{bottom:-70px;right:-60px;width:240px;height:240px;transform:rotate(45deg);background:linear-gradient(135deg,#2c5797,#3b6fb8)}
.slc-geo-br2{bottom:60px;right:80px;width:120px;height:120px;transform:rotate(45deg);background:#7ba6dd;opacity:.6}

.slc-inner{position:relative;z-index:2;background:#fff;margin:46px;height:calc(100% - 92px);padding:32px 56px 72px;display:flex;flex-direction:column}

.slc-l-header{display:flex;align-items:center;gap:18px;padding-bottom:14px;border-bottom:1px solid #e2e8f0}
.slc-l-logo{width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#2c5797,#3b6fb8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;box-shadow:0 4px 14px rgba(59,111,184,.4)}
.slc-l-school-block{flex:1;text-align:center}
.slc-l-school-name{font-family:'Cormorant Garamond',serif;font-size:27px;font-weight:700;letter-spacing:.08em;color:#0f172a;text-transform:uppercase}
.slc-l-school-meta{margin-top:4px;font-family:'Inter',sans-serif;font-size:11px;color:#64748b;letter-spacing:.04em}
.slc-l-dot{margin:0 8px;color:#cbd5e1}
.slc-l-serial{text-align:right;flex-shrink:0;font-family:'Inter',sans-serif}
.slc-l-serial-label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}
.slc-l-serial-value{font-size:13px;font-weight:700;color:#2c5797;margin-top:2px}

.slc-l-title{text-align:center;margin-top:26px;font-family:'Cormorant Garamond',serif;font-size:42px;font-weight:700;color:#1e293b;letter-spacing:.04em}
.slc-l-certify{text-align:center;margin-top:14px;font-size:18px;color:#475569;font-style:italic}
.slc-l-name{text-align:center;margin-top:6px;font-family:'Great Vibes',cursive;font-size:72px;color:#3b6fb8;line-height:1.05}

.slc-l-main-para{text-align:center;margin:14px auto 0;max-width:780px;font-size:18px;line-height:1.55;color:#334155;font-family:'Cormorant Garamond',serif}

.slc-l-dates-row{display:flex;align-items:center;justify-content:center;gap:36px;margin:18px auto 0;max-width:780px}
.slc-l-date-item{text-align:center}
.slc-l-date-label{font-family:'Inter',sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8}
.slc-l-date-label i{margin-right:4px;color:#3b6fb8}
.slc-l-date-value{font-family:'Inter',sans-serif;font-size:14px;font-weight:700;color:#1e293b;margin-top:3px}
.slc-l-date-sep{width:1px;height:30px;background:#cbd5e1}

.slc-l-record-para{margin-top:18px;padding:14px 22px;font-size:14px;line-height:1.7;color:#475569;font-family:'Inter',sans-serif;text-align:justify;border-top:1px dashed #cbd5e1;border-bottom:1px dashed #cbd5e1;background:#f8fafc;border-radius:6px}
.slc-l-record-para strong{color:#1e293b}

.slc-l-footer{margin-top:auto;padding-top:22px;padding-bottom:24px;display:flex;align-items:flex-end;justify-content:space-around;gap:40px}
.slc-l-footer-principal-only{justify-content:flex-end;padding-right:40px}
.slc-l-sig-principal{min-width:220px}
.slc-l-stamp-spacer{min-width:120px}
.slc-l-sig{text-align:center;min-width:200px}
.slc-l-sig-line{width:180px;height:1px;background:#334155;margin:0 auto 8px}
.slc-l-sig-title{font-family:'Inter',sans-serif;font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.06em}
.slc-l-sig-sub{font-family:'Inter',sans-serif;font-size:10px;color:#94a3b8;margin-top:2px}
.slc-l-stamp{display:flex;justify-content:center}
.slc-l-stamp-ring{width:96px;height:96px;border:2px dashed #94a3b8;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#94a3b8;text-align:center;font-family:'Inter',sans-serif}
.slc-l-stamp-ring i{font-size:22px;margin-bottom:4px}
.slc-l-stamp-ring span{font-size:8px;font-weight:700;letter-spacing:.12em;line-height:1.2}

@media print{
  html,body{padding:0;margin:0;background:#fff;width:100%;height:auto;min-height:0}
  body{display:block !important;min-height:0 !important}
  @page{size:A4 landscape;margin:6mm}
  .slc-cert-outer.slc-landscape{box-shadow:none;border-radius:0;margin:0 auto;page-break-after:avoid;page-break-inside:avoid}
}
</style>
</head>
<body>${doc.outerHTML}</body>
</html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); printWin.close(); }, 700);
}


/* ============================================================
   ENHANCED CHARACTER CERTIFICATE — Search, fill, conduct, print
   ============================================================ */

/* Search bar for Character Certificate modal */
function charSearchStudents() {
    const input    = document.getElementById('char-search-input');
    const dropdown = document.getElementById('char-search-results');
    if (!input || !dropdown) return;
    const query = input.value.trim().toLowerCase();

    dropdown.innerHTML = '';
    if (!query) { dropdown.classList.remove('open'); return; }

    const students = getDatabase();
    let matches;

    if (query.includes('~')) {
        const [namePartRaw, guardianPartRaw] = query.split('~');
        const namePart     = (namePartRaw || '').trim();
        const guardianPart = (guardianPartRaw || '').trim();
        matches = students.filter(s => {
            const name     = (s.name || s.fullName || '').toLowerCase();
            const guardian = (s.fatherName || s.guardianName || '').toLowerCase();
            const nameOk     = !namePart || name.includes(namePart);
            const guardianOk = !guardianPart || guardian.includes(guardianPart);
            return nameOk && guardianOk;
        }).slice(0, 8);
    } else {
        matches = students.filter(s => {
            const name     = (s.name || s.fullName || '').toLowerCase();
            const guardian = (s.fatherName || s.guardianName || '').toLowerCase();
            
            // FIX APPLIED HERE: Force numeric IDs to String
            const regNo    = String(s.regNo || '').toLowerCase();
            const id       = String(s.id || '').toLowerCase();
            
            return name.includes(query) || guardian.includes(query) || regNo.includes(query) || id.includes(query);
        }).slice(0, 8);
    }

    if (!matches.length) {
        dropdown.innerHTML = '<div class="slc-dropdown-item"><span class="slc-di-name" style="color:var(--text-secondary)">No students found</span></div>';
        dropdown.classList.add('open');
        return;
    }

    matches.forEach(s => {
        const sName     = s.name || s.fullName || 'Unknown';
        const sGuardian = s.fatherName || s.guardianName || '—';
        const sId       = s.regNo || s.id || '—';
        const sClass    = s.class || s.studentClass || '—';
        const item = document.createElement('div');
        item.className = 'slc-dropdown-item';
        item.innerHTML = `
            <div class="slc-di-name"><i class="fas fa-user-graduate"></i> ${sName}</div>
            <div class="slc-di-meta">ID: ${sId} &nbsp;|&nbsp; Class: ${sClass} &nbsp;|&nbsp; Guardian: ${sGuardian}</div>`;
        item.addEventListener('click', () => {
            input.value = sName;
            dropdown.classList.remove('open');
            charFillFromStudent(s);
        });
        dropdown.appendChild(item);
    });
    dropdown.classList.add('open');
}

/* Close char dropdown when clicking outside */
document.addEventListener('click', e => {
    const input    = document.getElementById('char-search-input');
    const dropdown = document.getElementById('char-search-results');
    if (input && dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

/* Generate certificate manually when student isn't in the database */
function charManualGenerate() {
    const idVal     = (document.getElementById('char-manual-id')?.value || '').trim();
    const namesVal  = (document.getElementById('char-manual-names')?.value || '').trim();
    const genderVal = document.getElementById('char-manual-gender')?.value || 'Female';

    let studentName  = namesVal;
    let guardianName = '';
    if (namesVal.includes('~')) {
        const [n, g] = namesVal.split('~');
        studentName  = (n || '').trim();
        guardianName = (g || '').trim();
    }

    if (!studentName) {
        showToast('Missing Name', 'Please enter at least the student name (use Student~Guardian format if you want to add the guardian too).', 'warning');
        return;
    }

    const fromInput = document.getElementById('char-from-date-input');
    const toInput   = document.getElementById('char-to-date-input');

    const manualStudent = {
        name: studentName,
        fatherName: guardianName || '—',
        regNo: idVal || '—',
        id: idVal || '—',
        gender: genderVal,
        admissionDate: fromInput && fromInput.value ? fromInput.value : '',
        leavingDate: toInput && toInput.value ? toInput.value : ''
    };

    charFillFromStudent(manualStudent);
}

/* Build the moral-character paragraph based on the conduct level selected */
function charBuildParagraph(studentName, guardianLabel, fatherName, fromDisplay, toDisplay, pronouns, conduct, classClause) {
    const { sub, poss, obj } = pronouns; // sub: He/She, poss: His/Her, obj: him/her

    const opening = `It is to certify that <strong>${studentName}</strong> ${guardianLabel} <strong>${fatherName}</strong> ` +
        `who has studied in this institution from <strong>${fromDisplay}</strong> to <strong>${toDisplay}</strong>${classClause || ''}, `;

    const templates = {
        excellent: opening +
            `bears an <strong>excellent moral character</strong>. ${poss} behaviour was outstanding with teachers and students alike. ` +
            `${sub} consistently displayed honesty, discipline, and respect, and never showed any sign of violent or aggressive behaviour, ` +
            `nor any desire to harm others. ${sub} is held in the highest regard by the institution.`,
        good: opening +
            `bears a <strong>good moral character</strong>. ${poss} behaviour was good with teachers and students. ` +
            `${sub} neither displayed persistent violent or aggressive behaviour nor any desire to harm others.`,
        moderate: opening +
            `bears a <strong>moderate moral character</strong>. ${poss} behaviour with teachers and students was generally acceptable, ` +
            `though there were occasional instances requiring guidance and correction. ${sub} showed no serious signs of violent or ` +
            `aggressive behaviour, nor any desire to harm others.`,
        bad: opening +
            `was found to bear a <strong>poor moral character</strong> during ${poss.toLowerCase()} time at this institution. ` +
            `${poss} behaviour with teachers and students raised repeated concerns, including instances of disruptive, ` +
            `aggressive, or disrespectful conduct that required disciplinary action.`
    };

    return templates[conduct] || templates.good;
}

/* Fill certificate from a student object */
function charFillFromStudent(s) {
    const today = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
    const studentName = s.name || s.fullName || '—';
    const regNo       = s.regNo || s.id || '—';
    const fatherName  = s.fatherName || s.guardianName || '—';
    const gender      = s.gender || 'Female';

    const guardianLabel = gender === 'Male' ? 'Son of' : 'Daughter of';
    const pronouns = gender === 'Male'
        ? { sub: 'He', poss: 'His', obj: 'him' }
        : { sub: 'She', poss: 'Her', obj: 'her' };

    const fromInput = document.getElementById('char-from-date-input');
    const toInput   = document.getElementById('char-to-date-input');

    const rawFrom = s.admissionDate || s.dateOfAdmission || '';
    const rawTo   = s.leavingDate || s.dateOfLeaving || '';

    // "Studied To" = the date the student left. If no leaving date is recorded, it is the day the
    // certificate is generated (today). Always set both fields so a previous student's dates never linger.
    if (fromInput) fromInput.value = rawFrom ? String(rawFrom).slice(0, 10) : '';
    if (toInput)   toInput.value   = rawTo   ? String(rawTo).slice(0, 10)   : charTodayISO();

    const fromDisplay = (fromInput && fromInput.value) ? new Date(fromInput.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const toDisplay   = (toInput && toInput.value)     ? new Date(toInput.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    setText('char-name-display', studentName);
    setText('char-id-display', regNo);
    setText('char-issue-date', today);

    const schoolEl = document.querySelector('.school-name');
    const schoolName = schoolEl ? schoolEl.textContent : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
    setText('char-school-name', schoolName);
    setText('char-taught-at', schoolName);

    // School phone/address come from Settings only — never editable here.
    setText('char-school-tel', getSchoolContactPhone() || 'Not set in Settings');
    setText('char-school-address', getSchoolContactAddress() || 'Not set in Settings');

    // Remember for conduct re-render & print
    window.__charCurrentName     = studentName;
    window.__charCurrentStudent  = s;
    window.__charGuardianLabel   = guardianLabel;
    window.__charFatherName      = fatherName;
    window.__charPronouns        = pronouns;
    window.__charFromDisplay     = fromDisplay;
    window.__charToDisplay       = toDisplay;

    csSyncToStudent('char', s);
    charRenderParagraph();

    document.getElementById('char-empty-state').style.display = 'none';
    document.getElementById('char-preview').style.display     = 'block';
    const printBtn = document.getElementById('char-print-btn'); if (printBtn) printBtn.style.display = '';
    const shareBtn = document.getElementById('char-share-btn'); if (shareBtn) shareBtn.style.display = '';
}

/* Re-render the paragraph using the currently selected conduct option */
function charRenderParagraph() {
    if (!window.__charCurrentName) return;
    const conduct = document.getElementById('char-conduct-select')?.value || 'good';

    // Class Status: "has passed <class>" / "is|was enrolled in <class>" (only once both are chosen)
    const { mode, cls } = csGetStatus('char');
    let classClause = '';
    if (mode && cls) {
        if (mode === 'passed') {
            classClause = ` and has passed <strong>${csEsc(cls)}</strong>`;
        } else {
            const toVal = document.getElementById('char-to-date-input')?.value || '';
            const stillStudying = !toVal || toVal >= charTodayISO();   // leaving date today/future → "is", past → "was"
            classClause = ` and ${stillStudying ? 'is' : 'was'} enrolled in <strong>${csEsc(cls)}</strong>`;
        }
    }

    const para = charBuildParagraph(
        window.__charCurrentName,
        window.__charGuardianLabel,
        window.__charFatherName,
        window.__charFromDisplay,
        window.__charToDisplay,
        window.__charPronouns,
        conduct,
        classClause
    );
    const el = document.getElementById('char-main-para');
    if (el) el.innerHTML = para;
}

/* Conduct dropdown changed -> update paragraph live */
function charUpdateConduct() {
    charRenderParagraph();
}

/* "Studied From"/"Studied To" date inputs changed -> update dates + paragraph */
function charUpdateDates() {
    const fromInput = document.getElementById('char-from-date-input');
    const toInput   = document.getElementById('char-to-date-input');
    window.__charFromDisplay = (fromInput && fromInput.value) ? new Date(fromInput.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    if (toInput && !toInput.value) toInput.value = charTodayISO();   // no leaving date → certificate date (today)
    window.__charToDisplay   = (toInput && toInput.value)     ? new Date(toInput.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    charRenderParagraph();
}

/* Today's date as YYYY-MM-DD in the device's LOCAL time (toISOString would give the previous day after midnight in Pakistan) */
function charTodayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Capture Character Certificate as an image blob using html2canvas */
async function charCaptureBlob() {
    const doc = document.getElementById('char-document');
    if (!doc || typeof html2canvas === 'undefined') return null;
    const canvas = await html2canvas(doc, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    return new Promise(res => canvas.toBlob(res, 'image/png'));
}

/* Share Character Certificate as image (Web Share API → fallback to WhatsApp / download) */
async function shareCharCert() {
    const name = (window.__charCurrentName || 'student').replace(/[^a-z0-9]+/gi, '_');
    const filename = `Character_Certificate_${name}.png`;
    const shareBtn = document.getElementById('char-share-btn');
    const oldHtml = shareBtn ? shareBtn.innerHTML : '';
    if (shareBtn) { shareBtn.disabled = true; shareBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...'; }
    try {
        const blob = await charCaptureBlob();
        if (!blob) throw new Error('Capture failed');
        const file = new File([blob], filename, { type: 'image/png' });

        // 1) Native share with file (mobile WhatsApp, etc.)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'Character Certificate',
                text: `Character Certificate for ${window.__charCurrentName || ''}`
            });
            return;
        }

        // 2) Fallback: download image + open WhatsApp Web with a prefilled message
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);

        const msg = encodeURIComponent(
            `Character Certificate for ${window.__charCurrentName || 'student'}.\n` +
            `(The certificate image has been downloaded — please attach "${filename}" in WhatsApp.)`
        );
        window.open(`https://wa.me/?text=${msg}`, '_blank');
    } catch (err) {
        console.error('Share failed', err);
        showToast('Share Failed', 'The certificate image could not be generated.', 'danger');
    } finally {
        if (shareBtn) { shareBtn.disabled = false; shareBtn.innerHTML = oldHtml; }
    }
}

/* Print the Character Certificate */
function printCharCert() {
    const doc = document.getElementById('char-document');
    if (!doc) return;

    const printWin = window.open('', '_blank', 'width=900,height=1100');
    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
<title>Character Certificate</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cormorant Garamond',Georgia,serif;background:#eef2f7;padding:24px;display:flex;justify-content:center;align-items:center;min-height:100vh}
.char-cert-outer{position:relative;background:#fff;width:745px;height:1075px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.18);border-radius:4px;color:#0f172a;margin:0 auto}
.char-geo{position:absolute;width:0;height:0;z-index:1}
.char-geo-tl{top:0;left:0;border-top:170px solid #c8a753;border-right:170px solid transparent}
.char-geo-bl{bottom:0;left:0;border-bottom:170px solid #1a2744;border-right:170px solid transparent}
.char-geo-tr{top:0;right:0;border-top:130px solid #1a2744;border-left:130px solid transparent}
.char-geo-br{bottom:0;right:0;border-bottom:130px solid #c8a753;border-left:130px solid transparent}
.char-border-frame{position:absolute;inset:26px;border:2px solid #c8a753;z-index:2;pointer-events:none}
.char-inner{position:relative;z-index:3;padding:64px 64px 50px;display:flex;flex-direction:column;align-items:center;text-align:center;height:100%}
.char-l-header{display:flex;align-items:center;gap:20px;width:calc(100% - 30px);margin:56px 0 20px 30px}
.char-l-logo{width:78px;height:78px;border-radius:50%;background:linear-gradient(135deg,#1a2744,#3b6fb8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0;box-shadow:0 4px 14px rgba(26,39,68,.35)}
.char-l-school-block{flex:1;text-align:center}
.char-l-school-meta{margin-top:4px;font-family:'Inter',sans-serif;font-size:10.5px;color:#64748b;letter-spacing:.04em}
.char-l-dot{margin:0 8px;color:#cbd5e1}
.char-school-name{font-family:'Inter',sans-serif;font-size:27px;font-weight:700;letter-spacing:.08em;color:#1a2744;text-transform:uppercase;margin-bottom:0}
.char-certify-line{font-family:'Cormorant Garamond',serif;font-size:15px;font-style:italic;color:#475569;margin-bottom:18px}
.char-title{font-family:'Great Vibes',cursive;font-size:54px;color:#1a2744;line-height:1;margin-bottom:4px}
.char-subtitle{font-family:'Inter',sans-serif;font-size:20px;font-weight:700;letter-spacing:.1em;color:#c8a753;text-transform:uppercase;margin-bottom:18px}
.char-medal-icons{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:22px;color:#1a2744}
.char-medal-icons i{font-size:26px}
.char-medal-main{font-size:40px;color:#c8a753}
.char-name{font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:700;color:#0f172a;letter-spacing:.03em;margin-top:6px}
.char-name-underline{width:260px;height:1px;background:#c8a753;margin:8px auto 22px}
.char-main-para{font-family:'Inter',sans-serif;font-size:14.5px;line-height:1.85;color:#334155;max-width:560px;text-align:justify;margin-bottom:30px}
.char-main-para strong{color:#0f172a}
.char-meta-row{display:flex;align-items:center;justify-content:center;gap:30px;margin-bottom:auto;padding-bottom:30px;width:100%;flex-wrap:wrap}
.char-meta-item{text-align:center}
.char-meta-label{font-family:'Inter',sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}
.char-meta-value{font-family:'Inter',sans-serif;font-size:13px;font-weight:700;color:#1a2744;margin-top:3px}
.char-footer{margin-top:auto;padding-top:30px;display:flex;justify-content:center;width:100%}
.char-sig{text-align:center;min-width:220px}
.char-sig-line{width:200px;height:1px;background:#334155;margin:0 auto 8px}
.char-sig-title{font-family:'Inter',sans-serif;font-size:12px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.06em}
@media print{
  html,body{padding:0;margin:0;background:#fff;width:100%;height:auto;min-height:0}
  body{display:block !important;min-height:0 !important}
  @page{size:A4 portrait;margin:5mm}
  .char-cert-outer{box-shadow:none;border-radius:0;margin:0 auto;page-break-after:avoid;page-break-inside:avoid}
}
</style>
</head>
<body>${doc.outerHTML}</body>
</html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); printWin.close(); }, 700);
}

function getCurrentAcademicSession() {
    const now   = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();
    if (month >= 4) {
        return `${year} – ${year + 1}`;
    } else {
        return `${year - 1} – ${year}`;
    }
}

function printCertificate(docId) {
    const doc = document.getElementById(docId);
    if (!doc) return;

    const printWin = window.open('', '_blank', 'width=800,height=700');
    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Certificate</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: Georgia, serif; background: #fff; padding: 20px; }
                .cert-header-band { height: 8px; background: linear-gradient(90deg,#1e40af,#6d28d9,#be185d); }
                .cert-footer-band { margin-top: 0; }
                .cert-school-header { display: flex; align-items: center; gap: 16px; padding: 20px 28px 12px; border-bottom: 1px solid #e5e7eb; }
                .cert-school-logo { width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg,#1e40af,#6d28d9); display:flex; align-items:center; justify-content:center; color:#fff; font-size:22px; flex-shrink:0; }
                .cert-school-name { font-size:20px; font-weight:700; color:#111827; }
                .cert-school-tagline { font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:.04em; font-family:sans-serif; }
                .cert-title-banner { background:#f8fafc; text-align:center; padding:16px 28px; border-bottom:1px solid #e5e7eb; }
                .cert-main-title { font-size:18px; font-weight:700; color:#1e3a5f; text-transform:uppercase; letter-spacing:.08em; }
                .cert-body-text { padding:20px 28px; font-size:13.5px; line-height:1.75; color:#374151; }
                .cert-body-text p { margin-bottom:12px; }
                .cert-meta-grid { display:grid; grid-template-columns:repeat(2,1fr); margin:0 28px 20px; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; }
                .cert-meta-item { padding:10px 14px; border-right:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb; }
                .cert-meta-item:nth-child(even){ border-right:none; }
                .cert-meta-item:nth-last-child(-n+2){ border-bottom:none; }
                .cert-meta-label { font-size:10px; font-weight:600; text-transform:uppercase; color:#9ca3af; font-family:sans-serif; }
                .cert-meta-value { font-size:13px; font-weight:600; color:#111827; }
                .cert-footer-row { display:flex; align-items:flex-end; justify-content:space-between; padding:20px 40px 24px; }
                .cert-sig-block { text-align:center; font-size:11px; color:#6b7280; font-family:sans-serif; }
                .cert-sig-block p { margin:6px 0 0; }
                .cert-sig-line { width:120px; height:1px; background:#374151; }
                .cert-stamp-circle { width:64px; height:64px; border-radius:50%; border:2px dashed #d1d5db; display:flex; align-items:center; justify-content:center; color:#d1d5db; font-size:22px; }
            </style>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
        </head>
        <body>${doc.outerHTML}</body>
        </html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); printWin.close(); }, 600);
}
/* ============================================================
   DATA EXPORT & IMPORT — openDataIOPage / closeDataIOPage
   ============================================================ */

function openDataIOPage() {
    _hideMainSections();
    document.getElementById('cert-page-view').style.display = 'none';
    const archiveView = document.getElementById('archive-page-view');
    if (archiveView) archiveView.style.display = 'none';
    document.getElementById('data-io-page-view').style.display = 'block';
    const statusEl = document.getElementById('data-io-status');
    if (statusEl) statusEl.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeDataIOPage() {
    document.getElementById('data-io-page-view').style.display = 'none';
    document.getElementById('cert-page-view').style.display = 'none';
    _showMainSections();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDataIOStatus(message, type) {
    const el = document.getElementById('data-io-status');
    if (!el) return;
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    el.className = 'data-io-status ' + (type || 'info');
    el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${message}`;
    el.style.display = 'flex';
}

/* ============================================================
   EXPORT — Build a formatted xlsx workbook from the backend database
   Includes: Student Photos, B-Form Images, Full Discount Breakdown
   ============================================================ */

/**
 * Convert a base64 data URL to a plain base64 string (strips the prefix).
 * Returns null if the input is not a valid image data URL.
 */
function _b64ImageOnly(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
    return match ? match[2] : null;
}

/**
 * Embed a base64 image into a worksheet at a given cell (top-left anchor).
 * Uses XLSX's addImage API (requires xlsx-js-style or the full xlsx build).
 * Falls back silently if addImage is unavailable.
 *
 * @param {object} wb          XLSX workbook
 * @param {object} ws          Target worksheet
 * @param {string} wsName      Worksheet name (needed for addImage)
 * @param {string} b64         Pure base64 image data (no prefix)
 * @param {string} ext         Extension: 'png' | 'jpeg' | 'gif'
 * @param {number} col         0-indexed column
 * @param {number} row         0-indexed row
 * @param {number} colW        Width in EMU (pixels × 9525)
 * @param {number} rowH        Height in EMU (pixels × 9525)
 */
function _addImageToSheet(wb, ws, wsName, b64, ext, col, row, colW, rowH) {
    try {
        if (!wb.addImage || !ws['!images']) {
            // Fallback: attach images array directly on the worksheet
            if (!ws['!images']) ws['!images'] = [];
        }
        const imgId = wb.addImage ? wb.addImage({ base64: b64, extension: ext }) : null;

        const imgObj = {
            '!pos': { r: row, c: col, x: 0, y: 0, w: colW, h: rowH },
        };
        if (imgId !== null) imgObj['!id'] = imgId;
        else imgObj['!data'] = { base64: b64, extension: ext };

        if (!ws['!images']) ws['!images'] = [];
        ws['!images'].push(imgObj);
    } catch (e) {
        // Image embedding is a best-effort feature; silently skip on failure
    }
}

/**
 * Build a small single-image worksheet showing a student's photo or B-Form scan.
 * The image is embedded using an <img> tag written into an HTML worksheet
 * so it always renders regardless of XLSX engine support.
 *
 * Since SheetJS CE (the CDN version) does not support image embedding natively
 * we use a workaround: we build a dedicated "Photos" sheet that lists
 * each student's name, ID, and the base64 data URL as a hyperlink/note,
 * AND we generate a separate standalone HTML file with all photos embedded.
 *
 * The HTML photo gallery is packaged as a Blob and downloaded alongside the xlsx.
 */
function _buildPhotoGalleryHTML(students) {
    const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const now = new Date();
    const dateStr = `${now.getDate()} ${MONTHS[now.getMonth()+1]} ${now.getFullYear()}`;

    const cards = students.map(s => {
        const name  = s.fullName || s.name || 'Unknown';
        const regNo = s.regNo || s.id || '—';
        const cls   = s.studentClass || s.class || '—';
        const photoSrc  = storedStudentFileSrc(s, 'photo');
        const bformSrc  = storedStudentFileSrc(s, 'bform');

        const photoBlock = photoSrc
            ? `<img src="${photoSrc}" alt="Photo of ${name}" style="width:110px;height:120px;object-fit:cover;border-radius:6px;border:2px solid #3b82f6;">`
            : `<div style="width:110px;height:120px;background:#e2e8f0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;border:2px dashed #cbd5e1;">No Photo</div>`;

        const bformBlock = bformSrc
            ? (bformSrc.startsWith('data:image') || !/\.pdf(?:$|[?#])/i.test(s.certData || '')
                ? `<img src="${bformSrc}" alt="B-Form" style="max-width:180px;max-height:130px;object-fit:contain;border-radius:4px;border:1px solid #e2e8f0;">`
                : `<a href="${bformSrc}" style="display:inline-block;padding:6px 12px;background:#3b82f6;color:#fff;border-radius:4px;text-decoration:none;font-size:11px;" download="${regNo}_bform.pdf">📄 Download B-Form PDF</a>`)
            : `<span style="color:#94a3b8;font-size:11px;font-style:italic;">Not uploaded</span>`;

        return `
        <div style="display:flex;gap:16px;align-items:flex-start;padding:16px;background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,0.1);margin-bottom:12px;border-left:4px solid #3b82f6;">
            <div style="flex-shrink:0;">${photoBlock}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px;">${name}</div>
                <div style="font-size:12px;color:#64748b;margin-bottom:8px;">ID: <b>${regNo}</b> &nbsp;|&nbsp; Class: <b>${cls}</b></div>
                <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">B-Form / Certificate</div>
                ${bformBlock}
            </div>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SoftSchool — Student Photo Gallery</title>
<style>
  body { font-family: Arial, sans-serif; background: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
  h1 { font-size: 20px; margin-bottom: 4px; color: #1e293b; }
  .meta { font-size: 12px; color: #64748b; margin-bottom: 20px; }
  .grid { max-width: 820px; margin: 0 auto; }
  @media print { body { background:#fff; } }
</style>
</head>
<body>
<div class="grid">
  <h1>📸 Student Photo & Document Gallery</h1>
  <div class="meta">ST. LAWRENCE INTERNATIONAL SCHOOL &nbsp;|&nbsp; Generated: ${dateStr} &nbsp;|&nbsp; ${students.length} student(s)</div>
  ${cards}
</div>
</body>
</html>`;
}

/* ============================================================
   EXPORT — 1) choose the format (Excel or CSV)
            2) choose the class and section (or "All classes" / "All sections")
            3) download

   openExportDialog()        opens the two-step dialog (the Export card calls it)
   _expSelected()            the students that match the current choice — used for
                             the live count AND for the real export
   _exportExcelFile / _exportCsvFile  build and download the file
   ============================================================ */

const _EXP = { fmt: '', cls: 'ALL', section: 'ALL', archived: false, gallery: true, busy: false, step: 1 };
const _EXP_NOCLASS = '__noclass__', _EXP_NOSEC = '__none__';

function _expIsActive(s) { return !s.status || s.status === 'active'; }
function _expClassOf(s)  { return String(s.studentClass || s.class || '').trim(); }
function _expSecOf(s)    { return String(s.section || '').trim(); }

/** Everyone who could be exported: active students, plus graduated/dropped ones if the box is ticked. */
function _expBase() {
    const all = getDatabase();
    return _EXP.archived ? all.slice() : all.filter(_expIsActive);
}
function _expMatchClass(s) {
    if (_EXP.cls === 'ALL') return true;
    if (_EXP.cls === _EXP_NOCLASS) return !_expClassOf(s);
    return _expClassOf(s) === _EXP.cls;
}
function _expMatchSection(s) {
    if (_EXP.section === 'ALL') return true;
    if (_EXP.section === _EXP_NOSEC) return !_expSecOf(s);
    return _expSecOf(s) === _EXP.section;
}
function _expSelected() { return _expBase().filter(s => _expMatchClass(s) && _expMatchSection(s)); }

/** Classes for the dropdown: those in Settings (in order), then any other class found on students, with counts. */
function _expClassOptions() {
    const base = _expBase();
    const configured = getClassConfigs().map(c => c.name);
    const counts = new Map();
    base.forEach(s => { const k = _expClassOf(s) || _EXP_NOCLASS; counts.set(k, (counts.get(k) || 0) + 1); });
    const names = configured.slice();
    [...counts.keys()].filter(k => k !== _EXP_NOCLASS && !configured.includes(k)).sort().forEach(k => names.push(k));
    const opts = names.map(n => ({ value: n, label: n, count: counts.get(n) || 0, extra: !configured.includes(n) }));
    if (counts.get(_EXP_NOCLASS)) opts.push({ value: _EXP_NOCLASS, label: '(No class)', count: counts.get(_EXP_NOCLASS) });
    return { total: base.length, opts };
}
/** Sections for the dropdown, for the chosen class (or across all classes), with counts. */
function _expSectionOptions() {
    const base = _expBase().filter(_expMatchClass);
    const counts = new Map();
    base.forEach(s => { const k = _expSecOf(s) || _EXP_NOSEC; counts.set(k, (counts.get(k) || 0) + 1); });
    const specific = _EXP.cls !== 'ALL' && _EXP.cls !== _EXP_NOCLASS;
    const configured = specific ? _impSectionsOf(_EXP.cls) : [];
    const names = configured.slice();
    [...counts.keys()].filter(k => k !== _EXP_NOSEC && !configured.includes(k))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(k => names.push(k));
    const opts = names.filter(n => specific || counts.get(n))
        .map(n => ({ value: n, label: `Section ${n}`, count: counts.get(n) || 0 }));
    if (counts.get(_EXP_NOSEC)) opts.push({ value: _EXP_NOSEC, label: 'No section', count: counts.get(_EXP_NOSEC) });
    return { total: base.length, opts };
}

function _expClassLabel() {
    return _EXP.cls === 'ALL' ? 'All classes' : _EXP.cls === _EXP_NOCLASS ? '(No class)' : _EXP.cls;
}
function _expSectionLabel() {
    return _EXP.section === 'ALL' ? 'All sections' : _EXP.section === _EXP_NOSEC ? 'No section' : `Section ${_EXP.section}`;
}
function _expFileBase() {
    let name = 'SoftSchool (Student Data)';
    if (_EXP.cls !== 'ALL') name += ' - ' + (_EXP.cls === _EXP_NOCLASS ? 'No class' : _EXP.cls);
    if (_EXP.section !== 'ALL') name += ' - ' + (_EXP.section === _EXP_NOSEC ? 'No section' : 'Section ' + _EXP.section);
    return name.replace(/[\\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

/* ---------- the dialog ---------- */

async function openExportDialog() {
    if (!getDatabase().length) {
        showDataIOStatus('No student records found to export.', 'error');
        return;
    }
    Object.assign(_EXP, { fmt: '', cls: 'ALL', section: 'ALL', archived: false, gallery: true, busy: false, step: 1 });
    await _impEnsureClassConfigs();          /* make sure the Class list is the school's real one */
    _expShowStep(1);
    openModal('export-modal');
}
function exportStudentsToExcel() { return openExportDialog(); }   /* old name, still works */

function closeExportDialog() {
    if (_EXP.busy) return;
    closeModal('export-modal');
}

function _expShowStep(n) {
    _EXP.step = n;
    document.getElementById('exp-step1').hidden = n !== 1;
    document.getElementById('exp-step2').hidden = n !== 2;
    document.getElementById('exp-back-btn').hidden = n !== 2;
    document.getElementById('exp-run-btn').hidden = n !== 2;
    document.querySelector('#exp-title span').textContent = n === 1 ? 'Export Students' : 'Choose Class & Section';
    if (n === 1) {
        const total = _expBase().length;
        document.getElementById('exp-summary').innerHTML = `<i class="fas fa-users"></i><span>${total} active student${total === 1 ? '' : 's'}</span>`;
        document.getElementById('exp-summary').classList.remove('imp-summary-warn');
    } else {
        _expRenderStep2();
    }
    const body = document.querySelector('#export-modal .modal-body-scroll');
    if (body) body.scrollTop = 0;
}

function exportPickFormat(fmt) {
    _EXP.fmt = fmt;
    _expShowStep(2);
}
function exportBack() { if (!_EXP.busy) _expShowStep(1); }

function exportSetClass(v)   { _EXP.cls = v; _EXP.section = 'ALL'; _expRenderStep2(); }
function exportSetSection(v) { _EXP.section = v; _expRenderStep2(); }
function exportSetOption(key, on) {
    _EXP[key] = !!on;
    if (key === 'archived') {                       /* options (counts) change — drop picks that no longer exist */
        const c = _expClassOptions();
        if (_EXP.cls !== 'ALL' && !c.opts.some(o => o.value === _EXP.cls)) { _EXP.cls = 'ALL'; _EXP.section = 'ALL'; }
        const s = _expSectionOptions();
        if (_EXP.section !== 'ALL' && !s.opts.some(o => o.value === _EXP.section)) _EXP.section = 'ALL';
    }
    _expRenderStep2();
}

function _expRenderStep2() {
    const isXlsx = _EXP.fmt === 'xlsx';
    const c = _expClassOptions(), s = _expSectionOptions();
    const selected = _expSelected();
    const archivedCount = getDatabase().filter(x => !_expIsActive(x)).length;

    const opt = (value, label, count, current) =>
        `<option value="${_impEsc(value)}"${current === value ? ' selected' : ''}>${_impEsc(label)} (${count})</option>`;

    /* A quick breakdown of what will be exported */
    let breakdown = '';
    if (selected.length) {
        const tally = new Map();
        const byClass = _EXP.cls === 'ALL';
        selected.forEach(x => {
            const k = byClass ? (_expClassOf(x) || '(No class)') : (_expSecOf(x) ? `Section ${_expSecOf(x)}` : 'No section');
            tally.set(k, (tally.get(k) || 0) + 1);
        });
        const entries = [...tally.entries()];
        breakdown = `<div class="exp-breakdown"><span class="exp-breakdown-label">${byClass ? 'By class' : 'By section'}</span>` +
            entries.slice(0, 14).map(([k, n]) => `<span class="imp-chip">${_impEsc(k)} · ${n}</span>`).join('') +
            (entries.length > 14 ? `<span class="imp-chip">+ ${entries.length - 14} more</span>` : '') + '</div>';
    }

    document.getElementById('exp-step2').innerHTML = `
        <div class="exp-formatpill">
            <span><i class="fas ${isXlsx ? 'fa-file-excel' : 'fa-file-csv'}"></i> Exporting as <strong>${isXlsx ? 'Excel (.xlsx)' : 'CSV (.csv)'}</strong></span>
            <button type="button" class="imp-link-btn" onclick="exportBack()">Change</button>
        </div>
        <div class="imp-panel exp-panel">
            <div class="imp-panel-title"><i class="fas fa-school"></i> Which students?
                <span class="imp-panel-sub">Choose one class and one section, or export everyone.</span></div>
            <div class="imp-fixed-row">
                <label><span>Class</span>
                    <select class="imp-select imp-big-select" onchange="exportSetClass(this.value)">
                        ${opt('ALL', 'All classes', c.total, _EXP.cls)}
                        ${c.opts.map(o => opt(o.value, o.label + (o.extra ? ' — not in Settings' : ''), o.count, _EXP.cls)).join('')}
                    </select>
                </label>
                <label><span>Section</span>
                    <select class="imp-select imp-big-select" onchange="exportSetSection(this.value)">
                        ${opt('ALL', 'All sections', s.total, _EXP.section)}
                        ${s.opts.map(o => opt(o.value, o.label, o.count, _EXP.section)).join('')}
                    </select>
                </label>
            </div>
            ${breakdown}
        </div>
        <div class="imp-panel exp-panel">
            <div class="imp-panel-title"><i class="fas fa-sliders"></i> Options</div>
            <label class="exp-check"><input type="checkbox" ${_EXP.archived ? 'checked' : ''} onchange="exportSetOption('archived', this.checked)">
                <span>Also include graduated &amp; dropped students <small>${archivedCount} in the archive</small></span></label>
            ${isXlsx ? `<label class="exp-check"><input type="checkbox" ${_EXP.gallery ? 'checked' : ''} onchange="exportSetOption('gallery', this.checked)">
                <span>Also download the photo &amp; B-Form gallery (HTML) <small>A second file with each student’s photo and documents. Takes longer.</small></span></label>` : ''}
        </div>`;

    const sum = document.getElementById('exp-summary');
    const btn = document.getElementById('exp-run-btn');
    const n = selected.length;
    sum.innerHTML = n
        ? `<i class="fas fa-circle-check"></i><span><strong>${n}</strong> student${n === 1 ? '' : 's'} · ${_impEsc(_expClassLabel())} · ${_impEsc(_expSectionLabel())}</span>`
        : `<i class="fas fa-circle-exclamation"></i><span>No students match this choice</span>`;
    sum.classList.toggle('imp-summary-warn', n === 0);
    btn.disabled = n === 0 || _EXP.busy;
    btn.querySelector('span').textContent = n ? `Export ${n} Student${n === 1 ? '' : 's'}` : 'Nothing to Export';
}

/* ---------- building the files ---------- */

/** Headings + rows of the full student directory — the same columns for the Excel sheet and the CSV file. */
function _expBuildDirectory(students, mode) {
    const csv = mode === 'csv';
    const headers = [
        'Reg No', 'Sibling Group ID', 'Full Name', 'Father / Guardian', 'Guardian Role',
        'Guardian CNIC', 'Father Name', 'Father CNIC', 'Gender', 'Date of Birth', 'Age', 'Class', 'Section', 'Roll No',
        'Admission Class', 'Admission Date', 'Phone 1', 'Phone 2', 'Permanent Address', 'Mailing Address',
        'Student B-Form No.', 'Medical Issues',
        'Orphan Status', 'Previous School Attended', 'Previous Class',
        'Transport Mode', 'Transport Type', 'Transport Fee (PKR)',
        'Monthly Tuition Fee (PKR)', 'Annual Fund (PKR)', 'Annual Fund Month',
        'Tuition Discount (PKR)', 'Transport Discount (PKR)', 'Sibling Discount (PKR)',
        'Total Discount (PKR)', 'Discount Type', 'Discount Valid Until',
        'Net Payable (PKR)', 'Has Sibling', 'Sibling Of',
        csv ? 'Has Student Photo' : 'Student Photo (Link)',
        csv ? 'Has B-Form / Certificate' : 'B-Form / Cert (Link)',
        'Status'
    ];
    const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
    const rows = students.map(s => {
        const tuitionDisc   = Number(s.tuitionDiscount)   || 0;
        const transportDisc = Number(s.transportDiscount) || 0;
        const siblingDisc   = Number(s.siblingDiscount)   || 0;
        const totalDiscount = tuitionDisc + transportDisc + siblingDisc;

        const annualFundEnabled = s.annualFundEnabled === 'on' || s.annualFundEnabled === true;
        const annualFund = annualFundEnabled
            ? (s.annualFundAmount != null && s.annualFundAmount !== '' ? Number(s.annualFundAmount) : '')
            : 0;
        const annualFundMonth = annualFundEnabled && s.annualFundMonth
            ? (MONTH_NAMES[Number(s.annualFundMonth)] || s.annualFundMonth)
            : '';
        const discountType = (s.isLifetime === 'on' || s.isLifetime === true)
            ? 'Lifetime'
            : (s.discountExpiry ? 'Temporary' : 'None');

        const hasPhoto = !!storedStudentFileSrc(s, 'photo');
        const hasBform = !!storedStudentFileSrc(s, 'bform');
        const status = s.status === 'graduated' ? 'Graduated' : s.status === 'dropped' ? 'Dropped' : 'Active';

        return [
            s.regNo                         || '',
            s.isSibling && s.siblingGroupId ? s.siblingGroupId : '',
            s.fullName  || s.name           || '',
            s.guardianName || s.fatherName  || '',
            s.guardianRole                  || '',
            s.guardianCnic                  || '',
            s.fatherFullName                || '',
            s.fatherCnic                    || '',
            s.gender                        || '',
            s.dob                           || '',
            s.age                           || '',
            s.studentClass || s.class       || '',
            s.section                       || '',
            s.rollNo                        || '',
            s.admissionClass                || '',
            s.admissionDate                 || '',
            s.phone1                        || '',
            s.phone2                        || '',
            s.permanentAddress || s.address || '',
            s.mailingAddress                || '',
            s.studentBform                  || '',
            s.medicalIssues                 || '',
            s.orphanStatus                  || '',
            s.previousSchool                || '',
            s.previousClass                 || '',
            s.transportMode                 || '',
            s.transportType                 || '',
            s.transportFee != null && s.transportFee !== '' ? Number(s.transportFee) : 0,
            s.standardFee  != null && s.standardFee  !== '' ? Number(s.standardFee)  : '',
            annualFund,
            annualFundMonth,
            tuitionDisc,
            transportDisc,
            siblingDisc,
            totalDiscount,
            discountType,
            s.discountExpiry || (discountType === 'Lifetime' ? 'Lifetime' : ''),
            s.netPayable != null && s.netPayable !== '' ? Number(s.netPayable) : '',
            s.isSibling ? 'Yes' : 'No',
            s.siblingOf || '',
            csv ? (hasPhoto ? 'Yes' : 'No') : (hasPhoto ? '✔ Saved (see Photo Gallery HTML)' : '✘ Not uploaded'),
            csv ? (hasBform ? 'Yes' : 'No') : (hasBform ? '✔ Saved (see Photo Gallery HTML)' : '✘ Not uploaded'),
            status
        ];
    });
    return { headers, rows };
}

/** One CSV cell. Text that a spreadsheet could run as a formula (=, +, -, @ …) is defused with a leading apostrophe —
    a student called "=HYPERLINK(...)" must not become a live formula when the file is opened in Excel. */
function _expCsvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^[+\-]?[\d\s().\-]+$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function _exportCsvFile(students, opts) {
    try {
        const { headers, rows } = _expBuildDirectory(students, 'csv');
        /* BOM + CRLF so Excel opens Urdu / accented names correctly */
        const text = '\uFEFF' + [headers].concat(rows).map(r => r.map(_expCsvCell).join(',')).join('\r\n');
        _impDownloadText(text, opts.fileName + '.csv', 'text/csv;charset=utf-8');
        return { ok: true, file: opts.fileName + '.csv', count: students.length, galleryCount: 0 };
    } catch (err) {
        console.error('CSV export failed', err);
        return { ok: false, error: err.message };
    }
}

/** Replaces stored file paths/URLs on photo + certData with embedded data: URIs (5 downloads at a time). */
async function ssInlineMediaForExport(students) {
    const schoolId = getCurrentSchoolId();
    const toDataUri = async (url) => {
        try {
            const res = await fetch(url);
            if (!res.ok) return '';
            const blob = await res.blob();
            return await fileToDataUri(blob);
        } catch (e) {
            return '';
        }
    };
    const out = students.map(s => Object.assign({}, s));
    let next = 0;
    const worker = async () => {
        while (next < out.length) {
            const s = out[next++];
            const regNo = s.regNo || s.id;
            if (!regNo) continue;
            const base = `${API_BASE}/${encodeURIComponent(regNo)}`;
            const q = `?schoolId=${encodeURIComponent(schoolId || '')}`;
            if (s.photo && !String(s.photo).startsWith('data:')) {
                s.photo = await toDataUri(`${base}/photo${q}`);
            }
            if (s.certData && !String(s.certData).startsWith('data:')) {
                s.certData = await toDataUri(`${base}/bform${q}`);
            }
        }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
    return out;
}

async function _exportExcelFile(selected, opts) {
    if (typeof XLSX === 'undefined') {
        return { ok: false, error: 'Excel library not loaded yet. Please wait a moment and try again.' };
    }
    let students = selected;

    /* The photo gallery needs the complete records (photo + certData inline). Only fetch them when it was asked for. */
    if (opts.gallery) {
        const fullStudents = await fetchFullStudents();
        if (Array.isArray(fullStudents) && fullStudents.length) {
            const fullByRegNo = new Map(fullStudents.map(s => [String(s.regNo || s.id || ''), s]));
            students = students.map(s => {
                const full = fullByRegNo.get(String(s.regNo || s.id || ''));
                return full ? Object.assign({}, s, { photo: full.photo, certData: full.certData }) : s;
            });
        }
    }

    /* The downloaded gallery .html is opened later, offline, from the user's disk, so its images must be
       EMBEDDED. Photos / B-Forms stored as files are fetched (authenticated) and inlined here. */
    if (opts.gallery) {
        students = await ssInlineMediaForExport(students);
    }

    try {
        const wb = XLSX.utils.book_new();

        /* ── Sheet 1: Full Student Directory (all fields) ── */
        const { headers: dirHeaders, rows: dirRows } = _expBuildDirectory(students, 'xlsx');

        const dirData = [dirHeaders, ...dirRows];
        const wsDir   = XLSX.utils.aoa_to_sheet(dirData);
        wsDir['!cols'] = [
            { wch: 12 }, { wch: 14 }, { wch: 26 }, { wch: 26 }, { wch: 16 },
            { wch: 18 }, { wch: 26 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 7  }, { wch: 14 },
            { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
            { wch: 30 }, { wch: 30 }, { wch: 20 }, { wch: 22 },
            { wch: 16 }, { wch: 26 }, { wch: 16 },
            { wch: 16 }, { wch: 14 }, { wch: 18 },
            { wch: 22 }, { wch: 18 }, { wch: 20 },
            { wch: 22 }, { wch: 24 }, { wch: 22 },
            { wch: 20 }, { wch: 16 }, { wch: 22 },
            { wch: 18 }, { wch: 12 }, { wch: 30 },
            { wch: 28 }, { wch: 28 }, { wch: 12 }
        ];
        XLSX.utils.book_append_sheet(wb, wsDir, 'Student Directory');

        /* ── Sheet 2: Discount Breakdown ── */
        const discHeaders = [
            'Reg No', 'Student Name', 'Class',
            'Standard Fee (PKR)', 'Transport Fee (PKR)',
            'Tuition Discount (PKR)', 'Transport Discount (PKR)', 'Sibling Discount (PKR)',
            'Total Discount (PKR)', 'Total Discount (%)',
            'Net Monthly Payable (PKR)', 'Discount Type', 'Valid Until'
        ];

        const discRows = students.map(s => {
            const stdFee        = Number(s.standardFee)     || 0;
            const transFee      = Number(s.transportFee)    || 0;
            const tuitionDisc   = Number(s.tuitionDiscount)   || 0;
            const transportDisc = Number(s.transportDiscount) || 0;
            const siblingDisc   = Number(s.siblingDiscount)   || 0;
            const totalDiscount = tuitionDisc + transportDisc + siblingDisc;
            const grossTotal    = stdFee + transFee;
            const discPct       = grossTotal > 0 ? parseFloat(((totalDiscount / grossTotal) * 100).toFixed(2)) : 0;
            const netPayable    = s.netPayable != null && s.netPayable !== '' ? Number(s.netPayable) : (grossTotal - totalDiscount);

            const discountType  = (s.isLifetime === 'on' || s.isLifetime === true)
                ? 'Lifetime'
                : (s.discountExpiry ? 'Temporary' : (totalDiscount > 0 ? 'Unspecified' : 'None'));

            return [
                s.regNo || '',
                s.fullName || s.name || '',
                s.studentClass || s.class || '',
                stdFee,
                transFee,
                tuitionDisc,
                transportDisc,
                siblingDisc,
                totalDiscount,
                discPct,
                netPayable,
                discountType,
                s.discountExpiry || (discountType === 'Lifetime' ? 'Lifetime' : '—')
            ];
        });

        /* Totals row */
        const totTuition    = discRows.reduce((a, r) => a + (r[5] || 0), 0);
        const totTransport  = discRows.reduce((a, r) => a + (r[6] || 0), 0);
        const totSibling    = discRows.reduce((a, r) => a + (r[7] || 0), 0);
        const totDiscount   = discRows.reduce((a, r) => a + (r[8] || 0), 0);
        const totNet        = discRows.reduce((a, r) => a + (r[10] || 0), 0);

        const discData = [
            discHeaders,
            ...discRows,
            [],
            ['TOTALS', '', '', '', '', totTuition, totTransport, totSibling, totDiscount, '', totNet, '', '']
        ];

        const wsDisc = XLSX.utils.aoa_to_sheet(discData);
        wsDisc['!cols'] = [
            { wch: 12 }, { wch: 26 }, { wch: 14 },
            { wch: 20 }, { wch: 20 },
            { wch: 24 }, { wch: 26 }, { wch: 24 },
            { wch: 22 }, { wch: 20 },
            { wch: 24 }, { wch: 16 }, { wch: 18 }
        ];
        XLSX.utils.book_append_sheet(wb, wsDisc, 'Discount Breakdown');

        /* ── Sheet 3: Class Summary ── */
        const classCounts = {};
        students.forEach(s => {
            const cls = s.studentClass || s.class || 'Unknown';
            classCounts[cls] = (classCounts[cls] || 0) + 1;
        });

        const summaryData = [
            ['Class', 'Total Students', 'Male', 'Female'],
            ...Object.entries(classCounts).map(([cls, total]) => {
                const inClass = students.filter(s => (s.studentClass || s.class || 'Unknown') === cls);
                const male    = inClass.filter(s => (s.gender || '').toLowerCase() === 'male').length;
                const female  = inClass.filter(s => (s.gender || '').toLowerCase() === 'female').length;
                return [cls, total, male, female];
            }),
            [],
            ['TOTAL', students.length,
             students.filter(s => (s.gender || '').toLowerCase() === 'male').length,
             students.filter(s => (s.gender || '').toLowerCase() === 'female').length]
        ];

        const wsSum = XLSX.utils.aoa_to_sheet(summaryData);
        wsSum['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, wsSum, 'Class Summary');

        /* ── Sheet 4: Fee Overview ── */
        const feeHeaders = [
            'Reg No', 'Student Name', 'Class',
            'Monthly Tuition (PKR)', 'Annual Fund (PKR)',
            'Tuition Disc.', 'Transport Disc.', 'Sibling Disc.',
            'Net Monthly (PKR)', 'Total Annual (PKR)'
        ];
        const feeRows = students.map(s => {
            const monthly       = Number(s.standardFee) || 0;
            const tuitionDisc   = Number(s.tuitionDiscount)   || 0;
            const transportDisc = Number(s.transportDiscount) || 0;
            const siblingDisc   = Number(s.siblingDiscount)   || 0;
            const fund = (s.annualFundEnabled === 'on' || s.annualFundEnabled === true)
                ? (Number(s.annualFundAmount) || 0) : 0;
            const net = s.netPayable != null && s.netPayable !== '' ? Number(s.netPayable) : (monthly - tuitionDisc - siblingDisc);
            return [
                s.regNo || '',
                s.fullName || s.name || '',
                s.studentClass || s.class || '',
                monthly,
                fund,
                tuitionDisc,
                transportDisc,
                siblingDisc,
                net,
                net * 12 + fund
            ];
        });
        const feeData = [feeHeaders, ...feeRows];
        const wsFee   = XLSX.utils.aoa_to_sheet(feeData);
        wsFee['!cols'] = [
            { wch: 12 }, { wch: 26 }, { wch: 14 },
            { wch: 20 }, { wch: 18 },
            { wch: 16 }, { wch: 18 }, { wch: 16 },
            { wch: 18 }, { wch: 18 }
        ];
        XLSX.utils.book_append_sheet(wb, wsFee, 'Fee Overview');

        /* ── Sheet 5: Photo Index (text reference since SheetJS CE can't embed images) ── */
        const photoHeaders = [
            '#', 'Reg No', 'Student Name', 'Class',
            'Has Student Photo', 'Has B-Form / Certificate', 'Document Type'
        ];
        const photoRows = students.map((s, i) => {
            const hasPhoto = !!storedStudentFileSrc(s, 'photo');
            const hasBform = !!storedStudentFileSrc(s, 'bform');
            const docType  = hasBform
                ? (/\.pdf(?:$|[?#])/i.test(s.certData || '') ? 'PDF' : 'Image')
                : '—';
            return [
                i + 1,
                s.regNo || '',
                s.fullName || s.name || '',
                s.studentClass || s.class || '',
                hasPhoto ? 'YES ✔' : 'NO ✘',
                hasBform ? 'YES ✔' : 'NO ✘',
                docType
            ];
        });

        const photoData = [photoHeaders, ...photoRows];
        const wsPhoto   = XLSX.utils.aoa_to_sheet(photoData);
        wsPhoto['!cols'] = [
            { wch: 5 }, { wch: 12 }, { wch: 26 }, { wch: 14 },
            { wch: 20 }, { wch: 26 }, { wch: 14 }
        ];
        XLSX.utils.book_append_sheet(wb, wsPhoto, 'Photo Index');

        /* ── Metadata ── */
        const now = new Date();
        const exportedOn = now.toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' })
                         + '  ' + now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });

        const studentsWithPhotos = students.filter(s => storedStudentFileSrc(s, 'photo')).length;
        const studentsWithBforms = students.filter(s => storedStudentFileSrc(s, 'bform')).length;
        const studentsWithDiscount = students.filter(s =>
            (Number(s.tuitionDiscount) || 0) + (Number(s.transportDiscount) || 0) + (Number(s.siblingDiscount) || 0) > 0
        ).length;

        const metaData = [
            ['SoftSchool — Student Data Export'],
            [],
            ['School', 'ST. LAWRENCE INTERNATIONAL SCHOOL'],
            ['Exported On', exportedOn],
            ['Total Students', students.length],
            ['Class', opts.clsLabel || 'All classes'],
            ['Section', opts.secLabel || 'All sections'],
            ['Includes graduated / dropped students', opts.archived ? 'Yes' : 'No'],
            ['Students with Photos', studentsWithPhotos],
            ['Students with B-Form / Certificate', studentsWithBforms],
            ['Students with Active Discounts', studentsWithDiscount],
            ['Exported By', 'SoftSchool v2.0'],
            [],
            ['NOTES'],
            ['• Student photos and B-Form images are embedded in the companion HTML gallery file.'],
            ['• Open "SoftSchool (Student Photos).html" alongside this Excel file to view all images.'],
            ['• The "Discount Breakdown" sheet shows itemised discounts per student.'],
            ['• Photo Index sheet lists which students have uploaded photos/documents.']
        ];
        const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
        wsMeta['!cols'] = [{ wch: 38 }, { wch: 46 }];
        XLSX.utils.book_append_sheet(wb, wsMeta, 'Export Info');

        /* ── Trigger Excel download ── */
        XLSX.writeFile(wb, opts.fileName + '.xlsx');

        /* ── Photo Gallery HTML (optional) ── */
        let galleryCount = 0;
        if (opts.gallery) {
            const studentsWithAnyMedia = students.filter(s =>
                storedStudentFileSrc(s, 'photo') ||
                storedStudentFileSrc(s, 'bform')
            );
            galleryCount = studentsWithAnyMedia.length;
            if (galleryCount > 0) {
                const galleryHtml = _buildPhotoGalleryHTML(students);
                const blob = new Blob([galleryHtml], { type: 'text/html;charset=utf-8' });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = opts.fileName.replace('(Student Data)', '(Student Photos)') + '.html';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            }
        }
        return { ok: true, file: opts.fileName + '.xlsx', count: students.length, galleryCount };

    } catch (err) {
        console.error('Export failed', err);
        return { ok: false, error: err.message };
    }
}

/** The "Export" button of the dialog. */
async function runExport() {
    if (_EXP.busy) return;
    const selected = _expSelected();
    if (!selected.length) return;

    const btn = document.getElementById('exp-run-btn');
    const label = btn.querySelector('span');
    _EXP.busy = true;
    btn.disabled = true;
    document.getElementById('exp-back-btn').disabled = true;
    label.textContent = _EXP.fmt === 'xlsx' && _EXP.gallery ? 'Preparing files…' : 'Preparing file…';

    const opts = {
        fileName: _expFileBase(), gallery: _EXP.gallery, archived: _EXP.archived,
        clsLabel: _expClassLabel(), secLabel: _expSectionLabel()
    };
    const scope = `${_impEsc(_expClassLabel())} · ${_impEsc(_expSectionLabel())}`;
    let result;
    try {
        result = _EXP.fmt === 'csv' ? _exportCsvFile(selected, opts) : await _exportExcelFile(selected, opts);
    } catch (err) {
        result = { ok: false, error: err && err.message ? err.message : String(err) };
    }

    _EXP.busy = false;
    document.getElementById('exp-back-btn').disabled = false;
    closeExportDialog();

    if (!result.ok) {
        showDataIOStatus('Export failed: ' + _impEsc(result.error), 'error');
        return;
    }
    let msg = `✓ Export successful! <strong>${result.count} student record(s)</strong> (${scope}) saved to <em>${_impEsc(result.file)}</em>.`;
    if (_EXP.fmt === 'xlsx') {
        msg += ' It includes the directory, discount breakdown, class summary, fee overview and photo index.';
        if (_EXP.gallery) {
            msg += result.galleryCount > 0
                ? ` A companion photo gallery (HTML) was also downloaded for <strong>${result.galleryCount}</strong> student(s).`
                : ' No student photos or B-Form images were found, so no gallery was created.';
        }
    }
    showDataIOStatus(msg + ' Check your Downloads folder.', 'success');
}

/* ============================================================
   IMPORT — Excel / CSV / PDF → students, saved class by class (see the notes in each section).

   1. importStudentsFromExcel(event)  reads the file: EVERY sheet that has
      data, each with its own heading row (auto-detected, adjustable).
   2. The mapping screen lets the user decide
        • which sheets to include,
        • where each student's CLASS comes from — a column in the file,
          the sheet name (one sheet per class), or one class for everyone,
        • how every class value in the file maps to a class in Settings,
        • which file column feeds each SoftSchool field,
        • what to do with students that already exist, and how to order
          roll numbers inside each class.
   3. buildImportPlan() turns all of that into the exact list of students to
      create / update. The live "Save plan" preview and the real import both
      use that same plan, so what is previewed is what gets saved.
   4. runStudentImport() saves the plan class by class.
   ============================================================ */

const IMPORT_FIELD_GROUPS = [
    { title: 'Academic & System Details', icon: 'fa-university', fields: [
        { key: 'regNo', label: 'Registration No.', hint: 'Auto-generated if not matched or left empty',
          aliases: ['regno', 'registrationno', 'registrationnumber', 'regnumber', 'reg#', 'studentid', 'admissionno', 'admissionnumber', 'grno', 'grnumber'] },
        { key: 'studentClass', label: 'Class / Grade', required: true, special: 'class',
          aliases: ['class', 'grade', 'classgrade', 'studentclass', 'currentclass', 'classname', 'standard'] },
        { key: 'admissionClass', label: 'Admission Class', hint: 'The class the student was first admitted in — saved as Admission Class',
          aliases: ['admissionclass', 'classatadmission', 'classofadmission', 'admittedclass', 'admittedinclass', 'joiningclass', 'classatjoining', 'entryclass', 'enrolmentclass', 'enrollmentclass', 'admissiongrade'] },
        { key: 'section', label: 'Section',
          aliases: ['section', 'sec', 'classsection', 'division'] },
        { key: 'rollNo', label: 'Roll Number', hint: 'Auto-numbered per class if not matched',
          aliases: ['rollno', 'rollnumber', 'roll', 'roll#'] },
        { key: 'admissionDate', label: 'Admission Date', hint: "Today's date if not matched",
          aliases: ['admissiondate', 'dateofadmission', 'doa', 'joiningdate', 'dateofjoining', 'enrolmentdate', 'enrollmentdate'] }
    ]},
    { title: 'Personal Information', icon: 'fa-user', fields: [
        { key: 'fullName', label: 'Student Full Name', required: true,
          aliases: ['fullname', 'studentname', 'studentsname', 'nameofstudent', 'studentfullname', 'name', 'pupilname', 'childname', 'childsname', 'nameofchild', 'student'] },
        { key: 'firstName', label: 'First Name', hint: 'Only if the name is split — joined with Last Name',
          aliases: ['firstname', 'givenname', 'forename', 'studentfirstname'] },
        { key: 'lastName', label: 'Last Name', hint: 'Only if the name is split — joined after First Name',
          aliases: ['lastname', 'surname', 'familyname', 'lname', 'studentlastname'] },
        { key: 'gender', label: 'Gender', aliases: ['gender', 'sex'] },
        { key: 'dob', label: 'Date of Birth',
          aliases: ['dateofbirth', 'dob', 'birthdate', 'birthday', 'bday'] },
        { key: 'studentBform', label: 'Student B-Form / CNIC No.',
          aliases: ['studentbformno', 'studentbform', 'bform', 'bformno', 'bformnumber', 'formb', 'studentcnic', 'bformcnic'] },
        { key: 'medicalIssues', label: 'Medical Issues / Allergies',
          aliases: ['medicalissues', 'medical', 'allergies', 'medicalcondition', 'medicalconditions', 'health'] },
        { key: 'orphanStatus', label: 'Orphan Status', aliases: ['orphanstatus', 'orphan', 'isorphan'] },
        { key: 'previousSchool', label: 'Previous School Attended',
          aliases: ['previousschoolattended', 'previousschool', 'lastschool', 'schoolattended', 'formerschool'] },
        { key: 'previousClass', label: 'Previous Class',
          aliases: ['previousclass', 'lastclass', 'classattended', 'lastclassattended'] }
    ]},
    { title: 'Guardian Information', icon: 'fa-users', fields: [
        { key: 'guardianName', label: 'Guardian Full Name',
          aliases: ['fatherguardian', 'guardianname', 'guardianfullname', 'father', 'guardian', 'parentname', 'parent', 'fatherorguardian', 'guardiansname', 'fatherguardianname', 'fname'] },
        { key: 'guardianRole', label: 'Guardian Relation / Role',
          aliases: ['guardianrole', 'guardianrelation', 'relation', 'relationship', 'guardianrelationship', 'relationwithstudent'] },
        { key: 'guardianCnic', label: 'Guardian CNIC Number',
          aliases: ['guardiancnic', 'parentcnic', 'cnic', 'guardiannic', 'cnicno', 'cnicnumber',
                    'cnicofguardian', 'cnicofparent', 'cnicguardian', 'guardianscnic', 'guardiancnicno'] }
    ]},
    { title: 'Father Details', icon: 'fa-user-tie', fields: [
        { key: 'fatherFullName', label: 'Father Full Name', hint: 'Used to detect siblings',
          aliases: ['fatherfullname', 'fathername', 'nameoffather', 'fathersname', 'fatherlegalname', 'fatherdetailsname'] },
        { key: 'fatherCnic', label: 'Father CNIC Number', hint: 'Used to detect siblings',
          aliases: ['fathercnic', 'fathercnicnumber', 'fathercnicno', 'fathernic', 'cnicoffather', 'cnicfather', 'fatherscnic', 'fatherdetailscnic'] }
    ]},
    { title: 'Contact & Address', icon: 'fa-phone-alt', fields: [
        { key: 'phone1', label: 'Primary Phone',
          aliases: ['phone1', 'primaryphone', 'phone', 'mobile', 'mobileno', 'contactno', 'contact', 'phonenumber', 'mobilenumber', 'cell', 'cellno', 'whatsapp', 'contactnumber', 'mobile1', 'fathermobile', 'parentmobile', 'guardianmobile', 'guardianphone', 'fathercontact', 'parentcontact', 'guardiancontact', 'fatherphone'] },
        { key: 'phone2', label: 'Secondary Phone',
          aliases: ['phone2', 'secondaryphone', 'alternatephone', 'alternativephone', 'altphone', 'phonealt', 'mobile2', 'contact2', 'othercontact', 'emergencycontact'] },
        { key: 'permanentAddress', label: 'Permanent Address',
          aliases: ['permanentaddress', 'permanentadd', 'address', 'addresses', 'homeaddress', 'residentialaddress', 'residence', 'presentaddress', 'residentaddress', 'fulladdress', 'studentaddress', 'addressline1', 'address1', 'addr', 'homeadd', 'resadd'] },
        { key: 'mailingAddress', label: 'Mailing Address', hint: 'Copies Permanent Address if not matched',
          aliases: ['mailingaddress', 'postaladdress', 'correspondenceaddress', 'currentaddress'] }
    ]},
    { title: 'Transport', icon: 'fa-bus', fields: [
        { key: 'transportMode', label: 'Transport Mode',
          aliases: ['transportmode', 'transport', 'transportfacility', 'conveyance'] },
        { key: 'transportType', label: 'Vehicle Type', aliases: ['transporttype', 'vehicletype', 'vehicle'] },
        { key: 'transportFee', label: 'Transport Monthly Fee',
          aliases: ['transportfeepkr', 'transportfee', 'transportcharges', 'vanfee', 'busfee', 'transportmonthlyfee'] }
    ]},
    { title: 'Fees & Discounts', icon: 'fa-file-invoice-dollar', fields: [
        { key: 'standardFee', label: 'Standard Tuition Fee', hint: 'Uses the class fee from Settings if not matched',
          aliases: ['monthlytuitionfeepkr', 'tuitionfee', 'monthlyfee', 'standardfee', 'fee', 'fees', 'monthlytuitionfee', 'tuition', 'schoolfee', 'monthlyfees', 'feepermonth', 'tuitionfees'] },
        { key: 'admissionFee', label: 'Admission Fee',
          aliases: ['admissionfee', 'admissioncharges', 'registrationfee'] },
        { key: 'tuitionDiscount', label: 'Tuition Discount',
          aliases: ['tuitiondiscountpkr', 'tuitiondiscount', 'discount', 'feediscount', 'concession'] },
        { key: 'transportDiscount', label: 'Transport Discount',
          aliases: ['transportdiscountpkr', 'transportdiscount'] },
        { key: 'siblingDiscount', label: 'Sibling Discount',
          aliases: ['siblingdiscountpkr', 'siblingdiscount', 'siblingconcession'] }
    ]}
];
const IMPORT_ALL_FIELDS = IMPORT_FIELD_GROUPS.flatMap(g => g.fields);
const IMP_SKIP = '__skip__', IMP_KEEP = '__keep__';
/* Limits and required fields copied from the admission form's ADMISSION_SCHEMA, so imported students follow the same rules. */
const IMP_MAX_LEN = { fullName: 80, guardianName: 80, fatherFullName: 80, previousSchool: 120, previousClass: 40, admissionClass: 40, medicalIssues: 300, permanentAddress: 300, mailingAddress: 300 };
const IMP_FORM_REQUIRED = ['guardianName', 'studentBform', 'guardianCnic', 'phone1', 'permanentAddress', 'dob'];

/* Everything the mapping screen needs; filled in when a file is analyzed. */
let importState = null;

function _impEsc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _impNorm(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9#]+/g, ''); }
function _impCellText(v) {
    if (v == null) return '';
    if (v instanceof Date) return isNaN(v) ? '' : _impToIsoDate(v);
    return String(v).trim();
}
function _impFilled(row) { return row.filter(c => _impCellText(c) !== '').length; }

/* ---------- 0. PDF SUPPORT ----------
   A PDF has no real "cells" — only pieces of text at x/y positions. So we
   rebuild the table from the layout:
     1. read every text piece with its position (pdf.js, loaded on demand),
     2. group pieces into lines by their vertical position,
     3. find the columns from the vertical white gaps that run through all
        the table rows,
     4. put every piece into its column, join wrapped cells (e.g. a long
        address on two lines), drop repeated page headings / footers,
     5. hand the rebuilt table to the same mapping screen as Excel/CSV.
   Works for PDFs that contain real (selectable) text. Scanned PDFs are
   pictures of text and would need OCR, which this page does not do. */

const PDFJS_VERSION = '3.11.174';
const PDFJS_LIB_URL    = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
let _pdfJsPromise = null;

function _impLoadPdfJs() {
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return Promise.resolve(window.pdfjsLib);
    }
    if (!_pdfJsPromise) {
        _pdfJsPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = PDFJS_LIB_URL;
            s.onload = () => {
                if (!window.pdfjsLib) { _pdfJsPromise = null; return reject(new Error('The PDF reader did not start correctly.')); }
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
                resolve(window.pdfjsLib);
            };
            s.onerror = () => { _pdfJsPromise = null; reject(new Error('Could not load the PDF reader. Please check your internet connection and try again.')); };
            document.head.appendChild(s);
        });
    }
    return _pdfJsPromise;
}

/** Every text piece of every page: [{ s, x0, x1, y, h }]. */
async function _impReadPdfPages(file) {
    const lib = await _impLoadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    let pdf;
    try { pdf = await lib.getDocument({ data }).promise; }
    catch (err) {
        if (err && err.name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password and try again.');
        throw err;
    }
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        showDataIOStatus(`Reading PDF page ${i} of ${pdf.numPages}…`, 'info');
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const items = [];
        tc.items.forEach(it => {
            if (!it.str || !it.str.trim()) return;
            const [a, b, , d, e, f] = it.transform;
            if (Math.abs(b) > Math.abs(a) * 0.5) return;          /* skip rotated text */
            const h = it.height || Math.abs(d) || 10;
            const w = it.width > 0 ? it.width : it.str.length * h * 0.5;
            items.push({ s: it.str.trim(), x0: e, x1: e + w, y: f, h });
        });
        pages.push(items);
    }
    return pages;
}

const _pdfMedian = arr => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

function _pdfGroupLines(items) {
    const sorted = items.slice().sort((a, b) => b.y - a.y || a.x0 - b.x0);
    const lines = [];
    sorted.forEach(it => {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - it.y) <= Math.max(2, 0.45 * Math.min(last.h, it.h))) {
            last.items.push(it); last.h = Math.max(last.h, it.h);
        } else lines.push({ y: it.y, h: it.h, items: [it] });
    });
    lines.forEach(l => l.items.sort((a, b) => a.x0 - b.x0));
    return lines;
}

/** Pieces closer than a word-space belong to one cell. */
function _pdfCells(line) {
    const cells = [];
    line.items.forEach(it => {
        const c = cells[cells.length - 1];
        if (c && it.x0 - c.x1 < 0.6 * line.h) {
            c.s += (it.x0 - c.x1 > 0.08 * line.h ? ' ' : '') + it.s;
            c.x1 = Math.max(c.x1, it.x1);
        } else cells.push({ s: it.s, x0: it.x0, x1: it.x1 });
    });
    return cells;
}

/** Rebuild one page's table into rows of column texts. Returns null if the page has no table. */
function _pdfPageToRows(items) {
    const lines = _pdfGroupLines(items);
    if (!lines.length) return null;
    lines.forEach(l => { l.cells = _pdfCells(l); });

    /* How many columns does the table have? The most common cell-count among lines with 2+ cells. */
    const freq = {};
    lines.forEach(l => { if (l.cells.length >= 2) freq[l.cells.length] = (freq[l.cells.length] || 0) + 1; });
    const keys = Object.keys(freq).map(Number);
    if (!keys.length) return null;
    const big = keys.filter(k => k >= 3);
    const pool = big.length ? big : keys;
    const N = pool.reduce((best, k) => (freq[k] > freq[best] || (freq[k] === freq[best] && k > best)) ? k : best, pool[0]);
    const thr = Math.max(2, Math.round(N * 0.6));
    lines.forEach(l => { l.isData = l.cells.length >= thr; });
    const dataLines = lines.filter(l => l.isData);
    if (dataLines.length < 2) return null;

    /* Column regions = x-ranges covered by text on the table rows; the empty vertical gaps between them are the gutters. */
    const h = _pdfMedian(dataLines.map(l => l.h));
    const minGap = Math.max(3, 0.35 * h);
    const spans = [];
    dataLines.forEach(l => l.items.forEach(it => spans.push([it.x0, it.x1])));
    spans.sort((a, b) => a[0] - b[0]);
    const cols = [];
    spans.forEach(sp => {
        const c = cols[cols.length - 1];
        if (c && sp[0] - c[1] < minGap) c[1] = Math.max(c[1], sp[1]); else cols.push([sp[0], sp[1]]);
    });
    const bounds = [];                                   /* boundary between column i and i+1 */
    for (let i = 0; i < cols.length - 1; i++) bounds.push((cols[i][1] + cols[i + 1][0]) / 2);
    const colOf = it => { const c = (it.x0 + it.x1) / 2; let i = 0; while (i < bounds.length && c >= bounds[i]) i++; return i; };

    const toRow = line => {
        const row = new Array(cols.length).fill('');
        const last = new Array(cols.length).fill(null);
        line.items.forEach(it => {
            const i = colOf(it);
            if (last[i] === null) row[i] = it.s;
            else row[i] += (it.x0 - last[i] > 0.08 * line.h ? ' ' : '') + it.s;
            last[i] = it.x1;
        });
        return row;
    };

    /* Row pitch = typical distance between table rows; tighter lines are wrapped text of the row above. */
    const pitches = [];
    for (let i = 1; i < dataLines.length; i++) pitches.push(dataLines[i - 1].y - dataLines[i].y);
    const pitch = _pdfMedian(pitches) || (h * 1.6);

    const rows = [];
    let started = false, prev = null;
    const titleLines = [];
    lines.forEach(l => {
        if (l.isData) { rows.push(toRow(l)); started = true; }
        else if (!started) { titleLines.push(l.items.map(i => i.s).join(' ')); }
        else if (prev && (prev.y - l.y) < 0.9 * pitch && rows.length) {
            const extra = toRow(l), r = rows[rows.length - 1];
            extra.forEach((t, i) => { if (t) r[i] = r[i] ? r[i] + ' ' + t : t; });
        }
        prev = l;
    });
    return { rows, ncols: cols.length, titleLines };
}

const _pdfIsNumeric = t => /^[\d\s.,\-\/#:]+$/.test(t);
/** A heading row has words, and none of its cells is a plain number. */
function _pdfLooksLikeHeader(row) {
    const filled = row.filter(c => c !== '');
    if (filled.length < 2) return false;
    if (filled.some(_pdfIsNumeric)) return false;
    return filled.filter(c => /[A-Za-z\u0600-\u06FF]/.test(c)).length / filled.length >= 0.7;
}
function _pdfSameHeader(a, b) {
    if (a.length !== b.length) return false;
    let same = 0, total = 0;
    a.forEach((t, i) => { if (t || b[i]) { total++; if (_impNorm(t) === _impNorm(b[i])) same++; } });
    return total > 0 && same / total >= 0.6;
}
/** "Class: Grade 2" / "Grade 2" printed above a table → the class name. */
function _pdfClassFromTitle(titleLines) {
    for (const line of titleLines) {
        const cands = [line, line.split(':').pop(), (line.match(/\b(?:class|grade|std|standard)\s*[:\-]?\s*[A-Za-z0-9]+/i) || [''])[0]];
        for (const c of cands) {
            if (!c || !c.trim()) continue;
            const m = _impMatchClass(c.trim());
            if (m.known && m.value) return m.value;
        }
    }
    return '';
}

/** All pages → sheets (one per distinct table; repeated headings and continued tables are merged). */
function _pdfBuildSheets(pages) {
    const tables = [];
    pages.forEach((items, pi) => {
        const pr = _pdfPageToRows(items);
        if (!pr) return;
        let rows = pr.rows;
        const first = rows[0];
        const headerLike = _pdfLooksLikeHeader(first);
        const prevTable = tables[tables.length - 1];
        const titleClass = _pdfClassFromTitle(pr.titleLines) || (prevTable ? prevTable.titleClass : '');

        let target = null;
        for (const t of tables) {                              /* same heading repeated on a later page */
            if (t.header && t.ncols === pr.ncols && t.titleClass === titleClass && _pdfSameHeader(t.header, first)) { target = t; rows = rows.slice(1); break; }
        }
        if (!target && !headerLike && prevTable && prevTable.ncols === pr.ncols && prevTable.titleClass === titleClass) target = prevTable; /* continued, no heading */
        if (!target) {
            if (!headerLike) rows = [first.map((_, i) => `Column ${i + 1}`)].concat(rows);
            target = { pages: [], rows: [], header: headerLike ? first : null, ncols: pr.ncols, titleClass };
            tables.push(target);
        }
        target.pages.push(pi + 1);
        target.rows.push(...rows);
    });

    return tables.map((t, i) => {
        const span = t.pages.length > 1 ? `Pages ${t.pages[0]}–${t.pages[t.pages.length - 1]}` : `Page ${t.pages[0]}`;
        const name = t.titleClass || (tables.length === 1 ? 'PDF table' : span);
        return { name, grid: t.rows, rowOffset: 0, headerRow: null, include: true };
    });
}

async function _impReadPdf(file) {
    const pages = await _impReadPdfPages(file);
    const pieces = pages.reduce((n, p) => n + p.length, 0);
    if (pieces < 5) {
        throw new Error('This PDF has no selectable text — it looks like a scanned picture. Scanned PDFs need OCR, which this page can’t do. Please use the original Excel/CSV file, or export the PDF from the program that created it');
    }
    const sheets = _pdfBuildSheets(pages);
    if (!sheets.length) {
        throw new Error('No table was found in this PDF. It should contain a heading row followed by student rows, with each column lined up');
    }
    return sheets;
}

/* ---------- 0b. FILE READERS & HELPERS (CSV, Excel formats, template, report) ---------- */

/** Decode a text file's bytes: UTF-8 (with or without BOM), UTF-16, or Excel's Windows-1252 as a fallback. */
function _impDecodeBytes(u8) {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) { return new TextDecoder('windows-1252').decode(u8); }
}

/** A proper CSV reader: sniffs , ; tab | delimiters, handles "quoted, cells", "" escapes and line breaks inside quotes.
    Every value stays TEXT, so 0012 stays 0012 and 03/04/2016 is not turned into a US date. */
function _impParseCsv(text) {
    text = text.replace(/^\uFEFF/, '');
    let delim = null;
    const sepLine = text.match(/^sep=(.)\r?\n/i);               /* Excel's "sep=;" hint line */
    if (sepLine) { delim = sepLine[1]; text = text.slice(sepLine[0].length); }
    if (!delim) {
        const sample = text.slice(0, 10000).split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 12);
        let bestScore = -1; delim = ',';
        [',', ';', '\t', '|'].forEach(d => {
            const counts = sample.map(l => { let n = 0, q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; });
            if (!counts.length || counts[0] === 0) return;
            const score = counts.filter(c => c === counts[0]).length * 1000 + counts[0];
            if (score > bestScore) { bestScore = score; delim = d; }
        });
    }
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
            else cell += ch;
        } else if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; }
        else if (ch === delim) { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

/** Excel sheet → grid. Numbers that the author formatted as 0000 / 00000000000 / 00000-0000000-0 keep their
    displayed text (leading zeros, dashes), so Registration Nos, phone numbers and CNICs are not mangled. */
function _impSheetGrid(ws) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: true });
    for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[i].length; j++) {
            if (typeof grid[i][j] !== 'number') continue;
            const c = ws[XLSX.utils.encode_cell({ r: range.s.r + i, c: range.s.c + j })];
            if (c && c.t === 'n' && typeof c.z === 'string' && c.w && c.z.length >= 2 &&
                /^[0#\-\s()+.]+$/.test(c.z) && c.w !== String(grid[i][j])) grid[i][j] = c.w.trim();
        }
    }
    return grid;
}

function _impColLetter(i) {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
}

function _impLev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[n];
}

/* Every heading we recognise (normalised) — used to find the real heading row in a sheet. */
function _impAliasSet() {
    if (!_impAliasSet.cache) {
        const s = new Set();
        IMPORT_ALL_FIELDS.forEach(f => [f.label, f.key].concat(f.aliases).forEach(a => s.add(_impNorm(a))));
        _impAliasSet.cache = s;
    }
    return _impAliasSet.cache;
}
function _impRowHeaderHits(row) {
    const set = _impAliasSet();
    let n = 0;
    row.forEach(c => {
        const t = _impNorm(_impCellText(c));
        if (!t) return;
        if (set.has(t)) n += 1;
        else if (t.length >= 5) { for (const a of set) { if (a.length >= 5 && t.includes(a)) { n += 0.5; break; } } }
    });
    return n;
}
function _impRowLooksLikeHeader(row) { return _pdfLooksLikeHeader(row.map(_impCellText)); }

/** Which row holds the headings? The one (in the first 30 rows) that best matches known headings — so title rows
    like "School: …   Date: …" above the real headings are skipped. */
function _impPickHeaderRow(grid) {
    let best = -1, bestScore = 0;
    const lim = Math.min(grid.length, 30);
    for (let i = 0; i < lim; i++) {
        const row = grid[i];
        if (_impFilled(row) < 2) continue;
        const score = _impRowHeaderHits(row) * 3 + (_impRowLooksLikeHeader(row) ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best !== -1) return { idx: best, hits: _impRowHeaderHits(grid[best]), like: _impRowLooksLikeHeader(grid[best]) };
    let first = grid.findIndex(r => _impFilled(r) >= 2);
    if (first === -1) first = grid.findIndex(r => _impFilled(r) >= 1);
    return { idx: first === -1 ? 0 : first, hits: 0, like: false };
}

/* ---- saved column matching (so the same file layout maps itself next time) ---- */
function _impSig(headers) {
    const s = headers.map(_impNorm).filter(Boolean).sort().join('|');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + '-' + headers.length;
}
function _impLoadSaved(headers) {
    try { const raw = localStorage.getItem('softschool-import-map-v1:' + _impSig(headers)); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
}
function _impSaveMapping(st) {
    try {
        localStorage.setItem('softschool-import-map-v1:' + _impSig(st.headers),
            JSON.stringify({ mapping: st.mapping, classMode: st.classMode !== 'fixed' ? st.classMode : null }));
    } catch (e) { /* storage unavailable — not important */ }
}

/** Fill the fields that headings could not explain by looking at what the columns CONTAIN. */
function _impInferByContent() {
    const st = importState;
    const configs = getClassConfigs();
    const used = () => new Set(Object.values(st.mapping));
    const free = st.headers.filter(h => !used().has(h));
    if (!free.length || !st.records.length) return;

    const sampleOf = h => {
        const out = [];
        for (const rec of st.records) {
            const t = _impCellText(rec.vals[h]);
            if (t !== '') out.push({ raw: rec.vals[h], t });
            if (out.length >= 60) break;
        }
        return out;
    };
    const frac = (arr, fn) => arr.length ? arr.filter(fn).length / arr.length : 0;
    const distinctRatio = arr => new Set(arr.map(x => x.t.toLowerCase())).size / (arr.length || 1);
    const take = (key, h) => {
        if (st.mapping[key] !== undefined || used().has(h)) return false;
        st.mapping[key] = h; st.auto[key] = 'content'; return true;
    };
    const digits = t => t.replace(/\D/g, '');
    const nameCandidates = [];
    const need = Math.min(3, st.records.length);

    free.forEach(h => {
        const s = sampleOf(h);
        if (s.length < need) return;

        if (frac(s, x => digits(x.t).length === 13 && /^[\d\-\s]+$/.test(x.t)) >= 0.7) { take('guardianCnic', h) || take('studentBform', h); return; }
        if (frac(s, x => /^(\+?92|0)?3\d{9}$/.test(digits(x.t)) && /^[\d\-\s+()]+$/.test(x.t)) >= 0.7) { take('phone1', h) || take('phone2', h); return; }
        if (frac(s, x => /^(m|f|male|female|boy|girl)$/i.test(x.t)) >= 0.8) { take('gender', h); return; }

        const isDateish = x => x.raw instanceof Date || (typeof x.raw === 'number' && x.raw > 20000 && x.raw < 60000) ||
                               /^\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}$/.test(x.t);
        if (frac(s, isDateish) >= 0.8) {
            const years = s.map(x => parseInt(_impToIsoDate(x.raw).slice(0, 4), 10)).filter(Boolean);
            const older = years.length && _pdfMedian(years) <= new Date().getFullYear() - 3;
            if (older) { take('dob', h) || take('admissionDate', h); } else { take('admissionDate', h) || take('dob', h); }
            return;
        }
        if (configs.length && frac(s, x => { const m = _impMatchClass(x.t); return m.known && m.value; }) >= 0.8 &&
            (frac(s, x => /[A-Za-z]/.test(x.t)) >= 0.5 || distinctRatio(s) <= 0.6)) { take('studentClass', h); return; }
        if (frac(s, x => /^[A-Za-z]$/.test(x.t)) >= 0.8 && new Set(s.map(x => x.t.toUpperCase())).size <= 8) { take('section', h); return; }
        const nums = s.map(x => parseFloat(x.t.replace(/,/g, ''))).filter(n => !isNaN(n));
        if (nums.length / s.length >= 0.8 && _pdfMedian(nums) >= 300 && _pdfMedian(nums) <= 100000 &&
            frac(s, x => /^[\d,]+(\.\d+)?$/.test(x.t)) >= 0.8 && distinctRatio(s) <= 0.7) { take('standardFee', h); return; }
        if (frac(s, x => /^[\p{L}][\p{L} .'\-]+$/u.test(x.t) && x.t.length >= 3) >= 0.85) {
            nameCandidates.push({ h, ratio: distinctRatio(s) });
        }
    });

    /* Names, left to right: the first mostly-unique text column is the student, the next is the guardian. */
    const stud = nameCandidates.find(c => c.ratio >= 0.7);
    if (stud && st.mapping.fullName === undefined && st.mapping.firstName === undefined) take('fullName', stud.h);
    const guard = nameCandidates.find(c => c.h !== (stud && stud.h) && c.ratio >= 0.3);
    if (guard) take('guardianName', guard.h);
}

/* ---- downloads ---- */
function _impDownloadText(text, fileName, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function _impCsvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Report of everything that was skipped, failed or looked wrong (opens in Excel). */
function _impBuildReportCsv(plan, extra) {
    const rows = [];
    plan.skipped.forEach(s => rows.push({ n: s.rowNo, a: [s.rowNo, s.sheet, s.name, 'Skipped', '', '', s.reason] }));
    plan.issueList.forEach(i => rows.push({ n: i.rowNo, a: [i.rowNo, i.sheet, i.name, 'Check', i.label, i.value, i.problem] }));
    (extra || []).forEach(f => rows.push({ n: f.rowNo, a: [f.rowNo, f.sheet, f.name, f.status, '', '', f.reason] }));
    if (!rows.length) return '';
    rows.sort((x, y) => (x.n || 0) - (y.n || 0));
    const head = ['Row in file', 'Sheet', 'Student', 'Status', 'Field', 'Value', 'Details'];
    return '\uFEFF' + [head].concat(rows.map(r => r.a)).map(r => r.map(_impCsvCell).join(',')).join('\r\n');
}
function downloadImportReport() {
    if (!importState || !importState.plan) return;
    const csv = _impBuildReportCsv(importState.plan, []);
    if (csv) _impDownloadText(csv, 'import-report.csv', 'text/csv;charset=utf-8');
}
function downloadLastImportReport() {
    if (window._impLastReportCsv) _impDownloadText(window._impLastReportCsv, 'import-report.csv', 'text/csv;charset=utf-8');
}

/* ============================================================
   TEMPLATES — "Download template" on the Import and Export cards.

   Both cards open the same small dialog (Excel or CSV). What gets downloaded:
     • IMPORT template  – the columns the importer accepts, 2 example rows, a field guide
                          and instructions on how to import.
     • EXPORT template  – the real export layout (same columns, same order as an export),
                          2 example rows, a field guide and a description of what an
                          export contains.
   Everything is generated from TEMPLATE_FIELDS so the guide always matches the code.
   Example rows start with "#" in the first cell; the importer ignores rows like that.
   ============================================================ */

/* col = heading in the Excel export · csvCol = heading in the CSV export (when different)
   imp / exp = used by the importer / present in the export
   req = how important it is when importing · fmt (or fmtImp / fmtExp) = format · impNote = what happens when empty
   src = where an exported value comes from · back = can an exported value be imported again */
const TEMPLATE_FIELDS = [
    { col: 'Reg No', imp: true, exp: true, req: 'Optional', fmt: 'Text, e.g. PSC_26_1',
      impNote: 'Empty → a Registration No. is created for you. When you choose “Update them” while importing, it is used to find the existing student.',
      src: 'The registration number saved on the student', back: 'Yes' },
    { col: 'Sibling Group ID', exp: true, fmt: 'Text', src: 'Shared by brothers and sisters who are linked as siblings', back: 'No — links are kept by the system' },
    { col: 'Full Name', imp: true, exp: true, req: 'Required', fmt: 'Text, up to 80 characters',
      impNote: 'Rows without a name are skipped. (You may use separate First Name and Last Name columns instead.)', src: 'The student’s full name', back: 'Yes' },
    { col: 'Father / Guardian', imp: true, exp: true, req: 'Recommended', fmt: 'Text, up to 80 characters',
      impNote: 'The admission form requires it — students without it are listed in the data checks.', src: 'The guardian’s name', back: 'Yes' },
    { col: 'Guardian Role', imp: true, exp: true, req: 'Optional', fmt: 'Father, Mother, Brother, Sister, Uncle, Grandparent or Legal Guardian',
      impNote: 'Common words such as Dad, Mom or Guardian are understood.', src: 'The guardian’s relation to the student', back: 'Yes' },
    { col: 'Guardian CNIC', imp: true, exp: true, req: 'Recommended', fmt: '13 digits, written 17101-1234567-1 (dashes are added for you)',
      impNote: 'A value that does not have 13 digits is flagged in the data checks.', src: 'The guardian’s CNIC number', back: 'Yes' },
    { col: 'Father Name', imp: true, exp: true, req: 'Recommended', fmt: 'Text, up to 80 characters',
      impNote: 'Siblings are detected ONLY from Father Name + Father CNIC. Empty → the student is never linked as a sibling. If Father / Guardian is empty, this name is used for it.', src: 'The father’s name', back: 'Yes' },
    { col: 'Father CNIC', imp: true, exp: true, req: 'Recommended', fmt: '13 digits, written 17101-1234567-1 (dashes are added for you)',
      impNote: 'A value that does not have 13 digits is flagged in the data checks. Empty → the student is never linked as a sibling.', src: 'The father’s CNIC number', back: 'Yes' },
    { col: 'Gender', imp: true, exp: true, req: 'Optional', fmt: 'Male or Female (M / F also understood)', impNote: 'Empty → left blank.', src: 'Gender', back: 'Yes' },
    { col: 'Date of Birth', imp: true, exp: true, req: 'Recommended',
      fmtImp: 'Day/Month/Year, e.g. 14/03/2015 (2015-03-14 also works)', fmtExp: 'Year-Month-Day, e.g. 2015-03-14',
      impNote: 'Impossible dates such as 31/02/2015 are flagged and left empty.', src: 'Date of birth', back: 'Yes' },
    { col: 'Age', exp: true, fmt: 'Years, e.g. 11 Years', src: 'Calculated from the Date of Birth', back: 'No — calculated automatically' },
    { col: 'Class', imp: true, exp: true, req: 'Required (or choose the class while importing)',
      fmt: 'A class from Settings, e.g. Grade 2',
      impNote: 'Also understood: 2, 2nd, Class Two, II, Grade 2-A. You can instead pick one class and section on the first import screen.', src: 'The student’s current class', back: 'Yes' },
    { col: 'Section', imp: true, exp: true, req: 'Optional', fmt: 'A section of that class, e.g. A', impNote: 'Can also be chosen on the first import screen.', src: 'The student’s section', back: 'Yes' },
    { col: 'Roll No', imp: true, exp: true, req: 'Optional', fmt: 'Number', impNote: 'Empty → numbered automatically after the last roll number in the class.', src: 'Roll number in the class', back: 'Yes' },
    { col: 'Admission Class', imp: true, exp: true, req: 'Optional', fmt: 'Class name, e.g. Grade 1 — the class the student was first admitted in', impNote: 'Empty → left blank. Saved as the student’s Admission Class (the current Class is not changed).', src: 'Class at admission', back: 'Yes' },
    { col: 'Admission Date', imp: true, exp: true, req: 'Optional',
      fmtImp: 'Day/Month/Year, e.g. 01/04/2024', fmtExp: 'Year-Month-Day, e.g. 2024-04-01', impNote: 'Empty → today’s date.', src: 'Date of admission', back: 'Yes' },
    { col: 'Phone 1', imp: true, exp: true, req: 'Recommended', fmt: 'Mobile number, e.g. 0300-1234567', impNote: 'Numbers Excel shortened (3001234567) get their leading 0 back.', src: 'Primary phone number', back: 'Yes' },
    { col: 'Phone 2', imp: true, exp: true, req: 'Optional', fmt: 'Mobile number, e.g. 0312-1112233', impNote: 'Empty → left blank.', src: 'Secondary phone number', back: 'Yes' },
    { col: 'Permanent Address', imp: true, exp: true, req: 'Recommended', fmt: 'Text, up to 300 characters', impNote: 'The admission form requires it — empty values are listed in the data checks.', src: 'Permanent address', back: 'Yes' },
    { col: 'Mailing Address', imp: true, exp: true, req: 'Optional', fmt: 'Text, up to 300 characters', impNote: 'Empty → the Permanent Address is used.', src: 'Mailing address', back: 'Yes' },
    { col: 'Student B-Form No.', imp: true, exp: true, req: 'Recommended', fmt: '13 digits, written 17101-1234567-1', impNote: 'The admission form requires it — empty values are listed in the data checks.', src: 'Student’s B-Form / CNIC number', back: 'Yes' },
    { col: 'Medical Issues', imp: true, exp: true, req: 'Optional', fmt: 'Text, up to 300 characters, e.g. None or Asthma', impNote: 'Empty → left blank.', src: 'Medical issues / allergies', back: 'Yes' },
    { col: 'Orphan Status', imp: true, exp: true, req: 'Optional', fmt: 'Orphan or Not Orphan (Yes / No also understood)', impNote: 'Empty → Not Orphan.', src: 'Orphan status', back: 'Yes' },
    { col: 'Previous School Attended', imp: true, exp: true, req: 'Optional', fmt: 'Text, up to 120 characters', impNote: 'Empty → left blank.', src: 'The school the student came from', back: 'Yes' },
    { col: 'Previous Class', imp: true, exp: true, req: 'Optional', fmt: 'Text, up to 40 characters — the class at the PREVIOUS school, not the current class', impNote: 'Empty → left blank.', src: 'Class at the previous school', back: 'Yes' },
    { col: 'Transport Mode', imp: true, exp: true, req: 'Optional', fmt: 'Private or School Provided', impNote: 'Empty → Private.', src: 'Transport mode', back: 'Yes' },
    { col: 'Transport Type', imp: true, exp: true, req: 'Optional', fmt: 'None, School Bus, School Van or Coaster', impNote: 'Empty → None.', src: 'Vehicle type', back: 'Yes' },
    { col: 'Transport Fee (PKR)', imp: true, exp: true, req: 'Optional', fmt: 'Monthly amount, a number', impNote: 'Empty → 0.', src: 'Monthly transport fee', back: 'Yes' },
    { col: 'Monthly Tuition Fee (PKR)', imp: true, exp: true, req: 'Optional', fmt: 'Monthly amount, a number', impNote: 'Empty → the class fee from Settings.', src: 'Standard monthly tuition fee', back: 'Yes' },
    { col: 'Admission Fee (PKR)', imp: true, req: 'Optional', fmt: 'One-time amount, a number', impNote: 'Empty → 0. (Not part of an export.)' },
    { col: 'Annual Fund (PKR)', exp: true, fmt: 'Amount, a number (0 when the annual fund is off)', src: 'Annual fund amount', back: 'No — not imported' },
    { col: 'Annual Fund Month', exp: true, fmt: 'Month name, e.g. April', src: 'Month the annual fund is charged', back: 'No — not imported' },
    { col: 'Tuition Discount (PKR)', imp: true, exp: true, req: 'Optional', fmt: 'Amount, a number', impNote: 'Empty → 0.', src: 'Discount on tuition', back: 'Yes' },
    { col: 'Transport Discount (PKR)', imp: true, exp: true, req: 'Optional', fmt: 'Amount, a number', impNote: 'Empty → 0.', src: 'Discount on transport', back: 'Yes' },
    { col: 'Sibling Discount (PKR)', imp: true, exp: true, req: 'Optional', fmt: 'Amount, a number', impNote: 'Empty → 0.', src: 'Discount for siblings', back: 'Yes' },
    { col: 'Total Discount (PKR)', exp: true, fmt: 'Amount, a number', src: 'Calculated: the three discounts added together', back: 'No — calculated automatically' },
    { col: 'Discount Type', exp: true, fmt: 'Lifetime, Temporary or None', src: 'Whether the discount lasts for ever or ends on a date', back: 'No — not imported' },
    { col: 'Discount Valid Until', exp: true, fmt: 'A date, or the word Lifetime', src: 'End date of a temporary discount', back: 'No — not imported' },
    { col: 'Net Payable (PKR)', exp: true, fmt: 'Amount, a number', src: 'Calculated by the system from the fee and discount columns', back: 'No — calculated automatically' },
    { col: 'Has Sibling', exp: true, fmt: 'Yes or No', src: 'Whether the student is linked to a sibling', back: 'No — not imported' },
    { col: 'Sibling Of', exp: true, fmt: 'Text', src: 'The sibling this student is linked to', back: 'No — not imported' },
    { col: 'Student Photo (Link)', csvCol: 'Has Student Photo', exp: true, fmt: 'Excel: “✔ Saved” or “✘ Not uploaded”. CSV: Yes or No', src: 'Whether a student photo is saved (the photo itself is in the optional photo gallery file)', back: 'No — photos cannot be imported' },
    { col: 'B-Form / Cert (Link)', csvCol: 'Has B-Form / Certificate', exp: true, fmt: 'Excel: “✔ Saved” or “✘ Not uploaded”. CSV: Yes or No', src: 'Whether a B-Form / certificate scan is saved', back: 'No — scans cannot be imported' },
    { col: 'Status', exp: true, fmt: 'Active, Graduated or Dropped', src: 'Where the student is in the school', back: 'No — imported students are Active' }
];

/** Example values for two students. Dates are written the way that file type uses them. */
function _tplExamples(which, mode) {
    const configs = getClassConfigs();
    const cls1 = configs.length ? configs[0].name : 'Grade 1';
    const cls2 = configs.length > 1 ? configs[1].name : cls1;
    const secs = configs.length ? _impSectionsOf(cls1) : [];
    const sec = secs[0] || 'A';
    const date = (y, m, d) => which === 'import'
        ? `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
        : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dob1 = date(2015, 3, 14), dob2 = date(2014, 11, 2);
    const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const csv = mode === 'csv';
    return {
        'Reg No': ['#EXAMPLE-1', '#EXAMPLE-2'], 'Sibling Group ID': ['', ''],
        'Full Name': ['Ali Khan', 'Sara Bibi'], 'Father / Guardian': ['Imran Khan', 'Gul Zaman'],
        'Guardian Role': ['Father', 'Father'], 'Guardian CNIC': ['17101-1234567-1', '17101-7654321-3'],
        'Father Name': ['Imran Khan', 'Gul Zaman'], 'Father CNIC': ['17101-1234567-1', '17101-7654321-3'],
        'Gender': ['Male', 'Female'], 'Date of Birth': [dob1, dob2],
        'Age': [_impAgeFromDob(iso(2015, 3, 14)), _impAgeFromDob(iso(2014, 11, 2))],
        'Class': [cls1, cls2], 'Section': [sec, sec], 'Roll No': [1, 1],
        'Admission Class': [cls1, cls2],
        'Admission Date': [date(2024, 4, 1), date(2024, 4, 1)],
        'Phone 1': ['0300-1234567', '0345-7654321'], 'Phone 2': ['', '0312-1112233'],
        'Permanent Address': ['House 5, Street 2, Abbottabad', 'Mohalla Qazian, Abbottabad'],
        'Mailing Address': ['House 5, Street 2, Abbottabad', which === 'import' ? '' : 'Mohalla Qazian, Abbottabad'],
        'Student B-Form No.': ['17101-5555555-5', '17101-6666666-6'],
        'Medical Issues': ['None', 'Asthma'], 'Orphan Status': ['Not Orphan', 'Not Orphan'],
        'Previous School Attended': ['Little Stars School', ''], 'Previous Class': ['KG', ''],
        'Transport Mode': ['Private', 'School Provided'], 'Transport Type': ['None', 'School Van'],
        'Transport Fee (PKR)': [0, 1500], 'Monthly Tuition Fee (PKR)': [2500, 2500], 'Admission Fee (PKR)': [5000, 5000],
        'Annual Fund (PKR)': [0, 1000], 'Annual Fund Month': ['', 'April'],
        'Tuition Discount (PKR)': [0, 500], 'Transport Discount (PKR)': [0, 0], 'Sibling Discount (PKR)': [0, 0],
        'Total Discount (PKR)': [0, 500], 'Discount Type': ['None', 'Lifetime'], 'Discount Valid Until': ['', 'Lifetime'],
        'Net Payable (PKR)': [2500, 3500], 'Has Sibling': ['No', 'No'], 'Sibling Of': ['', ''],
        'Student Photo (Link)': csv ? ['Yes', 'No'] : ['✔ Saved (see Photo Gallery HTML)', '✘ Not uploaded'],
        'B-Form / Cert (Link)': csv ? ['No', 'No'] : ['✘ Not uploaded', '✘ Not uploaded'],
        'Status': ['Active', 'Active']
    };
}

/** The columns of a template, in order, with their heading for this file type. */
function _tplColumns(which, mode) {
    return TEMPLATE_FIELDS
        .filter(f => which === 'import' ? f.imp : f.exp)
        .map(f => Object.assign({}, f, { heading: (which === 'export' && mode === 'csv' && f.csvCol) ? f.csvCol : f.col }));
}

function _tplGuideRows(which, cols, ex) {
    const fmtOf = f => which === 'import' ? (f.fmtImp || f.fmt) : (f.fmtExp || f.fmt);
    const example = f => { const v = (ex[f.col] || [''])[0]; return v === '' ? '(empty)' : v; };
    if (which === 'import') {
        return { head: ['Column heading', 'Required?', 'Format / allowed values', 'Example', 'If left empty / notes'],
                 rows: cols.map(f => [f.heading, f.req, fmtOf(f), example(f), f.impNote || '']) };
    }
    return { head: ['Column heading', 'Format in the file', 'Example', 'Where the value comes from', 'Can it be imported back?'],
             rows: cols.map(f => [f.heading, fmtOf(f), example(f), f.src || '', f.back || '']) };
}

function _tplInstructions(which) {
    if (which === 'import') return [
        'HOW TO IMPORT STUDENTS WITH THIS FILE',
        '',
        '1. Fill in one row per student under the headings. The two example rows start with # in the first column — the importer ignores them, so you can leave or delete them.',
        '2. Keep the headings as written (the importer also recognises many other spellings). You may delete columns you do not need — only Full Name is required (and Class, unless you choose the class while importing).',
        '3. In SoftSchool open Data Export & Import → Import Data and choose this file (Excel .xlsx / .xls, CSV .csv or PDF).',
        '4. The first screen asks which class and section the students are for. Choose “Into one class & section”, or “Use the classes in my file” if the Class column lists several classes.',
        '5. Click Review columns to check how every heading was matched, then read the Save plan and Data checks and click Import.',
        '',
        'FORMATS',
        '• Dates: day/month/year, e.g. 14/03/2015.   • Mobile numbers: 0300-1234567.   • CNIC and B-Form: 13 digits, e.g. 17101-1234567-1.',
        '• Fees and discounts: plain numbers (no “Rs”).   • Class and section must match the names in Settings.',
        '',
        'GOOD TO KNOW',
        '• Several classes in one file: use a Class column, OR one sheet per class named after the class (e.g. a sheet called Grade 2), OR rows containing only “Class 1”, “Class 2” above each group of students.',
        '• Instead of one Full Name column you can use a First Name and a Last Name column.',
        '• Empty cells are fine. Details the admission form requires (guardian, CNIC, B-Form, phone, address, date of birth) are listed after the import so you can complete them with Edit Student.',
        '• Students that already exist are skipped (or updated, if you choose that and the file has a Registration No.).',
        '• Photos and B-Form / certificate scans cannot be imported.',
        '• A row whose first cell starts with # is treated as a note and ignored.',
        '',
        'MAXIMUM LENGTHS: names 80 characters · addresses and medical issues 300 · previous school 120 · previous class 40. Longer text is shortened and reported.'
    ];
    return [
        'HOW EXPORTING WORKS — AND WHAT AN EXPORT LOOKS LIKE',
        '',
        '1. In SoftSchool open Data Export & Import → Export Data.',
        '2. Choose the format: Excel (.xlsx) or CSV (.csv).',
        '3. Choose the class and section: any one class, any one section, or All classes / All sections.',
        '4. Click Export. The file is named after your choice, e.g. “SoftSchool (Student Data) - Grade 2 - Section B.xlsx”.',
        '',
        'EXCEL EXPORT — one workbook with these sheets (see the “Export Contents” sheet):',
        '• Student Directory — one row per student with every column described in the Field Guide (this is the sheet you can import back).',
        '• Discount Breakdown, Class Summary, Fee Overview, Photo Index and Export Info — summaries of the same students.',
        '• Optionally a second file, the Photo Gallery (HTML), with each student’s photo and B-Form / certificate.',
        '',
        'CSV EXPORT — one file with the same columns as the Student Directory. The two photo columns show Yes / No. The file is UTF-8 with a BOM so Urdu and accented names open correctly in Excel.',
        '',
        'GOOD TO KNOW',
        '• Only active students are exported, unless you tick “Also include graduated & dropped students” (the Status column then shows who is who).',
        '• Dates are written Year-Month-Day (2015-03-14). Amounts are plain numbers.',
        '• To import an exported file again, use Import Data. The columns are recognised automatically; columns marked “No” in the Field Guide are calculated or not imported and are ignored.',
        '• In a CSV, text that starts with =, +, - or @ gets a leading apostrophe so a spreadsheet cannot run it as a formula.',
        '• Rows starting with # in this template are examples only.'
    ];
}

/** What the other sheets of a real Excel export contain (used by the export template). */
function _tplExportSheets() {
    return [
        ['Sheet', 'What it shows', 'Columns'],
        ['Student Directory', 'One row per student with every detail (the Field Guide describes each column).', 'See the Student Directory sheet of this template'],
        ['Discount Breakdown', 'Fees and discounts of each student.', 'Reg No, Student Name, Class, Standard Fee (PKR), Transport Fee (PKR), Tuition Discount (PKR), Transport Discount (PKR), Sibling Discount (PKR), Total Discount (PKR), Total Discount (%), Net Monthly Payable (PKR), Discount Type, Valid Until'],
        ['Class Summary', 'Number of students per class, split by gender, with a total.', 'Class, Total Students, Male, Female'],
        ['Fee Overview', 'Monthly and annual amounts of each student.', 'Reg No, Student Name, Class, Monthly Tuition (PKR), Annual Fund (PKR), Tuition Disc., Transport Disc., Sibling Disc., Net Monthly (PKR), Total Annual (PKR)'],
        ['Photo Index', 'Which students have a photo and a B-Form / certificate saved.', '#, Reg No, Student Name, Class, Has Student Photo, Has B-Form / Certificate, Document Type'],
        ['Export Info', 'When the file was made and what it contains (class, section, totals).', 'Item, Value']
    ];
}

function _tplFileName(which, kind) {
    return which === 'import' ? `students-import-template.${kind}` : `students-export-template.${kind}`;
}

function _tplBuildXlsx(which) {
    const cols = _tplColumns(which, 'xlsx');
    const ex = _tplExamples(which, 'xlsx');
    const wb = XLSX.utils.book_new();
    const heads = cols.map(c => c.heading);
    const data = [heads, cols.map(c => (ex[c.col] || ['', ''])[0]), cols.map(c => (ex[c.col] || ['', ''])[1])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = cols.map((c, i) => ({ wch: Math.min(42, Math.max(12, c.heading.length + 2, ...data.slice(1).map(r => String(r[i]).length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, which === 'import' ? 'Students' : 'Student Directory');

    const g = _tplGuideRows(which, cols, ex);
    const wsGuide = XLSX.utils.aoa_to_sheet([g.head].concat(g.rows));
    wsGuide['!cols'] = which === 'import'
        ? [{ wch: 28 }, { wch: 30 }, { wch: 60 }, { wch: 30 }, { wch: 80 }]
        : [{ wch: 28 }, { wch: 60 }, { wch: 30 }, { wch: 60 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Field Guide');

    if (which === 'export') {
        const wsSheets = XLSX.utils.aoa_to_sheet(_tplExportSheets());
        wsSheets['!cols'] = [{ wch: 22 }, { wch: 60 }, { wch: 110 }];
        XLSX.utils.book_append_sheet(wb, wsSheets, 'Export Contents');
    }
    const wsHow = XLSX.utils.aoa_to_sheet(_tplInstructions(which).map(l => [l]));
    wsHow['!cols'] = [{ wch: 140 }];
    XLSX.utils.book_append_sheet(wb, wsHow, 'Instructions');
    XLSX.writeFile(wb, _tplFileName(which, 'xlsx'));
    return { cols: cols.length };
}

/** CSV has no second sheet, so the guide is written as note lines starting with # — the importer ignores them. */
function _tplBuildCsv(which) {
    const cols = _tplColumns(which, 'csv');
    const ex = _tplExamples(which, 'csv');
    const g = _tplGuideRows(which, cols, ex);
    const rows = [cols.map(c => c.heading), cols.map(c => (ex[c.col] || ['', ''])[0]), cols.map(c => (ex[c.col] || ['', ''])[1])];
    const note = t => [t === '' ? '#' : '# ' + t];
    _tplInstructions(which).forEach(l => rows.push(note(l)));
    rows.push(note(''), note(which === 'import' ? 'FIELD GUIDE  (column | required? | format | example | if left empty / notes)' : 'FIELD GUIDE  (column | format | example | where it comes from | can it be imported back?)'));
    g.rows.forEach(r => rows.push(note(r.join(' | '))));
    if (which === 'export') {
        rows.push(note(''), note('OTHER SHEETS OF AN EXCEL EXPORT'));
        _tplExportSheets().slice(1).forEach(r => rows.push(note(`${r[0]} — ${r[1]} (${r[2]})`)));
    }
    const text = '\uFEFF' + rows.map(r => r.map(_impCsvCell).join(',')).join('\r\n');
    _impDownloadText(text, _tplFileName(which, 'csv'), 'text/csv;charset=utf-8');
    return { cols: cols.length };
}

/* ---------- the chooser dialog ---------- */
const _TPL = { which: 'import' };

async function openTemplateDialog(which) {
    _TPL.which = which;
    await _impEnsureClassConfigs();                  /* so the example Class / Section are real ones */
    const imp = which === 'import';
    const nCols = _tplColumns(which, 'xlsx').length;
    document.querySelector('#tpl-title span').textContent = imp ? 'Import Template' : 'Export Template';
    document.getElementById('tpl-lead').textContent = imp
        ? 'Download a file that shows how to prepare data for importing — which fields to use, their format, and examples. Which type do you want?'
        : 'Download a file that shows what an export looks like — the fields, their order and format, and what each one means. Which type do you want?';
    document.getElementById('tpl-xlsx-desc').textContent = imp
        ? `A “Students” sheet with ${nCols} headings and 2 example rows, a “Field Guide” sheet (format and meaning of every column) and an “Instructions” sheet.`
        : `A “Student Directory” sheet with the ${nCols} exported columns and 2 example rows, a “Field Guide”, an “Export Contents” sheet describing every sheet of an export, and “Instructions”.`;
    document.getElementById('tpl-csv-desc').textContent = imp
        ? `One file with the ${nCols} headings and 2 example rows. The field guide and instructions are written underneath as note lines starting with # — the importer ignores them.`
        : `One file with the ${nCols} exported columns and 2 example rows. The field guide and a description of the export are written underneath as note lines starting with #.`;
    document.getElementById('tpl-summary').innerHTML = `<i class="fas fa-circle-info"></i><span>Rows starting with <strong>#</strong> are notes — they are never imported.</span>`;
    openModal('template-modal');
}
function closeTemplateDialog() { closeModal('template-modal'); }

function downloadTemplate(which, kind) {
    try {
        if (kind === 'xlsx' && typeof XLSX === 'undefined') {
            showDataIOStatus('The Excel library has not loaded yet. Please try again in a moment.', 'error');
            return false;
        }
        const r = kind === 'csv' ? _tplBuildCsv(which) : _tplBuildXlsx(which);
        const file = _tplFileName(which, kind);
        showDataIOStatus(
            `✓ Template downloaded: <em>${_impEsc(file)}</em> — ${which === 'import' ? 'import' : 'export'} format with <strong>${r.cols}</strong> fields, example rows and a field guide. Check your Downloads folder.`,
            'success');
        return true;
    } catch (err) {
        console.error('Template download failed', err);
        showDataIOStatus('Could not create the template: ' + _impEsc(err.message), 'error');
        return false;
    }
}
function pickTemplateFormat(kind) {
    closeTemplateDialog();
    downloadTemplate(_TPL.which, kind);
}
function downloadImportTemplate(kind) { return downloadTemplate('import', kind); }   /* old name, still works */

/* ---------- 1. READ THE FILE ---------- */

function _impParseSheet(sheet) {
    const grid = sheet.grid;
    let h = sheet.headerRow;
    if (sheet.noHeader === undefined) {                       /* first look at this sheet: decide automatically */
        const p = _impPickHeaderRow(grid);
        h = p.idx;
        sheet.noHeader = p.hits < 2 && !p.like;               /* fewer than 2 recognisable headings and not word-like → no headings */
        sheet.autoNoHeader = sheet.noHeader;
    } else if (h == null || h < 0 || h >= grid.length) {
        h = _impPickHeaderRow(grid).idx;
    }
    sheet.headerRow = h;
    sheet.hits = sheet.noHeader ? 0 : _impRowHeaderHits(grid[h] || []);

    const noHeader = !!sheet.noHeader;
    const firstData = noHeader ? Math.max(0, grid.findIndex(r => _impFilled(r) > 0)) : h + 1;
    const rawHeaders = noHeader ? [] : (grid[h] || []);

    /* A class printed above the headings ("Class: Grade 2") */
    sheet.titleClass = noHeader ? '' : _pdfClassFromTitle(
        grid.slice(0, h).map(r => r.map(_impCellText).filter(Boolean).join(' ')).filter(Boolean));

    let width = rawHeaders.length;
    if (noHeader) {
        grid.slice(firstData).forEach(r => {
            for (let i = r.length - 1; i >= 0; i--) if (_impCellText(r[i]) !== '') { width = Math.max(width, i + 1); break; }
        });
    }
    const seen = {};
    const headers = [];
    for (let i = 0; i < width; i++) {
        let t = noHeader ? '' : _impCellText(rawHeaders[i]);
        if (!t) t = noHeader ? `Column ${_impColLetter(i)}` : `Column ${i + 1}`;
        if (seen[t]) { seen[t]++; t = `${t} (${seen[t]})`; } else seen[t] = 1;
        headers.push(t);
    }

    const rows = [], rowNums = [], groups = [];
    let current = sheet.titleClass || '', noteRows = 0;
    for (let gi = firstData; gi < grid.length; gi++) {
        const r = grid[gi];
        const f = _impFilled(r);
        if (f === 0) continue;
        /* A row whose first cell starts with # is a note or an example row (like the ones in our templates) — ignore it. */
        const lead = r.map(_impCellText).find(t => t !== '');
        if (lead && lead.charAt(0) === '#') { noteRows++; continue; }
        /* A row that is itself made of column headings (a second heading line, a repeated heading on a new page,
           or the heading row picked one row too low) is never a student. */
        if (!noHeader && f >= 2) {
            const hits = _impRowHeaderHits(r);
            const sameAsHeader = r.filter((c, ci) => _impCellText(c) !== '' && _impNorm(_impCellText(c)) === _impNorm(_impCellText(rawHeaders[ci]))).length;
            if (hits >= 2 && hits >= f * 0.5) { noteRows++; continue; }
            if (sameAsHeader >= 2 && sameAsHeader >= f * 0.5) { noteRows++; continue; }
        }
        /* A row with a single cell like "Class 1" is a class heading for the students below it. */
        if (f === 1 && headers.length >= 3) {
            const txt = r.map(_impCellText).find(t => t !== '');
            if (/[A-Za-z]/.test(txt)) {
                const cls = _pdfClassFromTitle([txt]);
                if (cls) { current = cls; continue; }
            }
        }
        rows.push(headers.map((_, i) => r[i] === undefined ? '' : r[i]));
        rowNums.push(gi + 1 + (sheet.rowOffset || 0));
        groups.push(current);
    }

    sheet.noteRows = noteRows;
    let last = headers.length - 1;
    while (last > 0 && (noHeader || !_impCellText(rawHeaders[last])) && !rows.some(r => _impCellText(r[last]) !== '')) last--;
    headers.length = last + 1;
    sheet.headers = headers;
    sheet.rows = rows.map(r => r.slice(0, last + 1));
    sheet.rowNums = rowNums;
    sheet.groups = groups;
}

function _impStart(fileName, sheetsIn, source) {
    /* The documentation sheets of our templates and exports hold no students — never treat them as data. */
    const realSheets = sheetsIn.filter(s => !/^(field guide|instructions|export contents|export info)$/i.test(String(s.name).trim()));
    if (realSheets.length) sheetsIn = realSheets;
    const sheets = [];
    sheetsIn.forEach(s => {
        _impParseSheet(s);
        if (s.rows.length) sheets.push(s);
    });
    /* A sheet with real student headings but no students (e.g. an untouched template) must not fall back to its
       Field Guide / Instructions sheets — tell the user there is nothing to import yet. */
    const bestHits = Math.max(0, ...sheetsIn.map(s => s.hits || 0));
    if (!sheets.length || (bestHits >= 2 && !sheets.some(s => s.hits >= 2))) {
        sheets.length = 0;
        const notes = sheetsIn.reduce((n, s) => n + (s.noteRows || 0), 0);
        showDataIOStatus(notes
            ? `This file only has example or note rows (rows starting with #) — there are no students to import yet. Add your students under the headings and try again.`
            : 'No student rows were found. Make sure the file has a heading row followed by student rows.', 'error');
        return;
    }
    if (sheets.length > 1 && sheets.some(s => s.hits >= 2)) {
        /* Notes / instruction sheets have no recognisable headings; the summary sheets of an export (Discount Breakdown,
           Fee Overview …) share only a few headings with the student sheet — start with just the main student sheet(s) ticked. */
        const maxHits = Math.max(...sheets.map(s => s.hits));
        sheets.forEach(s => { if (s.hits < 2 || (maxHits >= 6 && s.hits < maxHits * 0.5)) s.include = false; });
    }
    importState = {
        fileName, source, sheets, step: 1,
        headers: [], records: [], hasGroup: false,
        mapping: {}, auto: {},
        /* where the class comes from when the user chooses "use the classes in my file" */
        fileClassMode: 'column', classModeTouched: false, pendingMode: null, restoreTried: false,
        /* the question asked first: which class & section are these students for? */
        target: { mode: 'choose', cls: '', section: '', mismatch: 'import', fromFile: false }, targetTouched: false,
        classMode: 'fixed', fixedClass: '',
        classMap: {},
        dupMode: 'skip', order: 'file',
        plan: null, importing: false, stop: false
    };
    _impRebuild();
    _impPickClassMode();
    renderImportAll();
    const el = document.getElementById('data-io-status');
    if (el) el.style.display = 'none';
}

async function _impEnsureClassConfigs() {
    /* getClassConfigs() quietly falls back to built-in default classes until Settings has loaded — always pull the
       school's real classes first, so class matching and the Class dropdown use the right list. */
    try {
        if (typeof fetchClassConfigsFromServer === 'function') {
            await Promise.race([fetchClassConfigsFromServer(), new Promise(r => setTimeout(r, 4000))]);
        }
    } catch (e) { /* offline: keep what we have */ }
}

function importStudentsFromExcel(event) {
    const input = event.target;
    const file  = input.files && input.files[0];
    if (!file) return;
    if (!/\.(xlsx|xlsm|xls|ods|csv|tsv|pdf)$/i.test(file.name)) {
        showDataIOStatus('Unsupported file type. Please choose an Excel (.xlsx, .xls), CSV (.csv) or PDF (.pdf) file.', 'error');
        input.value = '';
        return;
    }

    /* ----- PDF ----- */
    if (/\.pdf$/i.test(file.name)) {
        showDataIOStatus('Opening PDF… please wait.', 'info');
        _impReadPdf(file)
            .then(async sheets => { await _impEnsureClassConfigs(); _impStart(file.name, sheets, 'pdf'); })
            .catch(err => {
                console.error('Import: could not read PDF', err);
                showDataIOStatus(_impEsc(err && err.message ? err.message : 'The PDF could not be read.') + '.', 'error');
            })
            .finally(() => { input.value = ''; });
        return;
    }

    const isText = /\.(csv|tsv)$/i.test(file.name);
    if (!isText && typeof XLSX === 'undefined') {
        showDataIOStatus('Excel library not loaded yet. Please wait a moment and try again.', 'error');
        input.value = '';
        return;
    }
    showDataIOStatus('Reading file and analyzing its headings… please wait.', 'info');

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const bytes = new Uint8Array(e.target.result);
            const sheets = [];
            if (isText) {
                /* CSV / TSV: our own reader keeps text as text and reads dates day-first. */
                const grid = _impParseCsv(_impDecodeBytes(bytes));
                if (grid.some(r => _impFilled(r) > 0)) {
                    sheets.push({ name: file.name.replace(/\.(csv|tsv)$/i, ''), grid, rowOffset: 0, headerRow: null, include: true });
                }
            } else {
                const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
                wb.SheetNames.forEach(name => {
                    const ws = wb.Sheets[name];
                    if (!ws || !ws['!ref']) return;
                    const rowOffset = XLSX.utils.decode_range(ws['!ref']).s.r;
                    const grid = _impSheetGrid(ws);
                    if (!grid.some(r => _impFilled(r) > 0)) return;
                    sheets.push({ name, grid, rowOffset, headerRow: null, include: true });
                });
            }
            await _impEnsureClassConfigs();
            _impStart(file.name, sheets, isText ? 'csv' : 'excel');
        } catch (err) {
            console.error('Import: could not read file', err);
            showDataIOStatus('Could not read this file: ' + _impEsc(err.message) + '. Make sure it is a valid Excel or CSV file.', 'error');
        } finally {
            input.value = '';
        }
    };
    reader.onerror = function () {
        showDataIOStatus('The file could not be read. Please try again.', 'error');
        input.value = '';
    };
    reader.readAsArrayBuffer(file);
}

function _impRebuild() {
    const st = importState;
    const inc = st.sheets.filter(s => s.include);
    const headers = [];
    inc.forEach(s => s.headers.forEach(h => { if (!headers.includes(h)) headers.push(h); }));
    st.headers = headers;

    st.records = [];
    inc.forEach(s => s.rows.forEach((r, ri) => {
        const vals = {};
        s.headers.forEach((h, i) => { vals[h] = r[i]; });
        st.records.push({ sheet: s.name, vals, rowNo: s.rowNums[ri], groupClass: s.groups[ri] || '' });
    }));
    st.hasGroup = st.records.some(r => r.groupClass);

    Object.keys(st.mapping).forEach(k => { if (!headers.includes(st.mapping[k])) { delete st.mapping[k]; delete st.auto[k]; } });

    /* First time we see this layout: re-use the matching saved from the last import of the same headings. */
    if (!st.restoreTried) {
        st.restoreTried = true;
        const saved = _impLoadSaved(headers);
        if (saved && saved.mapping) {
            const usedCols = new Set();
            Object.keys(saved.mapping).forEach(k => {
                const hdr = saved.mapping[k];
                if (headers.includes(hdr) && !usedCols.has(hdr) && IMPORT_ALL_FIELDS.some(f => f.key === k)) {
                    st.mapping[k] = hdr; st.auto[k] = 'remembered'; usedCols.add(hdr);
                }
            });
            if (saved.classMode) st.pendingMode = saved.classMode;
        }
    }
    _impAutoMatch();
}

function _impAutoMatch() {
    const st = importState;
    const normHeaders = st.headers.map(_impNorm);
    const usedCols = new Set(Object.values(st.mapping));
    const pairs = [];
    IMPORT_ALL_FIELDS.forEach((f, fi) => {
        if (st.mapping[f.key] !== undefined) return;
        const aliases = [_impNorm(f.label), _impNorm(f.key)].concat(f.aliases.map(_impNorm));
        const isNameField = f.key === 'guardianName' || f.key === 'fullName';
        const isClassField = f.key === 'studentClass';
        normHeaders.forEach((h, hi) => {
            if (!h || usedCols.has(st.headers[hi])) return;
            let score = 0;
            /* "CNIC of Guardian", "Father Mobile" are about something else — only an exact alias may claim them as a name.
               Likewise "Admission Class", "Previous Class", "Class Teacher" must not be taken for the student's class. */
            const blocked = (isNameField && /cnic|nic|phone|mobile|contact|cell|relation|role|address|occupation|income|email|whatsapp|bform|birth|dob/.test(h)) ||
                            (isClassField && /previous|prev|last|old|prior|former|admission|admit|joining|entry|enrol|teacher|incharge|room|rank|position|section/.test(h));
            aliases.forEach(a => {
                if (!a) return;
                if (h === a) score = Math.max(score, 100);
                else if (blocked) return;
                else if (a.length >= 5 && h.includes(a)) score = Math.max(score, 50 + a.length);
                else if (h.length >= 5 && a.includes(h)) score = Math.max(score, 40);
            });
            /* typos: "Gaurdian Name", "Studnet Name" … */
            if (score === 0 && !blocked) {
                aliases.forEach(a => {
                    if (a.length >= 6 && h.length >= 6 && Math.abs(a.length - h.length) <= 2 &&
                        1 - _impLev(h, a) / Math.max(h.length, a.length) >= 0.8) score = Math.max(score, 45);
                });
            }
            if (score > 0) pairs.push({ fi, hi, score });
        });
    });
    pairs.sort((a, b) => b.score - a.score || a.fi - b.fi || a.hi - b.hi);
    const usedField = new Set();
    pairs.forEach(p => {
        const key = IMPORT_ALL_FIELDS[p.fi].key, header = st.headers[p.hi];
        if (usedField.has(key) || usedCols.has(header)) return;
        usedField.add(key); usedCols.add(header);
        st.mapping[key] = header; st.auto[key] = true;
    });

    /* Several class-looking columns? Prefer the CURRENT class, then a plain "Class", and only then the ADMISSION class.
       A "Previous Class" column is the class at an earlier school — never the student's class here. */
    if (st.mapping.studentClass === undefined) {
        const taken = new Set(Object.values(st.mapping));
        const cands = _impClassCandidates().filter(c => !taken.has(c.header));
        const pick = ['current', 'class', 'admission'].map(r => cands.find(c => c.role === r)).find(Boolean);
        if (pick) { st.mapping.studentClass = pick.header; st.auto.studentClass = pick.role === 'admission' ? 'admission' : true; }
    }
    /* No address heading matched exactly? Take an unused column whose heading is clearly about an address. */
    if (st.mapping.permanentAddress === undefined) {
        const taken = new Set(Object.values(st.mapping));
        const h = st.headers.find(x => !taken.has(x) && /addr|resid|village|mohalla|domicile|location/.test(_impNorm(x)) && !/email|mail\b/.test(_impNorm(x)));
        if (h) { st.mapping.permanentAddress = h; st.auto.permanentAddress = true; }
    }
    _impInferByContent();
}

function _impClassRole(header) {
    const n = _impNorm(header);
    if (/previous|prev|last|old|prior|former/.test(n)) return 'previous';
    if (/admission|admit|joining|entry|enrol/.test(n)) return 'admission';
    if (/current|present|running/.test(n)) return 'current';
    return 'class';
}
const _IMP_ROLE_LABEL = { current: 'Current class', class: 'Class', admission: 'Admission class', previous: 'Previous class (earlier school)' };

/** Columns that look like they hold a class, with what each one probably means. */
function _impClassCandidates() {
    const st = importState;
    return st.headers
        .filter(h => { const n = _impNorm(h); return /class|grade|standard|std/.test(n) && !/section|teacher|incharge|room|rank|position|result/.test(n); })
        .map(h => ({ header: h, role: _impClassRole(h) }));
}

/** What the file says about one student's class: { raw, cls, known, section }. */
function _impFileClassOf(rec) {
    let raw = _impCell(rec, 'studentClass');
    if (!raw && rec.groupClass) raw = rec.groupClass;
    if (!raw) { const m = _impMatchClass(rec.sheet); if (m.known && m.value) raw = rec.sheet; }   /* a sheet / file named "Grade 2" */
    if (!raw) return { raw: '', cls: '', known: false, section: '' };
    const m = _impMatchClass(raw);
    return { raw, cls: m.known && m.value ? m.value : raw.trim(), known: !!(m.known && m.value), section: m.section || '' };
}
function _impFileClassInfo() {
    const st = importState, counts = new Map(), rows = st.records.map(_impFileClassOf);
    rows.forEach(fc => {
        if (!fc.raw) return;
        if (!counts.has(fc.cls)) counts.set(fc.cls, { cls: fc.cls, known: fc.known, count: 0 });
        counts.get(fc.cls).count++;
    });
    return { rows, distinct: [...counts.values()].sort((a, b) => b.count - a.count) };
}
function _impSectionsOf(cls) {
    const cfg = getClassConfigMap()[cls];
    return cfg && Array.isArray(cfg.sections) ? cfg.sections : [];
}

/** Work out how a "use the classes in my file" import would find the class, then decide the starting answer to the
    first question (one class & section, or the classes in the file). */
function _impPickClassMode() {
    const st = importState;
    if (st.pendingMode) {
        const pm = st.pendingMode; st.pendingMode = null;
        if ((pm === 'column' && st.mapping.studentClass !== undefined) || pm === 'sheet' || (pm === 'group' && st.hasGroup)) {
            st.fileClassMode = pm; st.classModeTouched = true;
        }
    }
    if (st.classModeTouched && st.fileClassMode === 'group' && !st.hasGroup) st.classModeTouched = false;
    if (!st.classModeTouched) {
        const isKnown = n => { const m = _impMatchClass(n); return m.known && !!m.value; };
        const inc = st.sheets.filter(s => s.include);
        const known = inc.filter(s => isKnown(s.name)).length;
        if (st.mapping.studentClass !== undefined) st.fileClassMode = 'column';
        else if (st.hasGroup) st.fileClassMode = 'group';
        else if (inc.length > 1 && known >= 1 && known >= inc.length / 2) st.fileClassMode = 'sheet';
        else if (inc.length === 1 && known === 1) st.fileClassMode = 'sheet';
        else st.fileClassMode = 'column';
    }
    if (!st.targetTouched) _impInitTarget(); else _impApplyTarget();
}

function _impInitTarget() {
    const st = importState;
    const info = _impFileClassInfo();
    const known = info.distinct.filter(d => d.known);
    st.target = { mode: 'choose', cls: '', section: '', mismatch: 'import', fromFile: false };
    if (info.distinct.length > 1 && known.length >= 1) {
        st.target.mode = 'file';                                   /* the file clearly holds several classes */
    } else if (info.distinct.length === 1 && known.length === 1) {
        st.target.cls = known[0].cls; st.target.fromFile = true;   /* the file only mentions one class — suggest it */
    }
    _impAutoSection();
    _impApplyTarget();
}
function _impAutoSection() {
    const t = importState.target;
    if (t.cls && !_impSectionsOf(t.cls).length) t.section = '__none__';
}
function _impApplyTarget() {
    const st = importState;
    if (st.target.mode === 'choose') { st.classMode = 'fixed'; st.fixedClass = st.target.cls; }
    else st.classMode = st.fileClassMode;
}

/* ---------- 2. THE MAPPING SCREEN ---------- */

function _impHeaderOptions(selectedHeader) {
    const st = importState;
    return '<option value="">— Don’t import —</option>' +
        st.headers.map((h, i) => `<option value="${i}"${selectedHeader === h ? ' selected' : ''}>${_impEsc(h)}</option>`).join('');
}

function renderImportAll() {
    const st = importState;
    if (!st) return;

    const total = st.records.length;
    document.getElementById('imp-file-bar').innerHTML =
        `<div class="imp-file-icon${st.source === 'pdf' ? ' is-pdf' : ''}"><i class="fas ${st.source === 'pdf' ? 'fa-file-pdf' : 'fa-file-excel'}"></i></div>
         <div class="imp-file-meta">
            <strong>${_impEsc(st.fileName)}</strong>
            <span>${total} student row${total === 1 ? '' : 's'} · ${st.headers.length} column${st.headers.length === 1 ? '' : 's'} · ${st.sheets.length} sheet${st.sheets.length === 1 ? '' : 's'}</span>
         </div>`;

    /* step 1 */
    renderImportTarget();
    renderImportClassPanel();
    renderImportSheets();
    renderImportColSummary();

    /* step 2 */
    const first = st.sheets.find(s => s.include) || st.sheets[0];
    document.getElementById('imp-detected').innerHTML =
        `<div class="imp-detected-label"><i class="fas fa-magnifying-glass-chart"></i> Headings detected in your file</div>
         <div class="imp-chip-row">${st.headers.map(h => `<span class="imp-chip">${_impEsc(h)}</span>`).join('')}</div>
         <details class="imp-peek"${st.source === 'pdf' ? ' open' : ''}>
            <summary>Preview the first rows${st.source === 'pdf' ? ' read from the PDF' : ''}</summary>
            <div class="imp-table-wrap"><table class="imp-plan-table imp-peek-table">
                <thead><tr>${first.headers.map(h => `<th>${_impEsc(h)}</th>`).join('')}</tr></thead>
                <tbody>${first.rows.slice(0, 5).map(r => `<tr>${r.map(c => `<td>${_impEsc(_impCellText(c))}</td>`).join('')}</tr>`).join('')}</tbody>
            </table></div>
         </details>`;
    renderImportOptions();

    document.getElementById('imp-rows').innerHTML = IMPORT_FIELD_GROUPS.map(g => `
        <div class="imp-group">
            <div class="form-section-label"><i class="fas ${g.icon}"></i> ${_impEsc(g.title)}</div>
            ${g.fields.map(f => `
            <div class="imp-row" data-key="${f.key}">
                <div class="imp-left">
                    <span class="imp-label">${_impEsc(f.label)}${f.required ? '<span class="imp-req" title="Required">*</span>' : ''}</span>
                    <span class="imp-hint" id="imp-hint-${f.key}">${f.hint ? _impEsc(f.hint) : ''}</span>
                </div>
                <i class="fas fa-arrow-right-long imp-arrow"></i>
                <div class="imp-right">
                    <select class="imp-select" data-key="${f.key}" onchange="onImportMappingChange(this)">${_impHeaderOptions(st.mapping[f.key])}</select>
                    <div class="imp-sample" id="imp-sample-${f.key}"></div>
                </div>
            </div>`).join('')}
        </div>`).join('');

    IMPORT_ALL_FIELDS.forEach(f => refreshImportRow(f.key));
    refreshImport();
    setImportStep(st.step || 1, true);
    openModal('import-map-modal');
}

function renderImportSheets() {
    const st = importState;
    const only = st.sheets.length === 1;
    const notes = [];
    if (st.source === 'pdf') notes.push('The table was rebuilt from the PDF’s layout. Check the preview below; if the headings are on a different line, change <strong>Headings in row</strong>.');
    if (st.sheets.some(s => s.noHeader && s.autoNoHeader)) notes.push('No heading row was found, so the columns are called Column A, B, C… and matched by what they <strong>contain</strong>. Please check each match below. If the first row does hold headings, untick <strong>No headings</strong>.');
    document.getElementById('imp-sheets').innerHTML =
        notes.map(n => `<div class="imp-note"><i class="fas fa-circle-info"></i> ${n}</div>`).join('') +
        `<div class="imp-panel-title"><i class="fas fa-layer-group"></i> ${only ? 'Sheet' : 'Sheets in this file'}
            ${only ? '' : '<span class="imp-panel-sub">Tick the sheets to import. Sheets with the same headings are combined.</span>'}</div>
         ${st.sheets.map((s, i) => `
            <div class="imp-sheet-row${s.include ? '' : ' is-off'}">
                <label class="imp-sheet-name">
                    <input type="checkbox" ${s.include ? 'checked' : ''} ${only ? 'disabled' : ''} onchange="toggleImportSheet(${i}, this.checked)">
                    <span>${_impEsc(s.name)}</span>
                </label>
                <span class="imp-sheet-meta">${s.rows.length} row${s.rows.length === 1 ? '' : 's'} · ${s.headers.length} columns${s.noteRows ? ` · ${s.noteRows} note row${s.noteRows === 1 ? '' : 's'} (#) ignored` : ''}</span>
                <label class="imp-sheet-hdr"><input type="checkbox" class="imp-cb" ${s.noHeader ? 'checked' : ''} onchange="setImportNoHeader(${i}, this.checked)"> No headings</label>
                <label class="imp-sheet-hdr${s.noHeader ? ' is-off' : ''}">Headings in row
                    <input type="number" min="1" ${s.noHeader ? 'disabled' : ''} value="${s.headerRow + 1 + s.rowOffset}" onchange="setImportHeaderRow(${i}, this.value)">
                </label>
            </div>`).join('')}`;
}

function toggleImportSheet(i, on) {
    const st = importState;
    if (!on && st.sheets.filter(s => s.include).length <= 1) { renderImportSheets(); return; } /* keep at least one */
    st.sheets[i].include = on;
    _impRebuild(); _impPickClassMode(); renderImportAll();
}

function setImportHeaderRow(i, value) {
    const st = importState, sheet = st.sheets[i];
    const n = parseInt(value, 10);
    if (isNaN(n)) { renderImportSheets(); return; }
    const idx = Math.min(Math.max(n - 1 - sheet.rowOffset, 0), sheet.grid.length - 1);
    sheet.headerRow = idx;
    _impParseSheet(sheet);
    /* A different heading row means different columns — forget the guesses, keep nothing stale. */
    st.mapping = {}; st.auto = {}; st.classMap = {};
    _impRebuild(); _impPickClassMode(); renderImportAll();
}

function renderImportClassPanel() {
    const st = importState;
    const panel = document.getElementById('imp-class-panel');
    panel.hidden = st.target.mode !== 'file';
    if (st.target.mode !== 'file') { panel.innerHTML = ''; return; }

    const configs = getClassConfigs();
    const modes = [['column', 'fa-table-columns', 'A column in the file']];
    if (st.hasGroup || st.fileClassMode === 'group') modes.push(['group', 'fa-heading', 'Class headings in the sheet']);
    modes.push(['sheet', 'fa-layer-group', 'The sheet name']);

    let html = `<div class="imp-panel-title"><i class="fas fa-school"></i> Where does the class come from in your file?
                    <span class="imp-panel-sub">Each student is saved into the class written for them.</span></div>
                <div class="imp-seg">${modes.map(([v, ic, label]) =>
                    `<button type="button" class="imp-seg-btn${st.fileClassMode === v ? ' active' : ''}" onclick="setImportClassMode('${v}')"><i class="fas ${ic}"></i> ${label}</button>`).join('')}</div>`;

    if (st.fileClassMode === 'column') {
        html += `<label class="imp-colpick">Class column in your file ${_impClassColumnPicker()}</label>`;
    }
    const distinct = _impDistinctClassValues();
    if (st.fileClassMode === 'column' && st.mapping.studentClass === undefined) {
        html += `<div class="imp-note imp-note-warn"><i class="fas fa-triangle-exclamation"></i> Choose the column that holds the class, or switch to “Into one class &amp; section” above.</div>`;
    } else if (!distinct.length) {
        html += `<div class="imp-note imp-note-warn"><i class="fas fa-triangle-exclamation"></i> No class values were found.</div>`;
    } else {
        const head = st.fileClassMode === 'sheet' ? 'Sheet name' : st.fileClassMode === 'group' ? 'Class heading' : 'Class in your file';
        html += `<div class="imp-classmap-head"><span>${head}</span><span></span><span>Save as (class in Settings)</span></div>`;
        html += distinct.map(d => {
            if (!(d.norm in st.classMap)) {
                const m = _impMatchClass(d.raw);
                if (m.known && m.value) st.classMap[d.norm] = m.value;
                else st.classMap[d.norm] = (st.fileClassMode === 'sheet' && distinct.some(x => _impMatchClass(x.raw).known)) ? IMP_SKIP : IMP_KEEP;
            }
            const cur = st.classMap[d.norm];
            const matched = cur !== IMP_KEEP && cur !== IMP_SKIP;
            const m0 = _impMatchClass(d.raw);
            const secNote = matched && m0.section && m0.value === cur ? ` <em class="imp-sec-hint">+ section ${_impEsc(m0.section)}</em>` : '';
            return `<div class="imp-classmap-row${cur === IMP_SKIP ? ' is-skip' : matched ? ' is-ok' : ' is-new'}">
                <div class="imp-cm-left"><strong>${_impEsc(d.raw)}</strong><span>${d.count} student${d.count === 1 ? '' : 's'}${secNote}</span></div>
                <i class="fas fa-arrow-right-long imp-arrow"></i>
                <select class="imp-select" onchange="setImportClassTarget('${_impEsc(d.norm)}', this.value)">
                    ${configs.map(c => `<option value="${_impEsc(c.name)}"${cur === c.name ? ' selected' : ''}>${_impEsc(c.name)}</option>`).join('')}
                    <option value="${IMP_KEEP}"${cur === IMP_KEEP ? ' selected' : ''}>Keep as “${_impEsc(d.raw)}” (not in Settings)</option>
                    <option value="${IMP_SKIP}"${cur === IMP_SKIP ? ' selected' : ''}>Don’t import these students</option>
                </select>
            </div>`;
        }).join('');
    }
    panel.innerHTML = html;
}

/** <select> of the file's columns for choosing the class column, with class-like ones labelled (Current / Admission / Previous). */
function _impClassColumnPicker() {
    const st = importState;
    const cands = _impClassCandidates();
    const candSet = new Set(cands.map(c => c.header));
    const sel = st.mapping.studentClass;
    const opt = (h, label) => `<option value="${st.headers.indexOf(h)}"${sel === h ? ' selected' : ''}>${_impEsc(label)}</option>`;
    return `<select class="imp-select" onchange="setImportClassColumn(this.value)">
        <option value="">— None —</option>
        ${cands.length ? `<optgroup label="Columns that look like a class">${cands.map(c => opt(c.header, `${c.header}  —  ${_IMP_ROLE_LABEL[c.role]}`)).join('')}</optgroup>` : ''}
        <optgroup label="Other columns">${st.headers.filter(h => !candSet.has(h)).map(h => opt(h, h)).join('')}</optgroup>
    </select>`;
}
function setImportClassColumn(value) {
    const st = importState;
    if (value === '') delete st.mapping.studentClass; else st.mapping.studentClass = st.headers[parseInt(value, 10)];
    st.auto.studentClass = false;
    st.classMap = {};
    refreshImportRow('studentClass');
    renderImportClassPanel();
    refreshImport();
}

function setImportClassMode(mode) {
    const st = importState;
    st.fileClassMode = mode; st.classModeTouched = true; st.targetTouched = true;
    _impApplyTarget();
    renderImportClassPanel();
    refreshImportRow('studentClass');
    refreshImport();
}

function renderImportOptions() {
    const st = importState;
    const hasReg = st.mapping.regNo !== undefined;
    document.getElementById('imp-options').innerHTML =
        `<div class="imp-panel-title"><i class="fas fa-sliders"></i> Import options</div>
         <div class="imp-fixed-row">
            <label>If a student already exists
                <select class="imp-select" onchange="importState.dupMode = this.value; refreshImport();">
                    <option value="skip"${st.dupMode === 'skip' ? ' selected' : ''}>Skip them</option>
                    <option value="update"${st.dupMode === 'update' ? ' selected' : ''}${hasReg ? '' : ' disabled'}>Update them (matched by Registration No.)</option>
                </select>
                ${hasReg ? '' : '<small>Match the Registration No. column to enable updating.</small>'}
            </label>
            <label>Roll numbers inside each class
                <select class="imp-select" onchange="importState.order = this.value; refreshImport();">
                    <option value="file"${st.order === 'file' ? ' selected' : ''}>Follow the file’s order</option>
                    <option value="name"${st.order === 'name' ? ' selected' : ''}>Alphabetical by student name</option>
                </select>
            </label>
         </div>`;
}

function setImportClassTarget(norm, value) {
    importState.classMap[norm] = value;
    renderImportClassPanel();
    refreshImport();
}

function _impDistinctClassValues() {
    const st = importState, out = new Map();
    st.records.forEach(rec => {
        const raw = st.classMode === 'sheet' ? rec.sheet : st.classMode === 'group' ? rec.groupClass : _impCell(rec, 'studentClass');
        if (!raw) return;
        const norm = _impNorm(raw);
        if (!out.has(norm)) out.set(norm, { raw, norm, count: 0 });
        out.get(norm).count++;
    });
    return [...out.values()];
}

function refreshImportRow(key) {
    const st = importState;
    const row = document.querySelector(`#imp-rows .imp-row[data-key="${key}"]`);
    if (!row || !st) return;
    const field = IMPORT_ALL_FIELDS.find(f => f.key === key);
    const header = st.mapping[key];
    const has = header !== undefined;
    const sel = row.querySelector('select');
    const hint = document.getElementById('imp-hint-' + key);

    /* The class column is only used for placing students when the class comes from a column; the other ways don't need it. */
    const isClass = field.special === 'class';
    const disabled = isClass && (st.classMode === 'sheet' || st.classMode === 'group');
    sel.disabled = disabled;
    row.classList.toggle('is-disabled', disabled);
    if (hint && isClass) {
        hint.textContent = st.classMode === 'sheet' ? 'Taken from the sheet name'
            : st.classMode === 'group' ? 'Taken from the class headings in the sheet'
            : st.classMode === 'fixed' ? 'Optional — only used to check which students belong to the class you chose'
            : '';
    }
    /* A student's name can come from one Full Name column or from First + Last Name columns. */
    const nameOk = key === 'fullName' && (st.mapping.firstName !== undefined);
    const needed = !!field.required && (!isClass || st.classMode === 'column');
    row.classList.toggle('is-matched', has && !disabled);
    row.classList.toggle('is-missing', !has && needed && !disabled && !nameOk);

    const sampleEl = document.getElementById('imp-sample-' + key);
    if (!sampleEl) return;
    if (!has || disabled) { sampleEl.innerHTML = ''; return; }
    let sample = '';
    for (const rec of st.records) { const t = _impCellText(rec.vals[header]); if (t !== '') { sample = t; break; } }
    const a = st.auto[key];
    const badge = a === 'remembered' ? '<span class="imp-auto-badge"><i class="fas fa-clock-rotate-left"></i> Remembered</span>'
                : a === 'content'    ? '<span class="imp-auto-badge is-check" title="Guessed from the values in this column"><i class="fas fa-table-list"></i> Matched by content — please check</span>'
                : a === 'admission'  ? '<span class="imp-auto-badge is-check" title="This looks like the class at admission, not necessarily the current class"><i class="fas fa-door-open"></i> Admission class — please check</span>'
                : a                  ? '<span class="imp-auto-badge"><i class="fas fa-wand-magic-sparkles"></i> Auto-matched</span>' : '';
    sampleEl.innerHTML = badge +
        (sample ? `<span class="imp-sample-text">e.g. ${_impEsc(sample.length > 40 ? sample.slice(0, 40) + '…' : sample)}</span>` : '');
}

function onImportMappingChange(selectEl) {
    const st = importState;
    const key = selectEl.dataset.key;
    if (selectEl.value === '') delete st.mapping[key];
    else st.mapping[key] = st.headers[parseInt(selectEl.value, 10)];
    st.auto[key] = false;
    refreshImportRow(key);
    if (key === 'firstName' || key === 'lastName') refreshImportRow('fullName');
    if (key === 'studentClass') { st.classMap = {}; renderImportClassPanel(); }
    if (key === 'regNo') {
        if (st.mapping.regNo === undefined && st.dupMode === 'update') st.dupMode = 'skip';
        renderImportOptions();
    }
    refreshImport();
}

function closeImportMapper() {
    if (importState && importState.importing) { importState.stop = true; return; }   /* "Stop" while saving */
    closeModal('import-map-modal');
    importState = null;
}

function setImportNoHeader(i, on) {
    const st = importState, sheet = st.sheets[i];
    sheet.noHeader = !!on; sheet.autoNoHeader = false;
    if (!on) sheet.headerRow = null;
    _impParseSheet(sheet);
    st.mapping = {}; st.auto = {}; st.classMap = {}; st.restoreTried = true;
    _impRebuild(); _impPickClassMode(); renderImportAll();
}

function resetImportMapping() {
    const st = importState;
    if (!st || st.importing) return;
    st.mapping = {}; st.auto = {}; st.classMap = {}; st.classModeTouched = false; st.restoreTried = true;
    _impRebuild(); _impPickClassMode(); renderImportAll();
}

function renderImportTarget() {
    const st = importState, t = st.target, configs = getClassConfigs();
    const seg = `<div class="imp-seg">
        <button type="button" class="imp-seg-btn${t.mode === 'choose' ? ' active' : ''}" onclick="setImportTargetMode('choose')"><i class="fas fa-bullseye"></i> Into one class &amp; section</button>
        <button type="button" class="imp-seg-btn${t.mode === 'file' ? ' active' : ''}" onclick="setImportTargetMode('file')"><i class="fas fa-shuffle"></i> Use the classes in my file</button>
    </div>`;
    let html = `<div class="imp-panel-title imp-target-title"><i class="fas fa-school"></i> Which class and section are these students for?
        <span class="imp-panel-sub">${t.mode === 'choose' ? 'Everyone will be saved into the class and section you choose.' : 'Each student goes into the class written in your file.'}</span></div>${seg}`;

    if (t.mode === 'choose') {
        const secs = t.cls ? _impSectionsOf(t.cls) : [];
        const fileHasSection = st.mapping.section !== undefined || _impFileClassInfo().rows.some(r => r.section);
        const needSection = !!t.cls && secs.length > 0 && !t.section;
        const secOpts = !t.cls ? '<option value="">Choose a class first</option>'
            : !secs.length ? '<option value="__none__">This class has no sections</option>'
            : `<option value=""${t.section ? '' : ' selected'} disabled>Select section…</option>` +
              secs.map(s => `<option value="${_impEsc(s)}"${t.section === s ? ' selected' : ''}>${_impEsc(s)}</option>`).join('') +
              `<option value="__none__"${t.section === '__none__' ? ' selected' : ''}>No section</option>` +
              (fileHasSection ? `<option value="__file__"${t.section === '__file__' ? ' selected' : ''}>Use the section written in my file</option>` : '');
        html += `<div class="imp-fixed-row imp-target-row">
            <label class="${t.cls ? '' : 'is-missing'}"><span>Class <span class="imp-req">*</span></span>
                <select class="imp-select imp-big-select" onchange="setImportTargetClass(this.value)">
                    <option value=""${t.cls ? '' : ' selected'} disabled>Select class…</option>
                    ${configs.map(c => `<option value="${_impEsc(c.name)}"${c.name === t.cls ? ' selected' : ''}>${_impEsc(c.name)}</option>`).join('')}
                </select>
                <small>Classes come from Settings. Missing one? <a href="settings.html" target="_blank" rel="noopener">Add it in Settings</a>.</small>
            </label>
            <label class="${needSection ? 'is-missing' : ''}"><span>Section ${secs.length ? '<span class="imp-req">*</span>' : ''}</span>
                <select class="imp-select imp-big-select" ${t.cls && secs.length ? '' : 'disabled'} onchange="setImportTargetSection(this.value)">${secOpts}</select>
                <small>${t.cls && secs.length ? 'Pick “No section” to leave it blank.' : ' '}</small>
            </label>
        </div><div id="imp-target-notes"></div>`;
    }
    document.getElementById('imp-target').innerHTML = html;
}

/** The notices under the class/section choice: the class column picker, a note when the class came from the file,
    and a warning when some students are listed in a different class in the file. */
function _impRenderTargetNotes() {
    const st = importState, el = document.getElementById('imp-target-notes');
    if (!st || !el) return;
    const t = st.target;
    let html = '';

    const cands = _impClassCandidates();
    if (cands.length) {
        const real = cands.filter(c => c.role !== 'previous');
        html += `<div class="imp-notebox">
            ${real.length > 1 ? `<div class="imp-note imp-note-warn"><i class="fas fa-triangle-exclamation"></i> Your file has more than one class column (${real.map(c => `<strong>${_impEsc(c.header)}</strong> — ${_IMP_ROLE_LABEL[c.role].toLowerCase()}`).join(', ')}). The system keeps <strong>one class per student</strong> (the current class), so choose below which column to read — it is only used to check the file against the class you picked.</div>` : ''}
            <label class="imp-colpick">Class column in your file <small>(optional check)</small> ${_impClassColumnPicker()}</label>
        </div>`;
    }

    if (t.cls && t.fromFile) {
        const col = st.mapping.studentClass;
        html += (col && _impClassRole(col) === 'admission')
            ? `<div class="imp-note imp-note-warn"><i class="fas fa-triangle-exclamation"></i> The only class in your file is <strong>${_impEsc(t.cls)}</strong>, taken from the <strong>${_impEsc(col)}</strong> column. That is the class at <em>admission</em> — it may not be the student’s <em>current</em> class. Please confirm the class above.</div>`
            : `<div class="imp-note imp-note-ok"><i class="fas fa-circle-check"></i> Your file only lists <strong>${_impEsc(t.cls)}</strong>, so it was selected for you. Change it above if that’s not right.</div>`;
    }

    if (t.cls) {
        const info = _impFileClassInfo();
        const other = info.rows.filter(fc => fc.raw && fc.cls !== t.cls);
        if (other.length) {
            const tally = {};
            other.forEach(fc => { tally[fc.cls] = (tally[fc.cls] || 0) + 1; });
            const labels = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${_impEsc(c)} × ${n}`).join(', ');
            html += `<div class="imp-note imp-note-warn"><i class="fas fa-triangle-exclamation"></i> <strong>${other.length} of ${st.records.length}</strong> students are listed in a different class in your file (${labels}). What should happen to them?</div>
                <div class="imp-radio-col">
                    <label><input type="radio" name="imp-mismatch" ${t.mismatch === 'import' ? 'checked' : ''} onchange="setImportMismatch('import')"> Import them into <strong>${_impEsc(t.cls)}</strong> as well</label>
                    <label><input type="radio" name="imp-mismatch" ${t.mismatch === 'skip' ? 'checked' : ''} onchange="setImportMismatch('skip')"> Skip them — import only the students listed as <strong>${_impEsc(t.cls)}</strong></label>
                </div>`;
        }
    }
    el.innerHTML = html;
}

function renderImportColSummary() {
    const st = importState;
    const mapped = IMPORT_ALL_FIELDS.filter(f => st.mapping[f.key] !== undefined);
    const shown = mapped.slice(0, 10);
    const nameOk = st.mapping.fullName !== undefined || st.mapping.firstName !== undefined;
    document.getElementById('imp-colsummary').innerHTML =
        `<div class="imp-panel-title"><i class="fas fa-table-columns"></i> Columns found in your file
            <button type="button" class="imp-link-btn imp-reset-btn" onclick="setImportStep(2)">Review &amp; change <i class="fas fa-arrow-right"></i></button></div>
         ${nameOk ? '' : '<div class="imp-note imp-note-warn"><i class="fas fa-triangle-exclamation"></i> No student name column was found — open <strong>Review &amp; change</strong> and choose it.</div>'}
         <div class="imp-chip-row">${shown.map(f => `<span class="imp-chip imp-chip-map">${_impEsc(f.label)} <i class="fas fa-arrow-left"></i> ${_impEsc(st.mapping[f.key])}</span>`).join('')}
            ${mapped.length > shown.length ? `<span class="imp-chip">+ ${mapped.length - shown.length} more</span>` : ''}
            ${mapped.length === 0 ? '<span class="imp-chip">Nothing matched yet</span>' : ''}</div>`;
}

function setImportStep(n, silent) {
    const st = importState;
    if (!st) return;
    st.step = n;
    document.getElementById('imp-step1').hidden = n !== 1;
    document.getElementById('imp-step2').hidden = n !== 2;
    document.querySelector('#imp-title span').textContent = n === 1 ? 'Import Students' : 'Match Columns & Review';
    const sb = document.getElementById('imp-step-btn');
    sb.innerHTML = n === 1 ? 'Review columns <i class="fas fa-arrow-right"></i>' : '<i class="fas fa-arrow-left"></i> Back';
    if (!silent) { const body = document.querySelector('#import-map-modal .modal-body-scroll'); if (body) body.scrollTop = 0; }
}
function toggleImportStep() { if (importState) setImportStep(importState.step === 1 ? 2 : 1); }

function setImportTargetMode(mode) {
    const st = importState;
    st.target.mode = mode; st.targetTouched = true;
    _impApplyTarget();
    renderImportTarget();
    renderImportClassPanel();
    refreshImportRow('studentClass');
    refreshImport();
}
function setImportTargetClass(value) {
    const st = importState, t = st.target;
    t.cls = value; t.section = ''; t.fromFile = false; st.targetTouched = true;
    _impAutoSection();
    _impApplyTarget();
    renderImportTarget();
    refreshImport();
}
function setImportTargetSection(value) {
    const st = importState;
    st.target.section = value; st.targetTouched = true;
    renderImportTarget();
    refreshImport();
}
function setImportMismatch(value) {
    importState.target.mismatch = value;
    refreshImport();
}

/* ---------- 3. VALUE CLEANERS ---------- */

function _impCell(rec, key) {
    const h = importState.mapping[key];
    return h === undefined ? '' : _impCellText(rec.vals[h]);
}
function _impRaw(rec, key) {
    const h = importState.mapping[key];
    return h === undefined ? '' : rec.vals[h];
}

function _impToIsoDate(v) {
    const pad = n => String(n).padStart(2, '0');
    /* a real calendar date? (31/02/2015 is not) */
    const valid = (y, m, d) => {
        if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
        const t = new Date(Date.UTC(y, m - 1, d));
        return (t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d) ? `${y}-${pad(m)}-${pad(d)}` : '';
    };
    const fromDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (v == null || v === '') return '';
    if (v instanceof Date) {
        if (isNaN(v)) return '';
        return fromDate(new Date(v.getTime() + 12 * 3600 * 1000)); /* +12h: immune to SheetJS timezone drift */
    }
    if (typeof v === 'number') {
        if (v < 1000) return '';
        const d = new Date(Math.round((v - 25569) * 86400000));
        return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    let s = String(v).trim();
    /* tidy: drop a trailing time ("14/03/2015 00:00:00", "… 12:30 PM"), spaces around separators, "14th" → "14" */
    s = s.replace(/[\sT]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm)?\s*(z|[+-]\d{2}:?\d{2})?$/i, '')
         .replace(/\s*([-\/.])\s*/g, '$1')
         .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
         .replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^\d{5}(\.\d+)?$/.test(s)) return _impToIsoDate(parseFloat(s));   /* an Excel date number saved as text */
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);     /* day-first, like Pakistan */
    if (m) {
        let y = parseInt(m[3], 10);
        if (m[3].length === 2) y += y <= 29 ? 2000 : 1900;
        let day = parseInt(m[1], 10), mon = parseInt(m[2], 10);
        if (mon > 12 && day <= 12) { const t = day; day = mon; mon = t; }
        return valid(y, mon, day);
    }
    if (/[A-Za-z]{3}/.test(s)) {                                   /* "14 March 2015", "14-Mar-15" */
        const parsed = new Date(s);
        if (!isNaN(parsed)) return fromDate(new Date(parsed.getTime() + 12 * 3600 * 1000));
    }
    return '';
}

function _impNumber(v) {
    if (v === '' || v == null) return 0;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
}
function _impGender(v) {
    const s = String(v).trim().toLowerCase();
    if (!s) return '';
    if (/^(m|male|boy|man|son)$/.test(s)) return 'Male';
    if (/^(f|female|girl|woman|daughter)$/.test(s)) return 'Female';
    return 'Other';
}
function _impGuardianRole(v) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    /* lower-case, punctuation removed: "S/O", "Son-of", "Father's" → "so", "son of", "fathers" */
    const s = raw.toLowerCase().replace(/[\/.\-_,()]+/g, ' ').replace(/['’`]s\b/g, '').replace(/\s+/g, ' ').trim();
    const has = re => re.test(s);
    /* Order matters: "grandfather" must not become Father, "step mother" is a Mother, … */
    if (has(/\b(grand\s?(parent|parents|father|mother|pa|ma)|dada|dadi|nana|nani)\b/)) return 'Grandparent';
    if (has(/\b(legal\s?guardian|guardian|gardian|custodian)\b/)) return 'Legal Guardian';
    if (has(/\b(mother|mom|mum|mama|mummy|ammi|ami|amma|maa|walida|walidah|mother\s?in\s?law)\b/)) return 'Mother';
    if (has(/\b(father|dad|daddy|baba|abu|abbu|abba|walid|papa|pita|abbo|baap)\b/)) return 'Father';
    if (has(/\b(brother|bro|bhai|bhaijan|bhaiya)\b/)) return 'Brother';
    if (has(/\b(sister|sis|behn|behen|bahan|baji|api|aapa)\b/)) return 'Sister';
    if (has(/\b(uncle|chacha|chachu|mamu|mamoo|taya|tayya|phupha|phuphi|khala|fufa|khalu)\b/)) return 'Uncle';
    /* The file says how the STUDENT relates to the guardian ("Son", "Daughter", "S/O", "D/O") —
       that means the guardian is the father. */
    if (has(/^(s o|d o|w o|so|do|wo)$/) || has(/\b(son|daughter|beta|beti|child|student|boy|girl|sibling)\b/) ||
        has(/\b(son|daughter) of\b/) || has(/\b(s o|d o)\b/)) return 'Father';
    return raw;
}
function _impCnic(v) {
    const raw = String(v).trim(), d = raw.replace(/\D/g, '');
    return d.length === 13 ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` : raw;
}
function _impPhone(v) {
    const raw = String(v).trim();
    let d = raw.replace(/\D/g, '');
    if (d.length === 10 && d[0] === '3') d = '0' + d;
    if (d.length === 12 && d.startsWith('92')) d = '0' + d.slice(2);
    return d.length === 11 && d.startsWith('03') ? `${d.slice(0, 4)}-${d.slice(4)}` : raw;
}
function _impAgeFromDob(iso) {
    if (!iso) return '';
    const dob = new Date(iso), today = new Date();
    if (isNaN(dob)) return '';
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age >= 0 ? age + ' Years' : '';
}

function _impClassNumber(raw) {
    const t = String(raw).trim();
    let s = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const stripped = s.replace(/^(class|grade|std|standard|year|form)\s*/, '').trim();
    const hadPrefix = stripped !== s;
    s = stripped;
    if (!s) return null;
    let m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
    if (m) return parseInt(m[1], 10);
    if (_IMP_WORD_NUM[s] !== undefined) return _IMP_WORD_NUM[s];
    if (_IMP_ROMAN[s] !== undefined && (hadPrefix || t === t.toUpperCase())) return _IMP_ROMAN[s];
    return null;
}
const _IMP_WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
                        first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const _IMP_ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

/** Match what is written in the file ("1", "5th", "Class Five", "V", "Nursery", "1-A", "Grade 2 B") to a class in
    Settings. When a section letter is attached ("1-A") it is returned separately. */
function _impMatchClass(v) {
    const raw = String(v).trim();
    if (!raw) return { value: '', known: true, section: '' };
    const names = getClassConfigs().map(c => c.name);
    const find = text => {
        const n = _impNorm(text);
        let hit = names.find(x => _impNorm(x) === n);
        if (hit) return hit;
        const num = _impClassNumber(text);
        if (num !== null) { const same = names.filter(x => _impClassNumber(x) === num); if (same.length === 1) return same[0]; }
        if (/^(playgroup|pg|play)$/.test(n)) hit = names.find(x => /playgroup/.test(_impNorm(x)));
        if (!hit && /^(prep|preparatory|kg)$/.test(n)) hit = names.find(x => /^(prep|preparatory)/.test(_impNorm(x)));
        if (!hit) hit = names.find(x => _impClassNumber(x) === null && _impNorm(x).length >= 4 && n.includes(_impNorm(x)));
        return hit || null;
    };
    const direct = find(raw);
    if (direct) return { value: direct, known: true, section: '' };
    const sp = raw.match(/^(.*?)[\s\-_\/.]*([A-Za-z])$/);               /* "1A", "Grade 2 - B" */
    if (sp && sp[1].trim()) {
        const h2 = find(sp[1].trim());
        if (h2) return { value: h2, known: true, section: sp[2].toUpperCase() };
    }
    return { value: raw, known: false, section: '' };
}

function _impMatchSection(className, v) {
    const raw = String(v).trim();
    if (!raw) return '';
    const cfg = getClassConfigMap()[className];
    const list = cfg && Array.isArray(cfg.sections) ? cfg.sections : [];
    return list.find(s => _impNorm(s) === _impNorm(raw)) || raw.toUpperCase();
}

/** Cleaned values for the fields that are mapped AND filled in on this row. */
function _impCleanRow(rec) {
    const v = {};
    const set = (k, val) => { if (val !== '' && val !== undefined && val !== null) v[k] = val; };
    const t = k => _impCell(rec, k);
    const num = k => { const x = t(k); return x === '' ? '' : _impNumber(x); };

    set('regNo', t('regNo'));
    set('fullName', t('fullName') || [t('firstName'), t('lastName')].filter(Boolean).join(' '));
    set('rollNo', t('rollNo'));
    set('admissionClass', (() => { const raw = t('admissionClass'); if (!raw) return ''; const m = _impMatchClass(raw); return m.known && m.value ? m.value : raw.trim(); })());
    set('admissionDate', _impToIsoDate(_impRaw(rec, 'admissionDate')));
    set('gender', _impGender(t('gender')));
    set('dob', _impToIsoDate(_impRaw(rec, 'dob')));
    set('studentBform', _impCnic(t('studentBform')));
    set('medicalIssues', t('medicalIssues'));
    const orphan = t('orphanStatus');
    if (orphan) set('orphanStatus', /^(orphan|yes|y|true|1)$/i.test(orphan) ? 'Orphan' : 'Not Orphan');
    set('previousSchool', t('previousSchool'));
    set('previousClass', t('previousClass'));
    set('guardianName', t('guardianName') || t('fatherFullName'));
    set('guardianRole', _impGuardianRole(t('guardianRole')));
    set('guardianCnic', _impCnic(t('guardianCnic') || t('fatherCnic')));
    set('fatherFullName', t('fatherFullName'));
    set('fatherCnic', _impCnic(t('fatherCnic')));
    /* Contact numbers: "0300-1234567 | 0311-7654321" → before the bar = primary, after the bar = secondary.
       Only one number (no bar) → it is saved as BOTH the primary and the secondary contact number. */
    {
        const BAR = /\s*[|｜¦]\s*/;
        const c1 = t('phone1'), c2 = t('phone2');
        let p1 = '', p2 = '';
        const src = c1 || c2;
        if (BAR.test(src)) {
            const parts = src.split(BAR).map(x => x.trim()).filter(Boolean);
            p1 = parts[0] || '';
            p2 = parts[1] || '';
            if (c1 && c2 && !BAR.test(c2) && !p2) p2 = c2;
        } else {
            p1 = c1 || c2;
            p2 = (c1 && c2) ? c2 : p1;
        }
        if (!p2) p2 = p1;
        set('phone1', _impPhone(p1));
        set('phone2', _impPhone(p2));
    }
    set('permanentAddress', t('permanentAddress') || t('mailingAddress'));
    set('mailingAddress', t('mailingAddress'));
    const tm = t('transportMode');
    if (tm) set('transportMode', /school|provided|^(yes|y|true|1)$/i.test(tm) ? 'School Provided' : 'Private');
    const tt = t('transportType').toLowerCase();
    if (tt) set('transportType', /coaster/.test(tt) ? 'Coaster' : /van/.test(tt) ? 'School Van' : /bus/.test(tt) ? 'School Bus' : 'None');
    set('transportFee', num('transportFee'));
    set('standardFee', num('standardFee'));
    set('admissionFee', num('admissionFee'));
    set('tuitionDiscount', num('tuitionDiscount'));
    set('transportDiscount', num('transportDiscount'));
    set('siblingDiscount', num('siblingDiscount'));
    Object.keys(IMP_MAX_LEN).forEach(k => { if (typeof v[k] === 'string' && v[k].length > IMP_MAX_LEN[k]) v[k] = v[k].slice(0, IMP_MAX_LEN[k]).trim(); });
    return v;
}

function _impResolveClass(rec) {
    const st = importState;
    if (st.classMode === 'fixed') {
        return st.fixedClass ? { cls: st.fixedClass, known: getClassConfigs().some(c => c.name === st.fixedClass), sectionHint: '' } : { empty: true };
    }
    const raw = st.classMode === 'sheet' ? rec.sheet : st.classMode === 'group' ? rec.groupClass : _impCell(rec, 'studentClass');
    if (!raw) return { empty: true };
    const norm = _impNorm(raw);
    const m = _impMatchClass(raw);
    let target = st.classMap[norm];
    if (target === undefined) target = m.known && m.value ? m.value : IMP_KEEP;
    if (target === IMP_SKIP) return { skip: true };
    if (target === IMP_KEEP) return { cls: raw.trim(), known: false, sectionHint: '' };
    return { cls: target, known: true, sectionHint: (m.value === target ? m.section : '') };
}

function _impBuildNewStudent(vals, cls, section, todayIso) {
    const s = {
        fullName: vals.fullName, studentClass: cls, section: section || '',
        admissionClass: vals.admissionClass || cls,
        gender: vals.gender || '', dob: vals.dob || '', age: _impAgeFromDob(vals.dob),
        admissionDate: vals.admissionDate || todayIso,
        studentBform: vals.studentBform || '', medicalIssues: vals.medicalIssues || '',
        orphanStatus: vals.orphanStatus || 'Not Orphan',
        previousSchool: vals.previousSchool || '', previousClass: vals.previousClass || '',
        guardianName: vals.guardianName || '', guardianRole: vals.guardianRole || '', guardianCnic: vals.guardianCnic || '',
        fatherFullName: vals.fatherFullName || '', fatherCnic: vals.fatherCnic || '',
        phone1: vals.phone1 || '', phone2: vals.phone2 || '',
        permanentAddress: vals.permanentAddress || '',
        mailingAddress: vals.mailingAddress || vals.permanentAddress || '',
        transportMode: vals.transportMode || 'Private', transportType: vals.transportType || 'None',
        transportFee: vals.transportFee || 0,
        standardFee: vals.standardFee !== undefined ? vals.standardFee : getStandardFeeForClass(cls),
        admissionFee: vals.admissionFee || 0,
        tuitionDiscount: vals.tuitionDiscount || 0, transportDiscount: vals.transportDiscount || 0,
        siblingDiscount: vals.siblingDiscount || 0,
        rollNo: vals.rollNo || '', regNo: vals.regNo || '',
        status: 'active', isLifetime: false
    };
    s.netPayable = Math.max(0, (s.standardFee + s.admissionFee + s.transportFee)
                             - (s.tuitionDiscount + s.transportDiscount + s.siblingDiscount));
    return s;
}

/* ---------- 4. THE PLAN (shared by the live preview and the real import) ---------- */

function _impRowIssues(rec, vals) {
    const out = [];
    const label = k => (IMPORT_ALL_FIELDS.find(f => f.key === k) || { label: k }).label;
    const add = (k, problem, kind) => out.push({ field: k, label: label(k), problem, kind: kind || 'check', value: _impCell(rec, k), rowNo: rec.rowNo, sheet: rec.sheet, name: vals.fullName });
    const given = k => _impCell(rec, k) !== '';
    ['dob', 'admissionDate'].forEach(k => { if (given(k) && !vals[k]) add(k, 'can’t be read as a date'); });
    if (vals.dob) {
        const y = parseInt(vals.dob.slice(0, 4), 10), now = new Date().getFullYear();
        if (y > now || y < now - 30) add('dob', `looks unusual (year ${y})`);
    }
    if (given('gender') && vals.gender === 'Other' && !/^(o|other|transgender|trans)$/i.test(_impCell(rec, 'gender'))) add('gender', 'is not recognised (saved as Other)');
    ['studentBform', 'guardianCnic', 'fatherCnic'].forEach(k => { if (given(k) && _impCell(rec, k).replace(/\D/g, '').length !== 13) add(k, 'should have 13 digits'); });
    ['phone1', 'phone2'].forEach(k => { if (vals[k] && !/^03\d{2}-\d{7}$/.test(vals[k])) add(k, 'doesn’t look like a mobile number'); });
    ['standardFee', 'admissionFee', 'transportFee', 'tuitionDiscount', 'transportDiscount', 'siblingDiscount'].forEach(k => {
        if (given(k) && !/\d/.test(_impCell(rec, k))) add(k, 'is not a number');
    });
    /* longer than the admission form allows → it was shortened */
    Object.keys(IMP_MAX_LEN).forEach(k => { if (_impCell(rec, k).length > IMP_MAX_LEN[k]) add(k, `was longer than ${IMP_MAX_LEN[k]} characters and was shortened`); });
    /* the admission form requires these — flag what is empty so it can be completed later via Edit Student */
    IMP_FORM_REQUIRED.forEach(k => { if (!given(k) && !(k === 'permanentAddress' && vals.permanentAddress)) add(k, 'is empty', 'missing'); });
    return out;
}

/* ---------- 4b. SIBLINGS — same father = same family ----------
   Uses the SAME rule as the admission form's findGuardianMatch(): Father Full Name + Father CNIC
   must match (guardian details and address are NOT used), and only ACTIVE students count (graduated /
   dropped students are never linked). A row missing either is never auto-linked, so two
   blanks can't look like "the same father". Only families that contain at least one student from
   THIS import are touched. The family shares one 00X code (siblingGroupId), exactly like the manual
   "Mark as Sibling" flow. */

function _impIsActive(s) { return window.isActiveStudent ? window.isActiveStudent(s) : (!s.status || s.status === 'active'); }

function _impSiblingKey(s) {
    const clean = v => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
    const name = clean(s.fatherFullName);
    const cnic = String(s.fatherCnic == null ? '' : s.fatherCnic).replace(/\D/g, '');   /* 12345-1234567-1 and 1234512345671 are the same */
    if (!name || !cnic || /^0+$/.test(cnic)) return '';
    return [name, cnic].join('|');
}

function _impSiblingList(s) {
    let a = s.hasSiblings;
    if (typeof a === 'string') { try { a = JSON.parse(a || '[]'); } catch (e) { a = []; } }
    return Array.isArray(a) ? a : [];
}

function _impMaxGroupNo(students) {
    let max = 0;
    students.forEach(s => {
        const m = String(s.siblingGroupId || '').match(/^00(\d+)$/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return max;
}

/** Returns [{ groupId, members }] — groupId is '' when the family has no 00X code yet. */
function _impFindSiblingFamilies(students, isNew) {
    const act = students.filter(_impIsActive);
    const byKey = new Map();
    act.forEach(s => {
        const k = _impSiblingKey(s);
        if (!k) return;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(s);
    });
    const out = [];
    byKey.forEach(list => {
        if (list.length < 2 || !list.some(isNew)) return;
        /* Family already has a code (a sibling was linked before) → reuse it. */
        const coded = list.find(m => m.siblingGroupId);
        const groupId = coded ? String(coded.siblingGroupId) : '';
        const members = list.filter(m => !m.siblingGroupId || String(m.siblingGroupId) === groupId);
        /* Also include members already in that group whose details differ slightly (e.g. linked by hand). */
        if (groupId) act.forEach(x => { if (String(x.siblingGroupId || '') === groupId && !members.includes(x)) members.push(x); });
        if (members.length < 2 || !members.some(isNew)) return;
        out.push({ groupId, members });
    });
    return out;
}

/** Write fields onto the record that is in the page's CURRENT student list. A background sync can swap that list
    for fresh copies at any moment, so a reference taken earlier may no longer be the one the tables read. */
function _impApplyToLive(regNo, fields) {
    const t = getDatabase().find(s => String(s.regNo) === String(regNo));
    if (t) Object.assign(t, fields);
}

/** Runs after the import has saved: links every family that contains a newly imported student. */
async function _impLinkSiblings(newRegs, out, extra) {
    const cur = getDatabase();
    const families = _impFindSiblingFamilies(cur, s => newRegs.has(String(s.regNo)));
    if (!families.length) return;
    let groupNo = _impMaxGroupNo(cur);

    for (const fam of families) {
        const groupId = fam.groupId || `${SIBLING_PREFIX}${++groupNo}`;   /* 001, 002, 003 … */
        const members = fam.members;
        const jobs = [];
        members.forEach(m => {
            const others = members.filter(x => x !== m);
            const list = _impSiblingList(m).slice();
            others.forEach(o => { if (!list.some(e => e && String(e.regNo) === String(o.regNo))) list.push({ name: o.fullName, regNo: o.regNo }); });
            const names = others.map(o => o.fullName);
            const siblingOf = typeof window.buildSiblingOfString === 'function' ? window.buildSiblingOfString(names) : names.join(', ');
            const same = m.isSibling && String(m.siblingGroupId || '') === groupId && (m.siblingOf || '') === siblingOf && _impSiblingList(m).length === list.length;
            if (!same) jobs.push({ m, patch: { isSibling: true, siblingGroupId: groupId, siblingOf, hasSiblings: list } });
        });

        let saved = 0;
        for (const { m, patch } of jobs) {
            const payload = Object.assign({}, m, patch);
            delete payload.photo;       /* untouched — the server keeps what it has */
            delete payload.certData;
            try {
                const res = await apiSaveStudent(payload);
                const back = Object.assign({}, res || {});
                if (window.normalizeSiblingFieldsFromServer) window.normalizeSiblingFieldsFromServer(back);
                Object.keys(back).forEach(k => { if ((back[k] === null || back[k] === '') && payload[k] !== undefined && payload[k] !== '') delete back[k]; });
                delete back.photo; delete back.certData; delete back.id;   /* never touch the photo / B-Form / local id */
                const fields = Object.assign({}, patch, back);
                Object.assign(m, fields);
                out.applied.push({ regNo: m.regNo, fields });
                _impApplyToLive(m.regNo, fields);
                saved++;
                if (newRegs.has(String(m.regNo))) out.linked++; else out.existingLinked++;
            } catch (err) {
                out.failed++;
                extra.push({ rowNo: '', sheet: '', name: m.fullName, status: 'Sibling link failed', reason: 'Saved, but could not be linked as a sibling: ' + ((err && err.message) || err) });
                console.error('Import: could not link sibling', m.regNo, err);
            }
        }
        if (saved) { out.families++; out.ids.push(groupId); }
    }
}

function buildImportPlan() {
    const st = importState;
    const db = getDatabase();
    const active = window.getActiveDatabase ? window.getActiveDatabase() : db;
    const todayIso = _impToIsoDate(new Date());
    const classOrder = getClassConfigs().map(c => c.name);
    const t = st.target;

    const byReg = new Map();
    db.forEach(s => [s.regNo, s.id].forEach(k => { if (k) byReg.set(String(k), s); }));
    const dupKey = s => [s.fullName, s.guardianName, s.dob || s.phone1 || '', s.studentClass].map(_impNorm).join('|');
    const existingKeys = new Set(db.filter(s => s.fullName && (s.dob || s.phone1)).map(dupKey));
    const seenRegs = new Set();

    const limit = window.getStudentLimit ? window.getStudentLimit() : null;
    let room = limit === null ? Infinity : Math.max(0, limit - active.length);

    const plan = { create: [], createMeta: [], update: [], skipped: [], issueList: [], issueGroups: [], missingGroups: [],
                   noName: 0, noClass: 0, skippedClass: 0, otherClass: 0, dupes: 0, overLimit: 0, unknownClasses: new Set(), perClass: [],
                   noteRows: st.sheets.filter(s => s.include).reduce((n, s) => n + (s.noteRows || 0), 0) };
    const skip = (rec, counter, reason, name) => { plan[counter]++; plan.skipped.push({ rowNo: rec.rowNo, sheet: rec.sheet, name: name || '', reason }); };
    const pending = [];

    st.records.forEach((rec, idx) => {
        const vals = _impCleanRow(rec);
        if (!vals.fullName) { skip(rec, 'noName', 'No student name'); return; }

        const c = _impResolveClass(rec);
        if (c.skip)  { skip(rec, 'skippedClass', 'Its class was set to “Don’t import”', vals.fullName); return; }
        if (c.empty) { skip(rec, 'noClass', 'No class given', vals.fullName); return; }
        if (!c.known) plan.unknownClasses.add(c.cls);

        /* Importing into ONE class: the file's own class column may disagree for some rows. */
        const fc = _impFileClassOf(rec);
        if (t.mode === 'choose' && t.mismatch === 'skip' && fc.raw && fc.cls !== c.cls) {
            skip(rec, 'otherClass', `Listed as “${fc.cls}” in the file, not ${c.cls}`, vals.fullName); return;
        }

        /* Section: the one the user chose (forced), "none", or the one written in the file. */
        let section = '';
        if (t.mode === 'choose') {
            if (t.section === '__file__') { const sr = _impCell(rec, 'section') || fc.section; section = sr ? _impMatchSection(c.cls, sr) : ''; }
            else if (t.section && t.section !== '__none__') section = t.section;
        } else {
            const sr = _impCell(rec, 'section') || c.sectionHint;
            section = sr ? _impMatchSection(c.cls, sr) : '';
        }

        const regNo = vals.regNo ? String(vals.regNo) : '';
        const existing = regNo ? byReg.get(regNo) : null;
        if (existing || (regNo && seenRegs.has(regNo))) {
            if (existing && st.dupMode === 'update' && !seenRegs.has(regNo)) {
                seenRegs.add(regNo);
                _impRowIssues(rec, vals).forEach(i => plan.issueList.push(i));
                plan.update.push({ existing, vals, cls: c.cls, section, rec });
            } else skip(rec, 'dupes', existing ? 'Already exists (same Registration No.)' : 'Registration No. appears twice in the file', vals.fullName);
            return;
        }
        const probe = { fullName: vals.fullName, guardianName: vals.guardianName, dob: vals.dob, phone1: vals.phone1, studentClass: c.cls };
        if (!regNo && (vals.dob || vals.phone1) && existingKeys.has(dupKey(probe))) {
            skip(rec, 'dupes', 'Already exists (same name, guardian, date of birth/phone and class)', vals.fullName); return;
        }
        if (room <= 0) { skip(rec, 'overLimit', 'Over your plan’s student limit', vals.fullName); return; }
        room--;
        if (regNo) seenRegs.add(regNo);
        if (vals.dob || vals.phone1) existingKeys.add(dupKey(probe));
        _impRowIssues(rec, vals).forEach(i => plan.issueList.push(i));
        pending.push({ idx, vals, cls: c.cls, known: c.known, section, rec });
    });

    /* Save class by class: Settings order first (unknown classes last), then section, then name/file order. */
    const rank = cls => { const i = classOrder.indexOf(cls); return i === -1 ? classOrder.length : i; };
    pending.sort((a, b) =>
        rank(a.cls) - rank(b.cls) || a.cls.localeCompare(b.cls, undefined, { numeric: true }) ||
        (a.section || '').localeCompare(b.section || '') ||
        (st.order === 'name' ? a.vals.fullName.localeCompare(b.vals.fullName, undefined, { sensitivity: 'base' }) : a.idx - b.idx));

    /* Roll numbers: continue after the highest one already used in each class. */
    const rollMax = {}, existingCount = {};
    active.forEach(s => {
        if (!s.studentClass) return;
        existingCount[s.studentClass] = (existingCount[s.studentClass] || 0) + 1;
        const r = parseInt(s.rollNo, 10);
        if (!isNaN(r)) rollMax[s.studentClass] = Math.max(rollMax[s.studentClass] || 0, r);
    });

    const perClass = new Map();
    pending.forEach(p => {
        const s = _impBuildNewStudent(p.vals, p.cls, p.section, todayIso);
        if (!s.rollNo) { rollMax[p.cls] = (rollMax[p.cls] || 0) + 1; s.rollNo = String(rollMax[p.cls]); }
        else { const r = parseInt(s.rollNo, 10); if (!isNaN(r)) rollMax[p.cls] = Math.max(rollMax[p.cls] || 0, r); }
        plan.create.push(s);
        plan.createMeta.push({ rowNo: p.rec.rowNo, sheet: p.rec.sheet, name: s.fullName });

        if (!perClass.has(p.cls)) perClass.set(p.cls, { cls: p.cls, count: 0, sections: {}, known: p.known, existing: existingCount[p.cls] || 0, rolls: [] });
        const pc = perClass.get(p.cls);
        pc.count++;
        const secLabel = p.section || 'No section';
        pc.sections[secLabel] = (pc.sections[secLabel] || 0) + 1;
        const r = parseInt(s.rollNo, 10); if (!isNaN(r)) pc.rolls.push(r);
    });
    plan.perClass = [...perClass.values()];

    /* Updates: only the fields that were mapped and filled in change. */
    plan.update.forEach(u => {
        const changes = Object.assign({}, u.vals);
        delete changes.regNo;
        if (!changes.admissionClass && !u.existing.admissionClass && u.existing.studentClass && u.existing.studentClass !== u.cls) {
            changes.admissionClass = u.existing.studentClass;   // class is changing — remember where they were admitted
        }
        changes.studentClass = u.cls;
        if (u.section) changes.section = u.section;
        const merged = Object.assign({}, u.existing, changes);
        if (changes.dob) changes.age = _impAgeFromDob(changes.dob);
        if (['standardFee', 'admissionFee', 'transportFee', 'tuitionDiscount', 'transportDiscount', 'siblingDiscount'].some(k => k in changes)) {
            const n = k => Number(merged[k]) || 0;
            changes.netPayable = Math.max(0, (n('standardFee') + n('admissionFee') + n('transportFee')) - (n('tuitionDiscount') + n('transportDiscount') + n('siblingDiscount')));
        }
        u.changes = changes;
    });

    /* Siblings: new students whose guardian matches (name + CNIC + address + role) another active student. */
    {
        const newSet = new Set(plan.create);
        const fams = _impFindSiblingFamilies(db.concat(plan.create), s => newSet.has(s));
        plan.siblingFamilies = fams.length;
        plan.siblingStudents = fams.reduce((n, f) => n + f.members.filter(m => newSet.has(m)).length, 0);
    }

    /* Group the data-check findings by kind. */
    const groupUp = list => {
        const groups = new Map();
        list.forEach(i => {
            const k = i.field + '|' + i.problem;
            if (!groups.has(k)) groups.set(k, { label: i.label, problem: i.problem, count: 0, rows: [], examples: [] });
            const g = groups.get(k);
            g.count++;
            if (g.rows.length < 8) g.rows.push(i.rowNo);
            if (g.examples.length < 2 && i.value && !g.examples.includes(i.value)) g.examples.push(i.value);
        });
        return [...groups.values()].sort((a, b) => b.count - a.count);
    };
    plan.issueGroups   = groupUp(plan.issueList.filter(i => i.kind !== 'missing'));
    plan.missingGroups = groupUp(plan.issueList.filter(i => i.kind === 'missing'));
    return plan;
}

function refreshImport() {
    const st = importState;
    if (!st) return;
    const plan = st.plan = buildImportPlan();
    const t = st.target;

    const missing = [];
    if (st.mapping.fullName === undefined && st.mapping.firstName === undefined) missing.push('Student name column');
    if (t.mode === 'choose') {
        if (!t.cls) missing.push('Class');
        else if (_impSectionsOf(t.cls).length && !t.section) missing.push('Section');
    } else {
        if (st.classMode === 'column' && st.mapping.studentClass === undefined) missing.push('Class column');
        if (st.classMode === 'group' && !st.hasGroup) missing.push('class headings');
    }

    const skipped = plan.noName + plan.noClass + plan.skippedClass + plan.otherClass + plan.dupes + plan.overLimit;
    const rows = plan.perClass.map(pc => {
        const secs = Object.entries(pc.sections).map(([k, v]) => `${_impEsc(k)}: ${v}`).join(' · ');
        const range = pc.rolls.length ? `${Math.min(...pc.rolls)} – ${Math.max(...pc.rolls)}` : '—';
        return `<tr>
            <td><strong>${_impEsc(pc.cls)}</strong>${pc.known ? '' : ' <span class="imp-tag-warn" title="This class is not set up in Settings">not in Settings</span>'}</td>
            <td class="imp-num">${pc.count}</td>
            <td>${secs}</td>
            <td class="imp-num">${range}</td>
            <td class="imp-num">${pc.existing}</td>
        </tr>`;
    }).join('');

    const notes = [];
    if (plan.update.length)    notes.push(`<span class="imp-pill imp-pill-info"><i class="fas fa-rotate"></i> ${plan.update.length} existing student${plan.update.length === 1 ? '' : 's'} will be updated</span>`);
    if (plan.siblingStudents)  notes.push(`<span class="imp-pill imp-pill-info"><i class="fas fa-people-roof"></i> ${plan.siblingStudents} new student${plan.siblingStudents === 1 ? '' : 's'} will be linked as siblings (${plan.siblingFamilies} ${plan.siblingFamilies === 1 ? 'family' : 'families'})</span>`);
    if (plan.dupes)            notes.push(`<span class="imp-pill"><i class="fas fa-clone"></i> ${plan.dupes} already exist — skipped</span>`);
    if (plan.noName)           notes.push(`<span class="imp-pill imp-pill-warn"><i class="fas fa-user-slash"></i> ${plan.noName} with no name — skipped</span>`);
    if (plan.noClass)          notes.push(`<span class="imp-pill imp-pill-warn"><i class="fas fa-school-circle-xmark"></i> ${plan.noClass} with no class — skipped</span>`);
    if (plan.otherClass)       notes.push(`<span class="imp-pill"><i class="fas fa-filter"></i> ${plan.otherClass} listed in another class — skipped</span>`);
    if (plan.skippedClass)     notes.push(`<span class="imp-pill"><i class="fas fa-ban"></i> ${plan.skippedClass} in classes you chose to skip</span>`);
    if (plan.overLimit)        notes.push(`<span class="imp-pill imp-pill-warn"><i class="fas fa-lock"></i> ${plan.overLimit} over your plan's student limit — skipped</span>`);
    if (plan.noteRows)         notes.push(`<span class="imp-pill"><i class="fas fa-note-sticky"></i> ${plan.noteRows} note / example row${plan.noteRows === 1 ? '' : 's'} (starting with #) ignored</span>`);

    const checks = plan.issueGroups.length
        ? plan.issueGroups.slice(0, 6).map(g => `
            <div class="imp-check"><i class="fas fa-triangle-exclamation"></i>
                <div><strong>${g.count} student${g.count === 1 ? '' : 's'}</strong> — ${_impEsc(g.label)} ${_impEsc(g.problem)}${g.examples.length ? ` (e.g. “${g.examples.map(_impEsc).join('”, “')}”)` : ''}
                <span class="imp-check-rows">Row${g.rows.length > 1 ? 's' : ''} ${g.rows.join(', ')}${g.count > g.rows.length ? '…' : ''}</span></div>
            </div>`).join('') +
          (plan.issueGroups.length > 6 ? `<div class="imp-check-more">+ ${plan.issueGroups.length - 6} more kinds of problems — see the report.</div>` : '')
        : '<div class="imp-check imp-check-ok"><i class="fas fa-circle-check"></i><div>No wrong or unreadable values found.</div></div>';
    const missingHtml = plan.missingGroups.length
        ? `<div class="imp-check imp-check-info"><i class="fas fa-circle-info"></i>
             <div><strong>Not in your file, but required by the admission form:</strong>
             ${plan.missingGroups.map(g => `${_impEsc(g.label)} (${g.count})`).join(' · ')}
             <span class="imp-check-rows">These students are still imported. Complete the details later with Edit Student.</span></div></div>`
        : '';
    const hasReport = plan.skipped.length || plan.issueList.length;

    document.getElementById('imp-preview').innerHTML =
        `<div class="imp-panel-title"><i class="fas fa-eye"></i> Save plan — what will be saved
            <span class="imp-panel-sub">Updates as you change the settings.</span></div>` +
        (plan.perClass.length
            ? `<div class="imp-table-wrap"><table class="imp-plan-table">
                <thead><tr><th>Class</th><th class="imp-num">New students</th><th>By section</th><th class="imp-num">Roll numbers</th><th class="imp-num">Already in class</th></tr></thead>
                <tbody>${rows}</tbody></table></div>`
            : '<div class="imp-note">No new students would be added with the current settings.</div>') +
        (notes.length ? `<div class="imp-pill-row">${notes.join('')}</div>` : '') +
        `<div class="imp-checks-head"><span><i class="fas fa-clipboard-check"></i> Data checks</span>
            ${hasReport ? '<button type="button" class="imp-link-btn" onclick="downloadImportReport()"><i class="fas fa-download"></i> Download report (CSV)</button>' : ''}</div>
         ${checks}${missingHtml}`;

    const sum = document.getElementById('imp-summary');
    const btn = document.getElementById('imp-run-btn');
    const doing = plan.create.length + plan.update.length;
    if (missing.length) {
        sum.innerHTML = `<i class="fas fa-circle-exclamation"></i><span>Still needed: <strong>${_impEsc(missing.join(', '))}</strong></span>`;
    } else {
        const where = t.mode === 'choose' && t.cls
            ? ` → <strong>${_impEsc(t.cls)}${t.section && t.section !== '__none__' && t.section !== '__file__' ? ' / ' + _impEsc(t.section) : ''}</strong>` : '';
        sum.innerHTML = `<i class="fas fa-circle-check"></i><span><strong>${plan.create.length}</strong> new` +
            (plan.update.length ? ` · <strong>${plan.update.length}</strong> updated` : '') +
            ` · <strong>${skipped}</strong> skipped${where}</span>`;
    }
    sum.classList.toggle('imp-summary-warn', missing.length > 0);
    btn.disabled = missing.length > 0 || doing === 0 || st.importing;
    btn.querySelector('span').textContent = doing ? `Import ${doing} Student${doing === 1 ? '' : 's'}` : 'Nothing to Import';

    _impRenderTargetNotes();
}

/* ---------- 5. SAVE ---------- */

async function runStudentImport() {
    const st = importState;
    if (!st || st.importing) return;
    const plan = buildImportPlan();
    if (!plan.create.length && !plan.update.length) return;

    const btn = document.getElementById('imp-run-btn');
    const label = btn.querySelector('span');
    const cancelBtn = document.getElementById('imp-cancel-btn');
    const prog = document.getElementById('imp-progress');
    const bar = document.getElementById('imp-progress-bar');

    st.importing = true; st.stop = false;
    btn.disabled = true;
    cancelBtn.textContent = 'Stop';
    prog.hidden = false; bar.style.width = '0%';

    const db = getDatabase();
    const result = { added: 0, updated: 0, failed: 0, perClass: {}, sec: {} };
    const extra = [];                 /* failed / not-done rows for the report */
    const savedNewRegs = new Set();   /* regNos of the NEW students that were really saved (used for sibling linking) */
    const total = plan.create.length + plan.update.length;
    let done = 0;

    /* Give EVERY new student a unique Registration No. up front. Doing it one by one while saving could hand the
       same number to two students (when the student list refreshed from the server in between), and the server
       then overwrote the earlier student with the later one — so fewer students were saved than were counted. */
    {
        const live = getDatabase();
        const temps = [];
        const reserve = r => { const t = { regNo: r, id: r, _impTemp: true }; live.push(t); temps.push(t); };
        plan.create.forEach(s => { if (s.regNo) reserve(String(s.regNo)); });
        plan.create.forEach((s, i) => {
            if (s.regNo) return;
            s.regNo = window.generateNextRegistrationNumber
                ? window.generateNextRegistrationNumber(s.admissionDate)
                : 'IMP_' + Date.now() + '_' + (i + 1);
            reserve(s.regNo);
        });
        temps.forEach(t => { const k = live.indexOf(t); if (k !== -1) live.splice(k, 1); });
    }

    /* New students — already sorted class by class. */
    for (let i = 0; i < plan.create.length; i++) {
        if (st.stop) break;
        const s = plan.create[i], meta = plan.createMeta[i];
        done++;
        label.textContent = `${s.studentClass}: saving ${done} of ${total}…`;
        bar.style.width = Math.round((done - 1) / total * 100) + '%';
        s.id = s.regNo;
        try {
            const saved = await apiSaveStudent(s);
            const back = Object.assign({}, saved || {});
            Object.keys(back).forEach(k => { if ((back[k] === null || back[k] === '') && s[k] !== undefined && s[k] !== '') delete back[k]; });
            db.push(Object.assign({}, s, back, { id: s.regNo }));
            result.added++;
            savedNewRegs.add(String(s.regNo));
            result.perClass[s.studentClass] = (result.perClass[s.studentClass] || 0) + 1;
            const sk = s.section || 'No section';
            (result.sec[s.studentClass] = result.sec[s.studentClass] || {})[sk] = ((result.sec[s.studentClass] || {})[sk] || 0) + 1;
        } catch (err) {
            result.failed++;
            extra.push({ rowNo: meta.rowNo, sheet: meta.sheet, name: meta.name, status: 'Failed', reason: 'Could not be saved: ' + ((err && err.message) || err) });
            console.error('Import: could not save', s.regNo, err);
        }
    }

    /* Existing students being updated. */
    for (let i = 0; i < plan.update.length; i++) {
        if (st.stop) break;
        const u = plan.update[i];
        done++;
        label.textContent = `Updating ${done} of ${total}…`;
        bar.style.width = Math.round((done - 1) / total * 100) + '%';
        const payload = Object.assign({}, u.existing, u.changes);
        delete payload.photo;      /* untouched — the server keeps what it has */
        delete payload.certData;
        try {
            await apiSaveStudent(payload);
            Object.assign(u.existing, u.changes);
            result.updated++;
        } catch (err) {
            result.failed++;
            extra.push({ rowNo: u.rec.rowNo, sheet: u.rec.sheet, name: u.vals.fullName, status: 'Failed', reason: 'Could not be updated: ' + ((err && err.message) || err) });
            console.error('Import: could not update', u.existing.regNo, err);
        }
    }
    const wasStopped = st.stop;
    if (wasStopped) {
        plan.createMeta.slice(Math.min(done, plan.create.length)).forEach(m => extra.push({ rowNo: m.rowNo, sheet: m.sheet, name: m.name, status: 'Not imported', reason: 'You stopped the import before this student was saved' }));
        plan.update.slice(Math.max(0, done - plan.create.length)).forEach(u => extra.push({ rowNo: u.rec.rowNo, sheet: u.rec.sheet, name: u.vals.fullName, status: 'Not imported', reason: 'You stopped the import before this student was updated' }));
    }
    {   /* merge into the CURRENT list (it may have been refreshed from the server while saving) */
        const cur = getDatabase();
        db.forEach(s => { if (!cur.some(x => String(x.regNo) === String(s.regNo))) cur.push(s); });
        saveDatabase(cur);
    }

    /* Sibling linking: students from this file who share a guardian (name + CNIC + address + role) with another
       active student get the same 00X sibling-group code, "Sibling of …" text and hasSiblings list. */
    const sibling = { families: 0, linked: 0, existingLinked: 0, failed: 0, ids: [], applied: [] };
    sibling.applied = [];
    if (savedNewRegs.size) {
        label.textContent = 'Linking siblings…';
        /* Pause the background sync while links are saved: a poll that lands in the middle replaces the student list
           with copies, which made the already-enrolled students lose their new sibling link on screen. */
        const live = window.SoftSchoolLiveSync;
        if (live && live.stop) live.stop();
        for (let w = 0; w < 100 && live && live.isBusy && live.isBusy(); w++) await new Promise(r => setTimeout(r, 100));
        try { await _impLinkSiblings(savedNewRegs, sibling, extra); }
        catch (err) { console.error('Import: sibling linking failed', err); }
        sibling.applied.forEach(a => _impApplyToLive(a.regNo, a.fields));   /* make sure every linked student shows it */
        if (live && live.start) live.start();
    }
    bar.style.width = '100%';

    const fileName = st.fileName;
    if (result.added || result.updated) _impSaveMapping(st);   /* remember the matching for next time */
    st.importing = false;
    cancelBtn.textContent = 'Cancel';
    prog.hidden = true;
    closeImportMapper();
    btn.disabled = false;

    const skipped = plan.noName + plan.noClass + plan.skippedClass + plan.otherClass + plan.dupes + plan.overLimit;
    const parts = [];
    if (result.added) {
        const byClass = Object.entries(result.perClass).map(([c, n]) => {
            const secs = Object.entries(result.sec[c] || {}).filter(([k]) => k !== 'No section');
            return `${_impEsc(c)}${secs.length ? ' (' + secs.map(([k, v]) => `${_impEsc(k)}: ${v}`).join(', ') + ')' : ''}: ${n}`;
        }).join(' · ');
        parts.push(`<strong>${result.added} new student${result.added === 1 ? '' : 's'}</strong> imported from <em>${_impEsc(fileName)}</em> — ${byClass}.`);
    }
    if (result.updated)  parts.push(`<strong>${result.updated}</strong> existing student${result.updated === 1 ? '' : 's'} updated.`);
    if (sibling.linked)  parts.push(`<strong>${sibling.linked}</strong> new student${sibling.linked === 1 ? '' : 's'} linked as siblings in <strong>${sibling.families}</strong> famil${sibling.families === 1 ? 'y' : 'ies'} (Sibling ID: ${sibling.ids.map(_impEsc).join(', ')})${sibling.existingLinked ? `, together with <strong>${sibling.existingLinked}</strong> already-enrolled student${sibling.existingLinked === 1 ? '' : 's'}` : ''}.`);
    if (sibling.failed)  parts.push(`${sibling.failed} sibling link(s) couldn't be saved — open the student and use Edit Student, or see the report.`);
    if (!result.added && !result.updated) parts.push(`Nothing was imported from <em>${_impEsc(fileName)}</em>.`);
    if (wasStopped)      parts.push(`Import stopped — ${total - done} student${total - done === 1 ? '' : 's'} not imported.`);
    if (skipped) {
        const why = [];
        if (plan.dupes) why.push(`${plan.dupes} already existed`);
        if (plan.noName) why.push(`${plan.noName} had no name`);
        if (plan.noClass) why.push(`${plan.noClass} had no class`);
        if (plan.otherClass) why.push(`${plan.otherClass} were listed in another class`);
        if (plan.skippedClass) why.push(`${plan.skippedClass} were in skipped classes`);
        if (plan.overLimit) why.push(`${plan.overLimit} were over your plan's student limit`);
        parts.push(`${skipped} row(s) skipped (${why.join(', ')}).`);
    }
    if (result.failed)   parts.push(`${result.failed} record(s) couldn't be saved to the server — check your connection and import again.`);
    if (plan.unknownClasses.size) {
        parts.push(`Class name(s) not found in Settings: <strong>${[...plan.unknownClasses].map(_impEsc).join(', ')}</strong> — add them in Settings so these students appear under a class card.`);
    }
    window._impLastReportCsv = _impBuildReportCsv(plan, extra);
    if (window._impLastReportCsv) {
        parts.push(`<a href="#" class="imp-report-link" onclick="downloadLastImportReport(); return false;"><i class="fas fa-download"></i> Download report</a>`);
    }
    showDataIOStatus(parts.join(' '), (result.failed || sibling.failed) ? 'error' : (result.added || result.updated ? 'success' : 'info'));
    if (typeof showToast === 'function' && (result.added || result.updated)) {
        showToast('Import Complete', `${result.added} added${result.updated ? `, ${result.updated} updated` : ''}${sibling.linked ? `, ${sibling.linked} linked as siblings` : ''}.`, 'success');
    }
    /* Refresh every student view right away (works even if the server can't be reached), then re-sync. */
    if (window.SoftSchoolRefreshStudentViews) window.SoftSchoolRefreshStudentViews();
    else if (window.updateDashboardStats) window.updateDashboardStats();
    if (window.SoftSchoolLiveSync) window.SoftSchoolLiveSync.refreshNow();
}

async function compressImage(file, maxWidth, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scaleFactor = maxWidth / img.width;
                
                // Only resize if the image is wider than maxWidth
                if (img.width > maxWidth) {
                    canvas.width = maxWidth;
                    canvas.height = img.height * scaleFactor;
                } else {
                    canvas.width = img.width;
                    canvas.height = img.height;
                }

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Convert to Base64 (JPEG format is best for compression)
                const base64 = canvas.toDataURL('image/jpeg', quality);
                resolve(base64);
            };
        };
        reader.onerror = error => reject(error);
    });
}

window.toggleUpdOrphanFilter = function() {
    updOrphanFilterActive = !updOrphanFilterActive;
    const btn = document.getElementById('upd-orphan-filter-btn');
    if (updOrphanFilterActive) {
        btn.classList.add('active-filter');
        btn.setAttribute('aria-pressed', 'true');
        btn.innerHTML = '<i class="fas fa-check"></i> Showing Orphans';
    } else {
        btn.classList.remove('active-filter');
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    }
    renderStudentTable();
};

// Toggle for View Directory Modal
window.toggleVoOrphanFilter = function() {
    voOrphanFilterActive = !voOrphanFilterActive;
    const btn = document.getElementById('vo-orphan-filter-btn');

    if (voOrphanFilterActive) {
        btn.classList.add('active-filter');
        btn.setAttribute('aria-pressed', 'true');
        btn.innerHTML = '<i class="fas fa-check"></i> Showing Orphans';
    } else {
        btn.classList.remove('active-filter');
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    }
    renderViewOnlyTable();
};