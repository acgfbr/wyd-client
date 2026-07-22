# WYD Web

Reimplementação do cliente clássico de With Your Destiny para navegador, usando TypeScript e Three.js.

O código é novo. O cliente clássico/C++ decompilado é usado como referência de formatos e comportamento; a implementação web anterior em `../tjs/src` não é reutilizada.

## Desenvolvimento

```bash
npm install
npm run import:classic
npm run dev
```

`import:classic` usa `../tjs/Origem` por padrão. Assets do jogo não fazem parte do código-fonte; o importador gera `public/game-data`, ignorado pelo Git.
