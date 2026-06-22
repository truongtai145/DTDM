const http = require("http");
const os = require("os");
const redis = require("redis");

const POD = os.hostname();

const store = redis.createClient({
  socket: { host: process.env.REDIS_HOST || "localhost", port: 6379 },
});
store.connect().catch(console.error);

function log(msg) {
  console.log(`[${new Date().toISOString()}] [${POD}] ${msg}`);
}

// Heartbeat — cho biết Pod nào đang sống (TTL 10s)
setInterval(async () => {
  try {
    await store.hSet("pod_hb", POD, Date.now().toString());
  } catch {}
}, 2000);

// Đăng ký pod-id ỔN ĐỊNH — không đổi khi Pod cũ chết / Pod mới sinh
async function getStablePodId() {
  const existing = await store.hGet("pod_ids", POD);
  if (existing) return existing;
  const n = await store.incr("pod_id_counter");
  const id = "Pod-" + n;
  await store.hSet("pod_ids", POD, id);
  return id;
}
let MY_ID = null;
getStablePodId().then((id) => {
  MY_ID = id;
  log("assigned " + id);
});

const sseClients = new Set();
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    try { c.write(msg); } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (u.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", pod: POD }));
    return;
  }

  if (u.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "connected", pod: POD, id: MY_ID })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // ── 1) LOAD BALANCING ──────────────────────────────────────────
  if (u.pathname === "/api/count" && req.method === "POST") {
    try {
      const total = await store.incr("visit_count");
      const podHits = await store.hIncrBy("pod_hits", POD, 1);
      log(`click #${total}`);
      broadcast({ type: "count", pod: POD, id: MY_ID, total, podHits });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ total, pod: POD, id: MY_ID, podHits }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── 2) SELF-HEALING: crash pod cụ thể theo ID ──────────────────
  if (u.pathname === "/api/crash" && req.method === "POST") {
    // Đọc body để lấy targetPodId
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let targetPodId = null;
      try { targetPodId = JSON.parse(body).targetPodId; } catch {}

      // Nếu crash chính pod này
      if (!targetPodId || targetPodId === MY_ID) {
        log("CRASH requested on self");
        await store.hSet("pod_dead", POD, Date.now().toString()).catch(() => {});
        await store.hIncrBy("crash_count", POD, 1).catch(() => {});
        broadcast({ type: "crash", pod: POD, id: MY_ID });
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, pod: POD, id: MY_ID }));
        setTimeout(() => process.exit(1), 300);
      } else {
        // Crash pod khác: đánh dấu dead trong Redis, broadcast sự kiện
        // Tìm hostname của targetPodId
        const ids = await store.hGetAll("pod_ids").catch(() => ({}));
        const targetHostname = Object.entries(ids || {}).find(([, v]) => v === targetPodId)?.[0];
        if (targetHostname) {
          await store.hSet("pod_dead", targetHostname, Date.now().toString()).catch(() => {});
          await store.hIncrBy("crash_count", targetHostname, 1).catch(() => {});
          // Xóa heartbeat để coi như đã chết
          await store.hDel("pod_hb", targetHostname).catch(() => {});
        }
        broadcast({ type: "crash", pod: targetHostname || targetPodId, id: targetPodId, remote: true });

        // Sau 3 giây: tạo pod mới thay thế (simulate)
        setTimeout(async () => {
          const newN = await store.incr("pod_id_counter").catch(() => 99);
          const newId = "Pod-" + newN;
          const fakeHostname = "simulated-" + newId.toLowerCase().replace("-", "");
          await store.hSet("pod_ids", fakeHostname, newId).catch(() => {});
          await store.hSet("pod_hb", fakeHostname, Date.now().toString()).catch(() => {});
          broadcast({ type: "healed", newId, newPod: fakeHostname, replacedId: targetPodId });
          log(`Self-healing: ${newId} replaces ${targetPodId}`);

          // Giữ heartbeat cho pod giả lập
          const hbInterval = setInterval(async () => {
            try { await store.hSet("pod_hb", fakeHostname, Date.now().toString()); } catch {}
          }, 2000);
          // Tự dừng sau 10 phút
          setTimeout(() => clearInterval(hbInterval), 600000);
        }, 3000);

        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, targetPodId, simulated: true }));
      }
    });
    return;
  }

  // ── 3) AUTO-SCALING: stress CPU + mô phỏng HPA scale up ────────
  if (u.pathname === "/api/stress" && req.method === "POST") {
    const sec = Math.min(parseInt(u.searchParams.get("s") || 30), 60);
    log(`stress CPU ${sec}s`);
    await store.hSet("pod_stress", POD, Date.now().toString()).catch(() => {});
    broadcast({ type: "stress_start", pod: POD, id: MY_ID, sec });
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, pod: POD, sec }));

    // Bắt đầu stress CPU
    const end = Date.now() + sec * 1000;
    const loop = () => {
      if (Date.now() < end) {
        for (let i = 0; i < 500000; i++) Math.sqrt(Math.random());
        setImmediate(loop);
      } else {
        store.hDel("pod_stress", POD).catch(() => {});
        broadcast({ type: "stress_end", pod: POD, id: MY_ID });
        log("stress done");
      }
    };
    setImmediate(loop);

    // Mô phỏng HPA scale-up: sau 5s bắt đầu thêm pod
    simulateHPAScaleUp(sec);
    return;
  }

  // ── HPA: scale down sau stress ──────────────────────────────────
  if (u.pathname === "/api/scaledown" && req.method === "POST") {
    await simulateHPAScaleDown();
    res.writeHead(200);
    res.end("{}");
    return;
  }

  // ── 4) STATE ────────────────────────────────────────────────────
  if (u.pathname === "/api/state") {
    try {
      const total = parseInt((await store.get("visit_count")) || 0);
      const allHits = (await store.hGetAll("pod_hits")) || {};
      const crashes = (await store.hGetAll("crash_count")) || {};
      const hb = (await store.hGetAll("pod_hb")) || {};
      const stress = (await store.hGetAll("pod_stress")) || {};
      const ids = (await store.hGetAll("pod_ids")) || {};
      const hpaState = JSON.parse((await store.get("hpa_state")) || "null") || { replicas: 3, phase: "idle" };
      const now = Date.now();
      const alive = Object.entries(hb)
        .filter(([, t]) => now - parseInt(t) < 8000)
        .map(([n]) => n);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ pod: POD, id: MY_ID, total, allHits, crashes, alive, stress, ids, hpaState }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── RESET ──────────────────────────────────────────────────────
  if (u.pathname === "/api/reset" && req.method === "POST") {
    // Xóa tất cả pod giả lập
    const ids = await store.hGetAll("pod_ids").catch(() => ({}));
    const hb = await store.hGetAll("pod_hb").catch(() => ({}));
    for (const hostname of Object.keys(ids || {})) {
      if (hostname.startsWith("simulated-") || hostname.startsWith("hpa-")) {
        await store.hDel("pod_ids", hostname).catch(() => {});
        await store.hDel("pod_hb", hostname).catch(() => {});
        await store.hDel("pod_hits", hostname).catch(() => {});
      }
    }
    await store.del(["visit_count","pod_hits","crash_count","pod_stress","pod_ids","pod_id_counter","hpa_state","pod_dead"]).catch(() => {});
    // Re-register current pod
    const n = await store.incr("pod_id_counter");
    const id = "Pod-" + n;
    MY_ID = id;
    await store.hSet("pod_ids", POD, id).catch(() => {});
    broadcast({ type: "reset" });
    log("reset");
    res.writeHead(200);
    res.end("{}");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML);
});

