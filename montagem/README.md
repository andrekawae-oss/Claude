# Gerador de Manual de Montagem

Transforma um modelo do SketchUp num **manual de montagem animado** para os montadores abrirem no celular.
Cada etapa mostra as peças entrando no lugar, quantas pessoas são necessárias, quanto tempo leva e as observações.

## Como usar

### 1. Exportar do SketchUp Pro

1. Abra o projeto no SketchUp.
2. **Arquivo → Exportar → Modelo 3D…**
3. Em "Tipo"/"Formato", escolha **COLLADA (*.dae)** e salve.

Não tem problema se o plugin bloquear a edição dos componentes. Exportar não edita nada, e os nomes dos componentes vêm junto.
Se o modelo tiver texturas, o SketchUp cria uma pasta ao lado do `.dae`. Arraste as duas coisas juntas para o app.

### 2. Montar as etapas no app

Abra o app (endereço do site + `/montagem/`) e arraste o arquivo `.dae` para a tela.

- **Lista de peças (à esquerda)**: cada componente do SketchUp vira uma peça, com cor por categoria (metalon, MDF, ferragem, porta, LED).
  Se a categoria estiver errada, selecione a peça e troque na barra laranja.
- **Dividir**: se um componente agrupa várias peças (ex.: um módulo inteiro), selecione-o e clique em **Dividir** para trabalhar com as subpeças.
- **Sugerir**: o app propõe uma sequência (estrutura → base → laterais → fundo → prateleiras → tampo → ferragens → portas → LED).
  Depois é só ajustar.
- **+ Etapa**: selecione peças (na lista ou clicando no 3D, com Ctrl para várias) e crie uma etapa com elas.
- Em cada etapa você define o **número de pessoas**, os **minutos**, de que **direção as peças entram** na animação e as **observações**.
- **Pode ser feita junto com a etapa anterior**: marque quando outra parte da equipe pode fazer essa etapa ao mesmo tempo.
  O resumo mostra o tempo economizado e quantas pessoas são necessárias no pico.
- **Esmaecer já usadas**: deixa transparentes as peças que já estão em alguma etapa, para achar as que faltam.

O trabalho fica salvo sozinho no navegador (por nome de arquivo). Para guardar ou continuar em outro computador, use **Salvar projeto** e **Abrir projeto**.

### 3. Gerar o manual

- **Pré-visualizar** abre o manual numa aba nova, do jeito que o montador vai ver.
- **Gerar manual** baixa um arquivo `manual-<nome>.html`. Esse arquivo é o manual completo: modelo 3D, etapas e tudo mais num arquivo só,
  e funciona **sem internet**.

Como entregar aos montadores:
- **Pelo site:** envie o arquivo para a pasta `montagem/manuais/` do repositório (Add file → Upload files). O link fica
  `https://andrekawae-oss.github.io/Claude/montagem/manuais/manual-<nome>.html`.
- **Direto:** mande o arquivo pelo WhatsApp ou e-mail. No celular, ele abre no navegador.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html`, `editor.js`, `editor.css` | O editor |
| `src/` | Código compartilhado: leitura do modelo, animação, sugestão de etapas, visualizador do manual |
| `build/viewer.bundle.js` | Visualizador do manual já empacotado (vai dentro de cada manual gerado) |
| `vendor/` | Biblioteca 3D (Three.js), incluída para não depender de internet |
| `exemplo/armario.dae` | Modelo de exemplo |

Se você alterar algo em `src/`, rode `npm install && npm run build` para atualizar o `build/viewer.bundle.js`.
