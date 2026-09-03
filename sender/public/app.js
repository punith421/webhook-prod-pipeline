  const targetUrl = document.getElementById("targetUrl");
  const replyBaseUrl = document.getElementById("replyBaseUrl");
  const countInput = document.getElementById("count");
  const concurrencyInput = document.getElementById("concurrency");
  const sendBtn = document.getElementById("sendBtn");
  const sentLane = document.getElementById("sentLane");
  const replyLane = document.getElementById("replyLane");
  const statSent = document.getElementById("statSent");
  const statReplies = document.getElementById("statReplies");
  const statElapsed = document.getElementById("statElapsed");
  const statStatus = document.getElementById("statStatus");
  const connDot = document.getElementById("connDot");
  const connLabel = document.getElementById("connLabel");
  const signBadge = document.getElementById("signBadge");

  replyBaseUrl.value = location.origin;
  fetch("/config").then(r => r.json()).then(cfg => {
    if (cfg.defaultReceiverWebhookUrl) targetUrl.value = cfg.defaultReceiverWebhookUrl;
    signBadge.textContent = "signing: " + (cfg.signingEnabled ? "ON" : "OFF");
    if (cfg.signingEnabled) signBadge.classList.add("on");
  }).catch(() => {});

  let sent = 0, replies = 0, startedAt = 0, timer = null;
  function addRow(container, cls, html) {
    if (container.querySelector(".empty")) container.innerHTML = "";
    const row = document.createElement("div");
    row.className = "row " + cls;
    row.innerHTML = html;
    container.prepend(row);
    while (container.children.length > 150) container.removeChild(container.lastChild);
  }
  function resetLanes() {
    sentLane.innerHTML = ""; replyLane.innerHTML = "";
    sent = 0; replies = 0;
    statSent.textContent = "0"; statReplies.textContent = "0"; statElapsed.textContent = "0 ms";
  }
  function startTimer() { clearInterval(timer); timer = setInterval(() => { statElapsed.textContent = (Date.now() - startedAt) + " ms"; }, 40); }
  function stopTimer() { clearInterval(timer); }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => { connDot.classList.add("live"); connLabel.textContent = "live"; };
    ws.onclose = () => { connDot.classList.remove("live"); connLabel.textContent = "disconnected — retrying…"; setTimeout(connect, 1500); };
    ws.onerror = () => ws.close();
    ws.onmessage = (evt) => {
      const e = JSON.parse(evt.data);
      if (e.type === "batch:start") { resetLanes(); startedAt = Date.now(); startTimer(); statStatus.textContent = "sending"; }
      else if (e.type === "sent") { sent = e.sent; statSent.textContent = sent; addRow(sentLane, "ok", `<span class="id">#${e.id}</span><span class="txt">POSTed (HTTP ${e.httpStatus})</span>`); }
      else if (e.type === "send-failed") { sent = e.sent; statSent.textContent = sent; addRow(sentLane, "err", `<span class="id">#${e.id}</span><span class="txt">send failed: ${e.error}</span>`); }
      else if (e.type === "batch:sent-complete") { statStatus.textContent = "waiting for replies"; }
      else if (e.type === "reply-received") {
        replies++; statReplies.textContent = replies;
        addRow(replyLane, "ok", `<span class="id">#${e.id}</span><span class="txt">${e.reply}</span><span class="ms">${e.tookMs}ms</span>`);
        if (replies >= sent && sent > 0) { stopTimer(); statStatus.textContent = "complete"; }
      }
    };
  }
  connect();

  sendBtn.addEventListener("click", async () => {
    sendBtn.disabled = true;
    statStatus.textContent = "starting…";
    try {
      await fetch("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: targetUrl.value,
          replyBaseUrl: replyBaseUrl.value,
          count: Math.max(1, Math.min(1000, Number(countInput.value) || 100)),
          concurrency: Math.max(1, Math.min(200, Number(concurrencyInput.value) || 30)),
        }),
      });
    } catch (e) { statStatus.textContent = "error"; }
    finally { sendBtn.disabled = false; }
  });
