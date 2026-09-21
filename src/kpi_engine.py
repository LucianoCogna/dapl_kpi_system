"""
Motor de cálculo dos indicadores. Reproduz, de forma determinística, toda a
lógica que foi validada manualmente ao longo do processamento dos KPIs DAPL:

- Flags de time (DENA/DDPL/DCOD/DGOD) via issuelinks + subtasks + parent
- Tempo em Refinamento (soma de todas as passagens, incluindo reaberturas)
- Tempo em Bloqueado (usado como "Tempo de Bloqueio Externo")
- Mês em que o card SAIU do Refinamento pela última vez (Mês Fim Refinamento)
- Time to Market e Tempo em Homologação
- Classificação de tamanho (size-P/M/G) e elegibilidade/aderência ao TTM previsto

Cada função é pequena e testável isoladamente — isso importa porque esse
cálculo já teve edge cases reais (changelog paginado, cards reabertos
múltiplas vezes, bloqueios no meio do refinamento).
"""
from datetime import datetime
from collections import defaultdict

from . import config

DT_FMT = "%Y-%m-%dT%H:%M:%S.%f%z"


def parse_dt(s):
    return datetime.strptime(s, DT_FMT)


def normalize_label(label: str) -> str:
    """EVOLUÇÃO / EVOLUCAO / evolução -> mesma coisa."""
    return (label or "").upper().replace("Ã", "A").replace("Ç", "C")


def month_of(dt: datetime) -> str:
    return config.MONTH_PT[dt.month]


# ---------------------------------------------------------------------------
# Status timeline
# ---------------------------------------------------------------------------
def extract_status_changes(histories):
    """
    A partir do changelog bruto (lista de 'histories'), retorna uma lista
    ordenada de (timestamp, from_status, to_status), considerando só o
    campo REAL de status do Jira (fieldId == 'status'), não campos
    derivados/custom que às vezes têm o mesmo nome amigável.
    """
    changes = []
    for h in histories:
        created = h.get("created")
        for item in h.get("items", []):
            if item.get("field") == "status" and item.get("fieldId") == "status":
                changes.append((created, item.get("fromString"), item.get("toString")))
    changes.sort(key=lambda x: x[0])
    return changes


def time_in_status(status_changes, status_name):
    """
    Soma o tempo total (em segundos) que o card passou em `status_name`,
    somando TODAS as passagens (entra/sai possivelmente várias vezes).
    Um "entra" sem "sai" correspondente (card ainda está nesse status,
    ou changelog cortado) é ignorado — sinalizado separadamente por
    has_open_entry.
    """
    total_seconds = 0.0
    entry_ts = None
    has_open_entry = False
    for created, from_s, to_s in status_changes:
        ts = parse_dt(created)
        if to_s == status_name:
            entry_ts = ts
        elif from_s == status_name and entry_ts is not None:
            total_seconds += (ts - entry_ts).total_seconds()
            entry_ts = None
    if entry_ts is not None:
        has_open_entry = True  # card entrou no status e não saiu (ainda está lá, ou changelog cortado)
    return total_seconds, has_open_entry


def last_exit_from_status(status_changes, status_name):
    """Timestamp (datetime) da última vez que o card SAIU de `status_name`, ou None."""
    last = None
    for created, from_s, to_s in status_changes:
        if from_s == status_name:
            last = parse_dt(created)
    return last


def first_entry_into_status(status_changes, status_name):
    """Timestamp (datetime) da primeira vez que o card ENTROU em `status_name`, ou None."""
    for created, from_s, to_s in status_changes:
        if to_s == status_name:
            return parse_dt(created)
    return None


def last_entry_into_status(status_changes, status_name):
    last = None
    for created, from_s, to_s in status_changes:
        if to_s == status_name:
            last = parse_dt(created)
    return last


# ---------------------------------------------------------------------------
# Flags de time
# ---------------------------------------------------------------------------
def compute_team_flags(issue_fields):
    """
    Um time é flag=1 se QUALQUER issue relacionada (issuelinks, subtasks ou
    parent) tiver chave começando com o prefixo do board daquele time.
    """
    related_keys = []

    for link in issue_fields.get("issuelinks", []) or []:
        other = link.get("inwardIssue") or link.get("outwardIssue")
        if other:
            related_keys.append(other["key"])

    for sub in issue_fields.get("subtasks", []) or []:
        related_keys.append(sub["key"])

    parent = issue_fields.get("parent")
    if parent:
        related_keys.append(parent["key"])

    flags = {}
    for prefix, flag_name in config.TEAM_PREFIXES.items():
        flags[flag_name] = 1 if any(k.startswith(prefix + "-") for k in related_keys) else 0
    return flags


# ---------------------------------------------------------------------------
# Classificação P/M/G
# ---------------------------------------------------------------------------
def compute_size_classification(issue_fields):
    """Lê o campo Componentes e retorna o nome do componente size-* (ou None)."""
    for comp in issue_fields.get("components", []) or []:
        name = comp.get("name", "")
        if name.startswith("size-"):
            return name
    return None


