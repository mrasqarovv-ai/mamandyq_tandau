#!/usr/bin/env python3
"""Read public Google Drive folders without credentials or third-party services.

This module deliberately reports unavailable, truncated or changed listings. It
never treats a sign-in page or an HTML download error as an archived document.
The embedded public folder format is not an official stable Google API, so a
successful listing does not prove that the entire historical archive exists.
"""
from __future__ import annotations

import argparse
import html
import http.cookiejar
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

FOLDER_MIME = "application/vnd.google-apps.folder"
EXPORTS = {
    "application/vnd.google-apps.document": ("document", "docx"),
    "application/vnd.google-apps.spreadsheet": ("spreadsheets", "xlsx"),
    "application/vnd.google-apps.presentation": ("presentation", "pptx"),
}
GOOGLE_HOSTS = {
    "drive.google.com", "drive.usercontent.google.com", "docs.google.com",
}
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024


class DriveError(RuntimeError):
    """A public source could not be verified or downloaded."""


def _url_id(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in GOOGLE_HOSTS:
        raise DriveError("Expected a public HTTPS Google Drive or Google Docs URL")
    match = re.search(r"/(?:folders|d)/([A-Za-z0-9_-]+)", parsed.path)
    identifier = match.group(1) if match else urllib.parse.parse_qs(parsed.query).get("id", [""])[0]
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,}", identifier):
        raise DriveError("No valid file or folder ID found in source URL")
    return identifier


def _decode_js_string(value: str) -> str:
    """Decode only JavaScript escapes; preserve unescaped Unicode names."""
    escapes = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f"}

    def replace(match):
        token = match.group(1)
        if token[0] in "xu":
            return chr(int(token[1:], 16))
        return escapes.get(token, token)

    return re.sub(r"\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)", replace, value)


def parse_folder_page(page: str) -> list[dict]:
    """Extract public metadata, raising on absent or malformed folder data."""
    match = re.search(r"(?:window\[\s*['\"]_DRIVE_ivd['\"]\s*\]|_DRIVE_ivd)\s*=\s*'((?:\\.|[^'\\])*)'", page, re.S)
    if not match:
        if re.search(r"accounts\.google\.com|ServiceLogin|request.access", page, re.I):
            raise DriveError("Folder requires sign-in/access or is unavailable")
        raise DriveError("Public folder listing metadata is absent; Google format may have changed")
    try:
        data = json.loads(_decode_js_string(match.group(1)))
    except (ValueError, TypeError) as exc:
        raise DriveError("Public folder metadata could not be decoded") from exc
    if not isinstance(data, list) or not data or data[0] is None:
        # Google uses null for a genuinely empty public folder.
        if isinstance(data, list) and data and data[0] is None:
            return []
        raise DriveError("Unexpected public folder metadata shape")
    entries = data[0]
    if not isinstance(entries, list):
        raise DriveError("Unexpected public folder entry list")
    files = []
    for item in entries:
        if not isinstance(item, list) or len(item) < 4:
            raise DriveError("An entry in the public folder is unreadable")
        identifier, name, mime = item[0], item[2], item[3]
        if not all(isinstance(x, str) and x for x in (identifier, name, mime)):
            raise DriveError("An entry lacks its file ID, name or MIME type")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", identifier):
            raise DriveError("An entry contains an invalid Drive ID")
        files.append({"id": identifier, "name": name, "mime_type": mime})
    return files


def _safe_name(name: str) -> str:
    name = re.sub(r'[\\/\x00-\x1f<>:"|?*]', "_", name).strip(" .")
    return name[:160] or "document"


class _ConfirmationForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.action = None
        self.fields = {}
        self.active = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "form" and values.get("id") == "download-form":
            self.action = values.get("action")
            self.active = True
        if tag == "input" and self.active and values.get("name"):
            self.fields[values["name"]] = values.get("value", "")

    def handle_endtag(self, tag):
        if tag == "form":
            self.active = False


