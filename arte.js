// Monta a arte 9x16 (1080x1920) no navegador, com as mesmas medidas do gerador.py do PC.
const Arte = (() => {
  const W = 1080, H = 1920;
  const FOTO = [60, 320, 960, 1280]; // x, y, largura, altura
  const CHAMADA_POS = [606, 1444];
  const LOGO_POS = [60, 1376];

  const CENTRO_X = 539.6;
  const BASE_Y = 286.45; // linha de base da 1ª linha
  const ENTRELINHA = 43.2;
  const TAMANHO = 36;
  const CONTORNO = 2;
  const MARGEM = 24; // distância mínima entre a legenda e a borda da foto interna
  const COR_PADRAO = '#4a70f1';
  const FONTE = 'MontserratBI';

  // A legenda fica sempre dentro da foto interna, respeitando a margem
  const TOPO = FOTO[1] + MARGEM, BASE = FOTO[1] + FOTO[3] - MARGEM;
  const ESQ = FOTO[0] + MARGEM, DIR = FOTO[0] + FOTO[2] - MARGEM;
  const Y_MIN = TOPO - 256, Y_MAX = BASE - 256 - 167, Y_PADRAO = Y_MIN;

  const PARCELAS = 12;
  const LINHAS_FIXAS = ['3 Meses de Garantia.', 'Aceito seu usado como parte do pagamento!'];

  // Sombra projetada do Photoshop (luz de 120°): deslocamentos já arredondados como no Python
  const SOMBRA = { 1: [0, 1], 5: [2, 4], 7: [4, 6] };

  let rec = null;

  function carregarImagem(src) {
    return new Promise((ok, falha) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => falha(new Error(`não carregou ${src}`));
      img.src = src;
    });
  }

  async function carregar() {
    if (rec) return rec;
    const fonte = new FontFace(FONTE, 'url(recursos/Montserrat-BlackItalic.otf)', { style: 'italic', weight: '900' });
    const [fundo, logo, chamada] = await Promise.all([
      carregarImagem('recursos/fundo.jpg'), carregarImagem('recursos/logo.png'),
      carregarImagem('recursos/chamada.png'), fonte.load().then((f) => document.fonts.add(f)),
    ]);
    rec = { fundo, logo, chamada };
    return rec;
  }

  // ------------------------------------------------------------ preço
  // '3700', '3.700', '3.700,00', 'R$ 343,5' -> centavos (inteiro)
  function lerCentavos(valor) {
    let t = String(valor ?? '').trim().replace('R$', '').replace(/\s/g, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) throw new Error('valor inválido');
    const [int, frac = ''] = t.split('.');
    const centavos = Number(int) * 100 + Math.round(Number(`0.${frac || 0}`) * 100);
    if (!(centavos > 0)) throw new Error('valor inválido');
    return centavos;
  }

  // 370000 -> 'R$3.700' ; 34350 -> 'R$343,50'
  function formatarReais(centavos) {
    const inteiro = Math.floor(centavos / 100), resto = centavos % 100;
    const milhar = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `R$${milhar}` + (resto ? `,${String(resto).padStart(2, '0')}` : '');
  }

  // Total = à vista ÷ (1 − 0,124); parcela = total ÷ 12, arredondada para cima no centavo.
  // Em centavos inteiros: ceil(c × 1000 ÷ (876 × 12)), sem erro de ponto flutuante.
  function calcularParcela(centavos) {
    return Math.floor((centavos * 1000 + 10511) / 10512);
  }

  function linhasPreco(aVista) {
    const c = lerCentavos(aVista);
    return [
      `${formatarReais(c)} à vista`,
      `ou ${PARCELAS}x de ${formatarReais(calcularParcela(c))} no cartão.`,
      ...LINHAS_FIXAS,
    ];
  }

  // ------------------------------------------------------------ legenda
  function fonte(escala) {
    return `italic 900 ${Math.round(TAMANHO * escala)}px ${FONTE}`;
  }

  // Caixa ocupada pelo bloco de texto (com o contorno), ou null se só tiver linhas em branco
  function caixaTexto(ctx, linhas, desloc, escala) {
    ctx.font = fonte(escala);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let caixa = null;
    linhas.forEach((linha, i) => {
      if (!linha.trim()) return;
      const m = ctx.measureText(linha);
      const base = BASE_Y + desloc + i * ENTRELINHA * escala;
      const c = [CENTRO_X - m.actualBoundingBoxLeft - CONTORNO, base - m.actualBoundingBoxAscent - CONTORNO,
        CENTRO_X + m.actualBoundingBoxRight + CONTORNO, base + m.actualBoundingBoxDescent + CONTORNO];
      caixa = caixa ? [Math.min(caixa[0], c[0]), Math.min(caixa[1], c[1]), Math.max(caixa[2], c[2]), Math.max(caixa[3], c[3])] : c;
    });
    return caixa;
  }

  // Igual ao legenda_na_foto do Python: diminui a fonte se não couber e empurra o bloco para dentro da foto
  function posicionarLegenda(ctx, linhas, textoY) {
    let desloc = Math.max(Y_MIN, Math.min(Y_MAX, textoY));
    let escala = 1;
    let caixa = caixaTexto(ctx, linhas, desloc, escala);
    if (!caixa) return null;
    escala = Math.min(1, (DIR - ESQ) / (caixa[2] - caixa[0]), (BASE - TOPO) / (caixa[3] - caixa[1]));
    if (escala < 1) caixa = caixaTexto(ctx, linhas, desloc, escala);
    let ajuste = 0;
    if (caixa[1] < TOPO) ajuste = TOPO - caixa[1];
    else if (caixa[3] > BASE) ajuste = BASE - caixa[3];
    desloc += ajuste;
    return { desloc, escala, caixa: [caixa[0], caixa[1] + ajuste, caixa[2], caixa[3] + ajuste] };
  }

  function desenharLegenda(ctx, linhas, pos, cor) {
    ctx.font = fonte(pos.escala);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = CONTORNO * 2; // o traço do canvas fica metade por dentro, metade por fora
    ctx.strokeStyle = '#000';
    ctx.fillStyle = cor;
    linhas.forEach((linha, i) => {
      if (!linha.trim()) return;
      const base = BASE_Y + pos.desloc + i * ENTRELINHA * pos.escala;
      ctx.strokeText(linha, CENTRO_X, base);
      ctx.fillText(linha, CENTRO_X, base);
    });
  }

  // ------------------------------------------------------------ montagem
  function comSombra(ctx, distancia, desfoque, desenhar) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = desfoque;
    [ctx.shadowOffsetX, ctx.shadowOffsetY] = SOMBRA[distancia];
    desenhar();
    ctx.restore();
  }

  function desenharFoto(ctx, foto, zoom, dx, dy) {
    const [x0, y0, larg, alt] = FOTO;
    const w = foto.naturalWidth || foto.width, h = foto.naturalHeight || foto.height;
    const escala = Math.max(larg / w, alt / h) * zoom;
    const x = Math.round((w * escala - larg) * dx), y = Math.round((h * escala - alt) * dy);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(foto, x / escala, y / escala, larg / escala, alt / escala, x0, y0, larg, alt);
  }

  let camadaTexto = null;

  /**
   * Desenha a arte no canvas (1080x1920) e devolve a caixa da legenda (para arrastar na prévia).
   * o: { foto, linhas, zoom, dx, dy, textoY, cor }
   */
  function montar(canvas, o) {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(rec.fundo, 0, 0, W, H);

    // brilho externo branco 75%, tamanho 11, atrás da foto
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.75)';
    ctx.shadowBlur = 11;
    ctx.fillStyle = '#fff';
    ctx.fillRect(...FOTO);
    ctx.restore();

    if (o.foto) desenharFoto(ctx, o.foto, o.zoom ?? 1, o.dx ?? 0.5, o.dy ?? 0.5);
    else { ctx.fillStyle = '#1f2937'; ctx.fillRect(...FOTO); }

    comSombra(ctx, 7, 5, () => ctx.drawImage(rec.chamada, ...CHAMADA_POS));
    comSombra(ctx, 1, 5, () => ctx.drawImage(rec.logo, ...LOGO_POS));

    const linhas = o.linhas || [];
    const pos = posicionarLegenda(ctx, linhas, o.textoY ?? Y_PADRAO);
    if (pos) {
      // texto numa camada separada para a sombra pegar o contorno junto, como no Photoshop
      camadaTexto ??= document.createElement('canvas');
      camadaTexto.width = W; camadaTexto.height = H;
      const t = camadaTexto.getContext('2d');
      t.clearRect(0, 0, W, H);
      desenharLegenda(t, linhas, pos, o.cor || COR_PADRAO);
      comSombra(ctx, 5, 5, () => ctx.drawImage(camadaTexto, 0, 0));
    }
    return pos ? pos.caixa : null;
  }

  // Foto desfocada com a logo no canto inferior esquerdo (igual ao carimbar_logo do PC)
  function carimbarLogo(foto, largura = 0.25, margem = 0.035) {
    const w = foto.naturalWidth || foto.width, h = foto.naturalHeight || foto.height;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(foto, 0, 0);
    const lw = Math.round(w * largura), lh = Math.round(rec.logo.height * lw / rec.logo.width);
    const m = Math.round(w * margem);
    const escala = w / FOTO[2];
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = Math.max(2, Math.round(5 * escala));
    const d = Math.max(1, Math.round(3 * escala));
    ctx.shadowOffsetX = Math.round(d * 0.5); ctx.shadowOffsetY = Math.round(d * 0.866);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rec.logo, m, h - m - lh, lw, lh);
    ctx.restore();
    return canvas;
  }

  return {
    W, H, FOTO, Y_MIN, Y_MAX, Y_PADRAO, COR_PADRAO, PARCELAS, LINHAS_FIXAS,
    carregar, carregarImagem, lerCentavos, formatarReais, calcularParcela, linhasPreco, montar, carimbarLogo,
  };
})();