// ── Mô phỏng HPA Scale Up ──────────────────────────────────────
let hpaScaleInterval = null;
async function simulateHPAScaleUp(stressSec) {
  if (hpaScaleInterval) return; // Đang scale

  const minReplicas = 3;
  const maxReplicas = 30;
  const stepDelay = 5000; // Cứ 5s thêm vài pod
  let currentReplicas = minReplicas;

  // Lấy số pod hiện tại từ Redis
  const ids = await store.hGetAll("pod_ids").catch(() => ({}));
  const hb = await store.hGetAll("pod_hb").catch(() => ({}));
  const now = Date.now();
  const aliveCount = Object.entries(hb || {}).filter(([,t]) => now - parseInt(t) < 8000).length;
  currentReplicas = Math.max(aliveCount, minReplicas);

  await store.set("hpa_state", JSON.stringify({ replicas: currentReplicas, phase: "scaling_up", cpuPercent: 85 }));
  broadcast({ type: "hpa_update", phase: "scaling_up", replicas: currentReplicas, cpuPercent: 85 });

  hpaScaleInterval = setInterval(async () => {
    if (currentReplicas >= maxReplicas) {
      clearInterval(hpaScaleInterval);
      hpaScaleInterval = null;
      await store.set("hpa_state", JSON.stringify({ replicas: currentReplicas, phase: "max", cpuPercent: 20 }));
      broadcast({ type: "hpa_update", phase: "max", replicas: currentReplicas, cpuPercent: 20 });
      // Scale down sau 30s
      setTimeout(simulateHPAScaleDown, 30000);
      return;
    }

    // Thêm 2-5 pod mỗi bước
    const addCount = Math.min(Math.floor(Math.random() * 4) + 2, maxReplicas - currentReplicas);
    for (let i = 0; i < addCount; i++) {
      const n = await store.incr("pod_id_counter").catch(() => 99);
      const newId = "Pod-" + n;
      const fakeHost = "hpa-" + newId.toLowerCase().replace("-","");
      await store.hSet("pod_ids", fakeHost, newId).catch(() => {});
      await store.hSet("pod_hb", fakeHost, Date.now().toString()).catch(() => {});
      currentReplicas++;

      // Keep heartbeat alive
      const iv = setInterval(async () => {
        try { await store.hSet("pod_hb", fakeHost, Date.now().toString()); } catch {}
      }, 2000);
      setTimeout(() => clearInterval(iv), 600000);

      broadcast({ type: "hpa_pod_added", newId, replicas: currentReplicas, cpuPercent: Math.max(20, 85 - currentReplicas * 2) });
      log(`HPA scale-up: added ${newId}, total=${currentReplicas}`);
    }

    const cpu = Math.max(20, 85 - currentReplicas * 2);
    await store.set("hpa_state", JSON.stringify({ replicas: currentReplicas, phase: "scaling_up", cpuPercent: cpu }));
    broadcast({ type: "hpa_update", phase: "scaling_up", replicas: currentReplicas, cpuPercent: cpu });

  }, stepDelay);

  // Dừng scale sau stressSec
  setTimeout(() => {
    if (hpaScaleInterval) {
      clearInterval(hpaScaleInterval);
      hpaScaleInterval = null;
    }
    store.set("hpa_state", JSON.stringify({ replicas: currentReplicas, phase: "stabilizing", cpuPercent: 15 }));
    broadcast({ type: "hpa_update", phase: "stabilizing", replicas: currentReplicas, cpuPercent: 15 });
    setTimeout(simulateHPAScaleDown, 20000);
  }, stressSec * 1000);
}

