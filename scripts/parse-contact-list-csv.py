#!/usr/bin/env python3
"""Parse facility contact-list CSV → CareStream referral_sources person rows (JSON on stdout).

Input columns: Facility, Name, Email Address
Rules:
  - name = person only, First Last (Title Case, letters/spaces)
  - drop roles/titles/org junk; never keep single-token names
  - infer last (or full) name from email local-part when needed
  - Facility (carried down) → source_entity; type = Adult Home
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from pathlib import Path

EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE_RE = re.compile(r"(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})")

ROLE_RE = re.compile(
    r"\b("
    r"medical\s*assist(?:ant)?|ma\b|case\s*mgr|case\s*manager|casemanager|"
    r"nurse(?:\s*case\s*mgr)?|building\s*nurse|nursing(?:\s*dps)?|dps|"
    r"director\s*of\s*operat\w*|regional\s*director|reginal\s*director|"
    r"admin\w*|assistant\s*admin|wellness\s*director|"
    r"np|pa|md|rn|fnp|old\s*assistant\s*admin|new\s*assistant\s*admin|"
    r"regional\s*director\s*of\s*maxm\w*|"
    r"maxm\w*|support"
    r")\b",
    re.I,
)

# Hard fixes when email/name is too messy for heuristics
EMAIL_NAME_OVERRIDES = {
    "jwkessler@thewatfordham.com": "Judy Kessler",
    "dradamzeitlen@gmail.com": "Adam Zeitlin",
}

# Email locals that are facility/role mailboxes — never invent a last name from them
BAD_EMAIL_LOCALS = {
    "addoyobs",
    "masmithtown",
    "malakeshore",
    "presidential",
    "support",
}


def scrub_role_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return email
    local = email.split("@", 1)[0].lower()
    if local in BAD_EMAIL_LOCALS or local.startswith("support"):
        return None
    return email

NON_PERSON_ROW = re.compile(
    r"^(medical\s*assist(?:ant)?|ma\s*maximize|ma|support|cc:?)$",
    re.I,
)

FACILITY_MAP = {
    "acb": "Amber Court of Brooklyn",
    "acpg": "Amber Court of Pelham Gardens",
    "acw": "Amber Court of Westbury",
    "acs": "Amber Court of Smithtown",
    "mohegan": "The Sentinel of Mohegan Lake ALP",
    "harborview": "Harbor View Home",
    "bronxwood": "Bronxwood Assisted Living",
    "riverdale": "The W Assisted Living at Riverdale",
    "woodhaven": "Woodhaven Assisted Living",
    "claremont": "Claremont Village",
    "nfa": "New Fordham Arms Home Adults",
    "lakeshore": "Lake Shore Assisted Living Residence",
    "nbm new broadway (s.i)": "New Broadview Manor",
    "nbm new broadway": "New Broadview Manor",
    "brooklyn alp": "Brooklyn Boulevard ALP",
    "castle": "Castle Senior Living Assisted Living",
    "brichwood": "Birchwood / Sutton Gardens",
    "birchwood": "Birchwood / Sutton Gardens",
    "willow ridge": "Willow Ridge of South Setauket",
    "arbors haupaugge": "Arbors Hauppauge",
    "arbors hauppauge": "Arbors Hauppauge",
    "arbors bohemia": "Arbors Bohemia",
    "arbors islandia east": "The Arbors Islandia East",
    "islandia east safercare": "The Arbors Islandia East",
    "arbors islandia west": "The Arbors Islandia West",
    "arbors westbury": "Arbors Westbury",
    "braemar": "Braemar Living",
    "new haven manor": "New Haven Manor",
    "the plaza at clover lake": "The Plaza at Clover Lake",
    "eliot new rochelle": "The Eliot at New Rochelle",
    "blvd alp queens": "Boulevard ALP",
    "bayview": "Bayview Rest Home",
}


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def norm_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean(s).lower()).strip()


def title_case_word(w: str) -> str:
    return w[:1].upper() + w[1:].lower() if w else w


def title_case_name(s: str) -> str:
    return " ".join(title_case_word(w) for w in clean(s).split())


def extract_email(text: str):
    # Prefer first real personal-looking address; skip bare "support@…"
    emails = EMAIL_RE.findall(text or "")
    for e in emails:
        el = e.lower().rstrip(">")
        if el.startswith("support@"):
            continue
        return el
    return emails[0].lower().rstrip(">") if emails else None


def extract_phone(text: str):
    m = PHONE_RE.search(text or "")
    if not m:
        return None
    digits = re.sub(r"\D", "", m.group(0))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return None


def resolve_facility(raw: str) -> str:
    k = norm_key(raw)
    if not k:
        return ""
    if k in FACILITY_MAP:
        return FACILITY_MAP[k]
    for key, name in FACILITY_MAP.items():
        if k == key or k.startswith(key) or key.startswith(k):
            return name
    return title_case_name(raw)


def email_local_parts(email: str) -> list[str]:
    if not email or "@" not in email:
        return []
    local = email.split("@", 1)[0]
    local = re.sub(r"[^a-z0-9._+-]+", "", local.lower())
    # strip common prefixes
    local = re.sub(r"^(dr|md)", "", local)
    if "." in local or "_" in local or "-" in local:
        bits = re.split(r"[._+-]+", local)
        return [b for b in bits if b and not b.isdigit()]
    return [local] if local else []


def finalize_person(first: str, last: str):
    """Return Title Case First Last or None."""
    first = re.sub(r"[^A-Za-z]", "", first or "")
    last = re.sub(r"[^A-Za-z]", "", last or "")
    if not first or not last:
        return None
    if len(first) < 2 or len(last) < 2:
        return None
    if first.lower() == last.lower():
        return None
    if first.lower() in {"dr", "md", "np", "pa", "rn", "cc", "ma"}:
        return None
    if last.lower() in {"dr", "md", "np", "pa", "rn", "cc", "ma", "maximize", "support", "admin", "administr"}:
        return None
    return f"{title_case_word(first)} {title_case_word(last)}"


def infer_from_email(known_first: str | None, email: str | None):
    """Build First Last from email, optionally using a known first name."""
    if email:
        ov = EMAIL_NAME_OVERRIDES.get(email.lower())
        if isinstance(ov, str):
            bits = ov.split()
            if len(bits) >= 2:
                return finalize_person(bits[0], bits[-1])

    parts = email_local_parts(email or "")
    if not parts:
        return None

    # first.last / first_last
    if len(parts) >= 2:
        a, b = parts[0], parts[-1]
        if known_first:
            # Dr. Sharma + Mickey.Sharma → Mickey Sharma (known is last name)
            if known_first.lower() == b.lower() and a.lower() != b.lower():
                return finalize_person(a, b)
            return finalize_person(known_first, b)
        return finalize_person(a, b)

    local = parts[0]
    if local in BAD_EMAIL_LOCALS or local.startswith("support"):
        return None
    if not known_first:
        return None

    kf = known_first.lower()
    # local is exactly the first name → no last available
    if local == kf:
        return None
    # firstlast (suzannelee)
    if local.startswith(kf) and len(local) > len(kf) + 1:
        return finalize_person(known_first, local[len(kf) :])
    # initial + last (acurrie → Currie, fhill → Hill, vstevens → Stevens)
    # Also when initial ≠ first (Njackson + Queenie → Jackson)
    if len(local) >= 4 and local[1:].isalpha():
        return finalize_person(known_first, local[1:])
    return None


def strip_name_junk(raw: str) -> str:
    s = clean(raw)
    s = re.sub(r"^cc:\s*", "", s, flags=re.I)
    s = re.sub(r"<[^>]*>", " ", s)
    s = EMAIL_RE.sub(" ", s)
    s = PHONE_RE.sub(" ", s)
    s = re.sub(r"\bPh#?\s*", " ", s, flags=re.I)
    # Nickname in parens: keep for later — extract Debby from ( Debby )
    s = s.replace("/", " ").replace(",", " ").replace("-", " ")
    s = ROLE_RE.sub(" ", s)
    s = re.sub(r"\b(dr\.?|md\.?)\b", " ", s, flags=re.I)
    s = re.sub(r"\bold\b|\bnew\b", " ", s, flags=re.I)
    s = re.sub(r"\b(of|the|and|for|at|to)\b", " ", s, flags=re.I)
    s = clean(s)
    return s


def extract_nickname(raw: str) -> str | None:
    m = re.search(r"\(\s*([A-Za-z]{2,})\s*\)", raw or "")
    return title_case_word(m.group(1)) if m else None


def parse_person(name_raw: str, email_raw: str):
    email = extract_email(email_raw or "")
    # Email may be embedded in name field
    if not email:
        email = extract_email(name_raw or "")
    phone = extract_phone(email_raw or "") or extract_phone(name_raw or "")

    if email and email.lower() in EMAIL_NAME_OVERRIDES:
        bits = EMAIL_NAME_OVERRIDES[email.lower()].split()
        person = finalize_person(bits[0], bits[-1])
        if person:
            return person, email, phone, None

    raw = clean(name_raw)
    if not raw or NON_PERSON_ROW.match(raw):
        if email:
            inferred = infer_from_email(None, email)
            if inferred:
                return inferred, email, phone, None
        return None, email, phone, "empty/non-person row"

    # Dual-name junk like "Dr. Zeitlin/ Marilyn" — if email override missed, take left person + email
    if "/" in raw and email:
        left = strip_name_junk(raw.split("/", 1)[0])
        left_toks = [t for t in left.split() if re.fullmatch(r"[A-Za-z]{2,}", t)]
        if left_toks:
            inferred = infer_from_email(left_toks[0], email)
            if inferred:
                return inferred, email, phone, None

    nick = extract_nickname(raw)
    cleaned = strip_name_junk(raw)
    if not cleaned:
        if nick:
            inferred = infer_from_email(nick, email)
            if inferred:
                return inferred, email, phone, None
        return None, email, phone, "roles only"

    tokens = [t for t in re.split(r"\s+", cleaned) if t and re.fullmatch(r"[A-Za-z]+", t)]
    tokens = [t for t in tokens if t.lower() not in {"pa", "np", "md", "rn", "ma", "dps"}]

    # Prefer nickname as first when present (Debby) + surname token (Ng)
    if nick and tokens:
        person = finalize_person(nick, tokens[0] if len(tokens[0]) <= 3 else tokens[-1])
        # Ng, Hiu Lam (Debby) → Debby Ng
        if "ng" in [t.lower() for t in tokens]:
            person = finalize_person(nick, "Ng")
        if person:
            return person, email, phone, None

    if len(tokens) >= 2:
        person = finalize_person(tokens[0], tokens[-1])
        if person and person.split()[-1].lower() in {"assist", "manager", "director", "admin", "nurse", "administer"}:
            person = None
        if person:
            # Only refine last name from email when it is a clear extension/correction
            # (Cardwel→Cardwell, Hertskaya→Hretskaya) — never replace Bailardo with Ickbaialardo.
            inferred = infer_from_email(tokens[0], email)
            if inferred:
                inf_last = inferred.split()[-1].lower()
                cur_last = person.split()[-1].lower()
                if inf_last != cur_last and (
                    inf_last.startswith(cur_last) or cur_last.startswith(inf_last)
                ):
                    person = inferred
            return person, email, phone, None

    if len(tokens) == 1:
        person = infer_from_email(tokens[0], email)
        if person:
            return person, email, phone, None
        if nick:
            person = infer_from_email(nick, email)
            if person:
                return person, email, phone, None
        return None, email, phone, f"single name, no email last ({tokens[0]})"

    first_guess = re.findall(r"[A-Za-z]{2,}", raw)
    if first_guess:
        person = infer_from_email(first_guess[0], email)
        if person:
            return person, email, phone, None

    return None, email, phone, f"could not resolve ({raw})"


def stable_id(name: str, entity: str, email: str) -> str:
    h = hashlib.sha1(f"{norm_key(name)}|{norm_key(entity)}|{norm_key(email)}".encode()).hexdigest()[:10]
    return f"src_cl_{h}"


def parse_csv(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    by_key = {}
    skipped = []
    current_facility = ""

    for i, row in enumerate(rows):
        fac_raw = clean(row.get("Facility") or "")
        if fac_raw:
            current_facility = fac_raw
        name_raw = clean(row.get("Name") or "")
        email_raw = clean(row.get("Email Address") or row.get("Email") or "")

        if not name_raw and not email_raw:
            skipped.append({"row": i, "reason": "empty", "facility": current_facility})
            continue

        # Skip support-only contact lines
        if not name_raw and email_raw and re.search(r"^support@", email_raw, re.I):
            skipped.append({"row": i, "reason": "support-only email", "facility": current_facility})
            continue

        person, email, phone, reason = parse_person(name_raw, email_raw)
        if not person:
            skipped.append({
                "row": i,
                "reason": reason or "no person",
                "facility": current_facility,
                "name": name_raw,
                "email": email_raw,
            })
            continue

        entity = resolve_facility(current_facility)
        # Dedupe by email when present; else by person+entity
        key = f"email|{norm_key(email)}" if email else f"name|{norm_key(person)}|{norm_key(entity)}"
        if key in by_key:
            prev = by_key[key]
            # Prefer a "cleaner" explicit two-token parse over a worse earlier one
            if email and person != prev["name"]:
                # Prefer name whose last name appears in email local
                local = (email.split("@")[0] or "").lower()
                prev_last = prev["name"].split()[-1].lower()
                new_last = person.split()[-1].lower()
                if new_last in local and prev_last not in local:
                    prev["name"] = person
                    prev["id"] = stable_id(person, prev.get("source_entity") or entity, email)
            if not prev.get("source_entity") and entity:
                prev["source_entity"] = entity
            skipped.append({
                "row": i,
                "reason": "duplicate person",
                "name": person,
                "facility": current_facility,
            })
            continue

        email = scrub_role_email(email)
        by_key[key] = {
            "id": stable_id(person, entity, email or ""),
            "name": person,
            "type": "ALF",
            "source_entity": entity or None,
            "email": email,
            "phone": phone,
        }

    return {"sources": list(by_key.values()), "skipped": skipped}


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "")
    if not path.is_file():
        print("Usage: parse-contact-list-csv.py <csv>", file=sys.stderr)
        sys.exit(1)
    out = parse_csv(path)
    print(json.dumps(out, indent=2))
    print(f"# sources={len(out['sources'])} skipped={len(out['skipped'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
