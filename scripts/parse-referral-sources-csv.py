#!/usr/bin/env python3
"""Parse marketing referral-sources CSV → CareStream person rows (JSON on stdout)."""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from pathlib import Path

EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE_RE = re.compile(r"(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})")


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def norm_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean(s).lower()).strip()


def title_case_name(s: str) -> str:
    parts = []
    for w in clean(s).split():
        if "@" in w:
            parts.append(w.lower())
        elif re.fullmatch(r"[A-Z0-9.-]{1,4}", w):
            parts.append(w)
        else:
            parts.append(w[:1].upper() + w[1:].lower())
    return " ".join(parts)


def extract_email(text: str):
    m = EMAIL_RE.search(text or "")
    return m.group(0).lower() if m else None


def extract_phone(text: str):
    m = PHONE_RE.search(text or "")
    if not m:
        return None
    digits = re.sub(r"\D", "", m.group(0))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return m.group(0).strip()


def strip_contact_extras(text: str) -> str:
    s = text or ""
    s = EMAIL_RE.sub(" ", s)
    s = PHONE_RE.sub(" ", s)
    s = re.sub(r"\bACANY\b", " ", s, flags=re.I)
    s = re.sub(r"\bAdvance Care Alliance\b", " ", s, flags=re.I)
    s = re.sub(r"\bCare Design(?:s)?(?: NY)?\b", " ", s, flags=re.I)
    s = re.sub(r"\bACA:\s*", " ", s, flags=re.I)
    s = re.sub(r"[/,;|]+", " ", s)
    s = clean(s)
    if re.fullmatch(r"(advance care alliance|care design ny|acany)", s, re.I):
        return ""
    return s


def looks_like_person(s: str) -> bool:
    t = clean(s)
    if not t:
        return False
    if EMAIL_RE.fullmatch(t):
        return False
    if re.fullmatch(
        r"(readmission|re[- ]?admit+t?|re admission|website|web lead|web|fax|call in|via|referral source|referral contact)",
        t,
        re.I,
    ):
        return False
    words = t.split()
    if not words:
        return False
    if len(words) == 1 and len(words[0]) < 3:
        return False
    if re.search(
        r"llc|inc\.?|services|home care|alliance|design|school|pediatrics|hospital|care$",
        t,
        re.I,
    ):
        if re.fullmatch(r"(mom called|wendi|daisy|gail|jessica|noelia)", t, re.I):
            return True
        if not re.match(r"^[A-Z][a-z]+ [A-Z][a-z]+", t):
            return False
    return bool(re.search(r"[A-Za-z]", t))


def looks_like_org(s: str) -> bool:
    t = clean(s)
    if not t:
        return False
    # Bare emails are contact channels, not organizations.
    if EMAIL_RE.fullmatch(t) or ("@" in t and " " not in t):
        return False
    if re.search(
        r"home care|alliance|design|llc|inc\.?|care$|school|pediatrics|opwdd|front door|"
        r"hamaspik|ahrc|ddc|event|website|web lead|readmit|re[- ]?admit|call in|fax|"
        r"summit|tri[- ]?county|nyhc|boulevard|anchor|welcome|human care|jemcare|"
        r"sinergia|parent to parent|group home|wellbound",
        t,
        re.I,
    ):
        return True
    return (not looks_like_person(t)) and len(t) > 2


