const $ = id => document.getElementById(id);
const video = $("video"), canvas = $("overlay"), ctx = canvas.getContext("2d");
const placeholder = $("placeholder"), statusText = $("cameraStatus"), videoLabel = $("videoLabel");
const wrap = document.querySelector(".video-wrap");
const startBtn = $("startCamera"), stopBtn = $("stopCamera"), recBtn = $("toggleRecognition");
const regBtn = $("register"), nameInput = $("name"), consent = $("consent"), notice = $("notice");

let stream = null, recognizing = false, busy = false, errShown = false;

function msg(text, error = false) {
  notice.textContent = text;
  notice.className = "notice show" + (error ? " error" : "");
}

function updateReg() {
  regBtn.disabled = !(stream && nameInput.value.trim() && consent.checked);
}

function clearOverlay() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error("Navegador sem suporte à câmera. Use Chrome ou Edge atualizado em http://127.0.0.1:5000");
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false
    });
    video.srcObject = stream;
    video.style.display = "block";
    placeholder.style.display = "none";
    await video.play();
    // canvas e vídeo com a mesma proporção/resolução => caixas alinhadas com o rosto
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    wrap.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    startBtn.disabled = true; stopBtn.disabled = false; recBtn.disabled = false;
    statusText.textContent = "Câmera conectada";
    videoLabel.textContent = "CÂMERA CONECTADA";
    updateReg();
    msg("Câmera iniciada. Permissão concedida pelo navegador.");
  } catch (e) {
    stream = null;
    msg("Não foi possível iniciar a câmera: " + e.message + " Confira a permissão de câmera do navegador e feche outros apps que usem a webcam.", true);
  }
}

function stopCamera() {
  recognizing = false;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  video.style.display = "none";
  placeholder.style.display = "flex";
  clearOverlay();
  startBtn.disabled = false; stopBtn.disabled = true; recBtn.disabled = true;
  recBtn.textContent = "Iniciar reconhecimento";
  regBtn.disabled = true;
  statusText.textContent = "Câmera desligada";
  videoLabel.textContent = "AGUARDANDO CÂMERA";
}

// Captura o frame já espelhado (igual ao que o usuário vê). As caixas retornadas
// pelo servidor ficam nas mesmas coordenadas da tela, sem precisar espelhar o canvas.
function capture() {
  if (!video.videoWidth) throw Error("A câmera ainda está iniciando");
  const c = document.createElement("canvas");
  c.width = video.videoWidth; c.height = video.videoHeight;
  const g = c.getContext("2d");
  g.translate(c.width, 0); g.scale(-1, 1);
  g.drawImage(video, 0, 0);
  return c.toDataURL("image/jpeg", 0.88);
}

async function post(url, data) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  let j = {};
  try { j = await r.json(); } catch { /* resposta sem JSON */ }
  if (!r.ok) throw Error(j.erro || "Solicitação falhou");
  return j;
}

async function register() {
  if (!stream) return msg("Inicie a câmera antes do cadastro.", true);
  regBtn.disabled = true;
  regBtn.textContent = "Processando rosto...";
  try {
    const j = await post("/api/cadastrar", { nome: nameInput.value.trim(), consentiu: consent.checked, imagem: capture() });
    msg(j.mensagem);
    nameInput.value = ""; consent.checked = false;
    await loadPeople();
  } catch (e) {
    msg(e.message, true);
  } finally {
    regBtn.textContent = "Capturar rosto e cadastrar";
    updateReg();
  }
}

function draw(faces) {
  clearOverlay();
  const fs = Math.max(15, canvas.width / 48);
  for (const f of faces) {
    const color = f.reconhecido ? "#35d07f" : "#ff5f70";
    ctx.lineWidth = Math.max(3, canvas.width / 300);
    ctx.strokeStyle = color;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    const label = f.reconhecido ? f.nome : "Desconhecido";
    ctx.font = `bold ${fs}px "Segoe UI", Arial`;
    const tw = ctx.measureText(label).width + 18;
    const lh = fs + 12;
    const ly = f.y - lh >= 0 ? f.y - lh : f.y;   // se não couber acima, desenha dentro da caixa
    ctx.fillStyle = color;
    ctx.fillRect(f.x, ly, tw, lh);
    ctx.fillStyle = "#07101d";
    ctx.fillText(label, f.x + 9, ly + fs + 2);
  }
}

async function loop() {
  if (!recognizing || busy || !stream) return;
  busy = true;
  try {
    const j = await post("/api/reconhecer", { imagem: capture() });
    if (!recognizing) return;
    draw(j.rostos || []);
    videoLabel.textContent = j.rostos?.length ? `${j.rostos.length} ROSTO(S) DETECTADO(S)` : "NENHUM ROSTO DETECTADO";
  } catch (e) {
    videoLabel.textContent = "ANÁLISE INDISPONÍVEL";
    if (!errShown) { msg("Falha na análise: " + e.message, true); errShown = true; }
  } finally {
    busy = false;
    if (recognizing) setTimeout(loop, 300);
  }
}

function toggleRec() {
  recognizing = !recognizing;
  recBtn.textContent = recognizing ? "Parar reconhecimento" : "Iniciar reconhecimento";
  if (recognizing) {
    errShown = false;
    videoLabel.textContent = "ANALISANDO ROSTOS...";
    loop();
  } else {
    clearOverlay();
    videoLabel.textContent = "CÂMERA CONECTADA";
  }
}

async function loadPeople() {
  const r = await fetch("/api/pessoas");
  if (!r.ok) throw Error("Servidor retornou erro " + r.status);
  const people = await r.json(), list = $("peopleList");
  $("count").textContent = people.length;
  list.replaceChildren();
  if (!people.length) {
    const e = document.createElement("div");
    e.className = "empty"; e.textContent = "Nenhuma pessoa cadastrada.";
    list.append(e);
    return;
  }
  for (const p of people) {
    const row = document.createElement("div"); row.className = "person";
    const a = document.createElement("div"); a.className = "avatar"; a.textContent = p.nome.slice(0, 1).toUpperCase();
    const info = document.createElement("div"), n = document.createElement("div"), d = document.createElement("div");
    n.className = "person-name"; n.textContent = p.nome;
    d.className = "person-date"; d.textContent = p.criado_em ? new Date(p.criado_em).toLocaleString("pt-BR") : "Cadastro local";
    info.append(n, d);
    const del = document.createElement("button"); del.className = "delete"; del.textContent = "Excluir";
    del.onclick = async () => {
      if (!confirm(`Excluir o cadastro de ${p.nome}?`)) return;
      const r = await fetch("/api/pessoas/" + encodeURIComponent(p.id), { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) return msg(j.erro, true);
      msg(j.mensagem);
      loadPeople();
    };
    row.append(a, info, del);
    list.append(row);
  }
}

startBtn.onclick = startCamera;
stopBtn.onclick = stopCamera;
recBtn.onclick = toggleRec;
regBtn.onclick = register;
nameInput.oninput = updateReg;
consent.onchange = updateReg;
loadPeople().catch(e => msg("Não foi possível carregar os cadastros: " + e.message, true));
window.onbeforeunload = () => stream?.getTracks().forEach(t => t.stop());
