// Editor de Fotos (celular): monta a arte no navegador e manda o blur para o PC pelo Gist.
const $ = (s) => document.querySelector(s);
const K = { cor: 'editorfotos:cor', forca: 'editorfotos:forca' };
const CORES_PRONTAS = [Arte.COR_PADRAO, '#ffffff', '#ffd400', '#ff3b3b', '#22c55e', '#ff4fd8', '#00d4ff'];
const MAX_ENVIO = 2048; // lado maior da foto enviada ao PC (a arte usa 960x1280)
const PC_ONLINE_MS = 25 * 60 * 1000; // o PC regrava o status a cada 10 min (freio de gravação do GitHub)

let itens = [];
let atual = null;
let pcStatus = null;
let caixaTexto = null; // onde a legenda ficou na última prévia (para arrastar)
const imagens = new Map(); // `${id}:o` / `${id}:d` -> Promise<HTMLImageElement>
const miniaturas = new Map(); // id -> object URL

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------------------------------------------------------------- banco (IndexedDB): fotos e ajustes ficam no aparelho
const Banco = (() => {
  let db;
  function abrir() {
    return db ??= new Promise((ok, falha) => {
      const r = indexedDB.open('editorfotos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('itens', { keyPath: 'id' });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => falha(r.error);
    });
  }
  async function tx(modo, fn) {
    const d = await abrir();
    return new Promise((ok, falha) => {
      const t = d.transaction('itens', modo);
      const r = fn(t.objectStore('itens'));
      t.oncomplete = () => ok(r.result);
      t.onerror = () => falha(t.error);
    });
  }
  return {
    todos: () => tx('readonly', (s) => s.getAll()),
    salvar: (item) => tx('readwrite', (s) => s.put(item)),
    apagar: (id) => tx('readwrite', (s) => s.delete(id)),
  };
})();

const salvarDepois = (() => {
  const pendentes = new Set();
  let timer;
  return (item) => {
    pendentes.add(item);
    clearTimeout(timer);
    timer = setTimeout(() => {
      pendentes.forEach((i) => { if (itens.includes(i)) Banco.salvar(i).catch(() => {}); });
      pendentes.clear();
    }, 400);
  };
})();

function novoItem(arquivo) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nome: arquivo.name || 'foto.jpg',
    original: arquivo,
    desfocada: null,
    blur: '', // '', 'enviando', 'fila', 'rodando', 'ok', 'erro'
    erro: '',
    pedido: null,
    usarDesfocada: true,
    aVista: '',
    texto: null, // legenda editada à mão; null = automática pelo preço
    zoom: 1,
    dx: 0.5,
    dy: 0.5,
    textoY: Arte.Y_PADRAO,
    feita: false,
  };
}

function imagem(item, desfocada) {
  const blob = desfocada ? item.desfocada : item.original;
  const chave = `${item.id}:${desfocada ? 'd' : 'o'}`;
  if (!imagens.has(chave)) {
    imagens.set(chave, Arte.carregarImagem(URL.createObjectURL(blob)));
  }
  return imagens.get(chave);
}

function esquecerImagens(item) {
  for (const k of ['o', 'd']) {
    const chave = `${item.id}:${k}`;
    imagens.get(chave)?.then((img) => URL.revokeObjectURL(img.src)).catch(() => {});
    imagens.delete(chave);
  }
  if (miniaturas.has(item.id)) { URL.revokeObjectURL(miniaturas.get(item.id)); miniaturas.delete(item.id); }
}

const usandoDesfocada = (item) => Boolean(item.desfocada && item.usarDesfocada);
const nomeBase = (item) => item.nome.replace(/\.[^.]+$/, '') || 'foto';