async function simulateHPAScaleDown() {
  const minReplicas = 3;
  const ids = await store.hGetAll("pod_ids").catch(() => ({}));
  const hb = await store.hGetAll("pod_hb").catch(() => ({}));
  const now = Date.now();

  // Thu thập các pod HPA giả lập
  const hpaPods = Object.entries(ids || {})
    .filter(([host]) => host.startsWith("hpa-"))
    .map(([host, id]) => ({ host, id }));

  if (hpaPods.length === 0) return;

  // Scale down dần dần
  let removed = 0;
  const toRemove = hpaPods.length; // Giữ lại minReplicas pod thật
  broadcast({ type: "hpa_update", phase: "scaling_down", replicas: hpaPods.length + 3, cpuPercent: 10 });

  const removeInterval = setInterval(async () => {
    if (removed >= toRemove) {
      clearInterval(removeInterval);
      await store.set("hpa_state", JSON.stringify({ replicas: minReplicas, phase: "idle", cpuPercent: 5 }));
      broadcast({ type: "hpa_update", phase: "idle", replicas: minReplicas, cpuPercent: 5 });
      return;
    }

    const pod = hpaPods[removed];
    removed++;
    await store.hDel("pod_ids", pod.host).catch(() => {});
    await store.hDel("pod_hb", pod.host).catch(() => {});
    await store.hDel("pod_hits", pod.host).catch(() => {});
    const remaining = toRemove - removed + minReplicas;
    broadcast({ type: "hpa_pod_removed", removedId: pod.id, replicas: remaining, cpuPercent: 5 });
    log(`HPA scale-down: removed ${pod.id}, remaining=${remaining}`);
  }, 3000);
}

const HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kubernetes Demo</title>
<style>
:root {
  --blue:#2563eb; --blue-bg:#eff6ff; --blue-bd:#bfdbfe;
  --green:#16a34a; --green-bg:#f0fdf4; --green-bd:#bbf7d0;
  --red:#dc2626; --red-bg:#fef2f2; --red-bd:#fecaca;
  --orange:#ea580c; --orange-bg:#fff7ed; --orange-bd:#fed7aa;
  --purple:#7c3aed; --purple-bg:#f5f3ff; --purple-bd:#ddd6fe;
  --bg:#f1f5f9; --text:#1e293b; --muted:#64748b; --border:#e2e8f0;
}
*{box-sizing:border-box;}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);padding:20px;margin:0;color:var(--text);}
.container{max-width:960px;margin:0 auto;}
h2{text-align:center;margin-bottom:4px;}
.subtitle{text-align:center;color:var(--muted);font-size:.85rem;margin-bottom:20px;}

.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid var(--border);}
.card-title{font-size:.72rem;color:var(--muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:12px;}

.section-num{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:.7rem;font-weight:700;margin-right:8px;}

.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
@media(max-width:640px){.grid{grid-template-columns:1fr;}}

.btn{width:100%;padding:13px;border:none;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer;color:#fff;margin-bottom:10px;transition:opacity .15s;}
.btn:hover{opacity:.9;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn:active{transform:scale(.98);}
.btn-blue{background:var(--blue);}
.btn-red{background:var(--red);}
.btn-orange{background:var(--orange);}
.btn-gray{background:#64748b;}
.btn-purple{background:var(--purple);}

.stat{font-size:46px;font-weight:800;color:var(--blue);text-align:center;font-family:'Courier New',monospace;}

.pod-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 8px;border-radius:6px;transition:background .2s;}
.pod-row:hover{background:var(--bg);}
.pod-row.dead{opacity:.5;}
.pod-id{font-size:.72rem;width:58px;font-weight:700;flex-shrink:0;font-family:monospace;}
.bar-wrap{flex:1;height:13px;background:var(--border);border-radius:7px;overflow:hidden;}
.bar-fill{height:100%;transition:width .4s ease;border-radius:7px;}
.pod-val{font-size:.72rem;font-weight:700;width:28px;text-align:right;flex-shrink:0;}
.pod-status{font-size:.6rem;padding:1px 6px;border-radius:4px;flex-shrink:0;font-weight:600;}
.status-live{background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd);}
.status-dead{background:var(--red-bg);color:var(--red);border:1px solid var(--red-bd);}
.status-new{background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-bd);animation:pulse 1s infinite;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.5;}}

