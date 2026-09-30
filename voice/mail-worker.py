#!/usr/bin/env python3
"""
VLAD — Worker mail (IMAP Gmail, stdlib uniquement)
--------------------------------------------------
Deux modes, pilotés par argv[1] :
  fetch  → liste les mails NON LUS récents (UID, from, subject, extrait) en JSON
           sur stdout. BODY.PEEK : ne marque RIEN comme lu.
  label  → lit sur stdin {"labels": {"<uid>": "VLAD/Urgent", …}} et pose les
           labels Gmail (X-GM-LABELS). Crée les labels manquants. Rien d'autre :
           pas d'archivage, pas de suppression, pas de marquage lu.
Identifiants : variables d'env MAIL_USER / MAIL_APP_PASSWORD (jamais loggés).
"""
import imaplib, email, email.header, json, os, re, sys

USER = os.environ.get("MAIL_USER", "")
PASS = os.environ.get("MAIL_APP_PASSWORD", "")
# 2e boîte (facultative) : MAIL_ACCOUNT=2 → MAIL_USER2 / MAIL_APP_PASSWORD2
if os.environ.get("MAIL_ACCOUNT") == "2":
    USER = os.environ.get("MAIL_USER2", "")
    PASS = os.environ.get("MAIL_APP_PASSWORD2", "")
LIMIT = 20          # mails max par cycle (le tri IA est fait en un seul appel)
SNIPPET = 400       # caractères d'extrait par mail

def die(msg):
    print(json.dumps({"error": msg}))
    sys.exit(1)

def dec(h):
    try:
        return " ".join(
            (t.decode(enc or "utf-8", "replace") if isinstance(t, bytes) else t)
            for t, enc in email.header.decode_header(h or "")
        ).strip()
    except Exception:
        return str(h or "")

def snippet(msg):
    try:
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
        else:
            return msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8", "replace")
    except Exception:
        pass
    return ""

