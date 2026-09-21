"""
Cliente HTTP direto para a API REST do Jira Cloud (v3), sem depender de
nenhuma ferramenta MCP. Usa autenticação básica com e-mail + API token
(https://id.atlassian.com/manage-profile/security/api-tokens).

IMPORTANTE: o changelog é paginado (100 itens por página). O bug que
encontramos no processamento manual — cards com Refinamento "incompleto"
porque a página só trazia os 100 eventos mais recentes — é corrigido aqui
com paginação completa (get_full_changelog).
"""
import time
import requests
from requests.auth import HTTPBasicAuth

from . import config


class JiraClient:
    def __init__(self, base_url=None, email=None, api_token=None):
        self.base_url = (base_url or config.JIRA_BASE_URL).rstrip("/")
        self.auth = HTTPBasicAuth(email or config.JIRA_EMAIL, api_token or config.JIRA_API_TOKEN)
        self.session = requests.Session()
        self.session.auth = self.auth
        self.session.headers.update({"Accept": "application/json"})

    def _get(self, path, params=None, retries=3):
        url = f"{self.base_url}{path}"
        for attempt in range(retries):
            resp = self.session.get(url, params=params, timeout=30)
            if resp.status_code == 429:  # rate limited
                wait = int(resp.headers.get("Retry-After", 5))
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()

    def search_issues(self, jql, fields=None, max_results=100):
        """Busca issues via JQL, paginando automaticamente até trazer todos os resultados."""
        fields = fields or ["summary", "status", "assignee", "labels", "components", "issuelinks", "subtasks", "parent"]
        all_issues = []
        next_page_token = None
        while True:
            params = {
                "jql": jql,
                "fields": ",".join(fields),
                "maxResults": max_results,
            }
            if next_page_token:
                params["nextPageToken"] = next_page_token
            data = self._get("/rest/api/3/search/jql", params=params)
            issues = data.get("issues", [])
            all_issues.extend(issues)
            next_page_token = data.get("nextPageToken")
            if not next_page_token or not issues:
                break
        return all_issues

    def get_full_changelog(self, issue_key):
        """
        Busca TODO o changelog de uma issue, paginando com startAt até esgotar.
        Corrige a limitação de 100 itens que causou o problema de "changelog
        incompleto" no processamento manual de alguns cards.
        """
        histories = []
        start_at = 0
        page_size = 100
        while True:
            data = self._get(
                f"/rest/api/3/issue/{issue_key}/changelog",
                params={"startAt": start_at, "maxResults": page_size},
            )
            batch = data.get("values", [])
            histories.extend(batch)
            total = data.get("total", len(histories))
            start_at += len(batch)
            if start_at >= total or not batch:
                break
        return histories

    def get_issue(self, issue_key, fields=None):
        fields = fields or ["summary", "status", "assignee", "labels", "components", "issuelinks", "subtasks", "parent"]
        return self._get(f"/rest/api/3/issue/{issue_key}", params={"fields": ",".join(fields)})
