// Gist secreto do Editor de Fotos. A API do GitHub aceita chamadas direto do navegador (CORS),
// então funciona no GitHub Pages. O celular manda as fotos para o server.py do PC desfocar.
//
// Arquivos no Gist:
//   pedido-<id>.json     foto enviada pelo celular { nome, forca, foto: base64 JPG }
//   resultado-<id>.json  foto desfocada pelo PC { nome, foto } ou { erro }
//   status.json          { pc: horário em ms, rodando, fila } — o PC regrava a cada minuto
const Sync = (() => {
  const CFG_KEY = 'editorfotos:sync';
  const API = 'https://api.github.com/gists';

  function config() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
  }
  function setConfig(cfg) {
    if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CFG_KEY);
  }
  function enabled() {
    const c = config();
    return Boolean(c.token && c.gistId);
  }

  async function request(url, { method = 'GET', body } = {}) {
    const { token } = config();
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const msg = res.status === 401 ? 'token inválido' : res.status === 404 ? 'Gist não encontrado'
        : res.status === 403 ? 'acesso negado pelo GitHub (403)' : `erro ${res.status}`;
      throw new Error(msg);
    }
    return res.json();
  }

  async function gist() {
    return request(`${API}/${config().gistId}`);
  }

  // Conteúdo de um arquivo do Gist (os grandes vêm cortados na API: baixa pelo raw_url)
  async function texto(arquivo) {
    if (!arquivo) return null;
    if (!arquivo.truncated) return arquivo.content;
    const res = await fetch(arquivo.raw_url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`erro ${res.status} ao baixar do Gist`);
    return res.text();
  }

  // { 'arquivo.json': objeto | null } — null apaga o arquivo
  async function gravar(arquivos) {
    const files = {};
    for (const [nome, valor] of Object.entries(arquivos)) {
      files[nome] = valor === null ? null : { content: JSON.stringify(valor) };
    }
    await request(`${API}/${config().gistId}`, { method: 'PATCH', body: { files } });
  }

  return { config, setConfig, enabled, gist, texto, gravar };
})();
