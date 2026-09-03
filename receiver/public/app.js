  document.getElementById("epUrl").textContent = location.origin + "/webhook";
  const incoming = document.getElementById("incoming");
  const jobs = document.getElementById("jobs");
  const connDot = document.getElementById("connDot");
  const connLabel = document.getElementById("connLabel");
  const statReceived = document.getElementById("statReceived");
  const statDup = document.getElementById("statDup");
  const statCompleted = document.getElementById("statCompleted");
  const statFailed = document.getElementById("statFailed");
  let completed = 0, failed = 0;

  function addRow(container, cls, html) {
    if (container.querySelector(".empty")) container.innerHTML = "";
    const row = document.createElement("div");
    row.className = "row " + cls;
    row.innerHTML = html;
    container.prepend(row);
    while (container.children.length > 150) container.removeChild(container.lastChild);
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => { connDot.classList.add("live"); connLabel.textContent = "live"; };
    ws.onclose = () => { connDot.classList.remove("live"); connLabel.textContent = "disconnected — retrying…"; setTimeout(connect, 1500); };
    ws.onerror = () => ws.close();
    ws.onmessage = (evt) => {
      const e = JSON.parse(evt.data);
      if (e.type === "received") {
        statReceived.textContent = e.totalReceived;
        addRow(incoming, "", `<span class="id">#${e.id}</span><span class="txt">${e.text} accepted, queued</span>`);
      } else if (e.type === "duplicate") {
        statDup.textContent = e.totalDuplicates;
        addRow(incoming, "warn", `<span class="id">#${e.id}</span><span class="txt">duplicate delivery ignored</span>`);
      } else if (e.type === "job:active") {
        addRow(jobs, "", `<span class="id">job ${e.jobId}</span><span class="txt">picked up by a worker…</span>`);
      } else if (e.type === "job:completed") {
        completed++; statCompleted.textContent = completed;
        addRow(jobs, "ok", `<span class="id">job ${e.jobId}</span><span class="txt">${e.result?.reply || "done"}</span><span class="ms">${e.result?.tookMs ?? ""}${e.result?.tookMs ? "ms" : ""}</span>`);
      } else if (e.type === "job:failed") {
        failed++; statFailed.textContent = failed;
        addRow(jobs, "err", `<span class="id">job ${e.jobId}</span><span class="txt">FAILED: ${e.error}</span>`);
      }
    };
  }
  connect();