// ---------------------------------------------------------------- lista de fotos
function desenharLista() {
  const lista = $('#lista');
  lista.innerHTML = '';
  for (const item of itens) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `miniatura${item === atual ? ' ativa' : ''}`;
    const blob = item.desfocada || item.original;
    if (!miniaturas.has(item.id)) miniaturas.set(item.id, URL.createObjectURL(blob));
    const selo = { '': '', enviando: '📤', fila: '⏳', rodando: '🔄', ok: '🌫', erro: '⚠' }[item.blur];
    b.innerHTML = `<img alt="" src="${miniaturas.get(item.id)}">${selo ? `<span class="selo">${selo}</span>` : ''}`
      + (item.feita ? '<span class="feita">✅</span>' : '');
    b.onclick = () => selecionar(item);
    lista.appendChild(b);
  }
  $('#editor').hidden = !atual;
  $('#vazio').hidden = Boolean(itens.length);
  const pendentes = itens.filter((i) => i.blur === '' || i.blur === 'erro').length;
  $('#desfocar').textContent = `🌫 Desfocar no PC${pendentes ? ` (${pendentes})` : ''}`;
  $('#desfocar').disabled = !pendentes;
}

async function adicionar(arquivos) {
  for (const arq of arquivos) {
    const item = novoItem(arq);
    try {
      await imagem(item, false);
    } catch {
      toast(`Não consegui abrir ${arq.name} (formato não suportado)`);
      esquecerImagens(item);
      continue;
    }
    itens.push(item);
    await Banco.salvar(item).catch(() => toast('Sem espaço para guardar a foto no aparelho'));
    if (!atual) selecionar(item);
  }
  desenharLista();
}

async function remover() {
  if (!atual || !confirm('Remover esta foto da lista?')) return;
  const item = atual;
  const i = itens.indexOf(item);
  itens.splice(i, 1);
  esquecerImagens(item);
  await Banco.apagar(item.id).catch(() => {});
  if (item.pedido && Sync.enabled()) Sync.gravar({ [`pedido-${item.pedido}.json`]: null }).catch(() => {});
  atual = null;
  if (itens.length) selecionar(itens[Math.min(i, itens.length - 1)]);
  else desenharLista();
}

// ---------------------------------------------------------------- editor
function linhasAutomaticas(item) {
  try { return Arte.linhasPreco(item.aVista); } catch { return [...Arte.LINHAS_FIXAS]; }
}
function linhasLegenda(item) {
  return item.texto !== null ? item.texto.split('\n') : linhasAutomaticas(item);
}

function selecionar(item) {
  atual = item;
  $('#preco').value = item.aVista;
  $('#zoom').value = Math.round(item.zoom * 100);
  mostrarTexto();
  mostrarParcela();
  atualizarControles();
  desenharLista();
  desenhar();
}

function atualizarControles() {
  const item = atual;
  if (!item) return;
  const chk = $('#usarDesfocada');
  chk.checked = usandoDesfocada(item);
  chk.disabled = !item.desfocada;
  $('#salvarDesfocada').disabled = !item.desfocada;
  let status = '';
  if (item.blur === 'erro') status = `⚠ Blur falhou: ${item.erro}`;
  else if (item.blur === 'enviando') status = '📤 Enviando a foto para o PC…';
  else if (item.blur === 'fila') status = '⏳ Na fila do PC. A prévia troca sozinha quando ficar pronta.';
  else if (item.blur === 'rodando') status = '🔄 O PC está desfocando esta foto…';
  else if (!item.desfocada && item.blur === '') status = 'Foto original (ainda sem blur).';
  $('#statusBlur').textContent = status;
}

function mostrarParcela() {
  try {
    const c = Arte.lerCentavos(atual.aVista);
    $('#parcela').textContent = `${Arte.PARCELAS}x de ${Arte.formatarReais(Arte.calcularParcela(c))} no cartão`;
  } catch {
    $('#parcela').textContent = '';
  }
}

function mostrarTexto() {
  const texto = linhasLegenda(atual).join('\n');
  if ($('#texto').value !== texto) $('#texto').value = texto;
  $('#textoAviso').textContent = atual.texto !== null
    ? '✏ Editado à mão (o preço não muda mais o texto)' : 'Automático pelo preço. Edite à vontade.';
}

