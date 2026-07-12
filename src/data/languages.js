/**
 * Canonical spoken-language catalog.
 * Seeded into `languages` (migration 0006). Patients.preferred_language stores `code`.
 * Users link via `user_languages` (many-to-many on language `id`).
 */
export const LANGUAGES = [
  { id: 'lang_en', code: 'en', name: 'English', sort_order: 10 },
  { id: 'lang_es', code: 'es', name: 'Spanish', sort_order: 20 },
  { id: 'lang_ht', code: 'ht', name: 'Haitian Creole', sort_order: 30 },
  { id: 'lang_fr', code: 'fr', name: 'French', sort_order: 40 },
  { id: 'lang_ru', code: 'ru', name: 'Russian', sort_order: 50 },
  { id: 'lang_yi', code: 'yi', name: 'Yiddish', sort_order: 60 },
  { id: 'lang_he', code: 'he', name: 'Hebrew', sort_order: 70 },
  { id: 'lang_zh_cmn', code: 'zh-cmn', name: 'Mandarin', sort_order: 80 },
  { id: 'lang_zh_yue', code: 'zh-yue', name: 'Cantonese', sort_order: 90 },
  { id: 'lang_bn', code: 'bn', name: 'Bangla', sort_order: 100 },
  { id: 'lang_hi', code: 'hi', name: 'Hindi', sort_order: 110 },
  { id: 'lang_ur', code: 'ur', name: 'Urdu', sort_order: 120 },
  { id: 'lang_ko', code: 'ko', name: 'Korean', sort_order: 130 },
  { id: 'lang_vi', code: 'vi', name: 'Vietnamese', sort_order: 140 },
  { id: 'lang_tl', code: 'tl', name: 'Tagalog', sort_order: 150 },
  { id: 'lang_ja', code: 'ja', name: 'Japanese', sort_order: 160 },
  { id: 'lang_ar', code: 'ar', name: 'Arabic', sort_order: 170 },
  { id: 'lang_pt', code: 'pt', name: 'Portuguese', sort_order: 180 },
  { id: 'lang_pl', code: 'pl', name: 'Polish', sort_order: 190 },
  { id: 'lang_it', code: 'it', name: 'Italian', sort_order: 200 },
];

export const DEFAULT_LANGUAGE_CODE = 'en';

export const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({
  value: l.code,
  label: l.name,
}));

export function languageName(code) {
  if (!code) return null;
  return LANGUAGES.find((l) => l.code === code)?.name || code;
}

export function languageById(id) {
  return LANGUAGES.find((l) => l.id === id) || null;
}

export function languageByCode(code) {
  return LANGUAGES.find((l) => l.code === code) || null;
}
