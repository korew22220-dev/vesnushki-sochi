"""Build the static home page from content/site.json for GitHub Pages."""
import html
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEMPLATE = (ROOT / "site-template.html").read_text(encoding="utf-8")
CONTENT = json.loads((ROOT / "content/site.json").read_text(encoding="utf-8"))

# These markers are already present in the published page. Only plain-text
# elements are exposed: replacing their contents cannot alter the layout HTML.
TEXT_FIELDS = {
    "hero": ["description", "age"],
    "about": ["adaptation", "groups", "individual", "teachers", "intro"],
    "groups": [
        "young.age", "young.description", "middle.age",
        "middle.description", "older.age", "older.description",
    ],
    "activities": [
        "sport.title", "sport.description", "english.title",
        "english.description", "speech.title", "speech.description",
        "art.title", "art.description", "workshops.title",
        "workshops.description",
    ],
    "food": ["description"],
    "walk": ["description"],
    "teachers": [
        "description", "irina.role", "irina.name",
        "angelina.role", "angelina.name", "yulia.role", "yulia.name",
        "ekaterina.role", "ekaterina.name", "stanislava.role",
        "stanislava.name",
    ],
    "mamaBaby": [
        "photoLabel", "age", "title1", "title2", "title3",
        "subtitle", "description", "activity1", "activity2",
        "activity3", "activity4", "activity5", "activity6",
        "cta", "limited",
    ],
}

IMAGE_FILES = {
    "photo_about": "photo-about-replacement.jpg",
    "group_young": "group-young.jpg",
    "group_middle": "group-middle.jpg",
    "group_older": "group-older.jpg",
    "activities": "photo-6.webp",
    "mama_baby": "mama-flyer.jpeg",
    "gallery_1": "photo-10.webp",
    "gallery_3": "photo-15.webp",
    "gallery_4": "photo-2.webp",
    "gallery_5": "photo-13.webp",
    "gallery_6": "photo-7.webp",
    "teacher_irina": "teacher-irina-priymak.webp",
    "teacher_angelina": "teacher-angelina-matiek.webp",
    "teacher_yulia": "teacher-yulia-andreeva.webp",
    "teacher_ekaterina": "teacher-ekaterina-shashkova.webp",
    "teacher_stanislava": "teacher-stanislava-safronova.webp",
}


def marked_text(source, marker, value):
    pattern = re.compile(
        r'(<(?P<tag>[a-z][\w-]*)\b[^>]*\bdata-cms-text="'
        + re.escape(marker)
        + r'"[^>]*>)(?P<body>.*?)</(?P=tag)>',
        re.S,
    )
    matches = list(pattern.finditer(source))
    if not matches:
        raise ValueError(f"Missing text marker: {marker}")
    if any("<" in m.group("body") for m in matches):
        raise ValueError(f"Nested markup in editable text: {marker}")
    escaped = html.escape(str(value), quote=False)
    return pattern.sub(lambda m: m.group(1) + escaped + "</" + m.group("tag") + ">", source)


def marked_price(source, marker, value):
    pattern = re.compile(
        r'(<(?P<tag>[a-z][\w-]*)\b[^>]*\bdata-price="'
        + re.escape(marker)
        + r'"[^>]*>)(?P<body>.*?)</(?P=tag)>',
        re.S,
    )
    if not pattern.search(source):
        raise ValueError(f"Missing price marker: {marker}")
    return pattern.sub(
        lambda m: m.group(1) + html.escape(str(value), quote=False)
        + "</" + m.group("tag") + ">",
        source,
    )


def build():
    page = TEMPLATE
    for section, fields in TEXT_FIELDS.items():
        for field in fields:
            page = marked_text(page, section + "." + field, CONTENT[section][field.replace(".", "_")])
    for marker, value in CONTENT["prices"].items():
        page = marked_price(page, marker, value)
    for marker in ("description", "endLabel", "discount", "popupEnd"):
        pattern = re.compile(
            r'(<(?P<tag>[a-z][\w-]*)\b[^>]*\bdata-promo="'
            + marker + r'"[^>]*>).*?</(?P=tag)>', re.S
        )
        if not pattern.search(page):
            raise ValueError(f"Missing promotion marker: {marker}")
        page = pattern.sub(
            lambda m: m.group(1) + html.escape(CONTENT["promotion"][marker])
            + "</" + m.group("tag") + ">",
            page,
        )
    if not isinstance(CONTENT["promotion"]["active"], bool):
        raise ValueError("Promotion active must be true or false")
    page = page.replace('"active":true,', '"active":'
                        + json.dumps(CONTENT["promotion"]["active"]) + ',')

    # Sitewide images share the same source where the original page reused it.
    for key, original in IMAGE_FILES.items():
        replacement = CONTENT["images"][key]
        if not isinstance(replacement, str) or not replacement:
            raise ValueError(f"Missing image: {original}")
        if not (replacement.startswith("/media/") or re.fullmatch(r"[\w.-]+", replacement)):
            raise ValueError(f"Image must be a site file or CMS upload: {replacement}")
        needle = 'src="' + original + '"'
        if needle not in page:
            raise ValueError(f"Missing image source: {original}")
        page = page.replace(needle, 'src="' + html.escape(replacement, quote=True) + '"')

    contact = CONTENT["contacts"]
    original_phone = "+7 (988) 233-05-66"
    digits = re.sub(r"\D", "", contact["phone"])
    if len(digits) != 11 or digits[0] not in "78":
        raise ValueError("Phone must be an 11-digit Russian number")
    digits = "7" + digits[1:]
    page = page.replace(original_phone, html.escape(contact["phone"], quote=True))
    page = page.replace("tel:+79882330566", "tel:+" + digits)
    page = page.replace('"+79882330566"', '"+' + digits + '"')
    for marker, old in [
        ("address", "Сочи, Туапсинская улица, 7Г"),
        ("days", "Понедельник–пятница"),
        ("hours", "07:30–19:00"),
    ]:
        pattern = re.compile(
            r'(<span data-contact="' + marker + r'">).*?(</span>)', re.S
        )
        if not pattern.search(page):
            raise ValueError(f"Missing contact marker: {marker}")
        page = pattern.sub(
            lambda m: m.group(1) + html.escape(contact[marker]) + m.group(2),
            page,
        )
    output = ROOT / "dist"
    if output.exists():
        shutil.rmtree(output)
    output.mkdir()
    (output / "index.html").write_text(page, encoding="utf-8")
    for asset in ROOT.iterdir():
        if asset.is_file() and asset.name not in {
            "index.html", "site-template.html", "render_site.py", "README.md",
            ".pages.yml",
        }:
            shutil.copy2(asset, output / asset.name)
    if (ROOT / "media").is_dir():
        shutil.copytree(ROOT / "media", output / "media")
    assert 'href="https://vesnushki-sochi23.ru/"' in page
    print("Rendered dist/index.html with", len(page), "characters")


if __name__ == "__main__":
    build()
