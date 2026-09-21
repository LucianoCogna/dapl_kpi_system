# Sistema de KPIs DAPL

Versão automatizada do processamento de indicadores que fizemos manualmente:
conecta direto na API do Jira, calcula as mesmas métricas (flags de time,
tempo em Refinamento, TTM, Homologação, classificação P/M/G, % dentro do
TTM previsto) e gera o Excel + dashboard HTML sozinho, sem precisar de mim
numa conversa.

## 1. Instalação

Requer Python 3.10+.

```bash
cd dapl_kpi_system
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Configuração

1. Gere um API token do Jira em: https://id.atlassian.com/manage-profile/security/api-tokens
2. Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

```
JIRA_BASE_URL=https://cogna.atlassian.net
JIRA_EMAIL=seu.email@cogna.com.br
JIRA_API_TOKEN=cole_seu_token_aqui
```

**Nunca** commite o arquivo `.env` num repositório — ele tem sua credencial.

## 3. Rodar

```bash
python main.py --months MAIO,JUNHO,JULHO,AGOSTO
```

Gera em `./output/`:
- `Indicadores_DAPL_Consolidado.xlsx`
- `dapl_dashboard.html`

## 4. O que ajustar antes de usar em produção

Este é um ponto de partida funcional, mas alguns pontos exigem calibração
com a realidade do seu board — eu não tinha como validar isso sem acesso
contínuo ao Jira:

- **JQL de busca** (`main.py`, função `fetch_month_records`): hoje traz
  Histórias Aceitas, Epics em produção e cards Em Andamento/Concluído sem
  filtro de data. Adicione um filtro por período (`updated >=`, uma
  sprint/fixVersion, ou uma label de mês) para não reprocessar tudo do
  zero toda vez.
- **Atribuição de "Mês de Referência"**: no processamento manual, cada card
  era associado a um mês de forma um pouco manual (o mês do lote sendo
  processado). Aqui, `--months` define isso globalmente por execução — se
  você processa vários meses de uma vez, ajuste `fetch_month_records` para
  derivar o mês por card (ex: a partir de uma `fixVersion`, ou do mês em
  que ele foi Aceito/Em produção) em vez de usar o mesmo valor para todos.
- **Labels de categoria**: `config.LABEL_NOVO_PRODUTO` e `LABEL_EVOLUCAO`
  assumem os nomes exatos usados hoje (`NOVO_PRODUTO_DADO`, `EVOLUÇÃO`).
  Se o time criar variações, adicione ao `normalize_label` em
  `kpi_engine.py`.
- **Classificação size-P/M/G**: lida do campo Componentes. Cards sem esse
  componente aparecem como "N/A (sem componente size-*)" e ficam fora do
  KPI de TTM previsto — isso é esperado até que o time classifique mais
  cards retroativamente.
- **Rate limit da API do Jira**: `main.py` tem um `time.sleep(0.1)` entre
  chamadas de changelog. Para volumes grandes (centenas de cards), considere
  paralelizar com cuidado ou aumentar esse intervalo se começar a levar
  erros 429.
- **Endpoint de busca**: o cliente usa `/rest/api/3/search/jql` (API mais
  recente do Jira Cloud). Se sua instância ainda usa o endpoint clássico
  `/rest/api/3/search`, ajuste `jira_client.py`.

## 5. Publicar no Vercel

O projeto agora também roda como app web, em `api/index.py` (Flask), pronto
para deploy no Vercel:

- `GET /` → gera o dashboard na hora (busca no Jira, calcula tudo, retorna o HTML)
- `GET /excel` → gera e retorna o Excel para download
- `GET /health` → checagem simples (não toca o Jira)

### Passos

```bash
npm install -g vercel      # se ainda não tiver a CLI
cd dapl_kpi_system
vercel login
vercel
```

Depois, configure as variáveis de ambiente no painel do Vercel (Project →
Settings → Environment Variables) — **não** suba o `.env`:

```
JIRA_BASE_URL=https://cogna.atlassian.net
JIRA_EMAIL=seu.email@cogna.com.br
JIRA_API_TOKEN=seu_token
```

Depois de configurar, rode `vercel --prod` (ou redeploy pelo painel) para
que as variáveis entrem em vigor.

### Se der "Not Found" depois do deploy

Esse erro geralmente significa que o Vercel não conseguiu associar a rota
à função Python — normalmente é configuração de roteamento, não erro no
código. Checklist, na ordem que eu testaria:

1. **Confirme que o build encontrou a função.** No painel do Vercel, abra
   o deployment → aba "Functions" — deve aparecer `api/index.py` listada.
   Se não aparecer, o Vercel não reconheceu o arquivo como função (confirme
   que `requirements.txt` está na raiz do projeto, não dentro de `api/`).
2. **Teste a função direto, sem passar pelo rewrite:**
   `https://seu-projeto.vercel.app/api/index`
   Se isso funcionar mas `/` continuar dando 404, o problema é
   especificamente no `rewrites` do `vercel.json` — confirme que ele foi
   de fato lido (às vezes precisa de um redeploy limpo, não só um redeploy
   do cache: `vercel --prod --force`).
3. **Confirme a raiz do projeto no Vercel.** Se você importou o projeto
   pelo painel (não pela CLI), o Vercel às vezes pergunta o "Root
   Directory" — tem que ser a pasta que contém `vercel.json` e `api/`,
   não uma pasta pai ou filha.
4. **Veja os logs de build**, não só o erro no navegador — em
   Deployments → (seu deployment) → "Build Logs". Erros de import (ex:
   `ModuleNotFoundError: No module named 'src'`) aparecem lá, não na
   página 404.
