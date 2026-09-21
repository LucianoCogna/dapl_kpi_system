#!/usr/bin/env python3
"""
Ponto de entrada do sistema de KPIs DAPL.

Uso:
    python main.py --months MAIO,JUNHO,JULHO,AGOSTO

O que faz:
    1. Busca no Jira todos os cards relevantes por mês (Histórias Aceitas +
       Epics em produção + cards Em Andamento/Concluído do mês corrente)
    2. Para cada card, busca o changelog completo e calcula as métricas
       (kpi_engine.compute_card_metrics)
    3. Monta o Excel consolidado (excel_builder)
    4. Monta o dashboard HTML a partir do Excel (dashboard_builder)

Saída: ./output/Indicadores_DAPL_Consolidado.xlsx e ./output/dapl_dashboard.html
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from src import config
from src.jira_client import JiraClient
from src.kpi_engine import compute_card_metrics
from src.excel_builder import build_workbook
from src.dashboard_builder import build_dashboard


ISSUE_FIELDS = [
    "summary", "status", "assignee", "labels", "components",
    "issuelinks", "subtasks", "parent", "issuetype",
]


def fetch_month_records(client: JiraClient, month: str, jql_extra: str = "") -> list[dict]:
    """
    Busca e processa os cards de um mês. O JQL abaixo cobre:
    - Histórias com status Aceito (produto entregue)
    - Epics com status "Em produção"
    - Histórias Em Andamento/Concluído (leva do mês corrente)
    Ajuste o JQL conforme a convenção real de datas do seu board — aqui
    fica um ponto único de configuração.
    """
    jql = (
        f'project = {config.PROJECT_KEY} AND '
        f'status in ("{config.STATUS_ACEITO}", "{config.STATUS_EM_PRODUCAO}", '
        f'"{config.STATUS_EM_ANDAMENTO}", "{config.STATUS_CONCLUIDO}") '
        f'{jql_extra} ORDER BY key ASC'
    )
    issues = client.search_issues(jql, fields=ISSUE_FIELDS)

    records = []
    for issue in issues:
        key = issue["key"]
        fields = issue["fields"]
        histories = client.get_full_changelog(key)
        metrics = compute_card_metrics(key, fields, histories, mes_lote=month)
        records.append(metrics)
        time.sleep(0.1)  # gentileza com a API — ajuste/remova se tiver rate limit folgado
    return records


def main():
    parser = argparse.ArgumentParser(description="Gera KPIs consolidados DAPL a partir do Jira.")
    parser.add_argument("--months", default="MAIO,JUNHO,JULHO,AGOSTO",
                         help="Meses a processar, separados por vírgula (ex: MAIO,JUNHO,JULHO)")
    parser.add_argument("--jql-extra", default="",
                         help='JQL adicional para restringir o período (ex: AND updated >= "2026-05-01")')
    parser.add_argument("--output-dir", default=config.OUTPUT_DIR)
    args = parser.parse_args()

    months = [m.strip().upper() for m in args.months.split(",")]
    os.makedirs(args.output_dir, exist_ok=True)

    client = JiraClient()

    all_records = []
    for month in months:
        print(f"[{month}] buscando e processando cards...")
        recs = fetch_month_records(client, month, jql_extra=args.jql_extra)
        print(f"[{month}] {len(recs)} cards processados.")
        all_records.extend(recs)

    incompletos = [r["Chave da item"] for r in all_records if r.get("Changelog incompleto?") == "Sim"]
    if incompletos:
        print(f"\n⚠️  {len(incompletos)} card(s) com changelog possivelmente incompleto "
              f"(entrada em Refinamento sem saída correspondente): {', '.join(incompletos)}")

    excel_path = os.path.join(args.output_dir, config.EXCEL_FILENAME)
    wb = build_workbook(all_records, months)
    wb.save(excel_path)
    print(f"\n✔ Excel gerado: {excel_path}")

    dashboard_path = os.path.join(args.output_dir, config.DASHBOARD_FILENAME)
    build_dashboard(excel_path, dashboard_path)
    print(f"✔ Dashboard gerado: {dashboard_path}")


if __name__ == "__main__":
    main()
