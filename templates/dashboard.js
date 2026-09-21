
const RAW = JSON.parse(document.getElementById('payload-data').textContent);
const records = RAW.records;
const kpiSheet = RAW.kpi; // kept for reference; KPI values are now computed directly from records below

const MONTH_ORDER = ["MAIO","JUNHO","JULHO","AGOSTO"];
const MONTH_LABEL = {GERAL:"Geral", MAIO:"Maio", JUNHO:"Junho", JULHO:"Julho", AGOSTO:"Agosto"};
const ACCENTS = {GERAL:"#8fb3ff", MAIO:"#5eead4", JUNHO:"#f5b562", JULHO:"#b3a4f0", AGOSTO:"#f28b82"};

// which months actually have data, plus a synthetic "GERAL" (all months combined) as the first tab
const realMonths = MONTH_ORDER.filter(m => records.some(r => (r["Mês de Referência"]||"").toUpperCase() === m));
const monthsPresent = ["GERAL", ...realMonths];

let currentMonth = "GERAL";
let selectedKpi = "total";
let sortState = {col: "Chave da item", dir: 1};
let ownerSortState = {col: "total", dir: -1};
let viewMode = "cards"; // "cards" | "owner"
let ownerFilter = null; // when set (by clicking an owner row), narrows the "Por card" table

// ---------- helpers ----------
function fmtPct(v){
  if (v === null || v === undefined || v === "" || isNaN(v)) return "—";
  return (v*100).toLocaleString('pt-BR', {maximumFractionDigits:1}) + "%";
}
function fmtNum(v, decimals){
  if (v === null || v === undefined || v === "" || isNaN(v)) return "—";
  return Number(v).toLocaleString('pt-BR', {maximumFractionDigits: decimals ?? 1, minimumFractionDigits:0});
}
function statusBadgeClass(s){
  if (!s) return "";
  const n = s.toLowerCase();
  if (n.includes("aceit")) return "b-aceito";
  if (n.includes("andamento")) return "b-andamento";
  if (n.includes("conclu")) return "b-concluido";
  return "";
}
function recordsForMonth(m){
  if (m === "GERAL") return records.slice();
  return records.filter(r => (r["Mês de Referência"]||"").toUpperCase() === m);
}
// Cards whose Refinamento actually ended in month m (used for "Tempo para insight",
// since a card's Mês de Referência and the month its Refinamento closed can differ).
function recordsByFimRefinamento(m){
  if (m === "GERAL") return records.slice();
  return records.filter(r => (r["Mês Fim Refinamento"]||"").toUpperCase() === m);
}
function avgNumeric(recs, field){
  const vals = recs.map(r => r[field]).filter(v => typeof v === "number" && !isNaN(v));
  if (!vals.length) return "Sem dados";
  return vals.reduce((a,b)=>a+b,0) / vals.length;
}
function pctFlag(recs, field){
  if (!recs.length) return 0;
  const n = recs.filter(r => Number(r[field]) === 1).length;
  return n / recs.length;
}
// Core KPI computation over an arbitrary pair of record sets — reused both for
// month-scoped KPIs and for per-owner KPIs (recsRef/recsFim pre-filtered by caller).
function computeKpi(name, recsRef, recsFim){
  switch(name){
    case "Total de Demandas": return recsRef.length;
    case "% Novo Produto": return pctFlag(recsRef, "Flag Novo Produto de Dados");
    case "% Evolução Produto": return pctFlag(recsRef, "Flag Evolução");
    case "% Engenharia de Dados": return pctFlag(recsRef, "Flag Engenharia (DENA)");
    case "% Plataforma": return pctFlag(recsRef, "Flag Plataforma (DDPL)");
    case "% DataViz": return pctFlag(recsRef, "Flag DataViz (DCOD)");
    case "% Governança": return pctFlag(recsRef, "Flag Governança (DGOD)");
    case "Tempo para insight (méd. dias em Refinamento)": {
      const recsFimNovo = recsFim.filter(r => Number(r["Flag Novo Produto de Dados"]) === 1);
      return avgNumeric(recsFimNovo, "Tempo em Refinamento (dias)");
    }
    case "Time to Market (dias corridos, Refinamento até Aceito)": {
      const recsRefNovo = recsRef.filter(r => Number(r["Flag Novo Produto de Dados"]) === 1);
      return avgNumeric(recsRefNovo, "Time to Market (dias corridos)");
    }
    case "Tempo em Homologação (dias, Concluído até Aceito)": return avgNumeric(recsRef, "Tempo em Homologação (dias)");
    case "% Novos Produtos entregues dentro do TTM previsto (por classificação P/M/G)": {
      const elig = recsRef.filter(r => r["Elegível TTM Previsto?"] === "Sim");
      if (!elig.length) return "Sem dados";
      const noPrazo = elig.filter(r => r["Dentro do Prazo?"] === "Sim").length;
      return noPrazo / elig.length;
    }
    default: return null;
  }
}
// Computes every KPI directly from the raw records, for any month OR the "GERAL" aggregate.
function kpiValueForMonth(name, m){
  const recsRef = recordsForMonth(m);       // filtered by Mês de Referência (or all, for GERAL)
  const recsFim = recordsByFimRefinamento(m); // filtered by Mês Fim Refinamento (or all, for GERAL)
  return computeKpi(name, recsRef, recsFim);
}