function cor() {
  return localStorage.getItem(K.cor) || Arte.COR_PADRAO;
}

function desenharCores() {
  const caixa = $('#cores');
  caixa.querySelectorAll('.cor').forEach((b) => b.remove());
  const livre = caixa.querySelector('.cor-livre');
  for (const c of CORES_PRONTAS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cor${c === cor() ? ' ativa' : ''}`;
    b.style.background = c;
    b.title = c === Arte.COR_PADRAO ? 'Azul padrão' : c;
    b.onclick = () => definirCor(c);
    caixa.insertBefore(b, livre);
  }
  $('#corLivre').value = cor();
  livre.style.outline = CORES_PRONTAS.includes(cor()) ? '' : '3px solid #fff';
}

function definirCor(c) {
  localStorage.setItem(K.cor, c.toLowerCase());
  desenharCores();
  desenhar();
}

// ---------------------------------------------------------------- prévia
let quadroPedido = false;
function desenhar() {
  if (quadroPedido) return;
  quadroPedido = true;
  requestAnimationFrame(async () => {
    quadroPedido = false;
    const item = atual;
    if (!item) return;
    let foto = null;
    try { foto = await imagem(item, usandoDesfocada(item)); } catch { /* sem foto: caixa cinza */ }
    if (item !== atual) return;
    caixaTexto = Arte.montar($('#previa'), {
      foto, linhas: linhasLegenda(item), zoom: item.zoom, dx: item.dx, dy: item.dy, textoY: item.textoY, cor: cor(),
    });
  });
}

function definirTexto(valor) {
  atual.textoY = Math.max(Arte.Y_MIN, Math.min(Arte.Y_MAX, Math.round(valor)));
  salvarDepois(atual);
  desenhar();
}

// Arrastar a foto (enquadrar), arrastar o texto (subir/descer) e pinça de dois dedos (zoom)
function ligarGestos() {
  const tela = $('#previa');
  const dedos = new Map();
  let modo = null, pinca = null;

  const paraArte = (e) => {
    const r = tela.getBoundingClientRect();
    return { x: (e.clientX - r.left) * Arte.W / r.width, y: (e.clientY - r.top) * Arte.H / r.height };
  };

  tela.addEventListener('pointerdown', (e) => {
    if (!atual) return;
    tela.setPointerCapture(e.pointerId);
    dedos.set(e.pointerId, paraArte(e));
    if (dedos.size === 2) {
      const [a, b] = [...dedos.values()];
      pinca = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: atual.zoom };
      modo = 'pinca';
    } else if (dedos.size === 1) {
      const p = paraArte(e);
      modo = caixaTexto && p.y >= caixaTexto[1] - 30 && p.y <= caixaTexto[3] + 30 ? 'texto' : 'foto';
    }
  });

  tela.addEventListener('pointermove', async (e) => {
    if (!dedos.has(e.pointerId) || !atual) return;
    const antes = dedos.get(e.pointerId);
    const agora = paraArte(e);
    dedos.set(e.pointerId, agora);
    const item = atual;
    if (modo === 'pinca' && dedos.size === 2) {
      const [a, b] = [...dedos.values()];
      const zoom = pinca.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinca.dist;
      item.zoom = Math.max(1, Math.min(3, zoom));
      $('#zoom').value = Math.round(item.zoom * 100);
    } else if (modo === 'texto') {
      item.textoY = Math.max(Arte.Y_MIN, Math.min(Arte.Y_MAX, item.textoY + (agora.y - antes.y)));
    } else if (modo === 'foto') {
      let foto;
      try { foto = await imagem(item, usandoDesfocada(item)); } catch { return; }
      const [, , larg, alt] = Arte.FOTO;
      const escala = Math.max(larg / foto.naturalWidth, alt / foto.naturalHeight) * item.zoom;
      const sobraX = foto.naturalWidth * escala - larg, sobraY = foto.naturalHeight * escala - alt;
      if (sobraX > 0) item.dx = Math.min(1, Math.max(0, item.dx - (agora.x - antes.x) / sobraX));
      if (sobraY > 0) item.dy = Math.min(1, Math.max(0, item.dy - (agora.y - antes.y) / sobraY));
    } else return;
    salvarDepois(item);
    desenhar();
  });

  const soltar = (e) => {
    dedos.delete(e.pointerId);
    if (dedos.size === 0) { modo = null; pinca = null; if (atual) atual.textoY = Math.round(atual.textoY); }
    else if (dedos.size === 1 && modo === 'pinca') modo = null; // sobrou um dedo: espera soltar
  };
  tela.addEventListener('pointerup', soltar);
  tela.addEventListener('pointercancel', soltar);
}

// ---------------------------------------------------------------- salvar no celular
async function entregar(blob, nome) {
  const arquivo = new File([blob], nome, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo] });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return true;
}

const paraBlob = (canvas) => new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.95));

async function salvarArte() {
  const item = atual;
  if (!item) return;
  if (item.texto === null) {
    try { Arte.lerCentavos(item.aVista); } catch {
      $('#preco').focus();
      return toast('Preencha o preço à vista (ex.: 3700) ou escreva o texto da legenda');
    }
  }
  if (['enviando', 'fila', 'rodando'].includes(item.blur)
    && !confirm('O blur desta foto ainda não terminou. Salvar a arte com a foto original?')) return;
  const canvas = document.createElement('canvas');
  Arte.montar(canvas, {
    foto: await imagem(item, usandoDesfocada(item)), linhas: linhasLegenda(item),
    zoom: item.zoom, dx: item.dx, dy: item.dy, textoY: item.textoY, cor: cor(),
  });
  if (!(await entregar(await paraBlob(canvas), 'fundo 9x16.jpg'))) return;
  item.feita = true;
  salvarDepois(item);
  const proxima = itens.find((i) => !i.feita);
  toast(proxima ? '✅ Arte salva! Indo para a próxima foto.' : '✅ Arte salva! Todas as fotos têm arte.');
  if (proxima) selecionar(proxima); else desenharLista();
}

async function salvarDesfocada() {
  const item = atual;
  if (!item?.desfocada) return;
  const canvas = Arte.carimbarLogo(await imagem(item, true));
  await entregar(await paraBlob(canvas), `${nomeBase(item)} desfocada.jpg`);
}

// ---------------------------------------------------------------- blur no PC (pelo Gist)
async function fotoParaEnvio(item) {
  const img = await imagem(item, false);
  const s = Math.min(1, MAX_ENVIO / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}

function base64ParaBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

function forca() {
  const n = parseInt($('#forca').value, 10);
  return Number.isFinite(n) && n >= 0 && n <= 60 ? n : null;
}

async function desfocarTodas() {
  if (!Sync.enabled()) {
    $('#ajustes').open = true;
    $('#ajustes').scrollIntoView({ behavior: 'smooth' });
    return toast('Conecte ao PC primeiro: leia o QR code do PC');
  }
  const f = forca();
  if (f === null) return toast('A força do blur precisa ser um número de 0 a 60');
  localStorage.setItem(K.forca, String(f));
  const pendentes = itens.filter((i) => i.blur === '' || i.blur === 'erro');
  if (pcStatus && Date.now() - pcStatus.pc > PC_ONLINE_MS) toast('O PC parece desligado: as fotos ficam na fila até ele ligar', 5000);
  for (const item of pendentes) {
    item.blur = 'enviando';
    item.erro = '';
    desenharLista();
    if (item === atual) atualizarControles();
    try {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await Sync.gravar({ [`pedido-${id}.json`]: { nome: item.nome, forca: f, foto: await fotoParaEnvio(item) } });
      item.pedido = id;
      item.blur = 'fila';
    } catch (e) {
      item.blur = 'erro';
      item.erro = `não enviou: ${e.message}`;
    }
    salvarDepois(item);
    desenharLista();
    if (item === atual) atualizarControles();
  }
  verificarLogo(1500);
}

let timerVerificar;
function verificarLogo(ms) {
  clearTimeout(timerVerificar);
  timerVerificar = setTimeout(verificar, ms);
}

async function verificar() {
  clearTimeout(timerVerificar);
  if (!Sync.enabled()) return mostrarPc();
  const esperando = () => itens.filter((i) => i.pedido && ['fila', 'rodando'].includes(i.blur));
  try {
    const gist = await Sync.gist();
    const arquivos = gist.files || {};
    try { pcStatus = JSON.parse(await Sync.texto(arquivos['status.json']) || 'null'); } catch { pcStatus = null; }
    const apagar = {};
    for (const item of esperando()) {
      const res = arquivos[`resultado-${item.pedido}.json`];
      if (res) {
        apagar[`resultado-${item.pedido}.json`] = null;
        const dados = JSON.parse(await Sync.texto(res));
        if (dados.foto) {
          esquecerImagens(item);
          item.desfocada = base64ParaBlob(dados.foto);
          item.blur = 'ok';
          item.usarDesfocada = true;
        } else {
          item.blur = 'erro';
          item.erro = dados.erro || 'o PC não conseguiu desfocar';
        }
        item.pedido = null;
        Banco.salvar(item).catch(() => {});
        if (item === atual) desenhar();
      } else if (pcStatus?.rodando === item.pedido) {
        item.blur = 'rodando';
      }
    }
    // resultados esquecidos (foto removida antes de ficar pronta) saem depois de um dia
    for (const nome of Object.keys(arquivos)) {
      const m = nome.match(/^resultado-(\d+)-/);
      if (m && !(nome in apagar) && Date.now() - Number(m[1]) > 86400000) apagar[nome] = null;
    }
    if (Object.keys(apagar).length) await Sync.gravar(apagar);
  } catch (e) {
    $('#statusBlur').textContent = `⚠ Gist: ${e.message}`;
  }
  mostrarPc();
  desenharLista();
  if (atual) atualizarControles();
  verificarLogo(esperando().length ? 4000 : 60000);
}

function mostrarPc() {
  const on = Boolean(pcStatus && Date.now() - pcStatus.pc < PC_ONLINE_MS);
  const b = $('#pc');
  b.className = `pc ${on ? 'on' : 'off'}`;
  const fila = pcStatus?.fila?.length || 0;
  b.querySelector('b').textContent = !Sync.enabled() ? 'Conectar PC' : on ? (pcStatus.rodando ? `PC desfocando${fila > 1 ? ` (${fila})` : ''}` : 'PC online') : 'PC offline';
  $('#conexao').innerHTML = Sync.enabled()
    ? `✅ Conectado ao Gist ${Sync.config().gistId.slice(0, 8)}… ${on ? '· PC ligado' : '· PC sem sinal (ligue o PC para desfocar)'}`
    : 'No PC, abra <b>http://localhost:8803</b> e leia o QR code com o botão abaixo.';
}

// ---------------------------------------------------------------- celular: QR / link de configuração
// O QR abre o app publicado com #config=…; o fragmento (#) não vai a nenhum servidor e é apagado ao ler.
function deBase64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

function aplicarLinkConfig(texto) {
  const match = String(texto || '').match(/#config=([\w%-]+)/);
  if (!match) return false;
  try {
    const { token, gistId } = JSON.parse(deBase64url(decodeURIComponent(match[1])));
    if (!token || !gistId) throw new Error();
    Sync.setConfig({ token, gistId });
    toast('✅ Conectado ao PC');
    verificar();
    return true;
  } catch {
    toast('Link de configuração inválido');
    return false;
  }
}

function carregarScript(src) {
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = falha;
    document.head.appendChild(s);
  });
}

let leitorStream = null;
let jsQrScript;
function pararLeitorQr() {
  leitorStream?.getTracks().forEach((t) => t.stop());
  leitorStream = null;
  $('#leitorQr').hidden = true;
}

async function lerQr() {
  const video = $('#videoQr');
  try {
    leitorStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    return toast('Sem acesso à câmera: permita nas configurações ou cole o link abaixo');
  }
  video.srcObject = leitorStream;
  $('#leitorQr').hidden = false;
  await video.play().catch(() => {});
  let ler;
  if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats?.())?.includes('qr_code')) {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    ler = async () => (await detector.detect(video))[0]?.rawValue;
  } else {
    try {
      jsQrScript ??= carregarScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js').catch((e) => { jsQrScript = null; throw e; });
      await jsQrScript;
    } catch {
      pararLeitorQr();
      return toast('Não foi possível carregar o leitor de QR: cole o link abaixo');
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ler = async () => {
      if (!video.videoWidth) return null;
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      return jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
    };
  }
  while (leitorStream) {
    const texto = await ler().catch(() => null);
    if (texto?.includes('#config=')) {
      pararLeitorQr();
      if (aplicarLinkConfig(texto)) $('#ajustes').open = false;
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ---------------------------------------------------------------- início
function ligarControles() {
  $('#arquivos').onchange = (e) => { adicionar([...e.target.files]); e.target.value = ''; };
  $('#desfocar').onclick = desfocarTodas;
  $('#pc').onclick = () => { $('#ajustes').open = true; $('#ajustes').scrollIntoView({ behavior: 'smooth' }); verificar(); };
  $('#forca').value = localStorage.getItem(K.forca) || '2';

  $('#usarDesfocada').onchange = (e) => { atual.usarDesfocada = e.target.checked; salvarDepois(atual); atualizarControles(); desenhar(); };
  $('#preco').oninput = (e) => {
    atual.aVista = e.target.value;
    if (atual.texto === null) mostrarTexto();
    mostrarParcela();
    salvarDepois(atual);
    desenhar();
  };
  $('#texto').oninput = (e) => {
    const v = e.target.value;
    atual.texto = v === linhasAutomaticas(atual).join('\n') ? null : v;
    mostrarTexto();
    salvarDepois(atual);
    desenhar();
  };
  $('#textoAuto').onclick = () => { atual.texto = null; mostrarTexto(); salvarDepois(atual); desenhar(); };
  $('#zoom').oninput = (e) => { atual.zoom = e.target.value / 100; salvarDepois(atual); desenhar(); };
  $('#centralizar').onclick = () => {
    Object.assign(atual, { zoom: 1, dx: 0.5, dy: 0.5 });
    $('#zoom').value = 100;
    salvarDepois(atual);
    desenhar();
  };
  $('#subir').onclick = () => definirTexto(atual.textoY - 10);
  $('#descer').onclick = () => definirTexto(atual.textoY + 10);
  $('#textoPadrao').onclick = () => definirTexto(Arte.Y_PADRAO);
  $('#corLivre').oninput = (e) => definirCor(e.target.value);
  $('#salvarArte').onclick = salvarArte;
  $('#salvarDesfocada').onclick = salvarDesfocada;
  $('#remover').onclick = remover;

  $('#lerQr').onclick = lerQr;
  $('#fecharQr').onclick = pararLeitorQr;
  $('#linkConfig').onchange = (e) => { if (aplicarLinkConfig(e.target.value)) { e.target.value = ''; $('#ajustes').open = false; } };
  $('#versao').textContent = EF_VERSAO;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verificar(); });
  ligarGestos();
}

async function iniciar() {
  ligarControles();
  desenharCores();
  if (location.hash.startsWith('#config=')) {
    aplicarLinkConfig(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
  }
  try {
    await Arte.carregar();
  } catch (e) {
    toast(`Erro ao carregar o molde: ${e.message}`);
  }
  try {
    itens = (await Banco.todos()).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  } catch {
    itens = [];
  }
  if (itens.length) selecionar(itens.find((i) => !i.feita) || itens[0]);
  desenharLista();
  mostrarPc();
  verificar();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