ENTITY_RULES = [
    (re.compile(r"care\s*design", re.I), "Care Design NY", "CCO"),
    (re.compile(r"^(aca|advance care alliance|advance care designs)$", re.I), "Advance Care Alliance", "CCO"),
    (re.compile(r"advance care alliance|advance care designs", re.I), "Advance Care Alliance", "CCO"),
    (re.compile(r"tri[- ]?county", re.I), "Tri-County Care", "CCO"),
    (re.compile(r"^(nyhc|new york health care)", re.I), "New York Health Care", "Other"),
    (re.compile(r"welcome\s*care", re.I), "Welcome Care", "Other"),
    (re.compile(r"boulevard", re.I), "Boulevard Homecare Associates", "Other"),
    (re.compile(r"high\s*standard", re.I), "High Standard Home Care", "Other"),
    (re.compile(r"ez\s*living", re.I), "EZ Living Home Care", "Other"),
    (re.compile(r"anchor\s*hc", re.I), "Anchor HC", "Other"),
    (re.compile(r"hamaspik", re.I), "Hamaspik HC", "Other"),
    (re.compile(r"human\s*care", re.I), "Human Care NY", "Other"),
    (re.compile(r"child center", re.I), "The Child Center of NY", "Other"),
    (re.compile(r"rebecca school", re.I), "Rebecca School", "Other"),
    (re.compile(r"wakefield pediatrics", re.I), "Wakefield Pediatrics", "PCP / MD"),
    (re.compile(r"parent to parent", re.I), "Parent to Parent", "Other"),
    (re.compile(r"sinergia", re.I), "Sinergia", "Other"),
    (re.compile(r"ahrc", re.I), "AHRC", "CCO"),
    (re.compile(r"jemcare", re.I), "JEMCARE LLC", "Other"),
    (re.compile(r"crown care", re.I), "Crown Care HC", "Other"),
    (re.compile(r"summit", re.I), "Summit", "Other"),
    (re.compile(r"advance home care services", re.I), "Advance Home Care Services", "Other"),
    (re.compile(r"ira group home", re.I), "IRA Group Home", "Adult Home"),
    (re.compile(r"front door|opwdd", re.I), "OPWDD Front Door", "Care Manager"),
    (re.compile(r"wellbound.*(readmit|roc)|re[- ]?admit|readmission|re admission|re cert", re.I), "Wellbound (Readmit)", "Other"),
    (re.compile(r"wellbound email", re.I), "Wellbound Email Submission", "Other"),
    (re.compile(r"web\s*lead|website|^web$", re.I), "Website", "Campaign"),
    (re.compile(r"call in|word of mouth", re.I), "Call-In / Word of Mouth", "Self-Referral"),
    (re.compile(r"\bfax\b", re.I), "Fax", "Other"),
    (re.compile(r"manhattan ddc", re.I), "Manhattan DD Council Event", "Campaign"),
    (re.compile(r"bronx ddc", re.I), "Bronx DD Council Event", "Campaign"),
    (re.compile(r"brooklyn dd council|brooklyn contacts", re.I), "Brooklyn DD Council", "Campaign"),
]


def resolve_entity(raw: str):
    t = clean(raw)
    if not t:
        return "", "Other", None
    # Never treat a bare email as an organization name.
    if EMAIL_RE.fullmatch(t) or ("@" in t and " " not in t):
        return "", "Other", None
    for rx, entity, typ in ENTITY_RULES:
        if rx.search(t):
            return entity, typ, None
    if looks_like_person(t) and not looks_like_org(t):
        return "", "Other", title_case_name(t.split(",")[0])
    # Drop ultra-short opaque codes (HF, etc.) unless we have a known rule.
    if len(t) <= 3 and t.isalpha():
        return "", "Other", None
    return title_case_name(t), "Other", None


def parse_contact(raw: str):
    email = extract_email(raw)
    phone = extract_phone(raw)
    name = strip_contact_extras(raw)
    if not name and email:
        local = email.split("@")[0].replace(".", " ").replace("_", " ")
        name = title_case_name(local)
    name = re.sub(r"^[:\-–—]\s*", "", name or "")
    name = clean(name)
    if name:
        name = title_case_name(name)
        name = re.sub(r"^Michlle\b", "Michelle", name, flags=re.I)
        name = re.sub(r"^Damascas\b", "Damascus", name, flags=re.I)
        name = re.sub(r"^Danirose\b", "DaniRose", name, flags=re.I)
        name = re.sub(r"^Stella Eseele\b", "Stella Esele", name, flags=re.I)
        name = re.sub(r"^Marcela Aguilar\b", "Maricela Aguilar", name, flags=re.I)
        name = re.sub(r"^Madeline Rusell\b", "Madeline Russell", name, flags=re.I)
    return name, email, phone


def stable_id(name: str, entity: str) -> str:
    h = hashlib.sha1(f"{norm_key(name)}|{norm_key(entity)}".encode()).hexdigest()[:10]
    return f"src_csv_{h}"


CHANNEL_ENTITIES = {
    "Website",
    "Wellbound (Readmit)",
    "Fax",
    "Call-In / Word of Mouth",
    "Wellbound Email Submission",
}

# CareStream name column rules: person only, first+last, Title Case, letters/spaces.
_NON_PERSON_NAME = re.compile(
    r"\b(general|llc|inc|services|alliance|design|homecare|home care|hospital|school|"
    r"pediatrics|event|council|submission|readmit|website|fax|email|called|mom)\b",
    re.I,
)


