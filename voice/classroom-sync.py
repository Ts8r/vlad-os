#!/usr/bin/env python3
"""
VLAD — Google Classroom + Drive (API officielle, OAuth, stdlib uniquement)
--------------------------------------------------------------------------
  auth   → ouvre le consentement Google (boucle locale 127.0.0.1), stocke le
           refresh token dans .google-oauth.json (dossier de VLAD) (jamais loggé)
  sync   → JSON sur stdout : cours actifs, devoirs (titre, échéance, lien,
           supports), annonces/supports (PDF & Docs) ; télécharge les nouveaux
           fichiers dans cours/ (Docs Google exportés en PDF), lus ensuite par VLAD
Identifiants client : .google-client.json (dossier de VLAD) (téléchargé depuis la
console Google Cloud, type « Application de bureau »). Lecture seule partout.
"""
import json, os, sys, re, time, urllib.request, urllib.parse, webbrowser, secrets
from http.server import BaseHTTPRequestHandler, HTTPServer   # pas « import http.server » : le helper http() ci-dessous masquerait le module

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CLIENT = os.path.join(ROOT, ".google-client.json")
TOKENS = os.path.join(ROOT, ".google-oauth.json")
ECOLE = os.path.join(ROOT, "cours")   # supports téléchargés → lus par voice/cours.js
SEEN = os.path.join(ROOT, ".classroom-api-seen.json")
SCOPES = " ".join([
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    "https://www.googleapis.com/auth/classroom.announcements.readonly",
    "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
])

def die(msg, code=1):
    print(json.dumps({"error": msg})); sys.exit(code)

def client():
    try:
        c = json.load(open(CLIENT))
        c = c.get("installed") or c.get("web") or c
        return c["client_id"], c["client_secret"]
    except Exception:
        die("client absent : dépose le JSON OAuth (application de bureau) dans le dossier de VLAD, nommé .google-client.json")

def http(url, data=None, headers=None, raw=False):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
        return b if raw else json.loads(b.decode() or "{}")

