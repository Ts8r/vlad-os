#!/usr/bin/env python3
"""
VLAD OS — Worker STT persistant (Whisper FR)
----------------------------------------------
Charge le modèle UNE seule fois au démarrage (≈ 3-4 s), puis reste en vie.
Le pont Node lui envoie "LISTEN\n" sur stdin ; le worker :
  1) émet {"event":"ready"}      → le modèle est chargé (au boot)
  2) émet {"event":"listening"}  → il écoute MAINTENANT (le HUD affiche "Parle")
  3) enregistre jusqu'au silence, transcrit en FR, émet {"text":"..."}
Une ligne JSON par message, flushée immédiatement. Plus aucun rechargement
de modèle par clic → la voix est captée instantanément.
"""
import sys, os, json, numpy as np, sounddevice as sd
from faster_whisper import WhisperModel

# Repli hors-ligne (le principal = reco native Chrome). "medium" = + précis en FR.
MODEL_NAME = os.environ.get("VLAD_WHISPER", "medium")

SR = 16000           # échantillonnage
SIL = 1.2            # secondes de silence qui terminent la prise
MAX_WAIT = 8.0       # si rien n'est dit, on abandonne après 8 s (pas de blocage)
MAX_LEN = 18.0       # durée max d'une prise
BLK = int(SR * 0.1)  # blocs de 100 ms

def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def rms(b):
    return float(np.sqrt(np.mean(b**2)))

def record():
    frames = []; sil = 0.0; waited = 0.0; started = False
    with sd.InputStream(samplerate=SR, channels=1, dtype="float32") as s:
        # 1) calibration du bruit ambiant (~0.4 s) → seuils ADAPTATIFS
        floor = 0.0
        for _ in range(4):
            d, _x = s.read(BLK); floor = max(floor, rms(d[:, 0]))
        on = max(floor * 3.0, floor + 0.006)   # parole = nettement au-dessus du bruit
        off = max(floor * 1.6, floor + 0.002)  # retour au calme = fin de prise
        # 2) prise de parole
        while True:
            d, _x = s.read(BLK); mono = d[:, 0]; lvl = rms(mono)
            if not started:
                waited += 0.1
                if lvl >= on:
                    started = True
                elif waited >= MAX_WAIT:
                    return np.zeros(1, dtype="float32")   # personne n'a parlé
            if started:
                frames.append(mono)
                sil = sil + 0.1 if lvl < off else 0.0
                if sil >= SIL:
                    break
                if len(frames) * 0.1 >= MAX_LEN:
                    break
    return np.concatenate(frames) if frames else np.zeros(1, dtype="float32")

def main():
    model = WhisperModel(MODEL_NAME, device="auto", compute_type="int8")
    emit({"event": "ready", "model": MODEL_NAME})
    for line in sys.stdin:
        line = line.strip()
        # {"file": "/tmp/…"} → transcrire un FICHIER audio (micro de l'iPhone via /transcribe)
        if line.startswith("{"):
            try:
                req = json.loads(line)
                seg, _ = model.transcribe(
                    req["file"], language="fr", beam_size=5, vad_filter=True,
                    initial_prompt="Transcription d'une consigne ou question dite en français.",
                )
                text = " ".join(s.text.strip() for s in seg).strip()
                emit({"text": text})
            except Exception as e:
                emit({"error": f"{type(e).__name__}: {e}"})
            continue
        if line != "LISTEN":
            continue
        emit({"event": "listening"})
        try:
            audio = record()
            # beam_size + initial_prompt FR → moins d'erreurs, ponctuation correcte
            seg, _ = model.transcribe(
                audio, language="fr", beam_size=5, vad_filter=True,
                initial_prompt="Transcription d'une consigne ou question dite en français.",
            )
            text = " ".join(s.text.strip() for s in seg).strip()
            emit({"text": text})
        except Exception as e:
            emit({"error": f"{type(e).__name__}: {e}"})

if __name__ == "__main__":
    main()
