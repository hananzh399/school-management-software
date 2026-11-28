/*!
 * admin-i18n.js - Admin portal language support (English / Urdu) + right-to-left layout.
 *
 * Loaded in <head> on every admin page, BEFORE the page's own stylesheet, so lang/dir
 * are set before the first paint and the user never sees the layout jump.
 *
 * WHERE THE CHOSEN LANGUAGE IS SAVED
 *   localStorage ('softschool_admin_lang')  -> read instantly on every page load (first paint)
 *   the school's settings row               -> the real home of the setting:
 *        online  : the server            (PUT /api/settings/{schoolId}/language)
 *        offline : the phone's database  (local-api.js answers the same URL from SQLite)
 *        hybrid  : both                  (saved on the phone, then uploaded when internet returns)
 *   The page never calls the server itself: settings.js sends the normal fetch() and
 *   local-api.js decides where it lands. localStorage is only the fast local copy so the
 *   right language is on screen before the settings row has been fetched.
 *
 * WHAT IT GIVES THE REST OF THE APP
 *   AdminI18n.t(key, vars)   -> translated text  ("{n} students" -> "12 طلبہ")
 *   AdminI18n.getLang()      -> 'en' | 'ur'
 *   AdminI18n.setLang(l)     -> switch language, re-apply, remember locally
 *   AdminI18n.isRTL()        -> true when the layout is right-to-left
 *   AdminI18n.apply()        -> re-translate the page (call after you build HTML in JS)
 *   AdminI18n.formatDate(d)  AdminI18n.formatMonth('2026-10')  AdminI18n.monthShort(i)
 *   event 'softschool:lang-changed' { lang, dir }
 *
 * HOW TO TRANSLATE MARKUP  (no JavaScript needed)
 *   <span data-i18n="nav.dashboard">Dashboard</span>
 *   <input data-i18n-placeholder="common.searchMenu">
 *   <button data-i18n-aria="hdr.openSidebar" data-i18n-title="hdr.openSidebar">
 *   <h2><i class="fas fa-school"></i> <span data-i18n="set.contactDetails">Contact Details</span></h2>
 *
 *   The English text stays in the HTML as the fallback, so a key that is missing from the
 *   dictionary leaves the page exactly as it is today instead of blanking it out.
 *
 * ADDING A NEW PAGE: add its keys to STRINGS.en and STRINGS.ur below, then tag the markup.
 * A key that exists in 'en' but not in 'ur' falls back to English - never to an empty string.
 */
