# Bot Resumo WhatsApp

Serviço Node.js/TypeScript que se conecta ao WhatsApp Web, guarda mensagens de grupos em um buffer efêmero e gera um resumo diário usando o modelo GPT-4o mini. O objetivo é ter um “secretário” que acompanha conversas longas e devolve um digest bem formatado a cada 24 horas (ou no intervalo que você definir).

## Destaques
- **Captura contínua** com `whatsapp-web.js` e autenticação persistida via `LocalAuth`.
- **Buffer temporário** em JSON local (`tmp/<chatId>/<data>.json`) para evitar banco de dados.
- **Pipeline map/reduce** com prompts em português, chunking token-aware (`@dqbd/tiktoken`) e chamadas ao **GPT-4o mini**.
- **Cron interno** (`node-cron`) capaz de rodar resumo automático ou manual (`--run-summary-now`).
- **Saída pronta para uso**: título com janela coberta, quadrante de decisões/pendências e notas extras.

## Arquitetura
```
┌──────────────┐   mensagens   ┌────────────┐   chunks   ┌──────────────┐
│ Grupo Whats  │ ─────────────►│ Buffer JSON│───────────►│ GPT-4o mini  │
└──────────────┘                │   tmp/     │           │ (map & reduce)│
        ▲                       └────────────┘            └──────▲───────┘
        │ resumo final                                        │
        └──────────────────────────────────────────────────────┘
```
Componentes principais:
- `src/whatsapp/client.ts`: inicializa o cliente Web, exibe QR, filtra grupos e salva mensagens relevantes no buffer.
- `src/shared/message-buffer.ts`: gerencia buckets diários, leitura da janela solicitada e limpeza pós-resumo.
- `src/summarizer/*`: prompts e pipeline map/reduce sobre GPT-4o mini.
- `src/jobs/*`: cron e job que monta o resumo, envia no grupo e limpa buffer.
- `src/index.ts`: bootstrap geral, incluindo parâmetro `--run-summary-now` para disparo manual.

## Pré-requisitos
- **Node.js 20+** (testado com 20.x e 22.x) e `npm`.
- Chromium ou Google Chrome instalado no host (necessário para o Puppeteer interno).
- Conta OpenAI com acesso ao modelo `gpt-4o-mini`.
- Número de WhatsApp dedicado (recomendado) com acesso ao(s) grupo(s) que serão monitorados.

## Configuração & Execução
1. Clone o repositório e instale dependências:
   ```bash
   npm install --no-bin-links # use --no-bin-links se o filesystem bloquear symlinks
   ```
2. Copie e edite o arquivo de ambiente:
   ```bash
   cp .env.example .env
   ```
   Preencha variáveis essenciais (descritas abaixo).
3. Inicie em modo desenvolvimento:
   ```bash
   npm run dev
   ```
   - Será exibido um QR code no terminal; escaneie com o WhatsApp do número dedicado.
   - Após “WhatsApp client is ready”, o bot já começa a coletar mensagens do(s) grupo(s) definidos.
4. Para testar o resumo imediatamente:
   ```bash
   npm run dev -- --run-summary-now
   ```
   ou, se já estiver rodando, pare e reinicie com o parâmetro.

### Variáveis de ambiente
| Nome | Obrigatória | Descrição |
| --- | --- | --- |
| `OPENAI_API_KEY` | ✅ | Chave da API OpenAI. |
| `WHATSAPP_TARGET_CHAT_IDS` | ➖ | Lista de IDs de grupos (`1234567890-123456@g.us`). Vazio = qualquer grupo onde a conta estiver. |
| `SUMMARY_SCHEDULE` | ➖ | Expressão cron (padrão `0 20 * * *`). |
| `SUMMARY_WINDOW_MINUTES` | ➖ | Janela em minutos (padrão `1440` = 24h). |
| `BUFFER_PATH` | ➖ | Pasta para os arquivos temporários (`tmp`). |
| `TIMEZONE` | ➖ | Fuso horário para o cron (`America/Sao_Paulo`). |
| `OPENAI_MODEL` | ➖ | Modelo usado no pipeline (`gpt-4o-mini`). |

> Dica: deixe `WHATSAPP_TARGET_CHAT_IDS` vazio no começo, envie uma mensagem no grupo e cheque os logs para descobrir o ID (`message.from`). Depois volte e configure o `.env` para filtrar apenas o(s) grupo(s) desejados.