// ---------- month tabs ----------
function buildMonthTabs(){
  const el = document.getElementById('monthTabs');
  el.innerHTML = "";
  monthsPresent.forEach(m => {
    const b = document.createElement('button');
    b.textContent = MONTH_LABEL[m];
    if (m === currentMonth) b.classList.add('active');
    b.addEventListener('click', () => { currentMonth = m; render(); });
    el.appendChild(b);
  });
}

// ---------- KPI cards ----------
const KPI_DEFS = [
  {id:"total", label:"Total de demandas", kind:"count", source:"Total de Demandas",
    concept:"Contagem de todos os cards com Mês de Referência igual ao mês selecionado — o volume bruto de demandas atendidas pela área no período."},
  {id:"novo", label:"% Novo Produto de Dados", kind:"pct", source:"% Novo Produto",
    concept:"Participação de cards com a label NOVO_PRODUTO_DADO sobre o total de demandas do mês — mede quanto do esforço foi criação de produto novo, e não manutenção/evolução."},
  {id:"evolucao", label:"% Evolução Produto", kind:"pct", source:"% Evolução Produto",
    concept:"Participação de cards com a label EVOLUÇÃO sobre o total de demandas do mês — mede quanto do esforço foi evolução de produtos já existentes."},
  {id:"engenharia", label:"% Engenharia de Dados (DENA)", kind:"pct", source:"% Engenharia de Dados",
    concept:"Participação de demandas com pelo menos um card vinculado (link, subtask ou parent) ao board DENA — indica o quanto do trabalho dependeu do time de Engenharia de Dados."},
  {id:"plataforma", label:"% Plataforma (DDPL)", kind:"pct", source:"% Plataforma",
    concept:"Participação de demandas com pelo menos um card vinculado ao board DDPL — indica o quanto do trabalho dependeu do time de Plataforma."},
  {id:"dataviz", label:"% DataViz (DCOD)", kind:"pct", source:"% DataViz",
    concept:"Participação de demandas com pelo menos um card vinculado ao board DCOD — indica o quanto do trabalho dependeu do time de DataViz."},
  {id:"governanca", label:"% Governança (DGOD)", kind:"pct", source:"% Governança",
    concept:"Participação de demandas com pelo menos um card vinculado ao board DGOD — indica o quanto do trabalho dependeu do time de Governança."},
  {id:"insight", label:"Tempo p/ insight — Novo Produto (dias em Refinamento)", kind:"days", source:"Tempo para insight (méd. dias em Refinamento)",
    concept:"Média de dias corridos que os cards de Novo Produto de Dados (label NOVO_PRODUTO_DADO) passaram no status Refinamento, contado no mês em que o card SAIU do Refinamento (coluna Mês Fim Refinamento) — mede a velocidade de amadurecer uma ideia de produto novo até ela virar trabalho executável."},
  {id:"ttm", label:"Time to Market — Novo Produto (dias corridos)", kind:"days", source:"Time to Market (dias corridos, Refinamento até Aceito)",
    concept:"Média de dias corridos entre a entrada em Refinamento e a mudança de status para Aceito, apenas para cards de Novo Produto de Dados — mede quanto tempo leva do início do refinamento até a entrega final de um produto novo."},
  {id:"homolog", label:"Tempo em Homologação (dias)", kind:"days", source:"Tempo em Homologação (dias, Concluído até Aceito)",
    concept:"Média de dias corridos entre a mudança de status para Concluído e a mudança para Aceito, para todos os cards — mede quanto tempo o time de negócio leva para validar e aceitar uma entrega já concluída."},
  {id:"ttm_prazo", label:"% Novos Produtos dentro do TTM previsto (P/M/G)", kind:"pct", source:"% Novos Produtos entregues dentro do TTM previsto (por classificação P/M/G)",
    concept:"Entre os novos produtos de dados já Aceitos e classificados por tamanho (P: até 3 sprints/42 dias, M: até 4 sprints/56 dias, G: até 6 sprints/84 dias — size-PP e size-Epic ficam fora do cálculo), o percentual cujo prazo líquido (Data de Entrega − Data de Início − Tempo de Bloqueio Externo) ficou dentro do limite da sua classificação."},
];