# ── OAuth ──────────────────────────────────────────────────────────────
def auth():
    cid, csec = client()
    port = 8791
    redirect = f"http://127.0.0.1:{port}/"
    state = secrets.token_urlsafe(16)
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code", "scope": SCOPES,
        "access_type": "offline", "prompt": "consent", "state": state,
        "login_hint": os.environ.get("VLAD_GOOGLE_EMAIL", ""),
    })
    got = {}
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            got.update({k: v[0] for k, v in q.items()})
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
            self.wfile.write("<h2 style='font-family:sans-serif'>VLAD est connecté à Classroom. Tu peux fermer cet onglet.</h2>".encode())
        def log_message(self, *a): pass
    srv = HTTPServer(("127.0.0.1", port), H)
    print(json.dumps({"open": url}), flush=True)
    try: webbrowser.open(url)
    except Exception: pass
    srv.timeout = 300
    while "code" not in got and "error" not in got:
        srv.handle_request()
    if "error" in got: die("consentement refusé : " + got["error"])
    if got.get("state") != state: die("état OAuth invalide")
    tok = http("https://oauth2.googleapis.com/token", urllib.parse.urlencode({
        "code": got["code"], "client_id": cid, "client_secret": csec, "redirect_uri": redirect, "grant_type": "authorization_code",
    }).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
    if "refresh_token" not in tok: die("pas de refresh_token reçu (réessaie avec prompt=consent)")
    tok["obtained"] = int(time.time())
    json.dump(tok, open(TOKENS, "w")); os.chmod(TOKENS, 0o600)
    print(json.dumps({"ok": True}))

def access_token():
    cid, csec = client()
    try: t = json.load(open(TOKENS))
    except Exception: die("non autorisé : lance `classroom-sync.py auth`", 2)
    if t.get("access_token") and time.time() < t.get("obtained", 0) + t.get("expires_in", 0) - 60:
        return t["access_token"]
    try:
        r = http("https://oauth2.googleapis.com/token", urllib.parse.urlencode({
            "refresh_token": t["refresh_token"], "client_id": cid, "client_secret": csec, "grant_type": "refresh_token",
        }).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if "invalid_grant" in body: die("autorisation expirée : relance `auth`", 2)
        die("refresh : HTTP " + str(e.code))
    t.update(r); t["obtained"] = int(time.time()); json.dump(t, open(TOKENS, "w"))
    return t["access_token"]

# ── API ────────────────────────────────────────────────────────────────
def api(path, params=None, base="https://classroom.googleapis.com/v1/"):
    url = base + path + ("?" + urllib.parse.urlencode(params) if params else "")
    return http(url, headers={"Authorization": "Bearer " + access_token()})

def paged(path, key, params=None):
    out, token = [], None
    while True:
        p = dict(params or {})
        if token: p["pageToken"] = token
        r = api(path, p)
        out += r.get(key, [])
        token = r.get("nextPageToken")
        if not token: return out

def safe_name(s):
    s = re.sub(r"[^\w.\-() éèàùçÉ]+", "_", s).strip("_ ")
    return s[:120] or "document"

def download(material, dest_dir, seen):
    """Télécharge un support PDF/Doc → cours/. Retourne le nom local ou None."""
    f = material.get("driveFile", {}).get("driveFile") or material.get("driveFile")
    if not f or not f.get("id"): return None
    fid, title = f["id"], f.get("title") or fid
    if fid in seen: return seen[fid]
    try:
        return _download(fid, title, dest_dir, seen)
    except urllib.error.HTTPError as e:
        # fichier supprimé ou non partagé via Drive (404/403) : on l'ignore définitivement,
        # le devoir garde son lien Classroom — jamais bloquant pour le reste de la synchro
        if e.code in (403, 404):
            seen[fid] = None
            return None
        raise

def _download(fid, title, dest_dir, seen):
    meta = api(f"files/{fid}", {"fields": "mimeType,name"}, base="https://www.googleapis.com/drive/v3/")
    mime, name = meta.get("mimeType", ""), safe_name(meta.get("name") or title)
    hdr = {"Authorization": "Bearer " + access_token()}
    if mime == "application/pdf":
        data = http(f"https://www.googleapis.com/drive/v3/files/{fid}?alt=media", headers=hdr, raw=True)
        if not name.lower().endswith(".pdf"): name += ".pdf"
    elif mime in ("application/vnd.google-apps.document", "application/vnd.google-apps.presentation"):
        data = http(f"https://www.googleapis.com/drive/v3/files/{fid}/export?mimeType=application%2Fpdf", headers=hdr, raw=True)
        name = re.sub(r"\.pdf$", "", name, flags=re.I) + ".pdf"
    else:
        return None                              # images, vidéos, liens : ignorés
    os.makedirs(dest_dir, exist_ok=True)
    with open(os.path.join(dest_dir, name), "wb") as fh: fh.write(data)
    seen[fid] = name
    return name

def sync():
    try: seen = json.load(open(SEEN))
    except Exception: seen = {}
    courses = [c for c in paged("courses", "courses", {"courseStates": "ACTIVE", "studentId": "me"})]
    out = {"courses": [], "assignments": [], "materials": [], "downloaded": []}
    for c in courses:
        cid, cname = c["id"], c.get("name", "")
        out["courses"].append({"id": cid, "name": cname, "section": c.get("section", ""), "link": c.get("alternateLink")})
        for w in paged(f"courses/{cid}/courseWork", "courseWork", {"courseWorkStates": "PUBLISHED", "orderBy": "dueDate desc"}):
            due = w.get("dueDate")
            due_s = f"{due['year']}-{due['month']:02d}-{due['day']:02d}" if due else None
            files = []
            for m in w.get("materials", []):
                n = download(m, ECOLE, seen)
                if n: files.append(n); out["downloaded"].append(n)
            out["assignments"].append({"id": w["id"], "course": cname, "title": w.get("title", ""), "type": w.get("workType", ""),
                                       "due": due_s, "link": w.get("alternateLink"), "updated": w.get("updateTime", ""), "files": files})
        for kind, path, key in (("material", f"courses/{cid}/courseWorkMaterials", "courseWorkMaterial"), ("announcement", f"courses/{cid}/announcements", "announcements")):
            try: items = paged(path, key, {"orderBy": "updateTime desc"})
            except Exception: items = []
            for it in items:
                files = []
                for m in it.get("materials", []):
                    n = download(m, ECOLE, seen)
                    if n: files.append(n); out["downloaded"].append(n)
                out["materials"].append({"id": it["id"], "kind": kind, "course": cname, "title": it.get("title") or (it.get("text") or "")[:100],
                                         "updated": it.get("updateTime", ""), "link": it.get("alternateLink"), "files": files})
    json.dump(seen, open(SEEN, "w"))
    out["downloaded"] = sorted(set(out["downloaded"]))
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "sync"
    try:
        {"auth": auth, "sync": sync}[mode]()
    except urllib.error.HTTPError as e:
        die(f"HTTP {e.code} : {e.read().decode(errors='replace')[:200]}")
    except KeyError:
        die("usage : auth | sync")
