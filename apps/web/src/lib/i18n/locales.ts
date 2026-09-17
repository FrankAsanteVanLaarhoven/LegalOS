/** Priority UK migrant & community languages + plain English mode */
export type LocaleCode =
  | "en"
  | "en-plain"
  | "bn"
  | "ur"
  | "ar"
  | "pl"
  | "ro"
  | "pa"
  | "gu"
  | "so"
  | "zh"
  | "pt"
  | "es"
  | "fr"
  | "tr"
  | "uk"
  | "hi"
  | "ta"
  | "ne"
  | "fa"
  | "am"
  | "ti"
  | "ps"
  | "ku"
  | "vi"
  | "it"
  | "de"
  | "sq"
  | "lt"
  | "lv"
  | "bg"
  | "sk"
  | "cs"
  | "el"
  | "sw"
  | "yo"
  | "ig"
  | "ha"
  | "tl"
  | "id"
  | "ms"
  | "th"
  | "ko"
  | "ja"
  | "ru"
  | "sr"
  | "hr"
  | "bs"
  | "al"
  | "ka"
  | "hy";

export interface LocaleMeta {
  code: LocaleCode;
  name: string;
  nativeName: string;
  dir: "ltr" | "rtl";
  /** Speech synthesis BCP-47 hint */
  speech: string;
  priority: boolean;
}