function monthIndex(m){ return monthsPresent.indexOf(m); }

function buildKpiGrid(){
  const el = document.getElementById('kpiGrid');
  el.innerHTML = "";
  KPI_DEFS.forEach(def => {
    const val = kpiValueForMonth(def.source, currentMonth);
    const card = document.createElement('div');
    card.className = "kpi-card" + (selectedKpi === def.id ? " selected" : "");
    card.dataset.kpi = def.id;

    let display;
    let isDim = false;
    if (val === null || val === undefined || val === "Sem dados"){
      display = val === "Sem dados" ? "Sem dados" : "—";
      isDim = true;
    } else if (def.kind === "pct"){
      display = fmtPct(val);
    } else if (def.kind === "days"){
      display = fmtNum(val, 1) + " d";
    } else {
      display = fmtNum(val, 0);
    }

    // delta vs previous real month (no delta for the "Geral" aggregate)
    let deltaHtml = "";
    const realIdx = realMonths.indexOf(currentMonth);
    if (currentMonth !== "GERAL" && realIdx > 0){
      const prevMonth = realMonths[realIdx-1];
      const prevVal = kpiValueForMonth(def.source, prevMonth);
      if (typeof val === "number" && typeof prevVal === "number"){
        const diff = val - prevVal;
        let cls = "flat", sign = "";
        if (Math.abs(diff) > 1e-9){
          cls = diff > 0 ? "up" : "down";
          sign = diff > 0 ? "▲" : "▼";
        }
        let diffDisp = def.kind === "pct" ? fmtPct(Math.abs(diff)) : fmtNum(Math.abs(diff),1);
        deltaHtml = `<div class="delta ${cls}">${sign ? sign + " " : "· "}${diffDisp} vs ${MONTH_LABEL[prevMonth]}</div>`;
      }
    }

    card.innerHTML = `
      <div class="label">${def.label}</div>
      <div class="value${isDim ? ' dim' : ''}">${display}</div>
      ${deltaHtml}
    `;
    card.addEventListener('click', () => { selectedKpi = def.id; render(); });
    el.appendChild(card);
  });
}

// ---------- trend chart ----------
let trendChartInstance = null;
function buildTrendChart(){
  const ctx = document.getElementById('trendChart');
  const labels = realMonths.map(m => MONTH_LABEL[m]);
  const data = realMonths.map(m => kpiValueForMonth("Total de Demandas", m) || 0);
  const bg = realMonths.map(m => m === currentMonth ? ACCENTS[m] : "#2a3752");

  if (trendChartInstance) trendChartInstance.destroy();
  trendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: bg,
        borderRadius: 6,
        maxBarThickness: 64,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display:false }, tooltip:{
        callbacks:{ label: (c) => ' ' + c.raw + ' demandas' }
      }},
      scales: {
        x: { grid:{ display:false }, ticks:{ color: getComputedStyle(document.body).getPropertyValue('--text-dim'), font:{family:"IBM Plex Mono", size:11} } },
        y: { beginAtZero:true, grid:{ color: 'rgba(128,128,128,.12)' }, ticks:{ color: getComputedStyle(document.body).getPropertyValue('--text-faint'), font:{family:"IBM Plex Mono", size:10}, precision:0 } }
      },
      onClick: (evt, els) => {
        if (els.length){ currentMonth = realMonths[els[0].index]; render(); }
      }
    }
  });
}

