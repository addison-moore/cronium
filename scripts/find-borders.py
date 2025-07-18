#!/usr/bin/env python3
import os
import re

# Regex to capture className="…" or className='…'
pattern = re.compile(r'className\s*=\s*(["\'])([^"\']*?)\1')

log_path = "logs/borders.log"


def scan_file(path, relpath, out_lines):
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            for m in pattern.finditer(line):
                classes = m.group(2)
                # count occurrences of the substring "border"
                if classes.count("border") == 1:
                    quote_char = m.group(1)
                    snippet = m.group(0)
                    # find the column of the opening quote (1-based)
                    quote_idx0 = m.start(0) + snippet.index(quote_char)
                    col = quote_idx0 + 1
                    out_lines.append(f'{lineno}:{col}\t"{classes}"')


def main():
    out = []
    for root, _, files in os.walk("src"):
        # skip common build/output dirs
        if any(part in ("node_modules", ".next") for part in root.split(os.sep)):
            continue
        for fn in files:
            if fn.endswith(".tsx"):
                full = os.path.join(root, fn)
                rel = os.path.relpath(full)
                file_matches = []
                scan_file(full, rel, file_matches := [])
                if file_matches:
                    out.append(rel)
                    out.extend(file_matches)
                    out.append("")  # blank line between files

    if out:
        with open(log_path, "w", encoding="utf-8") as logf:
            logf.write("\n".join(out))
        print(f"Logged {len(out)} entries to {log_path}")
    else:
        print("No className with exactly one 'border' found.")


if __name__ == "__main__":
    main()
