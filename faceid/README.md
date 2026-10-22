# FaceID Lab — reconhecimento facial local

Flask + câmera do navegador + DeepFace/ArcFace. Os embeddings ficam em `banco_dados.json`.
Rosto cadastrado = quadrado **verde** com o nome. Rosto não cadastrado = quadrado **vermelho** ("Desconhecido").

## Estrutura (obrigatória)
```
faceid/
├── app.py
├── banco_dados.json
├── requirements.txt
├── templates/
│   └── index.html
└── static/
    ├── app.js
    └── style.css
```

## Instalação (Windows, VS Code, Python 3.11 64 bits)
```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```
Abra `http://127.0.0.1:5000` no Chrome/Edge, clique em **Iniciar câmera**, cadastre (nome + consentimento) e depois **Iniciar reconhecimento**.
A primeira análise demora porque o modelo baixa os pesos.

## Ajustes em `app.py`
- `THRESHOLD`: menor = mais rígido (menos falsos positivos), maior = mais permissivo.
- `DETECTOR`: `"opencv"` é leve mas impreciso; `"yunet"` ou `"retinaface"` detectam melhor.

## Avisos
- `banco_dados.json` guarda dados biométricos: não compartilhe.
- Sem prova de vida: foto/vídeo pode enganar. Não use para controle de acesso real.
- Use apenas com consentimento.