// ---------- team mix ----------
const TEAM_FLAGS = [
  {flag:"Flag Engenharia (DENA)", label:"Engenharia (DENA)", color:"#5eead4"},
  {flag:"Flag Plataforma (DDPL)", label:"Plataforma (DDPL)", color:"#f5b562"},
  {flag:"Flag DataViz (DCOD)", label:"DataViz (DCOD)", color:"#b3a4f0"},
  {flag:"Flag Governança (DGOD)", label:"Governança (DGOD)", color:"#f28b82"},
];
function buildMix(){
  const recs = recordsForMonth(currentMonth);
  const el = document.getElementById('mixList');
  const scopeTxt = currentMonth === "GERAL" ? "no período completo (todos os meses)" : `em ${MONTH_LABEL[currentMonth]}`;
  document.getElementById('mixSub').textContent = `${recs.length} demanda(s) ${scopeTxt} — participação por time.`;
  el.innerHTML = "";
  TEAM_FLAGS.forEach(t => {
    const n = recs.filter(r => Number(r[t.flag]) === 1).length;
    const pct = recs.length ? (n / recs.length * 100) : 0;
    const row = document.createElement('div');
    row.className = "mini-row";
    row.innerHTML = `
      <span class="name"><span class="dot" style="background:${t.color}"></span>${t.label}</span>
      <span class="num">${n} · ${pct.toLocaleString('pt-BR',{maximumFractionDigits:0})}%</span>
    `;
    el.appendChild(row);
  });
  const novo = recs.filter(r => Number(r["Flag Novo Produto de Dados"]) === 1).length;
  const evo = recs.filter(r => Number(r["Flag Evolução"]) === 1).length;
  [["Novo Produto de Dados", novo, "#5eead4"], ["Evolução", evo, "#93a2bd"]].forEach(([label,n,color]) => {
    const pct = recs.length ? (n/recs.length*100) : 0;
    const row = document.createElement('div');
    row.className = "mini-row";
    row.innerHTML = `
      <span class="name"><span class="dot" style="background:${color}"></span>${label}</span>
      <span class="num">${n} · ${pct.toLocaleString('pt-BR',{maximumFractionDigits:0})}%</span>
    `;
    el.appendChild(row);
  });
}

// ---------- table ----------
const TABLE_COLS = [
  {key:"Chave da item", label:"Chave", type:"key"},
  {key:"Tipo de item", label:"Tipo", type:"text"},
  {key:"Resumo", label:"Resumo", type:"text-wide"},
  {key:"Status", label:"Status", type:"status"},
  {key:"Responsável", label:"Responsável", type:"text"},
  {key:"__flags", label:"Times / Categoria", type:"flags"},
  {key:"Tempo em Refinamento (dias)", label:"Refin. (d)", type:"num1"},
  {key:"Time to Market (dias corridos)", label:"TTM (d)", type:"num1"},
  {key:"Tempo em Homologação (dias)", label:"Homolog. (d)", type:"num1"},
  {key:"Mês Fim Refinamento", label:"Fim Refin.", type:"text"},
];

function populateStatusFilter(){
  const sel = document.getElementById('fStatus');
  const cur = sel.value;
  const statuses = Array.from(new Set(records.map(r => r["Status"]).filter(Boolean))).sort();
  sel.innerHTML = '<option value="">Todos os status</option>' + statuses.map(s => `<option value="${s}">${s}</option>`).join("");
  sel.value = cur;
}

