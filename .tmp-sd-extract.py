import json, re, sys
from pypdf import PdfReader

def extract(path):
    reader = PdfReader(path)
    pages = []
    for i, p in enumerate(reader.pages):
        text = p.extract_text() or ""
        pages.append({"i": i + 1, "n": len(text), "text": text})
    return {"path": path, "pageCount": len(reader.pages), "pages": pages}

for src, out in [
    (r"c:\Users\razon\Documents\Sundry Debitors.pdf", r"c:\Users\razon\AG_ERP_Backend\.tmp-sd-closing.json"),
    (r"c:\Users\razon\Documents\S Debtor New Export.pdf", r"c:\Users\razon\AG_ERP_Backend\.tmp-sd-export.json"),
]:
    data = extract(src)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(src)
    print("pages", data["pageCount"], "chars", sum(p["n"] for p in data["pages"]))
    print("--- page 1 preview ---")
    print(data["pages"][0]["text"][:2500] if data["pages"] else "")
    print()
