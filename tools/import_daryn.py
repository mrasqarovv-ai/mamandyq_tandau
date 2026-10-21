#!/usr/bin/env python3
"""Import publicly accessible original Daryn documents, without inventing questions.

Run from the repository root: python3 tools/import_daryn.py
PDF extraction uses pdftotext (preferred) or optional pypdf. DOCX and text use
the standard library. Google Drive support is provided by daryn_drive.py.
An unsuccessful refresh preserves already imported documents. Network failures,
unreadable scans and ambiguous metadata are recorded in data/import-report.json.
"""
from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime, timezone
import hashlib
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
import zipfile

SEEDS = [
    {"id": "junior-ru", "title": "7–8 сынып: ресми орысша архив", "url": "https://daryn.kz/resp-junior-olimpiad-ru/", "grades": [7, 8], "language": "ru"},
    {"id": "junior-kk", "title": "7–8 сынып: ресми қазақша архив", "url": "https://daryn.kz/kk/resp-junior-olimpiad-kz/", "grades": [7, 8], "language": "kk"},
    {"id": "grades-56", "title": "5–6 сынып: ресми қазақша архив", "url": "https://daryn.kz/kk/5-6-resp-olymp-kz/", "grades": [5, 6], "language": "kk"},
]
YEARS = [f"{year}–{year+1}" for year in range(2020, 2027)]
SUBJECTS = {
    "mathematics": ("математ", "mathemat", "algebra"),
    "physics": ("физик", "physics"),
    "chemistry": ("хими", "chemistry"),
    "biology": ("биолог", "biology"),
    "informatics": ("информат", "informatics", "computer science"),
    "geography": ("географ", "geography"),
    "history": ("тарих", "истори", "history"),
    "kazakh": ("қазақ", "казах", "kazakh"),
    "russian": ("орыс", "русск", "russian"),
    "english": ("ағылшын", "англий", "english"),
    "natural-science": ("жаратылыстан", "естествозн", "natural science"),
}
SUPPORTED = {".pdf", ".docx", ".txt", ".doc", ".xlsx", ".pptx", ".zip"}
MAX_BYTES = 100 * 1024 * 1024


def fetch(url: str, timeout: int = 30) -> tuple[bytes, str, str]:
    """Use configured TLS/proxy trust; never disable certificate checking."""
    request = Request(url, headers={"User-Agent": "DarynArchiveImporter/1.0 (+public educational archive)"})
    with urlopen(request, timeout=timeout) as response:
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError(f"Document exceeds {MAX_BYTES // 1024 // 1024} MiB limit")
        return data, response.headers.get_content_type(), response.geturl()


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[dict] = []
        self.active: dict | None = None
        self.context: deque[str] = deque(maxlen=14)
        self.year = ""
        self.stage = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href"):
            self.active = {"url": attrs["href"], "label": "", "context": " ".join(self.context), "year": self.year, "stage": self.stage}
        elif tag in ("iframe", "embed") and attrs.get("src"):
            self.links.append({"url": attrs["src"], "label": attrs.get("title", ""), "context": " ".join(self.context), "year": self.year, "stage": self.stage})

    def handle_data(self, data):
        text = " ".join(data.split())
        if not text:
            return
        year = re.search(r"\b(20\d{2})\s*[-–—]\s*(20\d{2})\b", text)
        if year and int(year[2]) == int(year[1]) + 1:
            self.year = f"{year[1]}–{year[2]}"
            self.stage = ""
        if re.search(r"^(?:Республикалық|Облыстық|Аудандық|Мектеп|Республиканский|Областной|Районный|Школьный)\s+(?:кезең|этап)", text, re.I):
            self.stage = text[:100]
        if self.active is not None:
            self.active["label"] += " " + text
        self.context.append(text[:250])

    def handle_endtag(self, tag):
        if tag == "a" and self.active is not None:
            self.links.append(self.active)
            self.active = None


