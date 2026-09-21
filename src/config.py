"""
Configuração central do sistema de KPIs DAPL.

Tudo que é "regra de negócio" (prefixos de time, limites de prazo, status IDs)
fica aqui, isolado do código que processa os dados — assim, se a regra mudar,
você edita só este arquivo.
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Conexão com o Jira
# ---------------------------------------------------------------------------
JIRA_BASE_URL = os.getenv("JIRA_BASE_URL", "https://cogna.atlassian.net")
JIRA_EMAIL = os.getenv("JIRA_EMAIL", "")
JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN", "")
CLOUD_ID = os.getenv("JIRA_CLOUD_ID", "")  # opcional; descoberto automaticamente se vazio

PROJECT_KEY = "DAPL"

# ---------------------------------------------------------------------------
# Prefixos de board usados para inferir o time responsável (via issuelinks,
# subtasks e parent). Mantém a mesma lógica usada no processamento manual.
# ---------------------------------------------------------------------------
TEAM_PREFIXES = {
    "DENA": "Flag Engenharia (DENA)",
    "DDPL": "Flag Plataforma (DDPL)",
    "DCOD": "Flag DataViz (DCOD)",
    "DGOD": "Flag Governança (DGOD)",
}

# ---------------------------------------------------------------------------
# Labels usadas para classificar o tipo de demanda
# ---------------------------------------------------------------------------
LABEL_NOVO_PRODUTO = "NOVO_PRODUTO_DADO"
LABEL_EVOLUCAO = "EVOLUÇÃO"  # também aceita "EVOLUCAO" sem acento (ver kpi_engine.normalize_label)

# ---------------------------------------------------------------------------
# Nomes de status usados no fluxo (exatamente como aparecem no Jira)
# ---------------------------------------------------------------------------
STATUS_BACKLOG = "Backlog"
STATUS_REFINAMENTO = "Refinamento"
STATUS_EM_ANDAMENTO = "Em Andamento"
STATUS_BLOQUEADO = "Bloqueado"
STATUS_CONCLUIDO = "Concluído"
STATUS_ACEITO = "Aceito"
STATUS_EM_PRODUCAO = "Em produção"

# Status finais/terminais considerados "elegível para KPIs de tempo de entrega"
STATUS_TERMINAIS_HISTORIA = {STATUS_ACEITO}
STATUS_TERMINAIS_EPIC = {STATUS_EM_PRODUCAO}

# Status que contam como "em andamento" para a leva mensal de cards ativos
STATUS_ATIVOS_MES = {STATUS_EM_ANDAMENTO, STATUS_CONCLUIDO}

# ---------------------------------------------------------------------------
# Classificação de tamanho (campo Componentes do Jira) e limites de TTM
# previsto. 1 sprint = SPRINT_DIAS dias corridos.
# ---------------------------------------------------------------------------
SPRINT_DIAS = 14

SIZE_LIMITS_SPRINTS = {
    "size-P": 3,
    "size-M": 4,
    "size-G": 6,   # confirmado manualmente: 6 sprints, não os 5 que o texto do componente sugere
}
SIZE_EXCLUDED = {"size-PP", "size-Epic"}  # fora do cálculo do KPI de TTM previsto

def size_limit_dias(component_name: str):
    """Retorna o limite em dias corridos para um componente size-*, ou None se não aplicável."""
    sprints = SIZE_LIMITS_SPRINTS.get(component_name)
    if sprints is None:
        return None
    return sprints * SPRINT_DIAS

# ---------------------------------------------------------------------------
# Meses cobertos pelo relatório, na ordem em que devem aparecer
# ---------------------------------------------------------------------------
MONTH_ORDER = ["MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO",
               "NOVEMBRO", "DEZEMBRO", "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL"]

MONTH_PT = {
    1: "JANEIRO", 2: "FEVEREIRO", 3: "MARÇO", 4: "ABRIL", 5: "MAIO", 6: "JUNHO",
    7: "JULHO", 8: "AGOSTO", 9: "SETEMBRO", 10: "OUTUBRO", 11: "NOVEMBRO", 12: "DEZEMBRO",
}

# ---------------------------------------------------------------------------
# Saída
# ---------------------------------------------------------------------------
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./output")
EXCEL_FILENAME = "Indicadores_DAPL_Consolidado.xlsx"
DASHBOARD_FILENAME = "dapl_dashboard.html"