function getFiltered(){
  let recs = recordsForMonth(currentMonth);
  const team = document.getElementById('fTeam').value;
  const status = document.getElementById('fStatus').value;
  const cat = document.getElementById('fCategoria').value;
  const search = document.getElementById('fSearch').value.trim().toLowerCase();

  if (ownerFilter){
    recs = recs.filter(r => r["Responsável"] === ownerFilter);
  }
  if (team){
    const flagKey = {DENA:"Flag Engenharia (DENA)", DDPL:"Flag Plataforma (DDPL)", DCOD:"Flag DataViz (DCOD)", DGOD:"Flag Governança (DGOD)"}[team];
    recs = recs.filter(r => Number(r[flagKey]) === 1);
  }
  if (status){
    recs = recs.filter(r => r["Status"] === status);
  }
  if (cat === "NOVO"){
    recs = recs.filter(r => Number(r["Flag Novo Produto de Dados"]) === 1);
  } else if (cat === "EVOLUCAO"){
    recs = recs.filter(r => Number(r["Flag Evolução"]) === 1);
  }
  if (search){
    recs = recs.filter(r =>
      (r["Chave da item"]||"").toLowerCase().includes(search) ||
      (r["Resumo"]||"").toLowerCase().includes(search) ||
      (r["Responsável"]||"").toLowerCase().includes(search)
    );
  }

  // KPI-driven pre-filter (clicking a KPI card narrows the table)
  if (selectedKpi === "novo") recs = recs.filter(r => Number(r["Flag Novo Produto de Dados"]) === 1);
  if (selectedKpi === "evolucao") recs = recs.filter(r => Number(r["Flag Evolução"]) === 1);
  if (selectedKpi === "engenharia") recs = recs.filter(r => Number(r["Flag Engenharia (DENA)"]) === 1);
  if (selectedKpi === "plataforma") recs = recs.filter(r => Number(r["Flag Plataforma (DDPL)"]) === 1);
  if (selectedKpi === "dataviz") recs = recs.filter(r => Number(r["Flag DataViz (DCOD)"]) === 1);
  if (selectedKpi === "governanca") recs = recs.filter(r => Number(r["Flag Governança (DGOD)"]) === 1);

  recs = recs.slice().sort((a,b) => {
    let av = sortState.col === "__flags" ? "" : a[sortState.col];
    let bv = sortState.col === "__flags" ? "" : b[sortState.col];
    if (av === null || av === undefined) av = "";
    if (bv === null || bv === undefined) bv = "";
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortState.dir;
    return String(av).localeCompare(String(bv), 'pt-BR') * sortState.dir;
  });

  return recs;
}

function flagPills(r){
  const pills = [];
  if (Number(r["Flag Engenharia (DENA)"])===1) pills.push(["DENA","#5eead4"]);
  if (Number(r["Flag Plataforma (DDPL)"])===1) pills.push(["DDPL","#f5b562"]);
  if (Number(r["Flag DataViz (DCOD)"])===1) pills.push(["DCOD","#b3a4f0"]);
  if (Number(r["Flag Governança (DGOD)"])===1) pills.push(["DGOD","#f28b82"]);
  if (Number(r["Flag Novo Produto de Dados"])===1) pills.push(["Novo","#5eead4"]);
  if (Number(r["Flag Evolução"])===1) pills.push(["Evolução","#93a2bd"]);
  return pills.map(([t,c]) => `<span class="flagpill" style="border-color:${c}66;color:${c}">${t}</span>`).join("");
}

function buildTableHead(){
  const tr = document.getElementById('tableHead');
  tr.innerHTML = "";
  TABLE_COLS.forEach(col => {
    const th = document.createElement('th');
    let arrow = "";
    if (sortState.col === col.key) arrow = sortState.dir === 1 ? "↑" : "↓";
    th.innerHTML = `${col.label}${arrow ? `<span class="arrow">${arrow}</span>` : ""}`;
    if (col.key !== "__flags"){
      th.addEventListener('click', () => {
        if (sortState.col === col.key) sortState.dir *= -1;
        else { sortState.col = col.key; sortState.dir = 1; }
        renderTable();
      });
    }
    tr.appendChild(th);
  });
}