## Fluxo diário
1. Mensagens entram no buffer imediatamente ao serem recebidas.
2. No horário configurado no cron, `DailySummaryJob` agrega tudo que estiver dentro da janela (`SUMMARY_WINDOW_MINUTES`).
3. O pipeline map/reduce gera mini-resumos por chunk, consolida e envia de volta ao grupo via `sendMessage`.
4. Mensagens anteriores ao resumo são removidas do buffer (sem armazenamento permanente).

### Formato do resumo (exemplo)
```
Resumo das últimas 24h — 10/05/2025 (20:00 - 20:00)

Resumo Principal:
- Equipe alinhou backlog do sprint e aprovou deploy do bot de suporte.
- Discussões sobre custos de tokens resultaram em novo limite diário.

Decisões Confirmadas:
- Ajustar prompts de atendimento até 13/05 (Ana).
- Realocar budget de IA para o squad de suporte (Bruno).

Pendências e Próximos Passos:
- Testar fallback de sessões WhatsApp no ambiente de staging (Carlos).
- Documentar fluxo de incidentes no Confluence (Debora).

Notas Relevantes:
- Alertas de segurança: nenhum.
```

## Deploy recomendado
Vercel não mantém processos longos nem suporta Puppeteer por muito tempo. Prefira serviços que mantenham o bot online 24/7:
- [Railway](https://railway.app/) (fácil, suporta build com `npm run build` + `npm start`).
- [Fly.io](https://fly.io/) ou [Render](https://render.com/) para mais controle.
- VPS próprio (Ubuntu) rodando com `pm2` ou `systemd`.

Checklist de deploy:
1. Instale Chromium no container (`apt-get update && apt-get install -y chromium`).
2. Exporte `PUPPETEER_EXECUTABLE_PATH` se o binário não for detectado automáticamente:
   ```bash
   export PUPPETEER_EXECUTABLE_PATH=$(which chromium)
   ```
3. Execute `npm install --omit=dev`, depois `npm run build`.
4. Use `npm start` como comando de produção.
5. Verifique os logs, escaneie o QR novamente e valide o resumo manual.

### Landing Page "CyberSec Brasil"
- A pasta `public/` contém uma landing page estática (HTML/CSS/JS) que pode ser publicada em Vercel como fachada institucional.
- O arquivo `vercel.json` aponta o `outputDirectory` para `public`, permitindo que o deploy do repositório sirva a landing page mesmo que o bot rode em outro ambiente.
- Personalize o conteúdo em `public/index.html` e a identidade visual em `public/styles.css`.

## Personalizações
- **Prompts**: ajuste `src/summarizer/prompts.ts` para mudar seções, idioma ou tom do output.
- **Chunk size**: altere o limite em `SummarizerPipeline.chunkMessages` se quiser blocos maiores/menores.
- **Janela móvel**: rode resumos “intraday” definindo cron de hora em hora (ex.: `0 * * * *`).
- **Entrega alternativa**: em vez de `sendMessage`, dispare e-mail, Slack ou Notion via webhook.

## Troubleshooting
- **`ts-node-dev: not found`**: rode `npm install` antes de `npm run dev`.
- **`Invalid environment configuration`**: confira o `.env` — `OPENAI_API_KEY` é obrigatório.
- **Nada aparece no console ao enviar mensagem**: garanta que o ID do chat está permitido e que a conta foi adicionada ao grupo correto. Se necessário, logue `message.from` temporariamente.
- **Erro ao instalar puppeteer/Chromium no host**: instale manualmente (`apt install chromium`) e informe o caminho via `PUPPETEER_EXECUTABLE_PATH`.
- **Vários grupos**: liste os IDs separados por vírgula em `WHATSAPP_TARGET_CHAT_IDS`.

## Roadmap sugerido
- Métricas de custo/token e telemetria.
- Painel HTTP com botão “Gerar resumo agora”.
- Suporte opcional a armazenamento S3/Cloudflare R2 para retenção de histórico.
- Testes unitários para o pipeline e mocks de WhatsApp.

Se tiver dúvidas ou quiser novas features (ex.: resumos temáticos, filtragem por palavras-chave, envio em PDF), abra uma issue ou manda mensagem. Bora automatizar esses grupos! 
