const state = { path: "", files: [], dialogMode: "folder", selected: null };
const $ = selector => document.querySelector(selector);
const list = $("#file-list");
const empty = $("#empty");
const toast = $("#toast");

const folderSvg = `<svg viewBox="0 0 24 24"><path d="M3 6.5h7l2 2h9v10H3z"/></svg>`;
const fileSvg = `<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v5h5"/></svg>`;

function escapeHtml(value) { return value.replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[c]); }
function prettySize(bytes) {
  if (bytes == null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toLocaleString("pt-BR", { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}
function prettyDate(value) { return new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(new Date(value)); }
function extension(name) { const part = name.includes(".") ? name.split(".").pop() : "arq"; return part.slice(0,4); }
function joinPath(name) { return [state.path, name].filter(Boolean).join("/"); }

async function api(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Não foi possível concluir"); }
  return response.status === 204 ? null : response.json();
}

async function load(path = state.path) {
  try {
    const data = await api(`/api/files?path=${encodeURIComponent(path)}`);
    state.path = data.path; state.files = data.files;
    render();
  } catch (error) { showToast(error.message, true); }
}

function render() {
  renderBreadcrumbs();
  empty.hidden = state.files.length > 0;
  list.hidden = !state.files.length;
  const folders = state.files.filter(item => item.type === "folder").length;
  const files = state.files.length - folders;
  $("#summary").textContent = state.files.length ? `${files} ${files === 1 ? "arquivo" : "arquivos"} e ${folders} ${folders === 1 ? "pasta" : "pastas"} neste espaço.` : "Um espaço simples para tudo que importa.";
  list.innerHTML = state.files.map((item, index) => `
    <article class="file-row" data-index="${index}">
      <button class="file-name" data-open title="Abrir ${escapeHtml(item.name)}">
        <span class="file-icon ${item.type}">${item.type === "folder" ? folderSvg : escapeHtml(extension(item.name))}</span>
        <strong>${escapeHtml(item.name)}</strong>
      </button>
      <span class="file-size">${prettySize(item.size)}</span>
      <span class="file-date">${prettyDate(item.modified)}</span>
      <div class="more"><button data-menu aria-label="Opções">•••</button><div class="menu">
        ${item.type === "file" ? `<a href="/download?path=${encodeURIComponent(item.path)}">Baixar</a>` : ""}
        <button data-rename>Renomear</button><button data-delete class="danger">Excluir</button>
      </div></div>
    </article>`).join("");
}

function renderBreadcrumbs() {
  const parts = state.path ? state.path.split("/") : [];
  const crumbs = [{ name:"Início", path:"" }, ...parts.map((name, i) => ({ name, path:parts.slice(0,i+1).join("/") }))];
  $("#breadcrumbs").innerHTML = crumbs.map((crumb, i) => `${i ? "<i>›</i>" : ""}<button data-path="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</button>`).join("");
}

function openDialog(mode, item = null) {
  state.dialogMode = mode; state.selected = item;
  const isFolder = mode === "folder";
  $("#dialog-title").textContent = isFolder ? "Nova pasta" : "Renomear item";
  $("#dialog-copy").textContent = isFolder ? "Dê um nome para organizar seus arquivos." : "Escolha um novo nome para este item.";
  $("#dialog-confirm").textContent = isFolder ? "Criar" : "Salvar";
  $("#dialog-icon").textContent = isFolder ? "＋" : "✎";
  $("#name-input").value = item?.name || "";
  $("#name-dialog").showModal();
  setTimeout(() => $("#name-input").select(), 30);
}

async function submitDialog(event) {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const name = $("#name-input").value.trim();
  if (!name) return;
  try {
    if (state.dialogMode === "folder") await api("/api/folders", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ path:state.path, name }) });
    else await api("/api/entries", { method:"PATCH", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ path:state.selected.path, newName:name }) });
    $("#name-dialog").close(); await load(); showToast(state.dialogMode === "folder" ? "Pasta criada" : "Item renomeado");
  } catch (error) { showToast(error.message, true); }
}

