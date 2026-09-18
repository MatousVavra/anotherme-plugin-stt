import re
import unicodedata
from difflib import SequenceMatcher


def normalize(text: str) -> str:
    text = text.lower().strip()
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^\w\s]", "", text).strip()


def tokenize(text: str) -> list[str]:
    return re.findall(r"\b\w+\b", text)


def build_name_prompt(people: list[dict]) -> str:
    if not people:
        return ""
    names = [p["name"] for p in people if p.get("name")]
    hints = []
    for p in people:
        if p.get("name") and p.get("pronunciation_hint"):
            hints.append(f"{p['name']} is pronounced {p['pronunciation_hint']}")
    lines = [
        "The following names may appear in the audio; preserve their exact spelling and diacritics:",
        ", ".join(names),
    ]
    if hints:
        lines.append("Pronunciation hints:")
        lines.extend(hints)
    return "\n".join(lines)


def _best_match(phrase: str, candidates: list[str], threshold: float = 0.75) -> tuple[str | None, float]:
    phrase_norm = normalize(phrase)
    best = None
    best_score = 0.0
    for cand in candidates:
        cand_norm = normalize(cand)
        if phrase_norm == cand_norm:
            return cand, 1.0
        score = SequenceMatcher(None, phrase_norm, cand_norm).ratio()
        # Guard short tokens to avoid false positives (e.g. "every" -> "Eva").
        if min(len(phrase_norm), len(cand_norm)) <= 3 and score < 0.95:
            continue
        if score > best_score and score >= threshold:
            best_score = score
            best = cand
    return best, best_score


def correct_names(text: str, people: list[dict]) -> tuple[str, list[tuple[str, str]]]:
    if not people or not text:
        return text, []
    names = [p["name"] for p in people if p.get("name")]
    # Tokens with their original character positions so we can replace spans
    token_matches = list(re.finditer(r"\b\w+\b", text))
    tokens = [m.group(0) for m in token_matches]

    # Group candidates by word count so we can match 1..N token sequences.
    names_by_len: dict[int, list[str]] = {}
    for name in names:
        length = len(name.split())
        names_by_len.setdefault(length, []).append(name)

    max_len = max(names_by_len.keys()) if names_by_len else 0
    consumed: set[int] = set()
    replacements: list[tuple[int, int, str, str, str]] = []

    i = 0
    while i < len(tokens):
        best_name: str | None = None
        best_len = 0
        best_phrase = ""

        # Try longer sequences first and stop at the first qualifying match so
        # multi-word names beat shorter token matches.
        for length in range(min(max_len, len(tokens) - i), 0, -1):
            if any(j in consumed for j in range(i, i + length)):
                continue
            candidates = names_by_len.get(length)
            if not candidates:
                continue
            phrase = " ".join(tokens[i : i + length])
            phrase_norm = normalize(phrase)
            # If the phrase is already exactly one of the candidates, consume it
            # without replacing so we do not duplicate diacritics/casing.
            if any(phrase == c for c in candidates):
                best_name = "__SKIP__"
                best_len = length
                break
            match, score = _best_match(phrase, candidates)
            if match:
                best_name = match
                best_len = length
                best_phrase = phrase
                break

        if best_name == "__SKIP__":
            for j in range(i, i + best_len):
                consumed.add(j)
            i += best_len
            continue
        if best_name:
            start_pos = token_matches[i].start()
            end_pos = token_matches[i + best_len - 1].end()

            # Preserve the original separators between tokens for multi-word
            # replacements so "Matous, Vavra" becomes "Matouš, Vávra".
            if best_len == 1:
                replacement_text = best_name
            else:
                name_words = best_name.split()
                parts = [name_words[0]]
                for k in range(best_len - 1):
                    sep = text[token_matches[i + k].end() : token_matches[i + k + 1].start()]
                    parts.append(sep + name_words[k + 1])
                replacement_text = "".join(parts)

            replacements.append((start_pos, end_pos, best_phrase, best_name, replacement_text))
            for j in range(i, i + best_len):
                consumed.add(j)
            i += best_len
        else:
            i += 1

    # Apply replacements from the end to keep earlier positions stable.
    corrected = text
    for start, end, _, _, replacement_text in sorted(replacements, reverse=True):
        corrected = corrected[:start] + replacement_text + corrected[end:]

    rep_list = [(phrase, name) for _, _, phrase, name, _ in sorted(replacements)]
    return corrected, rep_list
