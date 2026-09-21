"""
App web para deploy no Vercel. Expõe o mesmo pipeline de main.py (Jira ->
cálculo de KPIs -> Excel -> dashboard) como duas rotas HTTP:

  GET /            -> gera e retorna o dashboard HTML (fresco, na hora)
  GET /excel        -> gera e retorna o Excel para download
  GET /health       -> checagem simples, não toca o Jira

Vercel exige uma variável top-level chamada "app" (ou "application"/"handler")
neste arquivo — é isso que resolve o erro "does not export a top-level app".

IMPORTANTE: cada requisição dispara uma busca completa no Jira (sem cache).
Isso é simples e sempre traz dados frescos, mas pode ser lento/estourar o
timeout da função se o board tiver muitos cards — veja o README, seção
"Vercel", para a opção de cache caso isso aconteça.
"""
import os
import sys
import tempfile
import traceback

from flask import Flask, Response, jsonify

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import config
from src.jira_client import JiraClient
from src.kpi_engine import compute_card_metrics
from src.excel_builder import build_workbook
from src.dashboard_builder import build_dashboard

app = Flask(__name__)

ISSUE_FIELDS = [
    "summary", "status", "assignee", "labels", "components",
    "issuelinks", "subtasks", "parent", "issuetype",
]

DEFAULT_MONTHS = ["MAIO", "JUNHO", "JULHO", "AGOSTO"]


def _fetch_all_records(months):
    client = JiraClient()
    all_records = []
    for month in months:
        jql = (
            f'project = {config.PROJECT_KEY} AND '
            f'status in ("{config.STATUS_ACEITO}", "{config.STATUS_EM_PRODUCAO}", '
            f'"{config.STATUS_EM_ANDAMENTO}", "{config.STATUS_CONCLUIDO}") '
            f'ORDER BY key ASC'
        )
        issues = client.search_issues(jql, fields=ISSUE_FIELDS)
        for issue in issues:
            key = issue["key"]
            fields = issue["fields"]
            histories = client.get_full_changelog(key)
            all_records.append(compute_card_metrics(key, fields, histories, mes_lote=month))
    return all_records


def _build_excel_path(months):
    records = _fetch_all_records(months)
    wb = build_workbook(records, months)
    tmp_path = os.path.join(tempfile.gettempdir(), f"dapl_{'_'.join(months)}.xlsx")
    wb.save(tmp_path)
    return tmp_path


@app.route("/health")
def health():
    return jsonify({"status": "ok", "jira_configured": bool(config.JIRA_API_TOKEN)})


@app.route("/")
@app.route("/api")
@app.route("/api/")
def dashboard():
    try:
        excel_path = _build_excel_path(DEFAULT_MONTHS)
        html_path = os.path.join(tempfile.gettempdir(), "dapl_dashboard.html")
        build_dashboard(excel_path, html_path)
        with open(html_path, encoding="utf-8") as f:
            html = f.read()
        return Response(html, mimetype="text/html")
    except Exception as e:
        return Response(
            f"<pre>Erro ao gerar o dashboard:\n\n{e}\n\n{traceback.format_exc()}</pre>",
            status=500, mimetype="text/html",
        )


@app.route("/excel")
@app.route("/api/excel")
def excel():
    try:
        excel_path = _build_excel_path(DEFAULT_MONTHS)
        with open(excel_path, "rb") as f:
            data = f.read()
        return Response(
            data,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=Indicadores_DAPL_Consolidado.xlsx"},
        )
    except Exception as e:
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


# Vercel's Python runtime looks for this "app" variable.
if __name__ == "__main__":
    app.run(debug=True, port=5000)