async function removeItem(item) {
  if (!confirm(`Excluir “${item.name}”${item.type === "folder" ? " e todo o seu conteúdo" : ""}?`)) return;
  try { await api(`/api/entries?path=${encodeURIComponent(item.path)}`, { method:"DELETE" }); await load(); showToast("Item excluído"); }
  catch (error) { showToast(error.message, true); }
}

async function upload(files) {
  if (!files.length) return;
  const tray = $("#upload-tray"); tray.hidden = false;
  let done = 0;
  try {
    for (const file of files) {
      $("#upload-title").textContent = `Enviando ${file.name}`;
      $("#upload-detail").textContent = `${done + 1} de ${files.length}`;
      $("#progress-bar").style.width = `${done / files.length * 100}%`;
      await api(`/api/files?path=${encodeURIComponent(joinPath(file.name))}`, { method:"PUT", headers:{ "Content-Type":file.type || "application/octet-stream" }, body:file });
      done++;
      $("#progress-bar").style.width = `${done / files.length * 100}%`;
    }
    await load(); showToast(`${done} ${done === 1 ? "arquivo enviado" : "arquivos enviados"}`);
  } catch (error) { showToast(error.message, true); }
  finally { setTimeout(() => { tray.hidden = true; }, 600); $("#file-input").value = ""; }
}

let toastTimer;
function showToast(message, error = false) {
  clearTimeout(toastTimer); toast.textContent = message; toast.classList.toggle("error", error); toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
}

$("#new-folder").addEventListener("click", () => openDialog("folder"));
$("#name-dialog form").addEventListener("submit", submitDialog);
document.querySelectorAll("[data-coming-soon]").forEach(button => button.addEventListener("click", () => {
  const tool = button.dataset.comingSoon;
  $("#coming-title").textContent = `${tool} — em breve`;
  $("#coming-copy").textContent = tool === "IDE"
    ? "Uma IDE integrada ao LocalCloud está nos planos. Por enquanto, este é só um gostinho do que vem aí."
    : "Um terminal PowerShell integrado ao LocalCloud chegará em uma próxima versão. Por enquanto, este botão é apenas uma prévia.";
  $("#coming-dialog").showModal();
}));
$("#file-input").addEventListener("change", event => upload([...event.target.files]));
$("#breadcrumbs").addEventListener("click", event => { const button = event.target.closest("button[data-path]"); if (button) load(button.dataset.path); });
list.addEventListener("click", event => {
  const row = event.target.closest(".file-row"); if (!row) return;
  const item = state.files[Number(row.dataset.index)];
  if (event.target.closest("[data-open]")) item.type === "folder" ? load(item.path) : location.assign(`/download?path=${encodeURIComponent(item.path)}`);
  else if (event.target.closest("[data-menu]")) { document.querySelectorAll(".menu.open").forEach(menu => { if (menu !== row.querySelector(".menu")) menu.classList.remove("open"); }); row.querySelector(".menu").classList.toggle("open"); }
  else if (event.target.closest("[data-rename]")) openDialog("rename", item);
  else if (event.target.closest("[data-delete]")) removeItem(item);
});
document.addEventListener("click", event => { if (!event.target.closest(".more")) document.querySelectorAll(".menu.open").forEach(menu => menu.classList.remove("open")); });

let dragDepth = 0;
document.addEventListener("dragenter", event => { event.preventDefault(); dragDepth++; $("#dropzone").classList.add("visible"); });
document.addEventListener("dragover", event => event.preventDefault());
document.addEventListener("dragleave", event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $("#dropzone").classList.remove("visible"); } });
document.addEventListener("drop", event => { event.preventDefault(); dragDepth = 0; $("#dropzone").classList.remove("visible"); upload([...event.dataTransfer.files]); });

load();