function renderTable(){
  const recs = getFiltered();
  const body = document.getElementById('tableBody');
  document.getElementById('rowCount').textContent = `${recs.length} card(s)`;
  buildTableHead();

  if (!recs.length){
    body.innerHTML = `<tr><td colspan="${TABLE_COLS.length}"><div class="empty">Nenhum card corresponde aos filtros atuais.</div></td></tr>`;
    return;
  }

  body.innerHTML = recs.map(r => {
    const cells = TABLE_COLS.map(col => {
      if (col.key === "__flags") return `<td>${flagPills(r)}</td>`;
      if (col.type === "key") return `<td class="key">${r[col.key] ?? ""}</td>`;
      if (col.type === "status"){
        const s = r[col.key] ?? "";
        return `<td><span class="badge ${statusBadgeClass(s)}">${s}</span></td>`;
      }
      if (col.type === "num1"){
        const v = r[col.key];
        if (typeof v === "number") return `<td class="num">${fmtNum(v,1)}</td>`;
        return `<td class="num warn">${v ?? "—"}</td>`;
      }
      if (col.type === "text-wide") return `<td style="max-width:320px">${r[col.key] ?? ""}</td>`;
      return `<td>${r[col.key] ?? ""}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
}

function buildTableSub(){
  const def = KPI_DEFS.find(d => d.id === selectedKpi);
  const el = document.getElementById('tableSub');
  const scopeTxt = currentMonth === "GERAL" ? "de todos os meses" : `de ${MONTH_LABEL[currentMonth]}`;
  if (selectedKpi === "total" || !def){
    el.textContent = `Todos os cards ${scopeTxt}. Clique nos cabeçalhos para ordenar.`;
  } else {
    el.textContent = `Filtrado pelo KPI selecionado: ${def.label} · ${scopeTxt}. Clique no card novamente ou em "Total de demandas" para limpar.`;
  }
}

// ---------- wire up filters ----------
["fTeam","fStatus","fCategoria"].forEach(id => document.getElementById(id).addEventListener('change', renderTable));
document.getElementById('fSearch').addEventListener('input', renderTable);

// ---------- matrix view (Geral tab) ----------
let geralView = "month"; // "month" | "owner"

function buildMatrix(){
  Array.from(document.getElementById('geralToggle').querySelectorAll('button')).forEach(b => {
    b.classList.toggle('active', b.dataset.view === geralView);
  });
  if (geralView === "owner") buildOwnerMatrix();
  else buildMonthMatrix();
}

function buildMonthMatrix(){
  document.getElementById('matrixTitle').textContent = "Indicadores mensais";
  document.getElementById('matrixSub').textContent = 'Mesma leitura da aba "KPIs Mensais" do Excel — cada indicador, lado a lado por mês.';

  const head = document.getElementById('matrixHead');
  const body = document.getElementById('matrixBody');
  head.innerHTML = `<th style="min-width:260px">Indicador</th>` + realMonths.map(m => `<th class="month-col">${MONTH_LABEL[m]}</th>`).join("");

  body.innerHTML = KPI_DEFS.map(def => {
    const cells = realMonths.map(m => {
      const val = kpiValueForMonth(def.source, m);
      return `<td class="${fmtCellClass(val)}">${fmtCellDisplay(val, def)}</td>`;
    }).join("");
    return `<tr class="row-click" data-kpi="${def.id}">
      <td class="indicator">${def.label}<span class="concept">${def.concept || ""}</span></td>
      ${cells}
    </tr>`;
  }).join("");

  Array.from(body.querySelectorAll('tr')).forEach(tr => {
    tr.addEventListener('click', () => {
      selectedKpi = tr.dataset.kpi;
      currentMonth = realMonths[realMonths.length - 1];
      render();
    });
  });
}

function fmtCellClass(val){
  if (val === null || val === undefined || val === "Sem dados") return "mval empty-val";
  return "mval";
}
function fmtCellDisplay(val, def){
  if (val === null || val === undefined || val === "Sem dados") return "Sem dados";
  if (def.kind === "pct") return fmtPct(val);
  if (def.kind === "days") return fmtNum(val,1) + " d";
  return fmtNum(val,0);
}

function buildOwnerMatrix(){
  document.getElementById('matrixTitle').textContent = "Indicadores por responsável (DPO)";
  document.getElementById('matrixSub').textContent = "Como cada responsável performa em cada indicador, considerando todos os cards dele no período completo (todos os meses).";

  const owners = Array.from(new Set(records.map(r => r["Responsável"]).filter(Boolean))).sort((a,b) => a.localeCompare(b,'pt-BR'));

  const head = document.getElementById('matrixHead');
  const body = document.getElementById('matrixBody');
  head.innerHTML = `<th style="min-width:200px">Responsável</th>` + KPI_DEFS.map(def => `<th class="month-col" title="${def.concept || ""}">${def.label}</th>`).join("");

  body.innerHTML = owners.map(owner => {
    const recs = records.filter(r => r["Responsável"] === owner);
    const cells = KPI_DEFS.map(def => {
      const val = computeKpi(def.source, recs, recs);
      return `<td class="${fmtCellClass(val)}">${fmtCellDisplay(val, def)}</td>`;
    }).join("");
    return `<tr class="row-click" data-owner="${owner.replace(/"/g,'&quot;')}"><td class="indicator">${owner}<span class="concept">${recs.length} card(s) no período</span></td>${cells}</tr>`;
  }).join("");

  Array.from(body.querySelectorAll('tr[data-owner]')).forEach(tr => {
    tr.addEventListener('click', () => {
      ownerFilter = tr.dataset.owner;
      currentMonth = realMonths[realMonths.length - 1];
      viewMode = "cards";
      render();
    });
  });
}

