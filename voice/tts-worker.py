#!/usr/bin/env python3
"""
VLAD OS — Worker TTS persistant (Kokoro, FR)
----------------------------------------------
Charge le moteur Kokoro UNE fois, puis synthétise à la demande.
Le pont Node envoie une ligne JSON {"voice":"ff_siwis","text":"..."} sur stdin ;
le worker écrit un wav dans /tmp et répond {"wav":"/tmp/vlad_tts_N.wav"}.
Plus de rechargement de modèle par phrase → voix quasi instantanée.
"""
import sys, os, json, warnings, numpy as np, soundfile as sf
warnings.filterwarnings("ignore")
from kokoro import KPipeline

SR = 24000
OUT = "/tmp"

def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def main():
    pipe = KPipeline(lang_code="f")   # français
    # pré-chauffe (télécharge la voix FR si besoin) → 1er /speak rapide
    try:
        for _ in pipe("Bonjour.", voice="ff_siwis"):
            break
    except Exception:
        pass
    emit({"event": "ready"})
    n = 0
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            voice = req.get("voice", "ff_siwis")
            text = (req.get("text") or "").strip() or "Oui ?"
            chunks = [seg for _, _, seg in pipe(text, voice=voice)]
            audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype="float32")
            n += 1
            path = os.path.join(OUT, f"vlad_tts_{n % 6}.wav")
            sf.write(path, audio, SR)
            emit({"wav": path})
        except Exception as e:
            emit({"error": f"{type(e).__name__}: {e}"})

if __name__ == "__main__":
    main()