# ---------------------------------------------------------------------------
# Cálculo por card
# ---------------------------------------------------------------------------
def compute_card_metrics(issue_key, issue_fields, histories, mes_lote: str):
    """
    Calcula todas as métricas de um card. Retorna um dict pronto para virar
    uma linha da planilha "Indicadores DAPL".

    mes_lote: mês de referência do lote sendo processado (usado como
    fallback quando não há Refinamento no período, mantendo compatibilidade
    com a convenção adotada manualmente).
    """
    status_changes = extract_status_changes(histories)
    changelog_total = len(histories)

    refin_seconds, refin_open = time_in_status(status_changes, config.STATUS_REFINAMENTO)
    bloqueio_seconds, bloqueio_open = time_in_status(status_changes, config.STATUS_BLOQUEADO)

    last_refin_exit = last_exit_from_status(status_changes, config.STATUS_REFINAMENTO)
    mes_fim_refinamento = month_of(last_refin_exit) if last_refin_exit else mes_lote

    incompleto = refin_open  # heurística: se há uma entrada em Refinamento sem saída
    # correspondente, é sinal de possível changelog cortado (ou o card ainda
    # está em Refinamento agora — quem consome o dado decide como tratar).

    first_refin_entry = first_entry_into_status(status_changes, config.STATUS_REFINAMENTO)
    last_aceito_entry = last_entry_into_status(status_changes, config.STATUS_ACEITO)

    status_atual = issue_fields.get("status", {}).get("name")

    # --- Time to Market / Homologação (só fazem sentido se o card chegou a Aceito) ---
    ttm_dias = "N/A (não Aceito)"
    homolog_dias = "N/A (não Aceito)"
    if status_atual == config.STATUS_ACEITO and first_refin_entry and last_aceito_entry:
        ttm_dias = (last_aceito_entry - first_refin_entry).total_seconds() / 86400
        last_concluido_entry = last_entry_into_status(status_changes, config.STATUS_CONCLUIDO)
        if last_concluido_entry:
            homolog_dias = (last_aceito_entry - last_concluido_entry).total_seconds() / 86400

    # --- Flags de categoria ---
    labels = {normalize_label(l) for l in (issue_fields.get("labels") or [])}
    flag_novo = 1 if normalize_label(config.LABEL_NOVO_PRODUTO) in labels else 0
    flag_evolucao = 1 if normalize_label(config.LABEL_EVOLUCAO) in labels else 0

    team_flags = compute_team_flags(issue_fields)

    # --- Classificação de tamanho e elegibilidade ao TTM previsto ---
    size = compute_size_classification(issue_fields)
    elegivel_ttm = "Não"
    classificacao_tamanho = "N/A"
    qtde_dias_liquidos = "N/A"
    limite_dias = "N/A"
    dentro_do_prazo = "N/A"

    is_historia = (issue_fields.get("issuetype", {}).get("name") == "História")
    if is_historia and status_atual == config.STATUS_ACEITO and flag_novo == 1:
        if size in config.SIZE_EXCLUDED:
            classificacao_tamanho = f"{size} (fora do escopo P/M/G)"
        elif size in config.SIZE_LIMITS_SPRINTS:
            classificacao_tamanho = size.replace("size-", "")
            limite = config.size_limit_dias(size)
            bloqueio_dias = bloqueio_seconds / 86400
            qtde_dias = (last_aceito_entry - first_refin_entry).total_seconds() / 86400 - bloqueio_dias \
                if (first_refin_entry and last_aceito_entry) else None
            if qtde_dias is not None:
                elegivel_ttm = "Sim"
                qtde_dias_liquidos = round(qtde_dias, 2)
                limite_dias = limite
                dentro_do_prazo = "Sim" if qtde_dias <= limite else "Não"
        else:
            classificacao_tamanho = "N/A (sem componente size-*)"

    return {
        "Tipo de item": issue_fields.get("issuetype", {}).get("name"),
        "Chave da item": issue_key,
        "Resumo": issue_fields.get("summary"),
        "Status": status_atual,
        "Responsável": (issue_fields.get("assignee") or {}).get("displayName"),
        "Mês de Referência": mes_lote,
        "Mês Fim Refinamento": mes_fim_refinamento,
        "Flag Engenharia (DENA)": team_flags["Flag Engenharia (DENA)"],
        "Flag Plataforma (DDPL)": team_flags["Flag Plataforma (DDPL)"],
        "Flag DataViz (DCOD)": team_flags["Flag DataViz (DCOD)"],
        "Flag Governança (DGOD)": team_flags["Flag Governança (DGOD)"],
        "Flag Novo Produto de Dados": flag_novo,
        "Flag Evolução": flag_evolucao,
        "Tempo em Refinamento (dias)": round(refin_seconds / 86400, 6),
        "Validar Tempo Refinamento": "SIM - validar (tempo suspeito, possível migração em lote)" if refin_seconds < 5 else "Não",
        "Time to Market (dias corridos)": round(ttm_dias, 4) if isinstance(ttm_dias, float) else ttm_dias,
        "Tempo em Homologação (dias)": round(homolog_dias, 4) if isinstance(homolog_dias, float) else homolog_dias,
        "Classificação Tamanho": classificacao_tamanho,
        "Elegível TTM Previsto?": elegivel_ttm,
        "Tempo Bloqueio Externo (dias)": round(bloqueio_seconds / 86400, 4),
        "Qtde Dias Líquidos": qtde_dias_liquidos,
        "Limite (dias)": limite_dias,
        "Dentro do Prazo?": dentro_do_prazo,
        "Changelog incompleto?": "Sim" if incompleto else "Não",
        "_changelog_total_eventos": changelog_total,
    }