(function () {
  'use strict';
  if (window.AdminI18n) return;

  var LOCAL_KEY = 'softschool_admin_lang';
  var FONT_ID = 'ssUrduFontLink';
  // Naskh (not Nastaliq) on purpose: a dense admin screen has small labels, table cells and
  // numbers, and Naskh stays sharp and readable at 12-14px where Nastaliq does not.
  var FONT_URL = 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap';

  // ═══════════════════════════════════════════════════════════════════
  //  DICTIONARY
  // ═══════════════════════════════════════════════════════════════════
  var STRINGS = {
    en: {
      // ─── shared shell: sidebar ───
      'nav.menu': 'Menu',
      'nav.dashboard': 'Dashboard',
      'nav.students': 'Student Management',
      'nav.staff': 'Staff Management',
      'nav.attendance': 'Attendance',
      'nav.finance': 'Fees & Finance',
      'nav.reports': 'Reports & Analytics',
      'nav.announcements': 'Announcements',
      'nav.examination': 'Examination',
      'nav.sessions': 'Sessions',
      'nav.settings': 'Settings',
      'nav.logout': 'Logout',

      // ─── shared shell: header ───
      'hdr.openSidebar': 'Open sidebar',
      'hdr.closeSidebar': 'Close sidebar',
      'hdr.closeMenu': 'Close menu',
      'hdr.toggleTheme': 'Toggle theme',
      'hdr.searchMenu': 'Search menu...',
      'hdr.settingsTitle': 'Admin Settings',
      'set.pageTitle': 'System Configuration',
      'set.changesApply': 'Changes apply immediately.',
      'hdr.settingsSub': 'School profile, classes, fees and app behaviour.',

      // ─── common words used all over the portal ───
      'common.save': 'Save',
      'common.saveAll': 'Save All',
      'common.saveChanges': 'Save Changes',
      'common.cancel': 'Cancel',
      'common.close': 'Close',
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'common.add': 'Add',
      'common.remove': 'Remove',
      'common.reset': 'Reset',
      'common.confirm': 'Confirm',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.ok': 'OK',
      'common.back': 'Back',
      'common.next': 'Next',
      'common.search': 'Search',
      'common.loading': 'Loading...',
      'common.saving': 'Saving...',
      'common.optional': 'Optional',
      'common.required': 'Required',
      'common.enabled': 'Enabled',
      'common.disabled': 'Disabled',
      'common.on': 'On',
      'common.off': 'Off',
      'common.none': 'None',
      'common.total': 'Total',
      'common.status': 'Status',
      'common.actions': 'Actions',
      'common.name': 'Name',
      'common.date': 'Date',
      'common.month': 'Month',
      'common.year': 'Year',
      'common.class': 'Class',
      'common.section': 'Section',
      'common.student': 'Student',
      'common.students': 'Students',
      'common.staff': 'Staff',
      'common.teacher': 'Teacher',
      'common.amount': 'Amount',
      'common.rupees': 'Rs.',
      'common.noData': 'No data to show',
      'common.savedOk': 'All configurations saved successfully.',
      'common.saveFailed': 'Could not save to the server. Check your connection and try again.',
      'common.offlineSaved': 'Saved on this device. It will be uploaded when internet returns.',

      // ─── settings page: tabs ───
      'set.tabInfo': 'Info & Setting',
      'set.tabClasses': 'Classes & Fees',
      'set.tabLateFee': 'Late Fee',
      'set.tabVariables': 'Pay Variables',
      'set.tabAttendance': 'Attendance Setting',
      'set.tabWhatsApp': 'WhatsApp',
      'set.tabTeacherLogin': 'Teacher Login',

      // ─── settings page: contact details card ───
      'set.contactDetails': 'Contact Details',
      'set.contactDetailsSub': 'Printed on certificates, ID cards and vouchers.',
      'set.schoolAddress': 'School Address',
      'set.schoolAddressPh': 'Street, area, city, postal code',
      'set.schoolAddressHint': 'Shown on documents.',
      'set.contactPhone': 'Contact Phone',
      'set.contactPhonePh': 'e.g. 041-1234567',
      'set.contactPhoneHint': 'Primary contact number.',
      'set.altPhone': 'Alternate / WhatsApp Number',
      'set.altPhoneHint': 'Optional second number.',
      'set.email': 'Email Address',
      'set.emailHint': 'Used on official documents.',
      'set.website': 'Website',
      'set.websiteHint': 'Optional.',
      'set.principal': 'Principal / Head Name',
      'set.principalHint': 'Signatory on certificates.',
      'set.regNo': 'Registration / EMIS No.',
      'set.regNoHint': 'If required by your board.',

      // ─── settings page: LANGUAGE card (this feature) ───
      'set.language': 'Language',
      'set.languageSub': 'Choose the language for the whole admin portal.',
      'set.languageLabel': 'Portal Language',
      'set.languageHint': 'Urdu also switches the layout to right-to-left.',
      'set.langEnglish': 'English',
      'set.langUrdu': 'Urdu',
      'set.langEnglishNative': 'English',
      'set.langUrduNative': 'اردو',
      'set.langEnglishDesc': 'Left-to-right layout',
      'set.langUrduDesc': 'Right-to-left layout',
      'set.langNoteOnline': 'Saved on the server, so it follows you to every device.',
      'set.langNoteOffline': 'Saved on this device.',
      'set.langNoteHybrid': 'Saved on this device and uploaded to the server when internet returns.',
      'set.langSaved': 'Language changed to {lang}.',
      'set.langSavedLocal': 'Language changed to {lang}. It will be uploaded when internet returns.',
      'set.langFailed': 'Language changed on this device, but the server could not be reached.',
      'set.langApplying': 'Applying language...',

      // ─── settings page: admission mandatory fields ───
      'set.admissionTitle': 'New Admission — Mandatory Fields',
      'set.allRequired': 'All required',
      'set.allOptional': 'All optional',

      // ─── settings page: late fee ───
      'set.lateFeeTitle': 'Late Fee Rule',
      'set.lateFeeEnabled': 'Charge a late fee',
      'set.lateFeeDeadline': 'Deadline Day',
      'set.lateFeeType': 'Late Fee Type',
      'set.lateFeeFixed': 'Fixed amount',
      'set.lateFeePercent': 'Percentage',
      'set.lateFeeAmount': 'Late Fee Amount',
      'set.lateFeeGrace': 'Grace Days',

      // ─── settings page: pay variables ───
      'set.payVariables': 'Pay Variables',
      'set.penaltyType': 'Absence Penalty Type',
      'set.penaltyValue': 'Penalty Value',
      'set.bonus': 'Attendance Bonus',

      // ─── settings page: classes ───
      'set.classesTitle': 'Classes & Fees',
      'set.className': 'Class Name',
      'set.classFee': 'Tuition Fee',
      'set.classFund': 'Fund',
      'set.sections': 'Sections',
      'set.addClass': 'Add Class',

      // ─── dashboard ───
      'dash.totalStudents': 'Total Students',
      'dash.totalStaff': 'Total Staff',
      'dash.presentToday': 'Present Today',
      'dash.feesCollected': 'Fees Collected',
      'dash.quickActions': 'Quick Actions',
      'dash.recentActivity': 'Recent Activity',

      // ─── month + weekday names (used by date pickers and reports) ───
      'mon.full.0': 'January', 'mon.full.1': 'February', 'mon.full.2': 'March',
      'mon.full.3': 'April', 'mon.full.4': 'May', 'mon.full.5': 'June',
      'mon.full.6': 'July', 'mon.full.7': 'August', 'mon.full.8': 'September',
      'mon.full.9': 'October', 'mon.full.10': 'November', 'mon.full.11': 'December'
    },

    // ═══════════════════════════════════════════════════════════════════
    //  URDU - plain, professional words that a school office actually uses.
    //  Deliberately avoids heavy literary Urdu: a clerk reading this at speed
    //  should not have to stop and work out what a word means.
    // ═══════════════════════════════════════════════════════════════════
    ur: {
      // ─── shared shell: sidebar ───
      'nav.menu': 'مینیو',
      'nav.dashboard': 'ڈیش بورڈ',
      'nav.students': 'طلبہ کا انتظام',
      'nav.staff': 'عملے کا انتظام',
      'nav.attendance': 'حاضری',
      'nav.finance': 'فیس و مالیات',
      'nav.reports': 'رپورٹس و تجزیہ',
      'nav.announcements': 'اعلانات',
      'nav.examination': 'امتحانات',
      'nav.sessions': 'تعلیمی سیشن',
      'nav.settings': 'ترتیبات',
      'nav.logout': 'لاگ آؤٹ',

      // ─── shared shell: header ───
      'hdr.openSidebar': 'مینیو کھولیں',
      'hdr.closeSidebar': 'مینیو بند کریں',
      'hdr.closeMenu': 'مینیو بند کریں',
      'hdr.toggleTheme': 'تھیم تبدیل کریں',
      'hdr.searchMenu': 'مینیو میں تلاش کریں...',
      'hdr.settingsTitle': 'ایڈمن ترتیبات',
      'set.pageTitle': 'نظام کی ترتیبات',
      'set.changesApply': 'تبدیلیاں فوراً لاگو ہو جاتی ہیں۔',
      'hdr.settingsSub': 'اسکول کی معلومات، جماعتیں، فیس اور ایپ کی ترتیبات۔',

      // ─── common words ───
      'common.save': 'محفوظ کریں',
      'common.saveAll': 'سب محفوظ کریں',
      'common.saveChanges': 'تبدیلیاں محفوظ کریں',
      'common.cancel': 'منسوخ کریں',
      'common.close': 'بند کریں',
      'common.delete': 'حذف کریں',
      'common.edit': 'تبدیل کریں',
      'common.add': 'شامل کریں',
      'common.remove': 'ہٹائیں',
      'common.reset': 'دوبارہ ترتیب دیں',
      'common.confirm': 'تصدیق کریں',
      'common.yes': 'ہاں',
      'common.no': 'نہیں',
      'common.ok': 'ٹھیک ہے',
      'common.back': 'واپس',
      'common.next': 'آگے',
      'common.search': 'تلاش کریں',
      'common.loading': 'لوڈ ہو رہا ہے...',
      'common.saving': 'محفوظ ہو رہا ہے...',
      'common.optional': 'اختیاری',
      'common.required': 'لازمی',
      'common.enabled': 'فعال',
      'common.disabled': 'غیر فعال',
      'common.on': 'آن',
      'common.off': 'آف',
      'common.none': 'کوئی نہیں',
      'common.total': 'کل',
      'common.status': 'کیفیت',
      'common.actions': 'کارروائی',
      'common.name': 'نام',
      'common.date': 'تاریخ',
      'common.month': 'مہینہ',
      'common.year': 'سال',
      'common.class': 'جماعت',
      'common.section': 'سیکشن',
      'common.student': 'طالبِ علم',
      'common.students': 'طلبہ',
      'common.staff': 'عملہ',
      'common.teacher': 'استاد',
      'common.amount': 'رقم',
      'common.rupees': 'روپے',
      'common.noData': 'دکھانے کے لیے کچھ نہیں',
      'common.savedOk': 'تمام ترتیبات کامیابی سے محفوظ ہو گئیں۔',
      'common.saveFailed': 'سرور پر محفوظ نہیں ہو سکا۔ اپنا انٹرنیٹ دیکھ کر دوبارہ کوشش کریں۔',
      'common.offlineSaved': 'اس ڈیوائس پر محفوظ ہو گیا۔ انٹرنیٹ آنے پر سرور پر چلا جائے گا۔',

      // ─── settings page: tabs ───
      'set.tabInfo': 'معلومات و ترتیبات',
      'set.tabClasses': 'جماعتیں و فیس',
      'set.tabLateFee': 'تاخیری فیس',
      'set.tabVariables': 'تنخواہ کے اصول',
      'set.tabAttendance': 'حاضری کی ترتیبات',
      'set.tabWhatsApp': 'واٹس ایپ',
      'set.tabTeacherLogin': 'اساتذہ لاگ ان',

      // ─── settings page: contact details ───
      'set.contactDetails': 'رابطے کی تفصیلات',
      'set.contactDetailsSub': 'یہ تفصیلات اسناد، شناختی کارڈ اور واؤچر پر چھپتی ہیں۔',
      'set.schoolAddress': 'اسکول کا پتہ',
      'set.schoolAddressPh': 'گلی، علاقہ، شہر، پوسٹل کوڈ',
      'set.schoolAddressHint': 'دستاویزات پر دکھایا جاتا ہے۔',
      'set.contactPhone': 'رابطہ نمبر',
      'set.contactPhonePh': 'مثلاً 041-1234567',
      'set.contactPhoneHint': 'بنیادی رابطہ نمبر۔',
      'set.altPhone': 'متبادل / واٹس ایپ نمبر',
      'set.altPhoneHint': 'اختیاری دوسرا نمبر۔',
      'set.email': 'ای میل پتہ',
      'set.emailHint': 'سرکاری دستاویزات پر استعمال ہوتا ہے۔',
      'set.website': 'ویب سائٹ',
      'set.websiteHint': 'اختیاری۔',
      'set.principal': 'پرنسپل / سربراہ کا نام',
      'set.principalHint': 'اسناد پر دستخط کرنے والے۔',
      'set.regNo': 'رجسٹریشن / EMIS نمبر',
      'set.regNoHint': 'اگر آپ کا بورڈ مانگتا ہو۔',

      // ─── settings page: LANGUAGE card ───
      'set.language': 'زبان',
      'set.languageSub': 'پورے ایڈمن پورٹل کی زبان منتخب کریں۔',
      'set.languageLabel': 'پورٹل کی زبان',
      'set.languageHint': 'اردو منتخب کرنے پر خاکہ دائیں سے بائیں ہو جاتا ہے۔',
      'set.langEnglish': 'انگریزی',
      'set.langUrdu': 'اردو',
      'set.langEnglishNative': 'English',
      'set.langUrduNative': 'اردو',
      'set.langEnglishDesc': 'بائیں سے دائیں خاکہ',
      'set.langUrduDesc': 'دائیں سے بائیں خاکہ',
      'set.langNoteOnline': 'سرور پر محفوظ ہے، اس لیے ہر ڈیوائس پر یہی زبان رہے گی۔',
      'set.langNoteOffline': 'اس ڈیوائس پر محفوظ ہے۔',
      'set.langNoteHybrid': 'اس ڈیوائس پر محفوظ ہے اور انٹرنیٹ آنے پر سرور پر چلا جائے گا۔',
      'set.langSaved': 'زبان {lang} کر دی گئی۔',
      'set.langSavedLocal': 'زبان {lang} کر دی گئی۔ انٹرنیٹ آنے پر سرور پر محفوظ ہو جائے گی۔',
      'set.langFailed': 'زبان اس ڈیوائس پر بدل گئی، مگر سرور تک بات نہیں پہنچ سکی۔',
      'set.langApplying': 'زبان تبدیل ہو رہی ہے...',

      // ─── settings page: admission mandatory fields ───
      'set.admissionTitle': 'نیا داخلہ — لازمی خانے',
      'set.allRequired': 'سب لازمی',
      'set.allOptional': 'سب اختیاری',

      // ─── settings page: late fee ───
      'set.lateFeeTitle': 'تاخیری فیس کا اصول',
      'set.lateFeeEnabled': 'تاخیری فیس لگائیں',
      'set.lateFeeDeadline': 'آخری تاریخ',
      'set.lateFeeType': 'تاخیری فیس کی قسم',
      'set.lateFeeFixed': 'مقررہ رقم',
      'set.lateFeePercent': 'فیصد',
      'set.lateFeeAmount': 'تاخیری فیس کی رقم',
      'set.lateFeeGrace': 'رعایتی دن',

      // ─── settings page: pay variables ───
      'set.payVariables': 'تنخواہ کے اصول',
      'set.penaltyType': 'غیر حاضری پر کٹوتی کی قسم',
      'set.penaltyValue': 'کٹوتی کی مقدار',
      'set.bonus': 'حاضری کا انعام',

      // ─── settings page: classes ───
      'set.classesTitle': 'جماعتیں و فیس',
      'set.className': 'جماعت کا نام',
      'set.classFee': 'ماہانہ فیس',
      'set.classFund': 'فنڈ',
      'set.sections': 'سیکشن',
      'set.addClass': 'جماعت شامل کریں',

      // ─── dashboard ───
      'dash.totalStudents': 'کل طلبہ',
      'dash.totalStaff': 'کل عملہ',
      'dash.presentToday': 'آج حاضر',
      'dash.feesCollected': 'وصول شدہ فیس',
      'dash.quickActions': 'فوری کام',
      'dash.recentActivity': 'حالیہ کارروائی',

      // ─── month names ───
      'mon.full.0': 'جنوری', 'mon.full.1': 'فروری', 'mon.full.2': 'مارچ',
      'mon.full.3': 'اپریل', 'mon.full.4': 'مئی', 'mon.full.5': 'جون',
      'mon.full.6': 'جولائی', 'mon.full.7': 'اگست', 'mon.full.8': 'ستمبر',
      'mon.full.9': 'اکتوبر', 'mon.full.10': 'نومبر', 'mon.full.11': 'دسمبر'
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  ENGINE
  // ═══════════════════════════════════════════════════════════════════

  var LANGS = { en: { dir: 'ltr' }, ur: { dir: 'rtl' } };

  function normLang(v) { return String(v || '').toLowerCase() === 'ur' ? 'ur' : 'en'; }

  // Read the fast local copy. This runs before any network call, so the correct
  // language is on screen from the first paint instead of flashing English first.
  function readLocal() {
    try { return normLang(localStorage.getItem(LOCAL_KEY)); } catch (e) { return 'en'; }
  }
  function writeLocal(l) {
    try { localStorage.setItem(LOCAL_KEY, l); } catch (e) { /* private mode: screen still works */ }
  }

  var lang = readLocal();
  function dirOf(l) { return LANGS[l] ? LANGS[l].dir : 'ltr'; }

  // ─── <html lang> / <html dir> ───
  // Setting dir="rtl" here is what actually mirrors the whole portal: the browser
  // flips text flow, flexbox and grid order, scrollbars and logical CSS properties
  // on its own. admin-i18n.css then fixes the handful of places that were written
  // with hard-coded left/right.
  function setRoot(l) {
    var root = document.documentElement;
    if (!root) return;
    root.setAttribute('lang', l);
    root.setAttribute('dir', dirOf(l));
    // A plain class is handy for CSS that is easier to write as .ss-lang-ur than [lang="ur"].
    root.classList.remove('ss-lang-en', 'ss-lang-ur');
    root.classList.add('ss-lang-' + l);
  }

  // The Urdu web font is only fetched when Urdu is actually chosen. If it cannot load
  // (offline school, no internet) the CSS falls back to the Urdu fonts already on the
  // device, so the portal is still perfectly readable.
  function ensureUrduFont() {
    if (document.getElementById(FONT_ID)) return;
    var head = document.head || document.documentElement;
    if (!head) return;
    var link = document.createElement('link');
    link.id = FONT_ID;
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    head.appendChild(link);
  }

  // ─── lookup ───
  // Falls back to English, then to the key itself, so a half-finished translation
  // shows readable English instead of a blank label or "undefined".
  function raw(key) {
    var table = STRINGS[lang] || STRINGS.en;
    if (table[key] !== undefined) return table[key];
    if (STRINGS.en[key] !== undefined) return STRINGS.en[key];
    return null;
  }

  /** t('set.langSaved', { lang: 'اردو' }) -> "زبان اردو کر دی گئی۔" */
  function t(key, vars) {
    var s = raw(key);
    if (s === null) return '';
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }

  /** Has this key been translated at all? Useful when tagging a page gradually. */
  function has(key) { return raw(key) !== null; }

  // ─── dates ───
  // Digits stay 0-9 (Western Arabic). Pakistani school paperwork is written with 0-9,
  // and a roll number or fee amount must read the same in both languages.
  var WEEKDAYS = {
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    ur: ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ']
  };
  var MONTHS = {
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    ur: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر']
  };

  function monthShort(i) { return (MONTHS[lang] || MONTHS.en)[i] || ''; }
  function monthFull(i) { return t('mon.full.' + i); }
  function weekdayShort(i) { return (WEEKDAYS[lang] || WEEKDAYS.en)[i] || ''; }

  /** '2026-10' -> 'October 2026' / 'اکتوبر 2026' */
  function formatMonth(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    if (!m) return '';
    var i = +m[2] - 1;
    if (i < 0 || i > 11) return '';
    return monthFull(i) + ' ' + m[1];
  }

  /** A Date or '2026-10-02' -> 'Thu, Oct 2, 2026' / 'جمعرات، 2 اکتوبر 2026' */
  function formatDate(value) {
    var d;
    if (value instanceof Date) d = value;
    else {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
      if (!m) return '';
      d = new Date(+m[1], +m[2] - 1, +m[3]);
    }
    if (!d || isNaN(d.getTime())) return '';
    var wd = weekdayShort(d.getDay()), mo = monthShort(d.getMonth());
    return lang === 'ur'
      ? wd + '، ' + d.getDate() + ' ' + mo + ' ' + d.getFullYear()
      : wd + ', ' + mo + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // ─── apply the dictionary to the markup ───
  // Only the attributes listed here are touched, so JavaScript-rendered values
  // (a student's name, a fee total) are never overwritten by a translation.
  var ATTR_JOBS = [
    { sel: '[data-i18n]', run: function (el, key) {
        // <title> must stay plain text; everything else gets textContent too.
        el.textContent = t(key);
      } },
    { sel: '[data-i18n-html]', run: function (el, key) { el.innerHTML = t(key); } },
    { sel: '[data-i18n-placeholder]', run: function (el, key) { el.setAttribute('placeholder', t(key)); } },
    { sel: '[data-i18n-title]', run: function (el, key) { el.setAttribute('title', t(key)); } },
    { sel: '[data-i18n-aria]', run: function (el, key) { el.setAttribute('aria-label', t(key)); } },
    { sel: '[data-i18n-value]', run: function (el, key) { el.setAttribute('value', t(key)); } }
  ];
  var ATTR_NAMES = ['data-i18n', 'data-i18n-html', 'data-i18n-placeholder',
                    'data-i18n-title', 'data-i18n-aria', 'data-i18n-value'];

  // ─── English text that has not been translated yet ───
  // The portal is translated page by page, so for a while an Urdu (RTL) page still
  // holds English sentences. The browser lays those out right-to-left, which throws
  // their trailing punctuation to the wrong end: "Changes apply immediately."
  // renders as ".Changes apply immediately".
  //
  // admin-i18n.css handles the obvious text elements (p, h1-h6, label, td, button).
  // This catches the rest - mostly plain <div>s used as text containers - without a
  // blanket CSS rule, because it can check what an element ACTUALLY contains:
  // only a leaf element whose text is Latin with no Urdu in it is marked.
  //
  // dir="auto" then lets the browser lay that one element out as English, and it
  // self-corrects: once the string is translated the Urdu fails this test, the
  // attribute is removed, and the element goes back to following the page.
  var ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
  var LATIN_RE = /[A-Za-z]/;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, TITLE: 1, I: 1, svg: 1 };

  function isTextLeaf(el) {
    // "leaf" = no element children, so its text is its own and marking it is safe
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.tagName !== 'BR' && c.tagName !== 'I' && c.tagName !== 'B'
          && c.tagName !== 'STRONG' && c.tagName !== 'EM') return false;
    }
    return true;
  }

  function markUntranslatedText(scope) {
    if (dirOf(lang) !== 'rtl') return;             // only an RTL page has this problem
    var all = (scope || document).querySelectorAll('div, span, p, td, th, li, small, h1, h2, h3, h4, h5, h6');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (SKIP_TAGS[el.tagName]) continue;
      if (el.getAttribute('data-no-autodir') !== null) continue;
      var existing = el.getAttribute('dir');
      if (existing && existing !== 'auto') continue;   // the page author set it: respect that
      if (!isTextLeaf(el)) continue;

      var txt = el.textContent || '';
      if (!txt || txt.length > 400) continue;          // long prose: leave the page to decide
      var latin = LATIN_RE.test(txt), arabic = ARABIC_RE.test(txt);

      if (latin && !arabic) el.setAttribute('dir', 'auto');
      else if (existing === 'auto') el.removeAttribute('dir');   // now translated: hand it back
    }
  }

  // ─── free-text fields: let each field follow its own content ───
  // A school address, a principal's name or a class name can be typed in either
  // script, and often mixes both. Inside an RTL page a value like
  // "12 Jail Road, Faisalabad" is reordered to "Jail Road, Faisalabad 12",
  // because the leading digits are neutral and inherit the paragraph direction.
  //
  // dir="auto" fixes it the way the HTML standard intends: the browser looks at the
  // first strong character of the actual value and sets that field's direction and
  // alignment from it. Latin text reads left-to-right, Urdu text reads right-to-left,
  // and the user does not have to think about it. CSS alone cannot do this, which is
  // why it is applied here rather than in admin-i18n.css.
  //
  // Skipped for: fields that already declare a dir (the page author decided),
  // and the typed fields handled in CSS (tel/email/url/number), which are always LTR.
  var FREE_TEXT = 'input[type="text"], input:not([type]), textarea, [contenteditable="true"]';

  function markAutoDirection(scope) {
    var nodes = (scope || document).querySelectorAll(FREE_TEXT);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.hasAttribute('dir')) continue;          // explicitly set: leave it alone
      if (el.getAttribute('data-no-autodir') !== null) continue;
      el.setAttribute('dir', 'auto');
    }
  }

  /**
   * Re-translate the page. Call it after you build HTML in JavaScript:
   *     container.innerHTML = rows; AdminI18n.apply(container);
   * @param {Element} [root] only translate inside this element (default: whole page)
   */
  function apply(root) {
    setRoot(lang);
    if (lang === 'ur') ensureUrduFont();

    var scope = root && root.querySelectorAll ? root : document;
    for (var j = 0; j < ATTR_JOBS.length; j++) {
      var job = ATTR_JOBS[j], name = ATTR_NAMES[j];
      var nodes = scope.querySelectorAll(job.sel);
      for (var i = 0; i < nodes.length; i++) {
        var key = nodes[i].getAttribute(name);
        // An untranslated key leaves the element's English text exactly as it is.
        if (key && has(key)) job.run(nodes[i], key);
      }
    }
    // Any English left on an Urdu page is laid out as English, punctuation and all.
    markUntranslatedText(scope === document ? document : scope);

    // Free-text fields decide their own direction from what is typed in them.
    markAutoDirection(scope === document ? document : scope);

    // The document title is tagged on <title data-i18n="..."> but some pages set it in JS.
    var ttl = scope.querySelector ? scope.querySelector('title[data-i18n]') : null;
    if (ttl) { var k = ttl.getAttribute('data-i18n'); if (has(k)) document.title = t(k); }
  }

  /**
   * Switch language on screen and remember it locally.
   * Saving it to the server / phone database is settings.js's job - this function is
   * deliberately storage-agnostic so it can also be called when the settings row
   * arrives from the server and turns out to disagree with the local copy.
   */
  function setLang(next, opts) {
    var l = normLang(next);
    if (l === lang && !(opts && opts.force)) return lang;
    lang = l;
    if (!(opts && opts.skipLocal)) writeLocal(l);
    apply();
    try {
      window.dispatchEvent(new CustomEvent('softschool:lang-changed', {
        detail: { lang: lang, dir: dirOf(lang) }
      }));
    } catch (e) { /* very old webview */ }
    return lang;
  }

  /**
   * Called by settings.js once the school's settings row has been read (from the
   * server, or from the phone in offline/hybrid mode). If the saved language differs
   * from the local copy, the saved one wins and the page re-renders in it.
   */
  function adoptFromSettings(value) {
    if (value == null || value === '') return lang;      // never saved yet: keep the local choice
    return setLang(value);
  }

  // ─── start: set lang/dir before first paint ───
  setRoot(lang);
  if (lang === 'ur') ensureUrduFont();

  window.AdminI18n = {
    t: t,
    has: has,
    apply: apply,
    setLang: setLang,
    adoptFromSettings: adoptFromSettings,
    getLang: function () { return lang; },
    getDir: function () { return dirOf(lang); },
    isRTL: function () { return dirOf(lang) === 'rtl'; },
    languages: function () { return [
      { code: 'en', label: t('set.langEnglish'), native: 'English', dir: 'ltr' },
      { code: 'ur', label: t('set.langUrdu'), native: 'اردو', dir: 'rtl' }
    ]; },
    formatDate: formatDate,
    formatMonth: formatMonth,
    monthShort: monthShort,
    monthFull: monthFull,
    weekdayShort: weekdayShort,
    // Exposed so a page can add its own keys without editing this file:
    //   AdminI18n.extend('ur', { 'fin.voucher': 'واؤچر' });
    extend: function (l, table) {
      var code = normLang(l), target = STRINGS[code] || (STRINGS[code] = {});
      for (var k in table) if (Object.prototype.hasOwnProperty.call(table, k)) target[k] = table[k];
      return true;
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PICKING UP A CHANGE MADE ON ANOTHER DEVICE
  // ═══════════════════════════════════════════════════════════════════
  // localStorage is per-device, so a school that switched to Urdu on the office
  // computer would still see English on the headmaster's phone. Once per app
  // session (not per page) this asks for the saved setting and adopts it.
  //
  // It is deliberately cheap and quiet:
  //   - once per session, guarded by a sessionStorage flag
  //   - after the page has loaded, so it never delays the first paint
  //   - in offline / hybrid mode local-api.js answers it from the phone's own
  //     database, so there is no network request at all
  //   - any failure is ignored: the local copy is already on screen and correct
  var SYNC_FLAG = 'softschool_admin_lang_synced';
  var SETTINGS_BASE = 'https://thesoftschool.com/api/settings';

  function schoolId() {
    try {
      var A = window.SoftSchoolAdmin;
      if (A && typeof A.getCurrentSchool === 'function') {
        var sc = A.getCurrentSchool();
        if (sc && sc.schoolId) return sc.schoolId;
      }
      var s = JSON.parse(localStorage.getItem('softschool_session') || 'null');
      if (s && s.school && s.school.schoolId) return s.school.schoolId;
      if (s && s.schoolId) return s.schoolId;
    } catch (e) { /* not logged in */ }
    return null;
  }

  function syncFromSaved() {
    try { if (sessionStorage.getItem(SYNC_FLAG)) return; } catch (e) { return; }
    var id = schoolId();
    if (!id || typeof window.fetch !== 'function') return;
    try { sessionStorage.setItem(SYNC_FLAG, '1'); } catch (e) { /* ignore */ }

    window.fetch(SETTINGS_BASE + '/' + encodeURIComponent(id), {
      headers: { 'Content-Type': 'application/json' }
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (row) {
        if (!row || typeof row !== 'object') return;
        var saved = normLang(row.language);
        // Only act on a language the school has actually saved. A server that has
        // not been updated with the new column yet sends nothing here, and the
        // device's own choice is left alone rather than being reset to English.
        if (row.language && saved !== lang) setLang(saved);
      })
      .catch(function () { /* offline or old server: the local copy stands */ });
  }

  // ─── start ───
  function boot() {
    apply();
    // let the page finish rendering and its own requests go out first
    setTimeout(syncFromSaved, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