export const LOCALES: LocaleMeta[] = [
  {
    code: "en",
    name: "English",
    nativeName: "English",
    dir: "ltr",
    speech: "en-GB",
    priority: true,
  },
  {
    code: "en-plain",
    name: "Plain English",
    nativeName: "Simple English (age 10)",
    dir: "ltr",
    speech: "en-GB",
    priority: true,
  },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", dir: "ltr", speech: "bn-BD", priority: true },
  { code: "ur", name: "Urdu", nativeName: "اردو", dir: "rtl", speech: "ur-PK", priority: true },
  {
    code: "ar",
    name: "Arabic",
    nativeName: "العربية",
    dir: "rtl",
    speech: "ar-SA",
    priority: true,
  },
  { code: "pl", name: "Polish", nativeName: "Polski", dir: "ltr", speech: "pl-PL", priority: true },
  {
    code: "ro",
    name: "Romanian",
    nativeName: "Română",
    dir: "ltr",
    speech: "ro-RO",
    priority: true,
  },
  {
    code: "pa",
    name: "Punjabi",
    nativeName: "ਪੰਜਾਬੀ",
    dir: "ltr",
    speech: "pa-IN",
    priority: true,
  },
  {
    code: "gu",
    name: "Gujarati",
    nativeName: "ગુજરાતી",
    dir: "ltr",
    speech: "gu-IN",
    priority: true,
  },
  {
    code: "so",
    name: "Somali",
    nativeName: "Soomaali",
    dir: "ltr",
    speech: "so-SO",
    priority: true,
  },
  { code: "zh", name: "Chinese", nativeName: "中文", dir: "ltr", speech: "zh-CN", priority: true },
  {
    code: "pt",
    name: "Portuguese",
    nativeName: "Português",
    dir: "ltr",
    speech: "pt-PT",
    priority: true,
  },
  {
    code: "es",
    name: "Spanish",
    nativeName: "Español",
    dir: "ltr",
    speech: "es-ES",
    priority: true,
  },
  {
    code: "fr",
    name: "French",
    nativeName: "Français",
    dir: "ltr",
    speech: "fr-FR",
    priority: true,
  },
  {
    code: "tr",
    name: "Turkish",
    nativeName: "Türkçe",
    dir: "ltr",
    speech: "tr-TR",
    priority: true,
  },
  {
    code: "uk",
    name: "Ukrainian",
    nativeName: "Українська",
    dir: "ltr",
    speech: "uk-UA",
    priority: true,
  },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", dir: "ltr", speech: "hi-IN", priority: true },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", dir: "ltr", speech: "ta-IN", priority: true },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", dir: "ltr", speech: "ne-NP", priority: true },
  { code: "fa", name: "Persian", nativeName: "فارسی", dir: "rtl", speech: "fa-IR", priority: true },
  { code: "am", name: "Amharic", nativeName: "አማርኛ", dir: "ltr", speech: "am-ET", priority: true },
  {
    code: "ti",
    name: "Tigrinya",
    nativeName: "ትግርኛ",
    dir: "ltr",
    speech: "ti-ET",
    priority: false,
  },
  { code: "ps", name: "Pashto", nativeName: "پښتو", dir: "rtl", speech: "ps-AF", priority: false },
  { code: "ku", name: "Kurdish", nativeName: "Kurdî", dir: "ltr", speech: "ku", priority: true },
  {
    code: "vi",
    name: "Vietnamese",
    nativeName: "Tiếng Việt",
    dir: "ltr",
    speech: "vi-VN",
    priority: false,
  },
  {
    code: "it",
    name: "Italian",
    nativeName: "Italiano",
    dir: "ltr",
    speech: "it-IT",
    priority: false,
  },
  {
    code: "de",
    name: "German",
    nativeName: "Deutsch",
    dir: "ltr",
    speech: "de-DE",
    priority: false,
  },
  {
    code: "sq",
    name: "Albanian",
    nativeName: "Shqip",
    dir: "ltr",
    speech: "sq-AL",
    priority: true,
  },
  {
    code: "lt",
    name: "Lithuanian",
    nativeName: "Lietuvių",
    dir: "ltr",
    speech: "lt-LT",
    priority: false,
  },
  {
    code: "lv",
    name: "Latvian",
    nativeName: "Latviešu",
    dir: "ltr",
    speech: "lv-LV",
    priority: false,
  },
  {
    code: "bg",
    name: "Bulgarian",
    nativeName: "Български",
    dir: "ltr",
    speech: "bg-BG",
    priority: false,
  },
  {
    code: "sk",
    name: "Slovak",
    nativeName: "Slovenčina",
    dir: "ltr",
    speech: "sk-SK",
    priority: false,
  },
  {
    code: "cs",
    name: "Czech",
    nativeName: "Čeština",
    dir: "ltr",
    speech: "cs-CZ",
    priority: false,
  },
  {
    code: "el",
    name: "Greek",
    nativeName: "Ελληνικά",
    dir: "ltr",
    speech: "el-GR",
    priority: false,
  },
  {
    code: "sw",
    name: "Swahili",
    nativeName: "Kiswahili",
    dir: "ltr",
    speech: "sw-KE",
    priority: false,
  },
  {
    code: "yo",
    name: "Yoruba",
    nativeName: "Yorùbá",
    dir: "ltr",
    speech: "yo-NG",
    priority: false,
  },
  { code: "ig", name: "Igbo", nativeName: "Igbo", dir: "ltr", speech: "ig-NG", priority: false },
  { code: "ha", name: "Hausa", nativeName: "Hausa", dir: "ltr", speech: "ha-NG", priority: false },
  {
    code: "tl",
    name: "Filipino",
    nativeName: "Filipino",
    dir: "ltr",
    speech: "fil-PH",
    priority: false,
  },
  {
    code: "id",
    name: "Indonesian",
    nativeName: "Bahasa Indonesia",
    dir: "ltr",
    speech: "id-ID",
    priority: false,
  },
  {
    code: "ms",
    name: "Malay",
    nativeName: "Bahasa Melayu",
    dir: "ltr",
    speech: "ms-MY",
    priority: false,
  },
  { code: "th", name: "Thai", nativeName: "ไทย", dir: "ltr", speech: "th-TH", priority: false },
  {
    code: "ko",
    name: "Korean",
    nativeName: "한국어",
    dir: "ltr",
    speech: "ko-KR",
    priority: false,
  },
  {
    code: "ja",
    name: "Japanese",
    nativeName: "日本語",
    dir: "ltr",
    speech: "ja-JP",
    priority: false,
  },
  {
    code: "ru",
    name: "Russian",
    nativeName: "Русский",
    dir: "ltr",
    speech: "ru-RU",
    priority: true,
  },
  {
    code: "sr",
    name: "Serbian",
    nativeName: "Српски",
    dir: "ltr",
    speech: "sr-RS",
    priority: false,
  },
  {
    code: "hr",
    name: "Croatian",
    nativeName: "Hrvatski",
    dir: "ltr",
    speech: "hr-HR",
    priority: false,
  },
  {
    code: "bs",
    name: "Bosnian",
    nativeName: "Bosanski",
    dir: "ltr",
    speech: "bs-BA",
    priority: false,
  },
  {
    code: "ka",
    name: "Georgian",
    nativeName: "ქართული",
    dir: "ltr",
    speech: "ka-GE",
    priority: false,
  },
  {
    code: "hy",
    name: "Armenian",
    nativeName: "Հայերեն",
    dir: "ltr",
    speech: "hy-AM",
    priority: false,
  },
];

export const PRIORITY_LOCALES = LOCALES.filter((l) => l.priority);

export function getLocale(code: string): LocaleMeta {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}