.crash-btn{padding:2px 7px;border:1px solid var(--red-bd);background:var(--red-bg);color:var(--red);border-radius:4px;font-size:.6rem;cursor:pointer;font-weight:600;flex-shrink:0;transition:all .2s;}
.crash-btn:hover{background:var(--red);color:#fff;}
.crash-btn:disabled{opacity:.4;cursor:not-allowed;}

.my-pod-box{font-size:.75rem;text-align:center;margin-top:10px;color:var(--blue);font-family:monospace;background:var(--blue-bg);padding:8px;border-radius:6px;}

#logs{background:#0f172a;color:#38bdf8;padding:12px;border-radius:8px;font-family:'Courier New',monospace;font-size:.68rem;height:140px;overflow-y:auto;line-height:1.6;}
#logs div{padding:2px 0;border-bottom:1px solid #1e293b;}

.flow{display:flex;flex-wrap:wrap;gap:5px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:14px;}
.fs{padding:3px 10px;border-radius:20px;font-size:.68rem;font-weight:500;background:#fff;border:1px solid var(--border);color:var(--muted);transition:all .3s;}
.fs.on-blue{background:var(--blue);border-color:var(--blue);color:#fff;}
.fs.on-red{background:var(--red);border-color:var(--red);color:#fff;}
.fs.on-orange{background:var(--orange);border-color:var(--orange);color:#fff;}
.fs.on-green{background:var(--green);border-color:var(--green);color:#fff;}
.fa{color:#94a3b8;font-size:.7rem;}

.yaml{background:#0f172a;color:#94a3b8;border-radius:8px;padding:10px;font-family:monospace;font-size:.68rem;line-height:1.7;overflow-x:auto;}

.notice{background:var(--orange-bg);border:1px solid var(--orange-bd);border-radius:8px;padding:10px 14px;font-size:.76rem;color:#7c2d12;line-height:1.6;margin-bottom:14px;}

.toast{position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-80px);padding:10px 20px;border-radius:8px;font-size:.82rem;font-weight:600;z-index:999;background:#fff;border:1px solid var(--border);box-shadow:0 4px 16px rgba(0,0,0,.15);transition:transform .35s cubic-bezier(.34,1.56,.64,1);white-space:nowrap;}
.toast.show{transform:translateX(-50%) translateY(0);}
.toast.blue{border-color:var(--blue-bd);color:var(--blue);}
.toast.green{border-color:var(--green-bd);color:var(--green);}
.toast.red{border-color:var(--red-bd);color:var(--red);}
.toast.orange{border-color:var(--orange-bd);color:var(--orange);}

.topstatus{display:flex;align-items:center;justify-content:center;gap:6px;font-size:.7rem;color:var(--muted);margin-top:14px;}
.dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:blink 1.5s infinite;}
@keyframes blink{0%,100%{opacity:1;}50%{opacity:.3;}}

/* HPA Panel */
.hpa-panel{background:var(--purple-bg);border:1px solid var(--purple-bd);border-radius:10px;padding:14px;margin-bottom:14px;}
.hpa-row{display:flex;align-items:center;gap:12px;margin-bottom:8px;}
.hpa-label{font-size:.72rem;color:var(--muted);font-weight:600;width:80px;flex-shrink:0;}
.hpa-bar-wrap{flex:1;height:16px;background:#e2e8f0;border-radius:8px;overflow:hidden;position:relative;}
.hpa-bar-fill{height:100%;border-radius:8px;transition:width .6s ease, background .4s;}
.hpa-val{font-size:.78rem;font-weight:700;width:50px;text-align:right;flex-shrink:0;font-family:monospace;}
.hpa-phase{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
.phase-idle{background:var(--green-bg);color:var(--green);}
.phase-scaling_up{background:var(--orange-bg);color:var(--orange);animation:pulse 1s infinite;}
.phase-max{background:var(--red-bg);color:var(--red);}
.phase-stabilizing{background:var(--blue-bg);color:var(--blue);}
.phase-scaling_down{background:var(--purple-bg);color:var(--purple);}
.replica-counter{font-size:2rem;font-weight:800;color:var(--purple);font-family:monospace;text-align:center;}
.replica-range{font-size:.68rem;color:var(--muted);text-align:center;margin-top:-4px;}

.pod-grid{display:flex;flex-wrap:wrap;gap:4px;padding:8px;background:var(--bg);border-radius:8px;margin-top:6px;}
.pod-dot{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.55rem;font-weight:700;transition:all .3s;border:1px solid transparent;}
.pod-dot.alive{background:var(--green-bg);color:var(--green);border-color:var(--green-bd);}
.pod-dot.dead{background:var(--red-bg);color:var(--red);border-color:var(--red-bd);opacity:.5;}
.pod-dot.new{background:var(--orange-bg);color:var(--orange);border-color:var(--orange-bd);animation:pulse 1s infinite;}
.pod-dot.me{background:var(--blue-bg);color:var(--blue);border-color:var(--blue-bd);font-weight:800;}
</style>
</head>
<body>
<div class="toast" id="toast"></div>
<div class="container">
  <h2>☸ KUBERNETES DEMO</h2>
  <p class="subtitle">Pod của bạn: <b id="my-pod-label" style="color:var(--blue)">...</b></p>

  <!-- ════════ 1. LOAD BALANCING ════════ -->
  <div class="card">
    <div class="card-title"><span class="section-num" style="background:var(--blue-bg);color:var(--blue)">1</span>LOAD BALANCING & SERVICE DISCOVERY</div>

    <div class="flow">
      <span class="fs" id="lf0">Request</span><span class="fa">→</span>
      <span class="fs" id="lf1">Service</span><span class="fa">→</span>
      <span class="fs" id="lf2">Chọn Pod</span><span class="fa">→</span>
      <span class="fs" id="lf3">Xử lý</span><span class="fa">→</span>
      <span class="fs" id="lf4">Redis +1</span>
    </div>

    <div class="notice">
       Minikube/Windows dùng 1 tunnel cố định nên 1 tab thường chỉ vào 1 Pod.
      Nhấn <b>"Mô phỏng 3 client"</b> để thấy phân phối thật giữa các Pod.
    </div>

    <div class="grid">
      <div>
        <div style="text-align:center;margin-bottom:10px">
          <div class="card-title">TOTAL REQUESTS (SHARED STATE)</div>
          <div id="total" class="stat">0</div>
        </div>
        <button class="btn btn-blue" onclick="doClick()">SEND REQUEST (+1)</button>
        <button class="btn btn-blue" onclick="doClickMany()" id="btn-many">⚡ MÔ PHỎNG 3 CLIENT</button>
        <button class="btn btn-gray" onclick="doReset()">RESET DATA</button>
      </div>
      <div>
        <div class="card-title">LOAD BALANCING DISTRIBUTION</div>
        <div id="pod-list"><div style="color:var(--muted);font-size:.8rem">Chưa có dữ liệu...</div></div>
      </div>
    </div>
  </div>

  <!-- ════════ 2. SELF-HEALING ════════ -->
  <div class="grid">
    <div class="card">
      <div class="card-title"><span class="section-num" style="background:var(--red-bg);color:var(--red)">2</span>SELF-HEALING</div>
      <div class="flow">
        <span class="fs" id="hf0">Running</span><span class="fa">→</span>
        <span class="fs" id="hf1">Crash</span><span class="fa">→</span>
        <span class="fs" id="hf2">Phát hiện</span><span class="fa">→</span>
        <span class="fs" id="hf3">Tạo mới</span><span class="fa">→</span>
        <span class="fs" id="hf4">✓ OK</span>
      </div>

      <div class="card-title" style="margin-top:4px">CHỌN POD ĐỂ CRASH</div>
      <div id="crash-pod-list" style="margin-bottom:12px;">
        <div style="color:var(--muted);font-size:.78rem">Đang tải danh sách Pod...</div>
      </div>

      <!-- ════════ 3. AUTO-SCALING (HPA) ════════ -->
      <div class="card-title" style="margin-top:14px">AUTO-SCALING (HPA)</div>
      <div class="flow">
        <span class="fs" id="sf0">CPU thấp</span><span class="fa">→</span>
        <span class="fs" id="sf1">CPU cao</span><span class="fa">→</span>
        <span class="fs" id="sf2">HPA scale</span><span class="fa">→</span>
        <span class="fs" id="sf3">Pod mới</span>
      </div>
      <button class="btn btn-orange" onclick="doStress()" id="btn-stress">🔥 STRESS CPU 30s (HPA Scale Up)</button>

      <div class="my-pod-box" id="my-pod-box">—</div>
    </div>

    <div class="card">
      <!-- HPA Status Panel -->
      <div class="card-title">HPA REPLICA STATUS</div>
      <div class="hpa-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div>
            <div class="replica-counter" id="hpa-replicas">3</div>
            <div class="replica-range">Min: 3 / Max: 30 Pods</div>
          </div>
          <div style="text-align:right;">
            <div class="hpa-phase phase-idle" id="hpa-phase">IDLE</div>
            <div style="font-size:.65rem;color:var(--muted);margin-top:4px">Target CPU: 50%</div>
          </div>
        </div>
        <div class="hpa-row">
          <div class="hpa-label">CPU Usage</div>
          <div class="hpa-bar-wrap"><div class="hpa-bar-fill" id="hpa-cpu-bar" style="width:5%;background:var(--green)"></div></div>
          <div class="hpa-val" id="hpa-cpu-val">5%</div>
        </div>
        <div class="hpa-row">
          <div class="hpa-label">Replicas</div>
          <div class="hpa-bar-wrap"><div class="hpa-bar-fill" id="hpa-replica-bar" style="width:10%;background:var(--purple)"></div></div>
          <div class="hpa-val" id="hpa-replica-val">3/30</div>
        </div>
        <div id="pod-dot-grid" class="pod-grid"></div>
      </div>

      <div class="card-title">REAL-TIME EVENT LOGS</div>
      <div id="logs"></div>
      <div class="card-title" style="margin-top:12px">LỆNH THEO DÕI TRONG TERMINAL</div>
      <div class="yaml">kubectl get pods --watch
kubectl get hpa --watch</div>
    </div>
  </div>

  <div class="topstatus"><span class="dot"></span><span id="conn-status">Đang kết nối...</span></div>
</div>

<script>
let myPod = '', myId = '';
const COLORS = ['#2563eb','#16a34a','#dc2626','#ea580c','#7c3aed','#0891b2','#be185d','#65a30d'];
const colorMap = {};
function colorOf(id) {
  if (!colorMap[id]) colorMap[id] = COLORS[Object.keys(colorMap).length % COLORS.length];
  return colorMap[id];
}

function toast(msg, type, ms=2800) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast ' + type + ' show';
  setTimeout(() => el.classList.remove('show'), ms);
}

function addLog(m, c='#38bdf8') {
  const l = document.getElementById('logs');
  const d = document.createElement('div');
  d.style.color = c;
  d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + m;
  l.appendChild(d);
  l.scrollTop = l.scrollHeight;
  if (l.children.length > 60) l.removeChild(l.firstChild);
}

function flowOn(prefix, idx, cls) {
  const len = prefix === 'lf' ? 5 : prefix === 'hf' ? 5 : 4;
  for (let i = 0; i < len; i++) {
    const el = document.getElementById(prefix + i);
    if (el) el.className = 'fs' + (i <= idx ? ' on-' + cls : '');
  }
}
function flowReset(prefix) { flowOn(prefix, -1, ''); }

// Track dead pods locally for immediate UI feedback
const deadPods = new Set();
const newPods = new Set();

// ── SSE ──────────────────────────────────────────────────────────
const es = new EventSource('/events');
es.onmessage = (e) => {
  const d = JSON.parse(e.data);

  if (d.type === 'connected') {
    myPod = d.pod; myId = d.id || '';
    document.getElementById('my-pod-label').textContent = myId || myPod;
    document.getElementById('my-pod-box').textContent = 'Bạn đang kết nối: ' + (myId || myPod);
    document.getElementById('conn-status').textContent = 'Đã kết nối';
    addLog('Connected to Cluster as ' + (myId || myPod));
    refresh();
  }

  if (d.type === 'count') refresh();

  if (d.type === 'crash') {
    const label = d.id || d.pod;
    addLog('⚠ ' + label + ' CRASHED! → Chuyển sang DEAD', '#f87171');
    flowOn('hf', 1, 'red');
    setTimeout(() => { addLog('🔍 K8s phát hiện Pod lỗi: ' + label, '#fbbf24'); flowOn('hf', 2, 'orange'); }, 1000);
    setTimeout(() => { addLog('🆕 K8s đang tạo Pod mới thay thế...', '#fbbf24'); flowOn('hf', 3, 'orange'); }, 2000);
    toast('💀 ' + label + ' crashed! Pod mới sẽ được tạo sau 3s', 'red', 5000);
    refresh();
  }

  if (d.type === 'healed') {
    addLog('✅ Self-Healing: ' + d.newId + ' thay thế ' + d.replacedId, '#4ade80');
    flowOn('hf', 4, 'green');
    newPods.add(d.newId);
    setTimeout(() => newPods.delete(d.newId), 5000);
    toast('✅ Self-Healing: ' + d.newId + ' đã lên thay thế!', 'green', 4000);
    refresh();
  }

  if (d.type === 'stress_start') {
    addLog('🔥 Auto-scaling: CPU tăng cao trên ' + (d.id || d.pod) + ' (' + d.sec + 's)', '#fbbf24');
    flowOn('sf', 1, 'orange');
    toast('🔥 CPU Stress! HPA đang theo dõi...', 'orange', d.sec * 1000);
  }

  if (d.type === 'stress_end') {
    addLog('CPU stress kết thúc. HPA đang tính toán scale...', '#4ade80');
  }

  if (d.type === 'hpa_update') {
    updateHPAPanel(d);
    const phaseMap = { scaling_up: '📈 HPA Scale UP', max: '🚀 Đạt max replicas', stabilizing: '⚖ Ổn định', scaling_down: '📉 HPA Scale DOWN', idle: '✅ Về trạng thái bình thường' };
    addLog((phaseMap[d.phase] || d.phase) + ' — ' + d.replicas + ' Pods, CPU: ' + d.cpuPercent + '%', d.phase === 'scaling_up' ? '#fbbf24' : d.phase === 'idle' ? '#4ade80' : '#38bdf8');
    if (d.phase === 'scaling_up') flowOn('sf', 2, 'orange');
    if (d.phase === 'idle') { flowOn('sf', 3, 'green'); setTimeout(() => flowReset('sf'), 3000); }
    refresh();
  }

  if (d.type === 'hpa_pod_added') {
    addLog('➕ HPA thêm ' + d.newId + ' → Tổng: ' + d.replicas + ' Pods (CPU: ' + d.cpuPercent + '%)', '#a78bfa');
    newPods.add(d.newId);
    setTimeout(() => newPods.delete(d.newId), 4000);
    refresh();
  }

  if (d.type === 'hpa_pod_removed') {
    addLog('➖ HPA xóa ' + d.removedId + ' → Còn: ' + d.replicas + ' Pods', '#94a3b8');
    refresh();
  }

  if (d.type === 'reset') {
    addLog('↺ Reset toàn bộ dữ liệu');
    flowReset('lf'); flowReset('hf'); flowReset('sf');
    deadPods.clear(); newPods.clear();
    updateHPAPanel({ replicas: 3, phase: 'idle', cpuPercent: 5 });
    refresh();
  }
};
es.onerror = () => { document.getElementById('conn-status').textContent = 'Mất kết nối'; };

// ── UPDATE HPA PANEL ─────────────────────────────────────────────
function updateHPAPanel(d) {
  const replicas = d.replicas || 3;
  const cpuPct = d.cpuPercent || 5;
  const phase = d.phase || 'idle';

  document.getElementById('hpa-replicas').textContent = replicas;
  document.getElementById('hpa-phase').textContent = phase.replace('_', ' ').toUpperCase();
  document.getElementById('hpa-phase').className = 'hpa-phase phase-' + phase;

  const cpuEl = document.getElementById('hpa-cpu-bar');
  cpuEl.style.width = Math.min(cpuPct, 100) + '%';
  cpuEl.style.background = cpuPct > 70 ? 'var(--red)' : cpuPct > 50 ? 'var(--orange)' : 'var(--green)';
  document.getElementById('hpa-cpu-val').textContent = cpuPct + '%';

  const repPct = (replicas / 30) * 100;
  document.getElementById('hpa-replica-bar').style.width = repPct + '%';
  document.getElementById('hpa-replica-val').textContent = replicas + '/30';
}

// ── REFRESH STATE ────────────────────────────────────────────────
async function refresh() {
  try {
    const r = await fetch('/api/state');
    const d = await r.json();

    document.getElementById('total').textContent = d.total;

    // Detect self-healing
    if (myPod && d.pod !== myPod) {
      addLog('✅ Self-Healing: Pod mới ' + (d.id||d.pod) + ' thay thế ' + myPod, '#4ade80');
      myPod = d.pod; myId = d.id;
      document.getElementById('my-pod-label').textContent = myId || myPod;
      document.getElementById('my-pod-box').textContent = 'Pod mới đã phục hồi: ' + (myId || myPod);
      flowOn('hf', 4, 'green');
      toast('✅ Self-Healing thành công!', 'green', 3000);
    }

    if (d.hpaState) updateHPAPanel(d.hpaState);

    const ids   = d.ids || {};
    const alive = new Set(d.alive || []);
    const hits  = d.allHits || {};
    const stress= new Set(Object.keys(d.stress || {}));

    // Sort by pod number
    const entries = Object.entries(hits)
      .map(([pod, val]) => [ids[pod] || pod, parseInt(val), pod])
      .sort((a, b) => {
        const na = parseInt(a[0].replace('Pod-','')) || 0;
        const nb = parseInt(b[0].replace('Pod-','')) || 0;
        return na - nb;
      });

    // Include alive pods not yet in hits
    for (const hn of alive) {
      const id = ids[hn] || hn;
      if (!entries.find(e => e[2] === hn)) entries.push([id, 0, hn]);
    }
    entries.sort((a,b) => {
      const na = parseInt(a[0].replace('Pod-','')) || 0;
      const nb = parseInt(b[0].replace('Pod-','')) || 0;
      return na - nb;
    });

    const maxV = Math.max(...entries.map(e => e[1]), 1);

    // ── Load Balancing list (with per-pod crash button) ──
    document.getElementById('pod-list').innerHTML = entries.length ? entries.map(([id, val, podName]) => {
      const c   = colorOf(id);
      const pct = Math.round(val / maxV * 100);
      const isAl= alive.has(podName);
      const hot = stress.has(podName);
      const isMe= podName === myPod;
      const isDead = !isAl;
      return \`<div class="pod-row \${isDead?'dead':''}">
        <div class="pod-id" style="color:\${c}">\${isMe?'▶ ':''}\${id}</div>
        <div class="bar-wrap"><div class="bar-fill" style="width:\${isDead?0:pct}%;background:\${hot?'var(--orange)':c};\${isDead?'opacity:.3':''}"></div></div>
        <div class="pod-val">\${val}</div>
        <span class="pod-status \${isAl?'status-live':'status-dead'}">\${isAl?'LIVE':'DEAD'}</span>
      </div>\`;
    }).join('') : '<div style="color:var(--muted);font-size:.8rem">Chưa có dữ liệu...</div>';

    // ── Crash Pod list: chỉ show pod đang LIVE ──
    const livePods = entries.filter(([,, hn]) => alive.has(hn));
    document.getElementById('crash-pod-list').innerHTML = livePods.length ? livePods.map(([id,,podName]) => {
      const isMe = podName === myPod;
      const c = colorOf(id);
      return \`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding:6px 8px;background:var(--bg);border-radius:6px;">
        <div style="font-size:.72rem;font-weight:700;font-family:monospace;color:\${c};flex:1;">\${isMe?'▶ ':''}\${id}\${isMe?' (bạn)':''}</div>
        <span class="pod-status status-live">LIVE</span>
        <button class="crash-btn" onclick="crashPod('\${id}')" id="cbtn-\${id}">💥 CRASH</button>
      </div>\`;
    }).join('') : '<div style="color:var(--muted);font-size:.78rem">Chưa có pod live...</div>';

    // ── Pod dot grid for HPA ──
    const allIds = [];
    for (const [hn, id] of Object.entries(ids)) {
      const isAl = alive.has(hn);
      allIds.push({ id, isAl, isMe: hn === myPod });
    }
    allIds.sort((a,b) => {
      const na = parseInt(a.id.replace('Pod-','')) || 0;
      const nb = parseInt(b.id.replace('Pod-','')) || 0;
      return na - nb;
    });
    document.getElementById('pod-dot-grid').innerHTML = allIds.map(({ id, isAl, isMe }) => {
      const cls = isMe ? 'me' : newPods.has(id) ? 'new' : isAl ? 'alive' : 'dead';
      const num = id.replace('Pod-','');
      return \`<div class="pod-dot \${cls}" title="\${id}">\${num}</div>\`;
    }).join('');

  } catch {}
}

// ── ACTIONS ──────────────────────────────────────────────────────
async function doClick() {
  flowOn('lf', 0, 'blue');
  setTimeout(()=>flowOn('lf',1,'blue'),100);
  setTimeout(()=>flowOn('lf',2,'blue'),200);
  await fetch('/api/count', { method:'POST' });
  setTimeout(()=>flowOn('lf',3,'blue'),300);
  setTimeout(()=>{flowOn('lf',4,'blue'); refresh();},400);
  setTimeout(()=>flowReset('lf'),1800);
}

async function doClickMany() {
  const btn = document.getElementById('btn-many');
  btn.disabled = true; btn.textContent = '⏳ Đang gửi...';
  addLog('Bắt đầu mô phỏng 3 client song song...');
  const client = async (n) => {
    for (let i=0;i<30;i++){
      await fetch('/api/count',{method:'POST'});
      await new Promise(r=>setTimeout(r,60+Math.random()*60));
    }
  };
  await Promise.all([client(1),client(2),client(3)]);
  btn.disabled = false; btn.textContent = '⚡ MÔ PHỎNG 3 CLIENT';
  toast('Đã gửi 90 requests — xem phân phối!', 'blue', 3000);
  refresh();
}

async function crashPod(targetId) {
  const btn = document.getElementById('cbtn-' + targetId);
  if (btn) { btn.disabled = true; btn.textContent = '💀 Crashing...'; }
  flowOn('hf', 0, 'red');
  addLog('🎯 Gửi lệnh crash tới ' + targetId + '...', '#f87171');
  await fetch('/api/crash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetPodId: targetId })
  });
  setTimeout(refresh, 500);
}

async function doCrash() {
  if (!confirm('Crash Pod này?\\nK8s sẽ tự tạo Pod mới trong ~3 giây.')) return;
  const btn = document.getElementById('btn-crash');
  if(btn) { btn.disabled = true; btn.textContent = '💀 Đang crash...'; }
  await fetch('/api/crash', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
  setTimeout(() => { if(btn){btn.disabled=false; btn.textContent='💥 CRASH POD NÀY';} }, 15000);
}

async function doStress() {
  const btn = document.getElementById('btn-stress');
  btn.disabled = true;
  addLog('🔥 Bắt đầu CPU Stress 30s — HPA sẽ scale up...', '#fbbf24');
  await fetch('/api/stress?s=30', { method:'POST' });
  let t = 30;
  flowOn('sf', 0, 'orange');
  const iv = setInterval(()=>{
    t--; btn.textContent = '🔥 Stress... '+t+'s';
    if (t<=0){
      clearInterval(iv);
      btn.disabled=false;
      btn.textContent='🔥 STRESS CPU 30s (HPA Scale Up)';
    }
  },1000);
}

async function doReset() {
  if (!confirm('Reset toàn bộ dữ liệu?')) return;
  await fetch('/api/reset', { method:'POST' });
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;

server.listen(3000, () => log("K8s Demo started"));