def infer_metadata(label: str, source: dict) -> dict:
    """Infer only explicit labels; absent/ambiguous facts remain unknown."""
    label = unquote(label).lower()
    years = re.findall(r"\b(20\d{2})\s*[-–—_/]\s*(20\d{2})\b", label)
    valid_years = {f"{a}–{b}" for a, b in years if int(b) == int(a) + 1}
    # Grade ranges identify a collection, not an individual document's grade.
    label_without_ranges = re.sub(r"\b[5-8]\s*[-–—]\s*[5-8]\s*(?:сынып|класс|grade)", "", label)
    grades = set(re.findall(r"\b([5-8])\s*(?:[-_ ]?(?:сынып|класс|кл\.?|grade))", label_without_ranges))
    if not grades:
        grades = set(re.findall(r"(?:grade|класс|сынып)\s*[-_: ]*([5-8])\b", label_without_ranges))
    subject_label = re.sub(r"(?:қазақ|орыс)\s+тілінде\s+оқытатын\s+мектептердегі|(?:қазақ|орыс)\s+мектептеріне\s+арналған|(?:қазақ|орыс)\s+тілінде|(?:казахском|русском)\s+языке|\b(?:kazakh|russian)\s+language\s+version", "", label)
    subject_hits = [key for key, words in SUBJECTS.items() if any(word in subject_label for word in words)]
    if "mathematics" not in subject_hits and re.search(r"(?:^|[\W_])(?:мат|матем|math)(?:$|[\W_])", subject_label):
        subject_hits.append("mathematics")
    if "kazakh" in subject_hits and not re.search(r"қазақ(?!стан)|казах(?!стан)|kazakh", subject_label):
        subject_hits.remove("kazakh")
    # The language name can be the subject; language itself comes from explicit
    # language labels, otherwise from the official seed page's section.
    kk = bool(re.search(r"қазақша|қазақ тілінде|казахском языке|(?:^|[\W_])(?:kk|kaz|каз)(?:$|[\W_])", label))
    ru = bool(re.search(r"орысша|орыс тілінде|русском языке|(?:^|[\W_])(?:ru|rus|рус)(?:$|[\W_])", label))
    language = "mixed" if kk and ru else "kk" if kk else "ru" if ru else source.get("language", "unknown")
    stages = []
    for pattern, value in [(r"аудан|район|district", "district"), (r"облыс|област|regional", "regional"), (r"республик|republic", "republican")]:
        if re.search(pattern, label):
            stages.append(value)
    return {"subject": subject_hits[0] if len(subject_hits) == 1 else "other", "grade": int(next(iter(grades))) if len(grades) == 1 else None, "year": next(iter(valid_years)) if len(valid_years) == 1 else None, "language": language, "stage": stages[0] if len(stages) == 1 else "unknown"}


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        if shutil.which("pdftotext"):
            result = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"], capture_output=True, text=True, timeout=90)
            if result.returncode != 0:
                raise ValueError("pdftotext failed: " + result.stderr[:250])
            return result.stdout.strip()
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("Install poppler-utils (pdftotext) or Python pypdf to extract PDFs") from exc
        return "\n\n".join(page.extract_text() or "" for page in PdfReader(path).pages).strip()
    if suffix == ".docx":
        with zipfile.ZipFile(path) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
        namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        return "\n".join("".join(p.itertext()) for p in root.findall(".//w:p", namespace)).strip()
    if suffix == ".xlsx":
        namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        with zipfile.ZipFile(path) as archive:
            strings = []
            if "xl/sharedStrings.xml" in archive.namelist():
                strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("x:si", namespace)]
            sheets = []
            for name in sorted(archive.namelist()):
                if not re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name):
                    continue
                rows = []
                for row in ET.fromstring(archive.read(name)).findall(".//x:row", namespace):
                    values = []
                    for cell in row.findall("x:c", namespace):
                        value = cell.find("x:v", namespace)
                        text = value.text if value is not None else "".join(cell.itertext())
                        if cell.get("t") == "s" and text and text.isdigit() and int(text) < len(strings):
                            text = strings[int(text)]
                        values.append(text or "")
                    rows.append("\t".join(values))
                sheets.append("\n".join(rows))
            return "\n\n".join(sheets).strip()
    if suffix == ".pptx":
        namespace = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
        with zipfile.ZipFile(path) as archive:
            return "\n\n".join("\n".join(node.text or "" for node in ET.fromstring(archive.read(name)).findall(".//a:t", namespace)) for name in sorted(archive.namelist()) if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)).strip()
    if suffix == ".txt":
        data = path.read_bytes()
        for encoding in ("utf-8-sig", "utf-16", "cp1251"):
            try:
                return data.decode(encoding).strip()
            except UnicodeError:
                pass
        raise ValueError("Cannot determine document text encoding")
    if suffix == ".doc" and shutil.which("antiword"):
        result = subprocess.run(["antiword", str(path)], capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            return result.stdout.strip()
    if suffix == ".doc" and shutil.which("soffice"):
        with tempfile.TemporaryDirectory(prefix="daryn-office-") as temporary:
            temporary_path = Path(temporary)
            profile = (temporary_path / "profile").as_uri()
            result = subprocess.run(["soffice", f"-env:UserInstallation={profile}", "--headless", "--convert-to", "txt:Text", "--outdir", temporary, str(path.resolve())], capture_output=True, text=True, timeout=90)
            converted = temporary_path / (path.stem + ".txt")
            if result.returncode == 0 and converted.exists():
                return converted.read_text(encoding="utf-8-sig").strip()
            raise ValueError("LibreOffice could not extract legacy Word text; original retained")
    raise ValueError(f"Text extraction unavailable for {suffix}; original file retained")


def material_metadata(title: str, text: str, subject: str) -> dict:
    """Identify document type and language from the original, not seed-page UI."""
    name = title.rsplit(" / ", 1)[-1].lower()
    header = text[:1000].lower()
    if re.search(r"ключ|кілт|(?:^|[\W_])(?:keys?|ans(?:wers?)?)(?:$|[\W_])|ответ", name) or re.search(r"кілттер|ключи|ключ ответ|жауаптар кілт|\banswer key\b", header[:300]):
        kind = "answers"
    elif re.search(r"решени|шешім|solution", name):
        kind = "solutions"
    elif re.search(r"/\s*(?:шешімдер|решения|solutions|кілттер)\s*/", title, re.I):
        kind = "solutions"
    else:
        kind = "tasks"
    # Language subjects contain source-language exercises even when the official
    # listing and folder labels are translated into Kazakh.
    if subject in ("english", "russian", "kazakh"):
        language = {"english": "en", "russian": "ru", "kazakh": "kk"}[subject]
    else:
        sample = text[:10000].lower()
        kk_count = len(re.findall(r"[әғқңөұүһі]", sample))
        ru_count = len(re.findall(r"\b(?:задани\w*|класс\w*|решени\w*|ответ\w*|найдите|определите|котор\w*|является|правильн\w*|вопрос\w*|из|для|что|как|на)\b", sample))
        kk = kk_count >= 18
        ru = ru_count >= 6
        if re.search(r"кілттер\s*[/|]\s*ключи|жауаптар\s*[/|]\s*ответы|жауаптар к[іi]лт[іi]\s*[/|]\s*ключ", header):
            kk = ru = True
        if kk and ru:
            language = "mixed"
        elif kk:
            language = "kk"
        elif ru:
            language = "ru"
        elif re.search(r"ключ|ответ|рус", name):
            language = "ru"
        elif re.search(r"кілт|қазақ|жауап", name):
            language = "kk"
        else:
            language = "unknown"
    return {"language": language, "materialType": kind}


def document_suffix(data: bytes, url: str, content_type: str) -> str:
    if data.startswith(b"%PDF"):
        return ".pdf"
    suffix = Path(unquote(urlparse(url).path)).suffix.lower()
    if data.startswith(b"PK"):
        import io
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return ".docx" if "word/document.xml" in archive.namelist() else ".zip"
    if suffix in SUPPORTED:
        return suffix
    if content_type == "application/pdf":
        return ".pdf"
    if content_type.startswith("text/plain"):
        return ".txt"
    raise ValueError("URL did not return a supported document (possibly a login/access page)")


class Importer:
    def __init__(self, root: Path, max_pages: int, timeout: int):
        self.root = root.resolve()
        self.materials = self.root / "materials"
        self.materials.mkdir(parents=True, exist_ok=True)
        # Cache raw Drive names outside the published repository; the archive
        # retains content-addressed originals under materials/ exactly once.
        self.drive_cache = self.root.parent / ".daryn-import-cache" / self.root.name
        self.output = self.root / "data" / "archive.json"
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.max_pages, self.timeout = max_pages, timeout
        self.errors: list[dict] = []
        self.imported: list[dict] = []
        self.visited: set[str] = set()
        self.documents_seen: set[str] = set()
        self.checked_pages: list[str] = []

    def error(self, url: str, message: str):
        self.errors.append({"url": url, "error": message})
        print(f"[unavailable] {url}: {message}", file=sys.stderr)

    def add_local_document(self, path: Path, source_url: str, source_page: str, label: str, source: dict):
        if path.suffix.lower() == ".zip":
            self.unpack_documents(path, source_url, source_page, label, source)
            return
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        identifier = digest[:20]
        if digest in self.documents_seen:
            return
        metadata = infer_metadata(label, source)
        # The public site is dedicated exclusively to Kazakhstan history.
        # Do not copy unrelated downloads into the publicly served materials/.
        if metadata['subject'] not in ('history', 'other'):
            return
        try:
            text = extract_text(path)
            if not text:
                self.error(source_url, "No machine-readable text; original retained. Scan requires OCR/manual verification.")
        except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired, zipfile.BadZipFile, ET.ParseError) as exc:
            text = ""
            self.error(source_url, str(exc))
        if text:
            header_metadata = infer_metadata(text[:400], source)
            natural_science = bool(re.search(r"жаратылыстан|естествозн|natural science", label, re.I))
            if metadata["subject"] == "other" and header_metadata["subject"] != "other" and not natural_science:
                metadata["subject"] = header_metadata["subject"]
            if metadata["grade"] is None and header_metadata["grade"] is not None:
                metadata["grade"] = header_metadata["grade"]
        metadata.update(material_metadata(label, text, metadata["subject"]))
        if metadata['subject'] != 'history':
            return
        if not re.search(r'қазақстан(?:ның)?\s+тарих|истори[яи]\s+казахстан|kazakhstan\s+history|history\s+of\s+kazakhstan', label + '\n' + text[:1600], re.I):
            return
        self.documents_seen.add(digest)
        target = self.materials / f"{identifier}{path.suffix.lower()}"
        if target.exists() and target.read_bytes() != data:
            identifier = digest
            target = self.materials / f"{identifier}{path.suffix.lower()}"
        if path.resolve() != target.resolve():
            shutil.copyfile(path, target)
        metadata["grades"] = [metadata["grade"]] if metadata["grade"] is not None else []
        if not metadata["grades"]:
            grade_ranges = re.findall(r"\b([5-8])\s*[-–—]\s*([5-8])\s*(?:сынып|класс|grade)", label, re.I)
            for first, last in grade_ranges:
                if int(first) <= int(last):
                    metadata["grades"] = sorted(set(metadata["grades"]) | set(range(int(first), int(last) + 1)))
        self.imported.append({"id": identifier, "sha256": digest, "title": label.strip() or path.name, **metadata, "sourcePage": source_page, "sourceUrl": source_url, "fileUrl": target.relative_to(self.root).as_posix(), "format": target.suffix.lstrip("."), "text": text, "questions": []})

    def unpack_documents(self, path: Path, source_url: str, source_page: str, label: str, source: dict):
        with zipfile.ZipFile(path) as archive, tempfile.TemporaryDirectory(prefix="daryn-zip-") as temporary:
            members = [item for item in archive.infolist() if not item.is_dir() and Path(item.filename).suffix.lower() in SUPPORTED - {".zip"}]
            if len(members) > 400 or sum(item.file_size for item in members) > MAX_BYTES:
                raise ValueError("ZIP exceeds safe extraction limits")
            for index, item in enumerate(members):
                # Do not extract member paths: keep archive traversal inert.
                destination = Path(temporary) / f"{index}{Path(item.filename).suffix.lower()}"
                destination.write_bytes(archive.read(item))
                self.add_local_document(destination, source_url, source_page, f"{label} / {item.filename}", source)

    def direct_document(self, url: str, source_page: str, label: str, source: dict):
        if url in self.visited:
            return
        self.visited.add(url)
        try:
            data, content_type, final_url = fetch(url, self.timeout)
            suffix = document_suffix(data, final_url, content_type)
            with tempfile.TemporaryDirectory(prefix="daryn-download-") as temporary:
                path = Path(temporary) / (hashlib.sha256(data).hexdigest()[:20] + suffix)
                path.write_bytes(data)
                self.add_local_document(path, url, source_page, label, source)
        except (HTTPError, URLError, OSError, ValueError, TimeoutError, zipfile.BadZipFile) as exc:
            self.error(url, str(exc))

    def drive_folder(self, url: str, source_page: str, label: str, source: dict):
        if url in self.visited:
            return
        self.visited.add(url)
        try:
            from daryn_drive import crawl_folder
            result = crawl_folder(url, self.drive_cache, timeout=self.timeout)
            for error in result.get("errors", []):
                self.errors.append(error)
            for item in result.get("files", []):
                path = item.get("local_path")
                if not path:
                    continue
                folder_path = item.get("folder_path", [])
                if isinstance(folder_path, str):
                    folder_path = [folder_path]
                document_label = " / ".join([label, *folder_path, item.get("name", "")])
                self.add_local_document(Path(path), item.get("source_url", url), source_page, document_label, source)
        except (ImportError, RuntimeError, HTTPError, URLError, OSError, ValueError, TimeoutError) as exc:
            self.error(url, str(exc))

    def drive_document(self, url: str, source_page: str, label: str, source: dict):
        if url in self.visited:
            return
        self.visited.add(url)
        try:
            from daryn_drive import download_file
            item = download_file(url, self.drive_cache, timeout=self.timeout)
            path = Path(item["local_path"])
            if not path.suffix:
                suffix = document_suffix(path.read_bytes(), item["download_url"], item["mime_type"])
                renamed = path.with_suffix(suffix)
                path.rename(renamed)
                path = renamed
            self.add_local_document(path, url, source_page, label, source)
        except (ImportError, RuntimeError, HTTPError, URLError, OSError, ValueError, TimeoutError) as exc:
            self.error(url, str(exc))

    def crawl(self, source: dict):
        queue = deque([(source["url"], "")])
        start_checked = len(self.checked_pages)
        while queue and len(self.checked_pages) < self.max_pages:
            url, inherited_label = queue.popleft()
            if url in self.visited:
                continue
            self.visited.add(url)
            try:
                data, content_type, final_url = fetch(url, self.timeout)
                if "html" not in content_type:
                    raise ValueError("Expected official HTML archive page")
                page = PageLinks()
                page.feed(data.decode("utf-8", errors="replace"))
                self.checked_pages.append(url)
            except (HTTPError, URLError, OSError, ValueError, TimeoutError) as exc:
                self.error(url, str(exc))
                continue
            for link in page.links:
                target = urljoin(final_url, unescape(link["url"]))
                parsed = urlparse(target)
                if parsed.scheme not in ("https", "http"):
                    continue
                label = " / ".join(filter(None, [inherited_label, link.get("year"), link.get("stage"), link["label"]])).strip()
                is_task_link = bool(re.search(r"тапсыр|шешім|задан|решени|\btask|\bsolution|\bquestion|\banswer", link["label"], re.I))
                if parsed.hostname == "drive.google.com":
                    if not is_task_link:
                        continue
                    if "/folders/" in parsed.path:
                        self.drive_folder(target, url, label, source)
                    elif "/file/d/" in parsed.path or parsed.path in ("/open", "/uc"):
                        match = re.search(r"/file/d/([\w-]+)", target) or re.search(r"[?&]id=([\w-]+)", target)
                        if match:
                            self.drive_document(target, url, label, source)
                elif Path(unquote(parsed.path)).suffix.lower() in SUPPORTED:
                    if is_task_link:
                        self.direct_document(target, url, label, source)
                elif parsed.hostname in ("daryn.kz", "www.daryn.kz") and target not in self.visited:
                    # Follow archive-related pages rather than crawling unrelated news.
                    relevant = re.search(r"junior|5-6|5_6|7-8|7_8|архив|archive", unquote(parsed.path), re.I)
                    if relevant:
                        queue.append((target, link["label"]))
        return {**source, "status": "checked" if len(self.checked_pages) > start_checked else "blocked"}

    def save(self, sources: list[dict]):
        existing = {}
        if self.output.exists():
            # Fail instead of destroying an unreadable pre-existing archive.
            existing = json.loads(self.output.read_text(encoding="utf-8"))
        # Multiple curated records can intentionally represent different grade
        # or language slices of one original. Keep every existing record intact;
        # compare the original bytes, not the record's ID or sliced text.
        documents = list(existing.get("documents", []))
        hash_cache: dict[Path, str] = {}

        def file_hash(item):
            file_url = item.get("fileUrl", "")
            if file_url and not urlparse(file_url).scheme:
                path = (self.root / unquote(urlparse(file_url).path)).resolve()
                try:
                    path.relative_to(self.root)
                    if path.is_file():
                        if path not in hash_cache:
                            hasher = hashlib.sha256()
                            with path.open("rb") as stream:
                                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                                    hasher.update(chunk)
                            hash_cache[path] = hasher.hexdigest()
                        return hash_cache[path]
                except (ValueError, OSError):
                    pass
            digest = item.get("sha256", "")
            return digest.lower() if re.fullmatch(r"[0-9a-fA-F]{64}", digest) else None

        def original_identity(item):
            digest = file_hash(item)
            return ("sha256", digest) if digest else ("unverified", item.get("fileUrl") or item.get("sourceUrl") or item["id"])

        known_hashes = {digest for item in documents if (digest := file_hash(item))}
        known_ids = {item["id"] for item in documents}
        added_documents = []
        for item in self.imported:
            digest = file_hash(item)
            if digest in known_hashes:
                # Do not append an unsliced automatic record or replace curated
                # metadata/questions/text for an already represented original.
                continue
            if item["id"] in known_ids:
                if not digest:
                    self.error(item.get("sourceUrl", ""), "Existing record ID has no verifiable content identity; preserving existing record")
                    continue
                item = {**item, "id": digest}
                if item["id"] in known_ids:
                    self.error(item.get("sourceUrl", ""), "Existing record ID conflicts with different content; preserving existing record")
                    continue
            documents.append(item)
            added_documents.append(item)
            known_ids.add(item["id"])
            if digest:
                known_hashes.add(digest)
        # Preserve additional source annotations and sources not revisited by a
        # partial/blocked refresh. Match by URL because curated IDs may differ.
        merged_sources = [dict(item) for item in existing.get("sources", [])]
        for source in sources:
            position = next((i for i, old in enumerate(merged_sources) if old.get("url") == source.get("url") or old.get("id") == source.get("id")), None)
            if position is None:
                merged_sources.append(source)
            else:
                old = merged_sources[position]
                merged_sources[position] = {**source, **old, "status": source.get("status", old.get("status", "blocked"))}
        status = "partial" if documents or any(s.get("status") == "checked" for s in merged_sources) else "source-access-blocked"
        previous_coverage = {item["year"]: item for item in existing.get("coverage", [])}
        coverage = []
        all_years = list(dict.fromkeys([*YEARS, *previous_coverage, *(item.get("year") for item in documents if item.get("year"))]))
        added_years = {item.get("year") for item in added_documents}
        for year in all_years:
            if year in previous_coverage and (year not in added_years or previous_coverage[year].get("status") == "checked"):
                coverage.append(previous_coverage[year])
            else:
                count = len({original_identity(item) for item in documents if item.get("year") == year})
                coverage.append({**previous_coverage.get(year, {}), "year": year, "status": "partial" if count else "unverified", "note": f"{count} түпнұсқа құжат. Толықтық расталмаған." if count else "Материалдардың бар-жоғы расталмаған; жарияланбаған деп есептеуге болмайды."})
        question_keys = set()
        for item in documents:
            for index, question in enumerate(item.get("questions", [])):
                key = ("question-id", question["id"]) if isinstance(question, dict) and question.get("id") else ("record-question", item["id"], index)
                question_keys.add(key)
        statistics = {**existing.get("statistics", {}), "records": len(documents), "originalFiles": len({original_identity(item) for item in documents}), "verifiedSegmentedQuestions": len(question_keys), "questionCountComplete": False}
        if "segmentedQuestions" in statistics:
            statistics["segmentedQuestions"] = len(question_keys)
        result = {**existing, "schemaVersion": 1, "updatedAt": datetime.now(timezone.utc).isoformat(), "status": status, "sources": merged_sources, "coverage": coverage, "documents": documents, "statistics": statistics}
        if added_documents and isinstance(result.get("downloads"), dict):
            # The Word export reflects the previous content until regenerated.
            # Keep unrelated downloads; a failed or deduplicated refresh leaves
            # the existing Word download available.
            result["downloads"] = {key: value for key, value in result["downloads"].items() if key != "docx"}
        pending = self.output.with_suffix(".json.tmp")
        pending.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        pending.replace(self.output)
        report = {"updatedAt": result["updatedAt"], "importedDocuments": len(self.imported), "addedDocuments": len(added_documents), "retainedDocuments": len(documents), "wordExportNeedsRegeneration": bool(added_documents), "checkedPages": self.checked_pages, "errors": self.errors, "completeness": "Not established. Automatic discovery does not prove a complete archive."}
        (self.output.parent / "import-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Saved {len(documents)} records from {statistics['originalFiles']} originals ({len(added_documents)} added), {len(self.errors)} access/extraction issues.")
        return 2 if status == "source-access-blocked" else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="Output repository root")
    parser.add_argument("--max-pages", type=int, default=60)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--source", action="append", help="Additional official daryn.kz archive page URL")
    args = parser.parse_args(argv)
    importer = Importer(args.root, args.max_pages, args.timeout)
    sources = list(SEEDS)
    for index, url in enumerate(args.source or []):
        if urlparse(url).hostname not in ("daryn.kz", "www.daryn.kz"):
            parser.error("Additional source must be an official daryn.kz page")
        sources.append({"id": f"additional-{index}", "title": url, "url": url, "grades": [5, 6, 7, 8], "language": "unknown"})
    return importer.save([importer.crawl(source) for source in sources])


if __name__ == "__main__":
    raise SystemExit(main())