class PublicDrive:
    def __init__(self, timeout: int = 45):
        self.timeout = timeout
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def get(self, url: str) -> tuple[bytes, str, str]:
        # Use normal TLS and the environment's configured network proxy.
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Daryn public archive research)"})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                if urllib.parse.urlsplit(response.url).hostname == "accounts.google.com":
                    raise DriveError("Source redirects to Google sign-in")
                payload = response.read(MAX_DOWNLOAD_BYTES + 1)
                if len(payload) > MAX_DOWNLOAD_BYTES:
                    raise DriveError("Document exceeds the 100 MiB download limit")
                return payload, response.headers.get_content_type(), response.url
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            # Do not print proxy credentials, headers, cookie jars or raw bodies.
            if isinstance(exc, urllib.error.HTTPError):
                detail = f"HTTP {exc.code}"
            elif "403" in str(exc):
                detail = "connection denied (403), possibly network policy"
            else:
                detail = type(exc).__name__
            raise DriveError(f"Public source request failed: {detail}") from exc

    def download(self, file_url: str, output_dir: Path | str, *, metadata: dict | None = None) -> dict:
        identifier = _url_id(file_url)
        info = dict(metadata or {})
        mime = info.get("mime_type", "")
        name = info.get("name", identifier)
        if mime in EXPORTS:
            app, extension = EXPORTS[mime]
            download_url = f"https://docs.google.com/{app}/d/{identifier}/export?format={extension}"
            if not name.lower().endswith("." + extension):
                name += "." + extension
        else:
            download_url = f"https://drive.google.com/uc?export=download&id={identifier}"
        payload, content_type, actual_url = self.get(download_url)
        if content_type == "text/html" or payload.lstrip().lower().startswith((b"<!doctype html", b"<html")):
            form = _ConfirmationForm()
            form.feed(payload.decode("utf-8", errors="replace"))
            action = urllib.parse.urljoin(actual_url, html.unescape(form.action or ""))
            if form.action and urllib.parse.urlsplit(action).hostname in GOOGLE_HOSTS and form.fields.get("id") == identifier:
                # This is Google's public large-file confirmation, not authentication.
                download_url = action + ("&" if "?" in action else "?") + urllib.parse.urlencode(form.fields)
                payload, content_type, actual_url = self.get(download_url)
            if content_type == "text/html" or payload.lstrip().lower().startswith((b"<!doctype html", b"<html")):
                raise DriveError("Download returned an HTML access/confirmation/error page instead of a document")
        if not payload:
            raise DriveError("Download returned an empty document")
        if payload.startswith(b"%PDF-") and not name.lower().endswith(".pdf"):
            name += ".pdf"
        if name.lower().endswith(".pdf") and not payload.startswith(b"%PDF-"):
            raise DriveError("A .pdf source did not contain a PDF signature")
        if name.lower().endswith((".docx", ".xlsx", ".pptx", ".zip")) and not payload.startswith(b"PK"):
            raise DriveError("An Office/ZIP source did not contain a ZIP signature")
        output = Path(output_dir)
        output.mkdir(parents=True, exist_ok=True)
        path = output / f"{identifier}--{_safe_name(name)}"
        if path.exists() and path.read_bytes() != payload:
            raise DriveError("A different existing local file would be overwritten")
        path.write_bytes(payload)
        return {**info, "id": identifier, "name": name, "mime_type": mime or content_type,
                "source_url": file_url, "download_url": download_url,
                "local_path": str(path.resolve()), "bytes": len(payload)}


def download_file(file_url: str, output_dir: Path | str, timeout: int = 45, metadata: dict | None = None) -> dict:
    """Download one public file; raise DriveError if unavailable or invalid."""
    return PublicDrive(timeout).download(file_url, output_dir, metadata=metadata)


def crawl_folder(folder_url: str, output_dir: Path | str, timeout: int = 45) -> dict:
    """Recursively list and download public folders; retain every error explicitly."""
    client = PublicDrive(timeout)
    result = {"source_url": folder_url, "files": [], "folders": [], "errors": [], "complete": True}
    seen = set()

    def error(url, message):
        result["errors"].append({"source_url": url, "error": message})
        result["complete"] = False

    def visit(url, ancestors):
        identifier = _url_id(url)
        if identifier in seen:
            return
        seen.add(identifier)
        folder = {"id": identifier, "source_url": url, "folder_path": ancestors, "listed": False}
        result["folders"].append(folder)
        try:
            payload, _, _ = client.get(url)
            entries = parse_folder_page(payload.decode("utf-8", errors="replace"))
        except DriveError as exc:
            error(url, str(exc))
            return
        folder.update({"listed": True, "entry_count": len(entries)})
        if len(entries) >= 50:
            error(url, "Public embedded listing has at least 50 entries; pagination/completeness cannot be verified")
        for entry in entries:
            if entry["mime_type"] == FOLDER_MIME:
                visit(f"https://drive.google.com/drive/folders/{entry['id']}", ancestors + [entry["name"]])
                continue
            file_url = f"https://drive.google.com/file/d/{entry['id']}/view"
            entry["folder_path"] = ancestors
            try:
                result["files"].append(client.download(file_url, output_dir, metadata=entry))
            except DriveError as exc:
                error(file_url, str(exc))

    try:
        visit(folder_url, [])
    except DriveError as exc:
        error(folder_url, str(exc))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if "/folders/" in args.url:
        report = crawl_folder(args.url, args.output_dir)
    else:
        try:
            report = {"files": [download_file(args.url, args.output_dir)], "errors": [], "complete": True}
        except DriveError as exc:
            report = {"files": [], "errors": [{"source_url": args.url, "error": str(exc)}], "complete": False}
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(encoded, encoding="utf-8")
    print(encoded)
    return 0 if report["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