5. **Erro `Function Runtimes must have a valid version`**: isso é o campo
   `runtime` do `vercel.json` com formato errado. A versão atual deste
   projeto não usa mais esse campo — deixa o Vercel detectar o runtime
   Python sozinho pela extensão `.py`. Se você editou o `vercel.json`
   manualmente e adicionou algo como `"runtime": "python3.12"`, remova
   essa linha.
6. **Erro relacionado a `maxDuration`**: no plano Hobby, o Vercel pode
   rejeitar valores de `maxDuration` acima do permitido no seu plano. Se
   isso acontecer, o jeito mais simples é remover o bloco `functions`
   inteiro do `vercel.json` (fica só o `rewrites`) e deixar o Vercel usar
   o timeout padrão do seu plano:
   ```json
   {
     "rewrites": [
       { "source": "/(.*)", "destination": "/api/index" }
     ]
   }
   ```

Se depois disso ainda continuar dando erro, me mande o texto dos Build
Logs — com o traceback exato eu consigo apontar a causa certa em vez de
tentar às cegas.

### Sobre timeout e performance

Cada acesso à URL busca tudo no Jira de novo, na hora — sem cache. Isso
mantém o dashboard sempre atualizado, mas cada card processado custa uma
chamada de busca de changelog. Se o board crescer (muitos cards por mês),
a função pode ultrapassar o limite de execução:

- **Plano Hobby**: 10s por padrão (pode não ser suficiente)
- **Plano Pro**: até 60s por padrão, configurável até 300s (já configurado
  em `vercel.json` via `maxDuration`, mas confirme o limite do seu plano)

Se começar a dar timeout, a solução é separar geração de leitura:
1. Um Vercel Cron Job (`vercel.json` → `"crons"`) chama `/excel` (ou uma
   rota de "gerar") periodicamente e salva o resultado em um storage
   externo (Vercel Blob, S3, etc.)
2. A rota `/` passa a só *ler* esse resultado já pronto, em vez de
   recalcular — fica instantânea.

Me avise se quiser que eu já implemente esse caminho com cache — hoje o
projeto está na versão mais simples (gera tudo a cada acesso) porque é a
que funciona sem nenhuma peça extra de infraestrutura.

## 6. Agendar para rodar sozinho (fora do Vercel — cron tradicional)

### Opção A — cron (Linux/Mac, ou um servidor)

```bash
crontab -e
```

Adicione (roda toda segunda-feira às 7h):

```
0 7 * * 1 cd /caminho/para/dapl_kpi_system && venv/bin/python main.py --months AGOSTO >> logs/run.log 2>&1
```

### Opção B — Task Scheduler (Windows)

1. Abra o "Agendador de Tarefas"
2. Criar Tarefa Básica → defina a periodicidade (ex: semanal)
3. Ação: "Iniciar um programa"
   - Programa: `C:\caminho\para\dapl_kpi_system\venv\Scripts\python.exe`
   - Argumentos: `main.py --months AGOSTO`
   - Iniciar em: `C:\caminho\para\dapl_kpi_system`

### Opção C — GitHub Actions (se o código for para um repositório)

Crie `.github/workflows/kpis.yml`:

```yaml
name: Gerar KPIs DAPL
on:
  schedule:
    - cron: "0 10 * * 1"   # toda segunda, 10h UTC
  workflow_dispatch: {}      # também permite rodar manualmente pelo GitHub

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -r requirements.txt
      - run: python main.py --months AGOSTO
        env:
          JIRA_BASE_URL: ${{ secrets.JIRA_BASE_URL }}
          JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}
          JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: dapl-kpis
          path: output/
```

Guarde `JIRA_BASE_URL`, `JIRA_EMAIL` e `JIRA_API_TOKEN` em
Settings → Secrets and variables → Actions do repositório.

## 7. Estrutura do projeto

```
dapl_kpi_system/
├── main.py                    # ponto de entrada CLI (uso local/agendado, fora do Vercel)
├── api/
│   └── index.py                # app Flask — ponto de entrada quando publicado no Vercel
├── vercel.json                 # configuração de rotas/runtime do Vercel
├── src/
│   ├── config.py               # todas as regras de negócio (prefixos, limites, status)
│   ├── jira_client.py          # chamadas HTTP diretas à API do Jira (com paginação completa)
│   ├── kpi_engine.py           # cálculo de cada métrica por card
│   ├── excel_builder.py        # monta o .xlsx (duas abas, com fórmulas)
│   └── dashboard_builder.py    # monta o dashboard HTML a partir do .xlsx
├── templates/
│   ├── dashboard_template.html # HTML/CSS do dashboard (mesmo já validado)
│   └── dashboard.js            # lógica interativa do dashboard (mesma já validada)
├── output/                     # onde os arquivos gerados são salvos (uso via main.py)
├── requirements.txt
├── .env.example
└── README.md
```

Se quiser mudar o visual/comportamento do dashboard, edite
`templates/dashboard_template.html` (CSS/estrutura) ou
`templates/dashboard.js` (lógica/filtros/gráficos) — esses arquivos não
mudam a cada execução, só os dados injetados neles mudam.

## 8. Correção que este sistema já traz em relação ao processo manual

O changelog do Jira é paginado em blocos de 100 eventos. No processamento
manual, alguns cards muito reabertos (ex: DAPL-1147, DAPL-1140) ficaram
marcados como "Incompleto" porque só pegamos a primeira página. Aqui,
`jira_client.get_full_changelog` pagina até esgotar todo o histórico —
então esses casos devem sair corretos automaticamente. Ainda assim, o
sistema sinaliza `Changelog incompleto?` quando detecta uma entrada em
Refinamento sem saída correspondente (pode ser card ainda em andamento,
ou uma inconsistência real — vale checar caso a caso).
