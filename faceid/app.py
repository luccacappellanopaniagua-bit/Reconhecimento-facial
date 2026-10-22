from flask import Flask, render_template, request, jsonify
from pathlib import Path
from datetime import datetime
import json, uuid, base64, threading
import numpy as np
import cv2
from deepface import DeepFace

BASE = Path(__file__).resolve().parent
DB = BASE / "banco_dados.json"
MODEL = "ArcFace"
DETECTOR = "opencv"      # alternativas mais precisas: "yunet", "retinaface"
THRESHOLD = 0.68         # distância de cosseno máxima para considerar "reconhecido"
MIN_FACE = 60            # ignora detecções menores que isso (px), costumam ser falsos positivos
LOCK = threading.Lock()  # evita corrupção do JSON com requisições simultâneas
app = Flask(__name__)


def load_db():
    with LOCK:
        if not DB.exists():
            _save_db({"pessoas": []})
        with DB.open("r", encoding="utf-8") as f:
            data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("pessoas"), list):
        raise ValueError("Formato inválido no banco_dados.json")
    return data


def _save_db(data):
    temp = DB.with_suffix(".json.tmp")
    with temp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    temp.replace(DB)


def save_db(data):
    with LOCK:
        _save_db(data)


def decode_image(data_url):
    if not isinstance(data_url, str) or "," not in data_url or not data_url.startswith("data:image/"):
        raise ValueError("Imagem inválida.")
    raw = base64.b64decode(data_url.split(",", 1)[1])
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Não foi possível ler a imagem.")
    return image


def detect_faces(image):
    """Retorna a lista de rostos com embedding. Lista vazia se não houver rosto."""
    try:
        result = DeepFace.represent(img_path=image, model_name=MODEL, detector_backend=DETECTOR,
                                    enforce_detection=True, align=True)
    except ValueError as e:
        if "face" in str(e).lower() and "detect" in str(e).lower():
            return []
        raise
    faces = []
    for det in result:
        area = det.get("facial_area", {}) or {}
        if int(area.get("w", 0)) < MIN_FACE or int(area.get("h", 0)) < MIN_FACE:
            continue
        faces.append(det)
    return faces


def normalize(vec):
    vec = np.asarray(vec, dtype=np.float32)
    norm = np.linalg.norm(vec)
    if not norm:
        raise ValueError("Embedding inválido.")
    return vec / norm


def distance(a, b):
    if len(a) != len(b):
        return float("inf")
    a, b = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(1 - np.dot(a, b) / denom) if denom else float("inf")


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/pessoas")
def people():
    return jsonify([{"id": p["id"], "nome": p["nome"], "criado_em": p.get("criado_em", "")}
                    for p in load_db()["pessoas"]])


@app.post("/api/cadastrar")
def register():
    body = request.get_json(silent=True) or {}
    name = str(body.get("nome", "")).strip()
    if not name:
        return jsonify(erro="Digite o nome."), 400
    if body.get("consentiu") is not True:
        return jsonify(erro="É necessário confirmar o consentimento."), 400
    try:
        faces = detect_faces(decode_image(body.get("imagem", "")))
        if not faces:
            return jsonify(erro="Nenhum rosto detectado. Aproxime-se da câmera e melhore a iluminação."), 400
        if len(faces) > 1:
            return jsonify(erro="Deixe apenas um rosto visível."), 400
        vec = normalize(faces[0]["embedding"]).tolist()
        data = load_db()
        if any(p["nome"].casefold() == name.casefold() for p in data["pessoas"]):
            return jsonify(erro="Já existe cadastro com esse nome. Exclua o anterior primeiro."), 409
        data["pessoas"].append({"id": str(uuid.uuid4()), "nome": name, "modelo": MODEL,
                                "embedding": vec, "criado_em": datetime.now().isoformat(timespec="seconds")})
        save_db(data)
        return jsonify(mensagem=f"Cadastro de {name} concluído.")
    except Exception as e:
        return jsonify(erro=str(e)), 400


@app.post("/api/reconhecer")
def recognize():
    try:
        image = decode_image((request.get_json(silent=True) or {}).get("imagem", ""))
        detections = detect_faces(image)
        people = load_db()["pessoas"]
        faces = []
        for det in detections:
            area, vec = det.get("facial_area", {}) or {}, det.get("embedding", [])
            best, best_dist = None, float("inf")
            for person in people:
                if person.get("modelo", MODEL) != MODEL:
                    continue
                d = distance(vec, person.get("embedding", []))
                if d < best_dist:
                    best, best_dist = person, d
            known = best is not None and best_dist <= THRESHOLD
            faces.append({"x": int(area.get("x", 0)), "y": int(area.get("y", 0)),
                          "w": int(area.get("w", 0)), "h": int(area.get("h", 0)),
                          "nome": best["nome"] if known else "Desconhecido",
                          "reconhecido": bool(known),
                          "distancia": round(best_dist, 3) if best else None})
        return jsonify(rostos=faces)
    except Exception as e:
        return jsonify(erro=str(e)), 400


@app.delete("/api/pessoas/<person_id>")
def delete_person(person_id):
    data = load_db()
    old = len(data["pessoas"])
    data["pessoas"] = [p for p in data["pessoas"] if p.get("id") != person_id]
    if len(data["pessoas"]) == old:
        return jsonify(erro="Cadastro não encontrado."), 404
    save_db(data)
    return jsonify(mensagem="Cadastro excluído.")


if __name__ == "__main__":
    load_db()
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
