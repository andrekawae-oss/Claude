# Calendário Trello

Visão de **calendário mensal** dos cartões do Trello, para a equipe toda ver por um link.
Sem login, sem conectar conta, sem API key.

- Cartões aparecem no dia da **data de entrega**. Se tiverem **data de início**, aparecem em todos os dias do intervalo.
- A cor do cartão vem da primeira etiqueta. Cartões concluídos ficam riscados e os atrasados ganham borda vermelha.
- Filtros por lista, etiqueta, membro e quadro, além de busca por texto.
- Clique no cartão para ver detalhes e abrir no Trello.
- Cartões sem data ficam numa seção "Sem data" abaixo do calendário.
- Dá para juntar vários quadros no mesmo calendário.

## Como colocar os dados do Trello

### Opção A: exportar o JSON (funciona com qualquer quadro, inclusive privado)

1. No Trello, abra o quadro → **Menu (…)** → **Imprimir, exportar e compartilhar** → **Exportar como JSON**.
2. Salve o arquivo como `data/board.json` neste repositório (substituindo o de exemplo) e faça commit.
   Dá para fazer direto pelo site do GitHub: entre em `data/`, clique em **Add file → Upload files**.
3. O site é republicado sozinho em ~1 minuto.

Para mais de um quadro, salve cada um em `data/` (ex.: `data/marketing.json`, `data/dev.json`) e liste os nomes em `data/boards.json`:

```json
["marketing.json", "dev.json"]
```

> Para atualizar o calendário, repita a exportação quando quiser.
> O botão **Importar JSON** (ou arrastar o arquivo para a página) mostra um quadro **só no seu navegador**, para conferir antes de publicar.

### Opção B: atualização automática (quadros públicos)

Se o quadro estiver com visibilidade **Público** no Trello, o GitHub busca os cartões sozinho, de hora em hora:

1. No GitHub: **Settings → Secrets and variables → Actions → aba Variables → New repository variable**.
2. Nome: `TRELLO_BOARDS`. Valor: o link do quadro (ex.: `https://trello.com/b/AbCd1234/meu-quadro`).
   Para vários quadros, separe os links com vírgula.
3. Pronto. Nesse modo, os arquivos de `data/` do repositório são ignorados e substituídos pelos baixados.

Atenção: um quadro público pode ser visto por qualquer pessoa que tenha o link. Se o quadro tiver informação sensível, use a opção A.

## Publicar para a equipe (GitHub Pages)

1. Faça merge desta branch na `main`.
2. No GitHub: **Settings → Pages → Source: GitHub Actions**.
3. O workflow `Publicar calendário` publica o site. O link aparece em Settings → Pages (algo como `https://<usuario>.github.io/<repo>/`).
4. Mande o link para a equipe.

Atenção: no plano gratuito do GitHub, o Pages só funciona com repositório público, e o site publicado é público
(qualquer pessoa com o link vê os cartões). Para restringir o acesso, é preciso GitHub Pro/Team/Enterprise com Pages privado
ou hospedar os arquivos em outro lugar (é tudo estático: `index.html`, `app.js`, `style.css` e `data/`).

## Rodar localmente

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

Baixar quadros públicos manualmente:

```bash
node scripts/fetch-trello.mjs https://trello.com/b/AbCd1234/meu-quadro
```
