/**
 * Deterministic (non-AI) extraction of referral fields from inbound email.
 * Sender is NEVER treated as the patient — only as referrer/source contact.
 */

const LABEL_PATTERNS = [
  { field: 'patient_name', re: /(?:^|\n)\s*(?:patient(?:\s*name)?|pt\.?|name)\s*[:\-]\s*(.+)$/gim, conf: 'high' },
  { field: 'dob', re: /(?:^|\n)\s*(?:d\.?o\.?b\.?|date\s*of\s*birth|birth\s*date)\s*[:\-]\s*(.+)$/gim, conf: 'high' },
  { field: 'phone', re: /(?:^|\n)\s*(?:phone|tel|telephone|mobile|cell)\s*[:\-]\s*(.+)$/gim, conf: 'high' },
  { field: 'mrn', re: /(?:^|\n)\s*(?:mrn|medical\s*record\s*(?:#|number)?|record\s*#)\s*[:\-]\s*(.+)$/gim, conf: 'high' },
  { field: 'insurance', re: /(?:^|\n)\s*(?:insurance|payer|plan)\s*[:\-]\s*(.+)$/gim, conf: 'high' },
  { field: 'facility', re: /(?:^|\n)\s*(?:facility|hospital|snf|alf|nursing\s*home|from)\s*[:\-]\s*(.+)$/gim, conf: 'high' },
];

const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/;
const DOB_RE = /\b((?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])[\/\-.](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01]))\b/;
const LAST_FIRST_RE = /\b([A-Z][a-zA-Z'\-]+),\s*([A-Z][a-zA-Z'\-]+)\b/;

function cleanLine(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/[|]+/g, ' ').trim();
}

function normalizeDob(raw) {
  const s = cleanLine(raw);
  const mdy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (mdy) {
    const [, mm, dd, yyyy] = mdy;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const ymd = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (ymd) {
    const [, yyyy, mm, dd] = ymd;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return s;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return cleanLine(raw);
}

function splitName(full) {
  const s = cleanLine(full);
  if (!s) return { first: '', last: '' };
  const lf = s.match(/^([^,]+),\s*(.+)$/);
  if (lf) return { first: cleanLine(lf[2]), last: cleanLine(lf[1]) };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function setField(out, confidence, field, value, conf) {
  if (value == null || value === '') return;
  const existing = confidence[field];
  const rank = { high: 3, medium: 2, low: 1 };
  if (existing && rank[existing] >= rank[conf]) return;
  out[field] = value;
  confidence[field] = conf;
}

/**
 * @param {{ subject?: string, body_text?: string, body_html?: string, from_name?: string, from_email?: string }} email
 * @returns {object} parsed payload with confidence map
 */
export function parseInboundEmail(email = {}) {
  const subject = email.subject || '';
  const text = email.body_text
    || String(email.body_html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    || '';
  const hay = `${subject}\n${text}`;

  const out = {
    patient_name: null,
    patient_first: null,
    patient_last: null,
    dob: null,
    phone: null,
    mrn: null,
    insurance: null,
    facility: null,
    // Referrer = sender only — never conflated with patient
    referrer_name: cleanLine(email.from_name) || null,
    referrer_email: cleanLine(email.from_email) || null,
  };
  const confidence = {};

  for (const { field, re, conf } of LABEL_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(hay);
    if (!m) continue;
    let val = cleanLine(m[1]);
    if (!val) continue;
    if (field === 'dob') val = normalizeDob(val);
    if (field === 'phone') val = normalizePhone(val);
    setField(out, confidence, field, val, conf);
  }

  // Subject: "Referral for Jane Doe" / "Pt: Jane Doe"
  if (!out.patient_name) {
    const subjPt = subject.match(/(?:referral\s+for|pt\.?|patient)\s*[:\-]?\s*([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)+)/i);
    if (subjPt) setField(out, confidence, 'patient_name', cleanLine(subjPt[1]), 'medium');
  }

  // Last, First near "patient"
  if (!out.patient_name) {
    const near = hay.match(/patient[^\n]{0,40}?([A-Z][a-zA-Z'\-]+,\s*[A-Z][a-zA-Z'\-]+)/i);
    if (near) setField(out, confidence, 'patient_name', cleanLine(near[1]), 'medium');
  }

  if (!out.dob) {
    const m = hay.match(DOB_RE);
    if (m) setField(out, confidence, 'dob', normalizeDob(m[1]), 'medium');
  }

  if (!out.phone) {
    const m = hay.match(PHONE_RE);
    if (m) setField(out, confidence, 'phone', normalizePhone(m[0]), 'medium');
  }

  // Low-confidence: first Last, First in body that isn't the sender name
  if (!out.patient_name) {
    const m = hay.match(LAST_FIRST_RE);
    if (m) {
      const candidate = `${m[1]}, ${m[2]}`;
      const sender = (email.from_name || '').toLowerCase();
      if (!sender || !candidate.toLowerCase().includes(sender.split(/\s+/)[0] || '___')) {
        setField(out, confidence, 'patient_name', candidate, 'low');
      }
    }
  }

  if (out.patient_name) {
    const { first, last } = splitName(out.patient_name);
    out.patient_first = first || null;
    out.patient_last = last || null;
    confidence.patient_first = confidence.patient_name;
    confidence.patient_last = confidence.patient_name;
  }

  out.confidence = confidence;
  return out;
}

/** Prefill object for NewReferralForm — only high/medium confidence fields. */
export function parsedToFormPrefill(parsed) {
  if (!parsed) return {};
  const conf = parsed.confidence || {};
  const ok = (f) => conf[f] === 'high' || conf[f] === 'medium';
  const prefill = {};
  if (ok('patient_first') && parsed.patient_first) prefill.first_name = parsed.patient_first;
  if (ok('patient_last') && parsed.patient_last) prefill.last_name = parsed.patient_last;
  if (ok('dob') && parsed.dob) prefill.dob = parsed.dob;
  if (ok('phone') && parsed.phone) prefill.phone_primary = parsed.phone;
  if (ok('facility') && parsed.facility) {
    // facility name only — form still needs facility_id lookup by user
    prefill._facility_hint = parsed.facility;
  }
  if (parsed.referrer_name || parsed.referrer_email) {
    const bits = [parsed.referrer_name, parsed.referrer_email].filter(Boolean).join(' · ');
    prefill.initial_notes = `Inbound referrer / sender: ${bits}`;
  }
  return prefill;
}

export default parseInboundEmail;
