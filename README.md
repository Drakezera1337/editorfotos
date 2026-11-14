# Editor de Fotos (celular)

App web do Editor de Fotos: monta a arte 9x16 com preço, legenda editável, cor e logo direto no celular.
O blur do fundo é feito pelo PC (`server.py` do projeto EditorFotos, que usa o Pixelcut), com as fotos
indo e voltando por um Gist secreto.

**Site:** https://drakezera1337.github.io/editorfotos/

## Ligar
1. No PC, o servidor inicia sozinho com o Windows (atalho `Editor de Fotos (servidor)` em `shell:startup`).
   Abra http://localhost:8799, cole um token do GitHub com permissão **gist** e clique em **Conectar**.
2. No celular, aponte a câmera para o QR code da página do PC (ou no app: Conexão com o PC → **Ler QR do PC**).
3. Instale: Chrome ⋮ → **Instalar app** (iPhone: Compartilhar → Adicionar à Tela de Início).