document.getElementById('geralToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (btn){ geralView = btn.dataset.view; buildMatrix(); }
});

// ---------- owner (DPO) view ----------
const OWNER_COLS = [
  {key:"owner", label:"Responsável"},
  {key:"total", label:"Total"},
  {key:"dena", label:"DENA"},
  {key:"ddpl", label:"DDPL"},
  {key:"dcod", label:"DCOD"},
  {key:"dgod", label:"DGOD"},
  {key:"novo", label:"% Novo"},
  {key:"evolucao", label:"% Evolução"},
  {key:"refin", label:"Refin. médio (d)"},
  {key:"ttm", label:"TTM médio (d)"},
  {key:"homolog", label:"Homolog. médio (d)"},
  {key:"ttmPrazo", label:"% Dentro TTM Prev."},
  {key:"status", label:"Status"},
];

function buildOwnerData(){
  const recs = recordsForMonth(currentMonth);
  const byOwner = {};
  recs.forEach(r => {
    const name = r["Responsável"] || "— Sem responsável —";
    if (!byOwner[name]) byOwner[name] = [];
    byOwner[name].push(r);
  });
  return Object.entries(byOwner).map(([name, list]) => {
    const refinVals = list.map(r => r["Tempo em Refinamento (dias)"]).filter(v => typeof v === "number" && !isNaN(v));
    const refin = refinVals.length ? refinVals.reduce((a,b)=>a+b,0)/refinVals.length : null;
    const ttmVal = avgNumeric(list.filter(r => Number(r["Flag Novo Produto de Dados"])===1), "Time to Market (dias corridos)");
    const homologVal = avgNumeric(list, "Tempo em Homologação (dias)");
    const eligList = list.filter(r => r["Elegível TTM Previsto?"] === "Sim");
    const ttmPrazo = eligList.length ? eligList.filter(r => r["Dentro do Prazo?"] === "Sim").length / eligList.length : null;
    const statusCounts = {};
    list.forEach(r => { const s = r["Status"] || "—"; statusCounts[s] = (statusCounts[s]||0) + 1; });
    return {
      owner: name,
      total: list.length,
      dena: list.filter(r => Number(r["Flag Engenharia (DENA)"])===1).length,
      ddpl: list.filter(r => Number(r["Flag Plataforma (DDPL)"])===1).length,
      dcod: list.filter(r => Number(r["Flag DataViz (DCOD)"])===1).length,
      dgod: list.filter(r => Number(r["Flag Governança (DGOD)"])===1).length,
      novo: pctFlag(list, "Flag Novo Produto de Dados"),
      evolucao: pctFlag(list, "Flag Evolução"),
      refin,
      ttm: typeof ttmVal === "number" ? ttmVal : null,
      homolog: typeof homologVal === "number" ? homologVal : null,
      ttmPrazo,
      statusCounts,
      records: list,
    };
  });
}