def main():
    if not USER or not PASS:
        die("MAIL_USER / MAIL_APP_PASSWORD absents du .env")
    mode = sys.argv[1] if len(sys.argv) > 1 else "fetch"
    try:
        M = imaplib.IMAP4_SSL("imap.gmail.com")
        M.login(USER, PASS)
    except Exception as e:
        die(f"connexion IMAP : {type(e).__name__}")

    if mode == "fetch":
        M.select("INBOX", readonly=True)
        typ, data = M.uid("SEARCH", None, "UNSEEN")
        uids = (data[0] or b"").split()
        uids = uids[-LIMIT:]                     # les plus récents
        out = []
        for uid in uids:
            typ, md = M.uid("FETCH", uid, "(BODY.PEEK[])")
            if typ != "OK" or not md or md[0] is None:
                continue
            msg = email.message_from_bytes(md[0][1])
            body = re.sub(r"\s+", " ", snippet(msg)).strip()[:SNIPPET]
            out.append({
                "uid": uid.decode(),
                "from": dec(msg.get("From"))[:120],
                "subject": dec(msg.get("Subject"))[:160],
                "date": msg.get("Date", "")[:40],
                "snippet": body,
            })
        print(json.dumps({"unseen": len((data[0] or b"").split()), "mails": out}, ensure_ascii=False))

    elif mode == "lire":
        # CONTENU complet des mails d'un fil : argv[2..] = mots de recherche
        # (expéditeur + sujet, tous requis en priorité, sinon les mieux notés).
        import datetime
        q = " ".join(sys.argv[2:]).strip().lower()
        mots = [m for m in re.split(r"\W+", q) if len(m) > 2]
        if not mots:
            die("recherche vide")
        for box in ('"[Gmail]/Tous les messages"', '"[Gmail]/All Mail"', "INBOX"):
            try:
                if M.select(box, readonly=True)[0] == "OK":
                    break
            except Exception:
                continue
        since = (datetime.date.today() - datetime.timedelta(days=180)).strftime("%d-%b-%Y")
        typ, data = M.search(None, "SINCE", since)
        ids = (data[0] or b"").split()[-500:]
        if not ids:
            die("boîte vide sur la période")
        # en-têtes en un seul FETCH groupé, filtre local (SEARCH texte Gmail = peu fiable)
        typ, hd = M.fetch(b",".join(ids), "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])")
        heads, cur = {}, None
        for part in hd or []:
            if isinstance(part, tuple):
                cur = part[0].split()[0]
                m = email.message_from_bytes(part[1])
                heads[cur] = (dec(m.get("From")), dec(m.get("Subject")))
        note = {}
        for i, (frm, sub) in heads.items():
            t = (frm + " " + sub).lower()
            n = sum(1 for m in mots if m in t)
            if n:
                note[i] = n
        if not note:
            die("aucun mail trouvé pour : " + q)
        best = max(note.values())
        gardes = [i for i in sorted(note, key=lambda x: int(x)) if note[i] >= max(1, best - 1)][-6:]

        def corps(msg):
            t = re.sub(r"\s+", " ", snippet(msg)).strip()
            if t.startswith("<"):                      # partie « texte » qui est en fait du HTML
                t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style).*?</\1>", " ", t))).strip()
            # l'historique cité (réponses précédentes) est déjà couvert par les autres mails du fil
            t = re.split(r"On \w{3}, \d|_{15,}|De : .{0,60}Envoyé :", t)[0].strip()
            if t:
                return t
            try:
                parts = msg.walk() if msg.is_multipart() else [msg]
                for part in parts:
                    if part.get_content_type() == "text/html":
                        h = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
                        h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h)
                        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h)).strip()
            except Exception:
                pass
            return "(corps illisible)"

        blocs = []
        for i in gardes:
            typ, md = M.fetch(i, "(BODY.PEEK[])")
            if typ != "OK" or not md or md[0] is None:
                continue
            msg = email.message_from_bytes(md[0][1])
            blocs.append("--- %s · de %s · %s ---\n%s" % (
                msg.get("Date", "")[:31], dec(msg.get("From"))[:90], dec(msg.get("Subject"))[:120], corps(msg)[:3500]))
        print(("=== %d mail(s) pour « %s » ===\n" % (len(blocs), q)) + "\n\n".join(blocs))

    elif mode == "threads":
        # Fils des 14 derniers jours, TOUS mails (lus inclus) + Envoyés →
        # statut factuel par fil : "a_traiter" (l'autre a parlé en dernier)
        # ou "repondu" (tu as répondu en dernier, on attend l'autre).
        import datetime
        since = (datetime.date.today() - datetime.timedelta(days=14)).strftime("%d-%b-%Y")

        def scan(box, cap=60):
            out = {}
            try:
                M.select(box, readonly=True)
            except Exception:
                return out
            typ, data = M.uid("SEARCH", None, f"SINCE {since}")
            for uid in (data[0] or b"").split()[-cap:]:
                typ, md = M.uid("FETCH", uid,
                    "(X-GM-THRID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT)])")
                if typ != "OK" or not md or md[0] is None:
                    continue
                meta = md[0][0].decode(errors="replace")
                th = re.search(r"X-GM-THRID (\d+)", meta)
                dt = re.search(r'INTERNALDATE "([^"]+)"', meta)
                if not th:
                    continue
                hdr = email.message_from_bytes(md[0][1])
                ts = email.utils.parsedate_to_datetime(dt.group(1)).timestamp() if dt else 0
                cur = out.get(th.group(1))
                if not cur or ts > cur["ts"]:
                    out[th.group(1)] = {
                        "ts": ts,
                        "from": dec(hdr.get("From"))[:100],
                        "to": dec(hdr.get("To"))[:100],
                        "subject": dec(hdr.get("Subject"))[:140],
                    }
            return out

        inbox = scan("INBOX")
        # dossier Envoyés : repéré par l'attribut \Sent (nom localisé en UTF-7 sinon)
        sent_box = '"[Gmail]/Sent Mail"'
        try:
            for ln in (M.list()[1] or []):
                s = ln.decode(errors="replace")
                if "\\Sent" in s:
                    sent_box = '"' + s.split(' "/" ')[-1].strip().strip('"') + '"'
                    break
        except Exception:
            pass
        sent = scan(sent_box)

        threads = []
        me = USER.split("@")[0].lower()
        for tid, inn in inbox.items():
            if me in inn["from"].lower():
                continue                      # fil dont le dernier INBOX est moi-même (cc)
            out_ts = sent.get(tid, {}).get("ts", 0)
            status = "repondu" if out_ts >= inn["ts"] else "a_traiter"
            age = int((__import__("time").time() - max(inn["ts"], out_ts)) // 86400)
            threads.append({"subject": inn["subject"], "from": inn["from"],
                            "status": status, "joursDepuis": age})
        threads.sort(key=lambda t: (t["status"] != "a_traiter", t["joursDepuis"]))
        # caps SÉPARÉS : le tri « à traiter d'abord » ne doit pas éjecter les répondus
        at = [t for t in threads if t["status"] == "a_traiter"][:20]
        rep = [t for t in threads if t["status"] == "repondu"][:10]
        print(json.dumps({"threads": at + rep}, ensure_ascii=False))

    elif mode == "label":
        req = json.loads(sys.stdin.read() or "{}")
        labels = req.get("labels", {})
        # créer les labels manquants (idempotent : ALREADYEXISTS ignoré)
        for lb in set(labels.values()):
            try:
                M.create(f'"{lb}"')
            except Exception:
                pass
        M.select("INBOX")                        # lecture-écriture pour STORE
        done = 0
        for uid, lb in labels.items():
            try:
                typ, _x = M.uid("STORE", uid, "+X-GM-LABELS", f'("{lb}")')
                if typ == "OK":
                    done += 1
            except Exception:
                pass
        print(json.dumps({"labelled": done}))

    M.logout()

if __name__ == "__main__":
    main()
