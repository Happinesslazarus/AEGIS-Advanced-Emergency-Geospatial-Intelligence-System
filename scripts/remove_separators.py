#!/usr/bin/env python3
"""Remove decorative box-drawing separators from repository text files.

Targets the heavy banner/comment style built from double-line box characters.
The cleanup preserves surrounding text while stripping the decorative glyphs.

Run from repository root:
  python scripts/remove_separators.py
"""

from __future__ import annotations

import codecs
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
}

BLOCK_COMMENT_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"}


def chars(*codepoints: int) -> str:
    return "".join(chr(codepoint) for codepoint in codepoints)


TARGET_CHARS = chars(0x2550, 0x2551, 0x2554, 0x2557, 0x255A, 0x255D)
BOX_CHARS = TARGET_CHARS + chars(
    0x2500,
    0x2502,
    0x250C,
    0x2510,
    0x2514,
    0x2518,
    0x251C,
    0x2524,
    0x252C,
    0x2534,
    0x253C,
)

TARGET_RE = re.compile(f"[{re.escape(TARGET_CHARS)}]")
BOX_RE = re.compile(f"[{re.escape(BOX_CHARS)}]")
STAR_LINE_RE = re.compile(r"^(\s*)\*(?:\s|$)")
BLOCK_START_RE = re.compile(r"^\s*/\*")
BLOCK_END_RE = re.compile(r"^\s*\*/\s*$")


def is_text_file(path: Path) -> bool:
    try:
        raw = path.read_bytes()
    except OSError:
        return False
    if b"\x00" in raw:
        return False
    try:
        if raw.startswith(codecs.BOM_UTF8):
            raw[len(codecs.BOM_UTF8) :].decode("utf-8")
        else:
            raw.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def split_bom_and_text(raw: bytes) -> tuple[bytes, str]:
    if raw.startswith(codecs.BOM_UTF8):
        return codecs.BOM_UTF8, raw[len(codecs.BOM_UTF8) :].decode("utf-8")
    return b"", raw.decode("utf-8")


def is_empty_comment_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False

    if stripped in {"/*", "/**", "*/", "*", "<!--", "-->"}:
        return False

    for token in ("<!--", "-->", "/*", "*/", "//", "--", "#", "*"):
        stripped = stripped.replace(token, "")

    return not stripped.strip()


def clean_line(line: str) -> str:
    updated = BOX_RE.sub("", line)
    updated = re.sub(r"^(\s*)\*\s+\*/\s*$", r"\1 */", updated)
    return updated.rstrip(" \t")


def repair_block_comments(path: Path, lines: list[str]) -> tuple[list[str], bool]:
    if path.suffix.lower() not in BLOCK_COMMENT_SUFFIXES:
        return lines, False

    repaired: list[str] = []
    changed = False
    inside_block = False
    index = 0

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if BLOCK_START_RE.match(line):
            repaired.append(line)
            inside_block = not (
                stripped.endswith("*/") and stripped not in {"/*", "/**"}
            )
            index += 1
            continue

        if inside_block:
            repaired.append(line)
            if BLOCK_END_RE.match(line):
                inside_block = False
            index += 1
            continue

        star_match = STAR_LINE_RE.match(line)
        if star_match:
            indent = star_match.group(1)
            repaired.append(f"{indent}/*")
            changed = True
            while index < len(lines) and STAR_LINE_RE.match(lines[index]):
                repaired.append(lines[index])
                index += 1
            repaired.append(f"{indent} */")
            continue

        repaired.append(line)
        index += 1

    return repaired, changed


def process_file(path: Path) -> tuple[bool, int]:
    raw = path.read_bytes()
    bom, text = split_bom_and_text(raw)

    newline = "\r\n" if "\r\n" in text else "\n"
    had_final_newline = text.endswith(("\n", "\r"))
    has_target_chars = bool(TARGET_RE.search(text))

    removed_lines = 0
    changed = False

    if has_target_chars:
        cleaned_lines: list[str] = []

        for line in text.splitlines():
            cleaned = clean_line(line)
            if cleaned != line:
                changed = True

            if is_empty_comment_line(cleaned):
                removed_lines += 1
                changed = True
                continue

            cleaned_lines.append(cleaned)
    else:
        cleaned_lines = text.splitlines()

    cleaned_lines, repaired_comments = repair_block_comments(path, cleaned_lines)
    changed = changed or repaired_comments

    if not changed:
        return False, 0

    output = newline.join(cleaned_lines)
    if had_final_newline:
        output += newline

    path.write_bytes(bom + output.encode("utf-8"))
    return True, removed_lines


def iter_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if not is_text_file(path):
            continue
        yield path


def main() -> None:
    files_changed = 0
    total_removed_lines = 0

    for path in iter_files(ROOT):
        changed, removed_lines = process_file(path)
        if not changed:
            continue
        files_changed += 1
        total_removed_lines += removed_lines
        print(f"Updated {path.relative_to(ROOT)}; removed {removed_lines} separator lines")

    print(
        f"Done. Files changed: {files_changed}. "
        f"Total separator lines removed: {total_removed_lines}."
    )


if __name__ == "__main__":
    main()