def normalize_person_name(raw: str):
    """Return Title-Cased First Last… or None if not a valid person name."""
    s = clean(raw)
    if not s:
        return None
    s = re.sub(r"[-–—_/]+", " ", s)
    s = re.sub(r"['’`.,;:()\[\]{}|+&@#$!?\\]+", "", s)
    s = clean(s)
    if not s or _NON_PERSON_NAME.search(s):
        return None
    parts = [p for p in s.split() if p]
    if len(parts) < 2:
        return None
    if any(not re.fullmatch(r"[A-Za-z]+", p) for p in parts):
        return None
    return " ".join(p[:1].upper() + p[1:].lower() for p in parts)


def parse_csv(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    by_key = {}
    skipped = []

    for row in rows:
        left = clean(row.get("Referral source") or row.get("Referral Source") or "")
        right = clean(row.get("Referral Contact") or row.get("Referral contact") or "")
        left = re.sub(r"\s*\n\s*", " ", left)
        right = re.sub(r"\s*\n\s*", " ", right)

        a, b = norm_key(left), norm_key(right)
        if (not a and not b) or (a == "referral source" and (b in ("", "referral contact"))) or a == "referral contact":
            skipped.append({"reason": "header/empty", "left": left, "right": right})
            continue

        force_email = None
        force_phone = None

        # "Care Design NY, Elizabeth Limanov,"
        if re.search(r"care design", left, re.I) and "," in left:
            parts = [clean(p) for p in left.split(",") if clean(p)]
            if len(parts) >= 2 and looks_like_person(parts[1]):
                left = "Care Design NY"
                if not right:
                    right = " ".join(parts[1:])

        # Swapped person | org
        if looks_like_person(left) and looks_like_org(right) and not looks_like_org(left):
            left, right = right, left

        # Person+email in left, first-name in right
        if re.search(r"@caredesignny\.", left, re.I) and right and looks_like_person(right) and len(right.split()) == 1:
            n, em, ph = parse_contact(left)
            left = "Care Design NY"
            right = n or right
            force_email, force_phone = em, ph

        # Person | email → infer org from domain
        if looks_like_person(left) and extract_email(right) and not looks_like_org(left):
            if re.search(r"myacany\.org", right, re.I):
                ent = "Advance Care Alliance"
            elif re.search(r"caredesignny\.", right, re.I):
                ent = "Care Design NY"
            else:
                ent = ""
            right = f"{left}, {right}"
            left = ent or left

        entity, typ, person_hint = resolve_entity(left)
        contact_raw = right
        if not contact_raw and person_hint:
            contact_raw = person_hint

        if (not contact_raw) or norm_key(contact_raw) in (norm_key(left), norm_key(entity)):
            # No person contact — skip (do not invent "General" / channel names).
            skipped.append({"reason": "no person contact", "left": left, "right": right})
            continue

        contact_raw = re.sub(r"^\(readmission\)\s*", "", contact_raw, flags=re.I)
        name, email, phone = parse_contact(contact_raw)
        if force_email:
            email = force_email
        if force_phone:
            phone = force_phone
        name = normalize_person_name(name or "")
        if not name:
            skipped.append({"reason": "invalid person name", "left": left, "right": right})
            continue

        key = f"{norm_key(name)}|{norm_key(entity)}"
        prev = by_key.get(key)
        if prev:
            if not prev.get("email") and email:
                prev["email"] = email
            if not prev.get("phone") and phone:
                prev["phone"] = phone
            if len(name) > len(prev["name"]):
                prev["name"] = name
            prev["hits"] += 1
            continue

        by_key[key] = {
            "id": stable_id(name, entity),
            "name": name,
            "type": typ,
            "source_entity": entity or "",
            "email": email or "",
            "phone": phone or "",
            "is_active": "TRUE",
            "hits": 1,
        }

    sources = sorted(by_key.values(), key=lambda s: s["name"].lower())
    return {"sources": sources, "skipped": skipped}


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "Desktop" / "referal sources.csv")
    if not path.exists():
        print(f"CSV not found: {path}", file=sys.stderr)
        sys.exit(1)
    data = parse_csv(path)
    json.dump(data, sys.stdout, indent=2)
    print(f"\n# parsed {len(data['sources'])} unique contacts, skipped {len(data['skipped'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