function renderOwnerTable(){
  document.getElementById('cardFilters').style.display = "none";
  const data = buildOwnerData().sort((a,b) => {
    let av = a[ownerSortState.col], bv = b[ownerSortState.col];
    if (av === null) av = -Infinity;
    if (bv === null) bv = -Infinity;
    if (typeof av === "number" && typeof bv === "number") return (av-bv) * ownerSortState.dir;
    return String(av).localeCompare(String(bv), 'pt-BR') * ownerSortState.dir;
  });

  document.getElementById('rowCount').textContent = `${data.length} responsável(is)`;

  const head = document.getElementById('tableHead');
  head.innerHTML = OWNER_COLS.map(c => {
    let arrow = ownerSortState.col === c.key ? (ownerSortState.dir === 1 ? "↑" : "↓") : "";
    return `<th data-col="${c.key}">${c.label}${arrow ? `<span class="arrow">${arrow}</span>` : ""}</th>`;
  }).join("");
  Array.from(head.querySelectorAll('th')).forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (ownerSortState.col === col) ownerSortState.dir *= -1;
      else { ownerSortState.col = col; ownerSortState.dir = col === "owner" ? 1 : -1; }
      renderOwnerTable();
    });
  });

  const body = document.getElementById('tableBody');
  if (!data.length){
    body.innerHTML = `<tr><td colspan="${OWNER_COLS.length}"><div class="empty">Nenhum dado para este recorte.</div></td></tr>`;
    return;
  }
  body.innerHTML = data.map(o => {
    const statusHtml = `<div class="status-mini">${Object.entries(o.statusCounts).map(([s,n]) => `<span>${s}: ${n}</span>`).join("")}</div>`;
    return `<tr class="row-click" data-owner="${o.owner.replace(/"/g,'&quot;')}">
      <td class="owner-name">${o.owner}</td>
      <td class="num">${o.total}</td>
      <td class="num">${o.dena || "—"}</td>
      <td class="num">${o.ddpl || "—"}</td>
      <td class="num">${o.dcod || "—"}</td>
      <td class="num">${o.dgod || "—"}</td>
      <td class="num">${fmtPct(o.novo)}</td>
      <td class="num">${fmtPct(o.evolucao)}</td>
      <td class="num">${o.refin === null ? "—" : fmtNum(o.refin,1)}</td>
      <td class="num">${o.ttm === null ? "—" : fmtNum(o.ttm,1)}</td>
      <td class="num">${o.homolog === null ? "—" : fmtNum(o.homolog,1)}</td>
      <td class="num">${o.ttmPrazo === null ? "—" : fmtPct(o.ttmPrazo)}</td>
      <td>${statusHtml}</td>
    </tr>`;
  }).join("");

  Array.from(body.querySelectorAll('tr[data-owner]')).forEach(tr => {
    tr.addEventListener('click', () => {
      ownerFilter = tr.dataset.owner;
      viewMode = "cards";
      render();
    });
  });
}

function setViewMode(mode){
  viewMode = mode;
  if (mode === "cards") ownerFilter = null;
  Array.from(document.getElementById('viewToggle').querySelectorAll('button')).forEach(b => {
    b.classList.toggle('active', b.dataset.view === mode);
  });
  renderTableArea();
}

function renderTableArea(){
  const title = document.getElementById('tableTitle');
  const sub = document.getElementById('tableSub');
  const scopeTxt = currentMonth === "GERAL" ? "de todos os meses" : `de ${MONTH_LABEL[currentMonth]}`;

  if (viewMode === "owner"){
    title.textContent = "Demandas por responsável (DPO)";
    sub.textContent = `Agregado por responsável, ${scopeTxt}. Clique num responsável para ver os cards dele. Clique nos cabeçalhos para ordenar.`;
    renderOwnerTable();
  } else {
    document.getElementById('cardFilters').style.display = "";
    title.textContent = ownerFilter ? `Cards de ${ownerFilter}` : "Cards do mês selecionado";
    if (ownerFilter){
      sub.textContent = `Filtrado por responsável: ${ownerFilter} · ${scopeTxt}. `;
      const clearBtn = document.createElement('a');
      clearBtn.href = "#"; clearBtn.textContent = "Limpar filtro de responsável";
      clearBtn.style.color = "var(--accent)"; clearBtn.style.marginLeft = "4px";
      clearBtn.addEventListener('click', (e) => { e.preventDefault(); ownerFilter = null; renderTableArea(); });
      sub.appendChild(clearBtn);
    } else {
      buildTableSub();
    }
    populateStatusFilter();
    renderTable();
  }
}

document.getElementById('viewToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (btn) setViewMode(btn.dataset.view);
});

// ---------- render ----------
function render(){
  buildMonthTabs();

  const isGeral = currentMonth === "GERAL";
  document.getElementById('matrixPanel').style.display = isGeral ? "" : "none";
  document.getElementById('monthView').style.display = isGeral ? "none" : "";

  if (isGeral){
    buildMatrix();
    return;
  }

  buildKpiGrid();
  buildTrendChart();
  buildMix();
  renderTableArea();
}

render();

