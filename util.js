// 品名の正規化（仕様書 4-4）
// NFKC → 英字を小文字 → ひらがなをカタカナ → 前後の空白を除去
export function normalizeName(s) {
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .trim();
}

const pad2 = (n) => String(n).padStart(2, '0');

// 端末のローカル日付を YYYY-MM-DD で返す
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 期限切れ：期限が今日より前（当日は期限切れにしない）
export function isExpired(dueDate, today = localDateStr()) {
  return !!dueDate && dueDate < today;
}

// YYYY-MM-DD → "M/D"
export function formatMD(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// YYYY-MM-DD → "M/D（曜）"
export function formatMDW(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}（${WEEKDAYS[new Date(y, m - 1, d).getDay()]}）`;
}

// ISO 8601 → "YYYY/M/D HH:MM"（ローカル時刻）
export function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// YYYYMMDD（バックアップのファイル名用）
export function compactDate(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isValidIso(s) {
  return typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));
}
