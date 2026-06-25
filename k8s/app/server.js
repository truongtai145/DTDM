const http = require("http");
const os = require("os");
const redis = require("redis");

const POD_HOSTNAME = os.hostname();
const store = redis.createClient({
  socket: { host: process.env.REDIS_HOST || "localhost", port: 6379 },
});
store.connect().catch(console.error);

function slog(m) {
  console.log("[" + new Date().toISOString() + "] [" + POD_HOSTNAME + "] " + m);
}

// ── Heartbeat ────────────────────────────────────────────────
setInterval(async () => {
  try {
    await store.hSet("pod_hb", POD_HOSTNAME, Date.now().toString());
  } catch {}
}, 2000);

// ── Label Pod-1, Pod-2... ────────────────────────────────────
let MY_LABEL = null;
async function initLabel() {
  const ex = await store.hGet("pod_labels", POD_HOSTNAME).catch(() => null);
  if (ex) {
    MY_LABEL = ex;
    return;
  }
  const n = await store.incr("pod_label_counter");
  MY_LABEL = "Pod-" + n;
  await store.hSet("pod_labels", POD_HOSTNAME, MY_LABEL).catch(() => {});
  slog("Label: " + MY_LABEL);
}
initLabel();

// ── SSE broadcast ────────────────────────────────────────────
const clients = new Set();
function broadcast(data) {
  const msg = "data: " + JSON.stringify(data) + "\n\n";
  for (const c of clients) {
    try {
      c.write(msg);
    } catch {}
  }
}

// ── HTML (k8s-demo.html + SSE bridge, embedded) ─────────────
const HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kubernetes Flash Sale Demo</title>
<style>
:root {
  --blue:#2563eb;--blue-bg:#eff6ff;--blue-bd:#bfdbfe;--blue-dark:#1d4ed8;
  --green:#16a34a;--green-bg:#f0fdf4;--green-bd:#bbf7d0;
  --red:#dc2626;--red-bg:#fef2f2;--red-bd:#fecaca;
  --orange:#ea580c;--orange-bg:#fff7ed;--orange-bd:#fed7aa;
  --purple:#7c3aed;--purple-bg:#f5f3ff;--purple-bd:#ddd6fe;
  --yellow:#ca8a04;--yellow-bg:#fefce8;--yellow-bd:#fde68a;
  --gray:#64748b;--border:#e2e8f0;--bg:#f8fafc;--card:#fff;--text:#0f172a;--muted:#64748b;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}

/* ── HEADER ── */
.header{background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0f172a 100%);color:#fff;padding:24px 32px;position:relative;overflow:hidden;}
.header::before{content:'';position:absolute;inset:0;background:url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");}
.header-inner{max-width:1100px;margin:0 auto;position:relative;}
.flash-badge{display:inline-flex;align-items:center;gap:6px;background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;letter-spacing:.5px;margin-bottom:8px;}
.header h1{font-size:1.6rem;font-weight:800;margin-bottom:4px;}
.header p{font-size:.85rem;color:#94a3b8;}
.k8s-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:3px 10px;font-size:.72rem;color:#e2e8f0;margin-top:8px;}
.live-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;animation:pulse 1.5s infinite;}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.6;transform:scale(.85);}}

/* ── LAYOUT ── */
.main{max-width:1100px;margin:0 auto;padding:20px;}
.section{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;overflow:hidden;}
.section-head{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);}
.section-num{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:800;flex-shrink:0;}
.section-title{font-size:.95rem;font-weight:700;}
.section-sub{font-size:.72rem;color:var(--muted);margin-top:1px;}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
@media(max-width:680px){.g2,.g3{grid-template-columns:1fr;}}

/* ── SCENARIO BAR ── */
.scenario-bar{background:linear-gradient(90deg,#0f172a,#1e3a8a);color:#fff;border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap;}
.scenario-info{display:flex;align-items:center;gap:10px;}
.scenario-label{font-size:.72rem;color:#94a3b8;margin-bottom:2px;}
.scenario-val{font-size:1.5rem;font-weight:800;font-family:monospace;color:#fff;}
.traffic-bar-wrap{flex:1;min-width:140px;}
.traffic-bar{height:8px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden;}
.traffic-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:4px;transition:width .8s ease;}

/* ── STAT CARD ── */
.stat-card{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;}
.stat-label{font-size:.67rem;font-weight:600;letter-spacing:.4px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;}
.stat-value{font-size:1.6rem;font-weight:800;font-family:monospace;color:var(--blue);}
.stat-sub{font-size:.7rem;color:var(--muted);margin-top:2px;}

/* ── PROPERTY 1: DECLARATIVE ── */
.yaml-box{background:#0f172a;border-radius:8px;padding:14px;font-family:'Courier New',monospace;font-size:.72rem;line-height:1.7;color:#e2e8f0;position:relative;}
.yaml-box .k{color:#7dd3fc;}.yaml-box .v{color:#a5f3fc;}.yaml-box .n{color:#fde68a;}.yaml-box .c{color:#6b7280;}
.yaml-live{position:absolute;top:10px;right:10px;background:#16a34a;color:#fff;font-size:.6rem;font-weight:700;padding:2px 7px;border-radius:3px;}
.apply-arrow{display:flex;align-items:center;gap:8px;padding:10px 0;font-size:.75rem;color:var(--muted);}
.apply-arrow::before,.apply-arrow::after{content:'';flex:1;height:1px;background:var(--border);}
.k8s-engine{background:var(--blue-bg);border:1px solid var(--blue-bd);border-radius:8px;padding:12px;text-align:center;}
.k8s-engine-title{font-size:.8rem;font-weight:700;color:var(--blue);margin-bottom:4px;}
.k8s-engine-sub{font-size:.7rem;color:var(--muted);}
.desired-state{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
.state-item{flex:1;min-width:80px;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center;}
.state-item .si-val{font-size:1.2rem;font-weight:800;color:var(--blue);font-family:monospace;}
.state-item .si-label{font-size:.65rem;color:var(--muted);margin-top:2px;}
.state-item.ok .si-val{color:var(--green);}
.state-item.warn .si-val{color:var(--orange);}

/* ── PROPERTY 2: HPA / SCALING ── */
.hpa-visual{position:relative;padding:16px;background:var(--bg);border-radius:8px;border:1px solid var(--border);min-height:180px;}
#pod-grid{display:flex;flex-wrap:wrap;gap:5px;}
.pod-dot{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.55rem;font-weight:800;border:1px solid transparent;transition:all .4s;cursor:default;}
.pod-dot.alive{background:var(--green-bg);color:var(--green);border-color:var(--green-bd);}
.pod-dot.boot{background:var(--orange-bg);color:var(--orange);border-color:var(--orange-bd);animation:blink .7s infinite;}
.pod-dot.dead{background:var(--red-bg);color:var(--red);border-color:var(--red-bd);opacity:.5;}
@keyframes blink{0%,100%{opacity:1;}50%{opacity:.4;}}
.cpu-meter{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
.cpu-bar-wrap{flex:1;height:12px;background:var(--border);border-radius:6px;overflow:hidden;}
.cpu-bar-fill{height:100%;border-radius:6px;transition:width .6s,background .4s;}
.hpa-threshold{position:absolute;top:0;height:100%;border-left:2px dashed var(--orange);pointer-events:none;}
.hpa-label{position:absolute;top:2px;font-size:.6rem;color:var(--orange);font-weight:700;white-space:nowrap;}
.metric-row{display:flex;align-items:center;gap:8px;font-size:.72rem;margin-bottom:6px;}
.metric-label{color:var(--muted);width:90px;flex-shrink:0;}
.bar-wrap{flex:1;height:10px;background:var(--border);border-radius:5px;overflow:hidden;}
.bar-fill{height:100%;border-radius:5px;transition:width .5s,background .4s;}

/* ── PROPERTY 3: LOAD BALANCING ── */
#lb-pods{display:flex;gap:8px;align-items:flex-end;}
.lb-pod{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;}
.lb-bar-wrap{width:100%;height:100px;display:flex;align-items:flex-end;background:var(--bg);border-radius:6px;border:1px solid var(--border);overflow:hidden;position:relative;}
.lb-bar-fill{width:100%;border-radius:0 0 5px 5px;transition:height .5s;position:absolute;bottom:0;}
.lb-pod-label{font-size:.65rem;font-weight:700;font-family:monospace;}
.lb-hit-count{font-size:.7rem;font-weight:800;font-family:monospace;}
.lb-status{font-size:.55rem;padding:2px 6px;border-radius:3px;font-weight:700;}
.lb-status.live{background:var(--green-bg);color:var(--green);}
.lb-status.dead{background:var(--red-bg);color:var(--red);}
.request-packet{position:fixed;pointer-events:none;z-index:9999;font-size:10px;background:var(--blue);color:#fff;border-radius:4px;padding:2px 5px;font-weight:700;font-family:monospace;transition:none;}

/* ── PROPERTY 4: SELF-HEALING ── */
.timeline{position:relative;padding-left:20px;}
.tl-line{position:absolute;left:6px;top:0;bottom:0;width:1.5px;background:var(--border);}
.tl-item{position:relative;margin-bottom:10px;padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--card);transition:all .3s;}
.tl-dot{position:absolute;left:-17px;top:12px;width:10px;height:10px;border-radius:50%;border:2px solid var(--border);background:var(--card);}
.tl-item.active .tl-dot{background:var(--blue);border-color:var(--blue);}
.tl-item.done .tl-dot{background:var(--green);border-color:var(--green);}
.tl-item.error .tl-dot{background:var(--red);border-color:var(--red);}
.tl-item.active{border-color:var(--blue-bd);background:var(--blue-bg);}
.tl-item.done{border-color:var(--green-bd);background:var(--green-bg);}
.tl-item.error{border-color:var(--red-bd);background:var(--red-bg);}
.tl-head{display:flex;align-items:center;gap:6px;font-size:.75rem;font-weight:700;margin-bottom:2px;}
.tl-body{font-size:.68rem;color:var(--muted);}

/* ── BUTTONS ── */
.btn{padding:10px 18px;border:none;border-radius:7px;font-weight:700;font-size:.8rem;cursor:pointer;color:#fff;transition:.15s;display:inline-flex;align-items:center;gap:6px;}
.btn:hover{filter:brightness(1.1);}
.btn:active{transform:scale(.97);}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.btn-blue{background:var(--blue);}
.btn-green{background:var(--green);}
.btn-red{background:var(--red);}
.btn-orange{background:var(--orange);}
.btn-gray{background:var(--gray);}
.btn-sm{padding:6px 12px;font-size:.72rem;}

/* ── LOG ── */
#log{background:#0f172a;color:#38bdf8;padding:10px 12px;border-radius:8px;font-family:'Courier New',monospace;font-size:.66rem;height:130px;overflow-y:auto;line-height:1.7;}
#log div{border-bottom:1px solid #1e293b;padding:1px 0;}

/* ── FLOW DIAGRAM ── */
.flow{display:flex;align-items:center;gap:4px;flex-wrap:wrap;background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:8px 12px;margin-bottom:12px;}
.flow-step{padding:4px 10px;border-radius:20px;font-size:.65rem;font-weight:700;background:var(--card);border:1px solid var(--border);color:var(--muted);transition:.4s;white-space:nowrap;}
.flow-step.s-blue{background:var(--blue);border-color:var(--blue);color:#fff;}
.flow-step.s-green{background:var(--green);border-color:var(--green);color:#fff;}
.flow-step.s-orange{background:var(--orange);border-color:var(--orange);color:#fff;}
.flow-step.s-red{background:var(--red);border-color:var(--red);color:#fff;}
.flow-arr{color:var(--muted);font-size:.75rem;}

/* ── TAG ── */
.tag{display:inline-block;font-size:.62rem;font-weight:700;padding:2px 7px;border-radius:4px;}
.tag-green{background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd);}
.tag-red{background:var(--red-bg);color:var(--red);border:1px solid var(--red-bd);}
.tag-orange{background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-bd);}
.tag-blue{background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-bd);}
.tag-purple{background:var(--purple-bg);color:var(--purple);border:1px solid var(--purple-bd);}

/* ── KILL LIST ── */
.kill-row{display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg);border-radius:6px;margin-bottom:5px;}
.kill-btn{padding:3px 9px;border:1px solid var(--red-bd);background:var(--red-bg);color:var(--red);font-size:.62rem;font-weight:700;border-radius:4px;cursor:pointer;transition:.15s;}
.kill-btn:hover{background:var(--red);color:#fff;}
.kill-btn:disabled{opacity:.3;cursor:default;}

/* ── TOAST ── */
.toast{position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-90px);padding:10px 20px;border-radius:8px;font-size:.82rem;font-weight:600;z-index:9999;background:#fff;border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,.12);transition:.35s cubic-bezier(.34,1.56,.64,1);}
.toast.show{transform:translateX(-50%) translateY(0);}
.toast.t-green{border-color:var(--green-bd);color:var(--green);}
.toast.t-red{border-color:var(--red-bd);color:var(--red);}
.toast.t-orange{border-color:var(--orange-bd);color:var(--orange);}
.toast.t-blue{border-color:var(--blue-bd);color:var(--blue);}

.notice{background:var(--yellow-bg);border:1px solid var(--yellow-bd);border-radius:7px;padding:9px 13px;font-size:.73rem;color:#78350f;line-height:1.5;margin-bottom:12px;}

/* ── NUMBER TICKER ── */
@keyframes countUp{from{transform:translateY(8px);opacity:0;}to{transform:translateY(0);opacity:1;}}
.tick{display:inline-block;animation:countUp .2s ease;}

/* footer */
.footer{text-align:center;padding:20px;font-size:.7rem;color:var(--muted);}
</style>
</head>
<body>
<div class="toast" id="toast"></div>

<!-- ── HEADER ── -->
<div class="header">
  <div class="header-inner">
    <div class="flash-badge">⚡ FLASH SALE</div>
    <h1>☸ Kubernetes — Flash Sale Demo</h1>
    <p>Website thương mại điện tử | Mô phỏng 4 tính chất cốt lõi của Kubernetes</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      <span class="k8s-badge"><span class="live-dot"></span> Cluster </span>
      <span class="k8s-badge"> Redis</span>
      <span class="k8s-badge">⚙ HPA</span>
    </div>
  </div>
</div>

<div class="main">

<!-- ── SCENARIO BAR ── -->
<div class="scenario-bar">
  <div class="scenario-info">
    <div>
      <div class="scenario-label">KHÁCH HÀNG / GIÂY</div>
      <div class="scenario-val" id="rps-val">0</div>
    </div>
  </div>
  <div class="traffic-bar-wrap">
    <div style="font-size:.68rem;color:#94a3b8;margin-bottom:4px;">Lưu lượng truy cập</div>
    <div class="traffic-bar"><div class="traffic-fill" id="traffic-fill" style="width:0%"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:.62rem;color:#64748b;margin-top:3px;"><span>Bình thường</span><span>Flash Sale ⚡</span></div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-blue" onclick="setScenario('normal')">Bình Thường</button>
    <button class="btn btn-red" onclick="setScenario('flash')">⚡ Flash Sale</button>
    <button class="btn btn-gray" onclick="resetAll()">↺ Reset</button>
  </div>
</div>

<div class="g2" style="margin-bottom:16px;">
  <div class="stat-card"><div class="stat-label">Tổng Requests</div><div class="stat-value" id="total-req">0</div><div class="stat-sub"></div></div>
  <div class="stat-card"><div class="stat-label">Pods Đang Chạy</div><div class="stat-value" id="pod-count-val" style="color:var(--green)">3</div><div class="stat-sub">Kubernetes duy trì tự động</div></div>
</div>

<!-- ══════════════════════════════════════════ -->
<!-- TÍNH CHẤT 1: DECLARATIVE CONFIG           -->
<!-- ══════════════════════════════════════════ -->
<div class="section">
  <div class="section-head">
    <div class="section-num" style="background:var(--blue-bg);color:var(--blue);">1</div>
    <div>
      <div class="section-title">Quản Lý Khai Báo (Declarative Configuration)</div>
     
    </div>
  </div>

  

  <!-- Cấu hình khai báo — dạng thẻ gọn -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">

    <!-- TRÁI: Desired State từ YAML -->
    <div>
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:10px;letter-spacing:.5px;">📋 DESIRED STATE — DevOps khai báo</div>

      <!-- 3 thẻ config chính -->
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;background:var(--blue-bg);border:1px solid var(--blue-bd);border-radius:8px;padding:10px 14px;">
          <div style="font-size:1.5rem;font-weight:900;color:var(--blue);font-family:monospace;width:36px;text-align:center;" id="yaml-replicas">3</div>
          <div>
            <div style="font-size:.75rem;font-weight:700;color:var(--blue);">replicas: 3</div>
       
          </div>
          <div style="margin-left:auto;font-size:.6rem;background:var(--blue);color:#fff;padding:2px 7px;border-radius:4px;font-weight:700;">Deployment</div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;background:var(--orange-bg);border:1px solid var(--orange-bd);border-radius:8px;padding:10px 14px;">
          <div style="font-size:1.5rem;font-weight:900;color:var(--orange);font-family:monospace;width:36px;text-align:center;">50%</div>
          <div>
            <div style="font-size:.75rem;font-weight:700;color:var(--orange);">targetCPU: 50%</div>
          
          </div>
          <div style="margin-left:auto;font-size:.6rem;background:var(--orange);color:#fff;padding:2px 7px;border-radius:4px;font-weight:700;">HPA</div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;background:var(--green-bg);border:1px solid var(--green-bd);border-radius:8px;padding:10px 14px;">
          <div style="font-size:.85rem;font-weight:900;color:var(--green);font-family:monospace;width:36px;text-align:center;">3→10</div>
          <div>
            <div style="font-size:.75rem;font-weight:700;color:var(--green);">min: 3 / max: 10 Pods</div>
          
          </div>
          <div style="margin-left:auto;font-size:.6rem;background:var(--green);color:#fff;padding:2px 7px;border-radius:4px;font-weight:700;">HPA</div>
        </div>
      </div>

      <!-- kubectl apply arrow -->
      
    </div>

    <!-- PHẢI: Actual State + Reconciliation -->
    <div>
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:10px;letter-spacing:.5px;">⚙ ACTUAL STATE — K8s thực thi</div>

      <!-- Desired vs Actual -->
      <div class="desired-state" id="desired-state-grid" style="margin-bottom:12px;"><!-- Filled by JS --></div>

      <!-- Reconciliation loop -->
      <div style="background:var(--bg);border-radius:8px;border:1px solid var(--border);padding:12px;margin-bottom:12px;">
        <div style="font-size:.68rem;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">⟳ Reconciliation Loop</div>
        <div id="reconcile-log" style="font-size:.7rem;line-height:2;color:var(--text);">
          <div><b>Desired:</b> 3 replicas &nbsp;|&nbsp; <b>Actual:</b> <span id="rc-actual">3</span> replicas</div>
          <div id="rc-action" style="color:var(--green);">✓ Trạng thái khớp — không cần hành động</div>
        </div>
      </div>

      <!-- Thử xóa pod -->
      <div style="font-size:.7rem;color:var(--muted);margin-bottom:6px;">Thử xóa 1 Pod — K8s sẽ tự tạo lại:</div>
      <button class="btn btn-red btn-sm" onclick="manualDelete()"> Delete Pod</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════ -->
<!-- TÍNH CHẤT 2: AUTO-SCALING (HPA)           -->
<!-- ══════════════════════════════════════════ -->
<div class="section">
  <div class="section-head">
    <div class="section-num" style="background:var(--orange-bg);color:var(--orange);">2</div>
    <div>
      <div class="section-title">Tự Động Co Giãn — HPA (Horizontal Pod Autoscaler)</div>
  
    </div>
  </div>

  <div class="flow" id="hpa-flow">
    <span class="flow-step" id="hf0">CPU bình thường</span><span class="flow-arr">→</span>
    <span class="flow-step" id="hf1">CPU > 50%</span><span class="flow-arr">→</span>
    <span class="flow-step" id="hf2">HPA tính toán</span><span class="flow-arr">→</span>
    <span class="flow-step" id="hf3">Scale Up ↑</span><span class="flow-arr">→</span>
    <span class="flow-step" id="hf4">Scale Down ↓</span>
  </div>

  <div class="g2">
    <div>
      <div style="margin-bottom:10px;">
        <div class="metric-row">
          <span class="metric-label">CPU Usage</span>
          <div class="bar-wrap"><div class="bar-fill" id="cpu-fill" style="width:8%;background:var(--green);"></div></div>
          <span style="font-size:.72rem;font-weight:700;min-width:36px;text-align:right;font-family:monospace;" id="cpu-pct">8%</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Pods (Replicas)</span>
          <div class="bar-wrap"><div class="bar-fill" id="rep-fill" style="width:10%;background:var(--purple);"></div></div>
          <span style="font-size:.72rem;font-weight:700;min-width:36px;text-align:right;font-family:monospace;" id="rep-val">3/30</span>
        </div>
      </div>
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:6px;">PODS TRONG CLUSTER</div>
      <div class="hpa-visual">
        <div id="pod-grid"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn btn-orange btn-sm" onclick="startStress()"> Stress CPU (Flash Sale)</button>
        <button class="btn btn-gray btn-sm" id="stop-stress-btn" onclick="stopStress()" disabled>⏹ Dừng Stress</button>
      </div>
    </div>
    <div>
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:8px;">HPA REPLICA STATUS</div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:2rem;font-weight:800;font-family:monospace;color:var(--purple);" id="hpa-rep-big">3</div>
          <span class="tag tag-green" id="hpa-phase-tag">IDLE</span>
        </div>
        <div style="font-size:.7rem;color:var(--muted);" id="hpa-note">Hệ thống bình thường | CPU thấp</div>
      </div>
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:6px;">KUBERNETES HPA LOG</div>
      <div id="hpa-log" style="background:#0f172a;color:#a5f3fc;padding:10px 12px;border-radius:8px;font-family:'Courier New',monospace;font-size:.63rem;height:130px;overflow-y:auto;line-height:1.8;"></div>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════ -->
<!-- TÍNH CHẤT 3: LOAD BALANCING               -->
<!-- ══════════════════════════════════════════ -->
<div class="section">
  <div class="section-head">
    <div class="section-num" style="background:var(--blue-bg);color:var(--blue);">3</div>
    <div>
      <div class="section-title">Cân Bằng Tải (Load Balancing)</div>
    
    </div>
  </div>

  <div class="flow">
    <span class="flow-step s-blue">Khách hàng</span><span class="flow-arr">→</span>
    <span class="flow-step s-blue">K8s Service</span><span class="flow-arr">→</span>
    <span class="flow-step s-blue">Round-Robin</span><span class="flow-arr">→</span>
    <span class="flow-step s-blue">Pod 1..N</span><span class="flow-arr">→</span>
    <span class="flow-step s-blue">Redis +1</span>
  </div>

  <div class="g2">
    <div>
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:10px;">PHÂN PHỐI REQUEST VÀO PODS</div>
      <div id="lb-pods" style="display:flex;gap:6px;align-items:flex-end;min-height:120px;"></div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button class="btn btn-blue btn-sm" onclick="sendOneRequest()"> Gửi 1 Request</button>
        <button class="btn btn-blue" onclick="sendBurst()"> Gửi 100 Requests</button>
      </div>
    </div>
    <div>
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:8px;">THỐNG KÊ PHÂN PHỐI</div>
      <div id="lb-stats" style="display:flex;flex-direction:column;gap:5px;"></div>
      <div style="margin-top:12px;background:var(--blue-bg);border:1px solid var(--blue-bd);border-radius:7px;padding:10px;">
        <div style="font-size:.72rem;font-weight:700;color:var(--blue);margin-bottom:4px;">K8s Service (ClusterIP)</div>
        <div style="font-size:.68rem;color:var(--muted);line-height:1.6;">
          • Mỗi Pod có IP riêng<br>
          • Service có 1 IP ảo duy nhất (ClusterIP)<br>
          • kube-proxy phân phối Round-Robin<br>
          • Pod mới được tự động thêm vào pool
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════ -->
<!-- TÍNH CHẤT 4: SELF-HEALING                 -->
<!-- ══════════════════════════════════════════ -->
<div class="section">
  <div class="section-head">
    <div class="section-num" style="background:var(--red-bg);color:var(--red);">4</div>
    <div>
      <div class="section-title">Tự Phục Hồi (Self-Healing)</div>
  
    </div>
  </div>

  <div class="flow" id="sh-flow">
    <span class="flow-step" id="shf0">Running</span><span class="flow-arr">→</span>
    <span class="flow-step" id="shf1">Crash!</span><span class="flow-arr">→</span>
    <span class="flow-step" id="shf2">Liveness Probe Fail</span><span class="flow-arr">→</span>
    <span class="flow-step" id="shf3">Xóa Pod</span><span class="flow-arr">→</span>
    <span class="flow-step" id="shf4">Tạo Pod Mới</span><span class="flow-arr">→</span>
    <span class="flow-step" id="shf5"> Healthy</span>
  </div>

  <div class="g2">
    <div>
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:8px;">CHỌN POD ĐỂ CRASH</div>
      <div id="kill-list"></div>
      <div id="heal-status" style="margin-top:10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:10px;font-size:.72rem;font-family:monospace;min-height:44px;line-height:1.7;color:var(--muted);">— Chưa có sự kiện</div>
      <div style="margin-top:12px;background:var(--red-bg);border:1px solid var(--red-bd);border-radius:7px;padding:10px;">
        
      
      </div>
    </div>
    <div>
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:8px;">SELF-HEALING TIMELINE</div>
      <div class="timeline">
        <div class="tl-line"></div>
        <div class="tl-item" id="tl0">
          <div class="tl-dot"></div>
          <div class="tl-head">t=0s &nbsp; Pod crash</div>
          <div class="tl-body">Process exit(1) — Pod không phản hồi</div>
        </div>
        <div class="tl-item" id="tl1">
          <div class="tl-dot"></div>
          <div class="tl-head">t=1s &nbsp; Liveness probe fail</div>
          <div class="tl-body">HTTP GET /health → Connection refused (3 lần)</div>
        </div>
        <div class="tl-item" id="tl2">
          <div class="tl-dot"></div>
          <div class="tl-head">t=2s &nbsp; K8s xóa Pod dead</div>
          <div class="tl-body">Pod bị rút khỏi Service pool — không nhận request mới</div>
        </div>
        <div class="tl-item" id="tl3">
          <div class="tl-dot"></div>
          <div class="tl-head">t=3s &nbsp; Tạo Pod thay thế</div>
          <div class="tl-body">K8s pull image, khởi động container mới</div>
        </div>
        <div class="tl-item" id="tl4">
          <div class="tl-dot"></div>
          <div class="tl-head">t=5s &nbsp; Readiness probe pass</div>
          <div class="tl-body">HTTP GET /health → 200 OK → thêm vào Service pool</div>
        </div>
        <div class="tl-item" id="tl5">
          <div class="tl-dot"></div>
          <div class="tl-head"> Online — Pod kế thừa state từ Redis</div>
          <div class="tl-body" id="tl5-body">Hệ thống phục hồi hoàn toàn, 0 data loss</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- LOG -->
<div class="section">
  <div class="section-head">
    <div class="section-num" style="background:#0f172a;color:#38bdf8;">⬛</div>
    <div>
      <div class="section-title">Real-Time Event Log</div>
     
    </div>
  </div>
  <div id="log"></div>
</div>

<div class="footer">☸ Kubernetes Demo </div>
</div><!-- /main -->

<script>
// ════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════
const MAX_PODS = 10, INIT_PODS = 3;
let podCounter = 0;
let pods = [];           // {num, id, status:'alive'|'dead'|'boot', hits}
let usedNums = new Set();
let totalRequests = 0;
let rrIndex = 0;         // round-robin cursor
let hpaCpu = 8, hpaPhase = 'idle';
let stressIv = null, sdTimer = null, scaleIv = null;
let healLock = false;
let scenario = 'normal'; // 'normal' | 'flash'
let trafficIv = null;

function nextNum() {
  for (let i = podCounter + 1; i <= 999; i++) {
    if (!usedNums.has(i)) { podCounter = i; return i; }
  }
  return null;
}
function resetCounter() { podCounter = 0; usedNums.clear(); }

function addPodObj(num, status, hits) {
  usedNums.add(num);
  pods.push({ num, id:'Pod-'+num, status, hits: hits||0 });
}

// ── Init ──
function initPods() {
  pods = []; resetCounter();
  for (let i = 0; i < INIT_PODS; i++) {
    const n = nextNum();
    addPodObj(n, 'alive', 0);
  }
}
initPods();

// ── Colors ──
const COLORS = ['#2563eb','#16a34a','#dc2626','#ea580c','#7c3aed','#0891b2','#be185d','#b45309','#0f766e','#9333ea'];
const colMap = {};
function podColor(id) {
  if (!colMap[id]) colMap[id] = COLORS[Object.keys(colMap).length % COLORS.length];
  return colMap[id];
}

// ════════════════════════════════════════════════
// TOAST / LOG
// ════════════════════════════════════════════════
function toast(msg, cls='blue', ms=2800) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show t-'+cls;
  clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('show'), ms);
}
function log(msg, col='#38bdf8') {
  const el = document.getElementById('log');
  const d = document.createElement('div');
  d.style.color = col;
  d.textContent = '['+new Date().toLocaleTimeString()+'] '+msg;
  el.appendChild(d); el.scrollTop = el.scrollHeight;
  if (el.children.length > 120) el.removeChild(el.firstChild);
}
function hpaLog(msg, col='#a5f3fc') {
  const el = document.getElementById('hpa-log');
  const d = document.createElement('div');
  d.style.color = col;
  d.textContent = '['+new Date().toLocaleTimeString('vi',{hour12:false})+'] '+msg;
  el.appendChild(d); el.scrollTop = el.scrollHeight;
  if (el.children.length > 60) el.removeChild(el.firstChild);
}

// ════════════════════════════════════════════════
// FLOW HELPERS
// ════════════════════════════════════════════════
function flowSet(prefix, ids, cls) {
  for (const id of ids) {
    const el = document.getElementById(prefix+id);
    if (el) el.className = 'flow-step' + (cls ? ' s-'+cls : '');
  }
}
function flowReset(prefix, total) {
  for (let i = 0; i < total; i++) {
    const el = document.getElementById(prefix+i);
    if (el) el.className = 'flow-step';
  }
}

// ════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════
function render() {
  renderPodGrid();
  renderLB();
  renderKillList();
  renderDesiredState();
  updateHPAUI();
  document.getElementById('total-req').textContent = totalRequests.toLocaleString();
  document.getElementById('pod-count-val').textContent = pods.filter(p=>p.status!=='dead').length;
}

function renderPodGrid() {
  const g = document.getElementById('pod-grid');
  const sorted = [...pods].sort((a,b)=>a.num-b.num);
  g.innerHTML = sorted.map(p => {
    const cls = p.status==='alive'?'alive':p.status==='boot'?'boot':'dead';
    return \`<div class="pod-dot \${cls}" title="\${p.id} (\${p.status}) \${p.hits} reqs">\${p.num}</div>\`;
  }).join('');
}

function renderLB() {
  const alive = pods.filter(p=>p.status==='alive').sort((a,b)=>a.num-b.num);
  const maxH = Math.max(...alive.map(p=>p.hits), 1);
  const lbEl = document.getElementById('lb-pods');
  lbEl.innerHTML = alive.map(p => {
    const pct = Math.round(p.hits / maxH * 100);
    const c = podColor(p.id);
    return \`<div class="lb-pod" style="min-width:40px;flex:1;">
      <div class="lb-hit-count" style="color:\${c}">\${p.hits}</div>
      <div class="lb-bar-wrap">
        <div class="lb-bar-fill" style="height:\${pct}%;background:\${c};"></div>
      </div>
      <div class="lb-pod-label" style="color:\${c}">\${p.id}</div>
      <div class="lb-status live">LIVE</div>
    </div>\`;
  }).join('');

  // stats
  const total = alive.reduce((s,p)=>s+p.hits,0)||1;
  document.getElementById('lb-stats').innerHTML = alive.map(p => {
    const pct = Math.round(p.hits/total*100);
    return \`<div style="display:flex;align-items:center;gap:6px;font-size:.68rem;">
      <span style="width:52px;font-weight:700;font-family:monospace;color:\${podColor(p.id)}">\${p.id}</span>
      <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:\${pct}%;background:\${podColor(p.id)};border-radius:4px;transition:width .4s;"></div>
      </div>
      <span style="width:30px;text-align:right;font-family:monospace;font-weight:700;">\${p.hits}</span>
      <span style="width:32px;text-align:right;color:var(--muted);">\${pct}%</span>
    </div>\`;
  }).join('');
}

function renderKillList() {
  const alive = pods.filter(p=>p.status==='alive').sort((a,b)=>a.num-b.num);
  document.getElementById('kill-list').innerHTML = alive.length
    ? alive.map(p => \`
      <div class="kill-row">
        <div style="flex:1;font-size:.72rem;font-weight:700;font-family:monospace;color:\${podColor(p.id)};">\${p.id} <span style="color:var(--muted);font-weight:400;">\${p.hits} reqs</span></div>
        <span class="tag tag-green">LIVE</span>
        <button class="kill-btn" onclick="killPod('\${p.id}')" \${healLock?'disabled':''}>💥 Crash</button>
      </div>\`).join('')
    : '<div style="color:var(--muted);font-size:.75rem;padding:8px;">Không có pod alive</div>';
}

function renderDesiredState() {
  const alive = pods.filter(p=>p.status==='alive').length;
  const desired = INIT_PODS;
  const ok = alive >= desired;
  document.getElementById('desired-state-grid').innerHTML = \`
    <div class="state-item \${ok?'ok':'warn'}">
      <div class="si-val">\${desired}</div>
      <div class="si-label">Desired Replicas</div>
    </div>
    <div class="state-item \${ok?'ok':'warn'}">
      <div class="si-val">\${alive}</div>
      <div class="si-label">Actual Alive</div>
    </div>
    <div class="state-item \${ok?'ok':'warn'}">
      <div class="si-val">\${ok?'':'⚠'}</div>
      <div class="si-label">\${ok?'In Sync':'Reconciling'}</div>
    </div>\`;

  document.getElementById('rc-actual').textContent = alive;
  const rcAct = document.getElementById('rc-action');
  if (ok) {
    rcAct.style.color = 'var(--green)';
    rcAct.textContent = ' Trạng thái khớp — không cần hành động';
  } else {
    rcAct.style.color = 'var(--orange)';
    rcAct.textContent = '⚙ Đang tạo Pod mới để đủ '+desired+' replicas...';
  }
  document.getElementById('yaml-replicas').textContent = pods.filter(p=>p.status!=='dead').length;
}

function updateHPAUI() {
  const rep = pods.filter(p=>p.status!=='dead').length;
  document.getElementById('hpa-rep-big').textContent = rep;
  document.getElementById('rep-fill').style.width = Math.round(rep/MAX_PODS*100)+'%';
  document.getElementById('rep-val').textContent = rep+'/'+MAX_PODS;

  const cpu = Math.round(hpaCpu);
  const cpuFill = document.getElementById('cpu-fill');
  cpuFill.style.width = cpu+'%';
  cpuFill.style.background = cpu>70?'var(--red)':cpu>50?'var(--orange)':'var(--green)';
  document.getElementById('cpu-pct').textContent = cpu+'%';

  const phaseMap = {idle:'IDLE',scaling_up:'SCALE UP ↑',max:'MAX ('+MAX_PODS+')',scaling_down:'SCALE DOWN ↓'};
  const clsMap   = {idle:'tag-green',scaling_up:'tag-orange',max:'tag-red',scaling_down:'tag-purple'};
  const noteMap  = {idle:'Hệ thống bình thường | CPU thấp',scaling_up:'⬆ Đang thêm Pod! CPU cao',max:'🚀 Đạt max '+MAX_PODS+' Pods',scaling_down:'⬇ Thu hồi Pod thừa | CPU giảm'};
  document.getElementById('hpa-phase-tag').textContent = phaseMap[hpaPhase]||hpaPhase;
  document.getElementById('hpa-phase-tag').className = 'tag '+(clsMap[hpaPhase]||'tag-green');
  document.getElementById('hpa-note').textContent = noteMap[hpaPhase]||'';
}

// ════════════════════════════════════════════════
// SCENARIO
// ════════════════════════════════════════════════
function setScenario(s) {
  scenario = s;
  clearInterval(trafficIv);
  if (s === 'flash') {
    toast('⚡ Flash Sale bắt đầu! Traffic tăng đột biến...', 'orange', 4000);
    log('⚡ FLASH SALE! Lưu lượng tăng đột biến', '#fb923c');
    let rps = 0;
    trafficIv = setInterval(() => {
      rps = Math.min(50000, rps + 3000 + Math.random()*2000);
      document.getElementById('rps-val').textContent = Math.round(rps).toLocaleString();
      document.getElementById('traffic-fill').style.width = Math.min(100, rps/500)+'%';
    }, 500);
    // auto stress
    setTimeout(startStress, 1000);
  } else {
    document.getElementById('rps-val').textContent = '0';
    document.getElementById('traffic-fill').style.width = '0%';
    log('📉 Traffic trở về bình thường', '#38bdf8');
  }
}

// ════════════════════════════════════════════════
// LOAD BALANCING — SEND REQUESTS
// ════════════════════════════════════════════════
function pickPod() {
  const alive = pods.filter(p=>p.status==='alive');
  if (!alive.length) return null;
  const p = alive[rrIndex % alive.length];
  rrIndex++;
  return p;
}

function sendOneRequest() {
  const p = pickPod();
  if (!p) { toast('Không có pod alive!','red',2000); return; }
  p.hits++;
  totalRequests++;
  log(\`📤 Request → \${p.id} (total: \${totalRequests}, pod hits: \${p.hits})\`, '#7dd3fc');
  render();
}

async function sendBurst() {
  const btn = event.target;
  btn.disabled = true; btn.textContent = '⚡ Đang gửi...';
  log('⚡ 100 requests (mô phỏng Flash Sale burst)...', '#fbbf24');
  for (let i = 0; i < 100; i++) {
    const p = pickPod();
    if (!p) break;
    p.hits++;
    totalRequests++;
    if (i % 10 === 0) { render(); await sleep(30); }
  }
  render();
  log(\` 100 requests xong! Total: \${totalRequests}\`, '#4ade80');
  toast(' 100 requests phân phối đều vào '+pods.filter(p=>p.status==='alive').length+' Pods', 'green', 3000);
  btn.disabled = false; btn.textContent = '⚡ Gửi 100 Requests';
}

// ════════════════════════════════════════════════
// HPA / STRESS CPU
// ════════════════════════════════════════════════
function startStress() {
  if (stressIv) return;
  const btn = document.getElementById('stop-stress-btn');
  btn.disabled = false;
  hpaCpu = 8; hpaPhase = 'idle';
  log(' CPU Stress bắt đầu — HPA đang theo dõi CPU...', '#fbbf24');
  hpaLog('INFO: CPU utilization monitoring started');
  toast(' CPU tăng! HPA sẽ scale up...', 'orange', 3000);

  let t = 0;
  stressIv = setInterval(() => {
    t++;
    // CPU curve
    if (t <= 3) {
      hpaCpu = Math.min(92, 8 + t*28);
      if (hpaCpu > 50 && hpaPhase === 'idle') {
        hpaPhase = 'scaling_up';
        flowSet('hf',[0,1,2],'orange');
        hpaLog(\`WARNING: CPU \${Math.round(hpaCpu)}% > 50% threshold → triggering scale up\`, '#fbbf24');
        log(\`⚠ HPA: CPU \${Math.round(hpaCpu)}% > 50% → scale up kích hoạt!\`, '#fbbf24');
      }
    } else if (t <= 20) {
      const alive = pods.filter(p=>p.status==='alive').length;
      hpaCpu = Math.max(35, 92 - (alive - INIT_PODS) * 8);
    } else {
      hpaCpu = Math.max(8, hpaCpu - 15);
      if ((hpaPhase==='scaling_up'||hpaPhase==='max') && hpaCpu <= 50) {
        hpaPhase = 'scaling_down';
        flowSet('hf',[0,1,2,3],'orange');
        flowSet('hf',[4],'green');
        hpaLog('INFO: CPU below threshold → scale down cooldown 3s', '#a5f3fc');
        log(' CPU thấp → HPA bắt đầu scale down...', '#a78bfa');
        startScaleDown();
      }
    }

    // Scale up: thêm pod mỗi 2s
    if (hpaPhase === 'scaling_up' && t >= 2 && t % 2 === 0) {
      const cur = pods.filter(p=>p.status!=='dead').length;
      const toAdd = Math.min(3, MAX_PODS - cur);
      for (let i = 0; i < toAdd; i++) {
        const n = nextNum(); if (!n) break;
        usedNums.add(n);
        const nid = 'Pod-'+n;
        const obj = { num:n, id:nid, status:'boot', hits:0 };
        pods.push(obj);
        hpaLog(\`INFO: Scaling up → creating \${nid} (replicas: \${cur+i+1}/\${MAX_PODS})\`, '#a5f3fc');
        log(\`➕ HPA tạo \${nid} (CPU:\${Math.round(hpaCpu)}%, Pods: \${cur+i+1})\`, '#a78bfa');
        const _n = n;
        setTimeout(() => {
          const p = pods.find(x=>x.num===_n && x.status==='boot');
          if (p) { p.status='alive'; render(); hpaLog(\`INFO: \${nid} → Running\`, '#4ade80'); }
        }, 1500);
      }
      if (pods.filter(p=>p.status!=='dead').length >= MAX_PODS) {
        hpaPhase = 'max';
        hpaLog(\`WARNING: Reached maxReplicas=\${MAX_PODS}\`, '#f87171');
        log(\` Đạt max \${MAX_PODS} Pods!\`, '#f87171');
        flowSet('hf',[0,1,2,3],'red');
      }
    }
    render();
  }, 1000);
}

function stopStress() {
  clearInterval(stressIv); stressIv = null;
  document.getElementById('stop-stress-btn').disabled = true;
  log('⏹ Stress dừng — CPU đang giảm...', '#94a3b8');
  hpaLog('INFO: Stress stopped — CPU cooling down');
  // gradually cool down
  const cool = setInterval(() => {
    hpaCpu = Math.max(8, hpaCpu - 20);
    if (hpaCpu <= 8) { clearInterval(cool); }
    if (hpaCpu <= 50 && (hpaPhase==='scaling_up'||hpaPhase==='max')) {
      hpaPhase='scaling_down'; startScaleDown(); clearInterval(cool);
    }
    render();
  }, 800);
}

function startScaleDown() {
  if (sdTimer) return;
  sdTimer = setTimeout(() => {
    const iv = setInterval(() => {
      const sims = pods.filter(p=>p.status==='alive');
      const total = pods.filter(p=>p.status!=='dead').length;
      if (total <= INIT_PODS) {
        clearInterval(iv); sdTimer = null;
        hpaPhase='idle'; hpaCpu=8;
        flowReset('hf', 5);
        hpaLog(\`INFO: Scale down complete → \${INIT_PODS} replicas (minReplicas)\`, '#4ade80');
        log(\` Scale down xong → \${INIT_PODS} Pods (min replicas)\`, '#4ade80');
        toast(' HPA scale down về '+INIT_PODS+' Pods', 'green', 3000);
        render(); return;
      }
      // remove simulated pods (highest number first)
      const toRemove = sims.filter(p=>p.num>INIT_PODS).sort((a,b)=>b.num-a.num).slice(0,2);
      for (const p of toRemove) {
        usedNums.delete(p.num);
        hpaLog(\`INFO: Scaling down → terminating \${p.id}\`, '#a5f3fc');
        log(\`➖ HPA xóa \${p.id} (CPU thấp, Pods: \${total-1})\`, '#94a3b8');
      }
      pods = pods.filter(p=>!toRemove.includes(p));
      render();
    }, 2000);
  }, 3000);
}

// ════════════════════════════════════════════════
// SELF-HEALING — KILL POD
// ════════════════════════════════════════════════
function setTL(idx, cls) {
  const el = document.getElementById('tl'+idx);
  if (el) el.className = 'tl-item '+cls;
}
function resetTL() {
  for (let i=0;i<=5;i++) setTL(i,'');
}

function killPod(podId) {
  if (healLock) { toast('⏳ Đang healing, vui lòng đợi...','orange',2000); return; }
  const pod = pods.find(p=>p.id===podId && p.status==='alive');
  if (!pod) return;

  healLock = true;
  const oldHits = pod.hits;
  const oldNum  = pod.num;

  // t=0
  pod.status = 'dead';
  resetTL(); setTL(0,'error');
  flowSet('shf',[0,1],'red');
  setHeal(\`<span style="color:var(--red)">💀 \${podId} → CRASHED! (đã xử lý \${oldHits} requests)</span>\`);
  log(\`💀 \${podId} crash! Exit code 1 — liveness probe fail\`, '#f87171');
  toast(\`💀 \${podId} crashed!\`, 'red', 3000);
  render();

  // t=1s: probe fail
  setTimeout(() => {
    setTL(0,'done'); setTL(1,'active');
    flowSet('shf',[2],'orange');
    setHeal(\`<span style="color:var(--orange)">🔍 Liveness probe: GET /health → Connection refused (fail 3/3)</span>\`);
    log(\`🔍 K8s: liveness probe fail x3 → \${podId} đánh dấu Unhealthy\`, '#fbbf24');
  }, 1000);

  // t=2s: remove from pool
  setTimeout(() => {
    setTL(1,'done'); setTL(2,'active');
    flowSet('shf',[3],'orange');
    setHeal(\`<span style="color:var(--orange)"> \${podId} rút khỏi Service pool — không nhận request mới</span>\`);
    log(\` \${podId} rút khỏi endpoint pool\`, '#fbbf24');
  }, 2000);

  // t=3s: create new
  let newPodRef = null;
  setTimeout(() => {
    setTL(2,'done'); setTL(3,'active');
    // Get new number HIGHER than current max (never reuse old num)
    const newNum = nextNum();
    if (newNum !== null) {
      usedNums.add(newNum);
      const newId = 'Pod-'+newNum;
      newPodRef = { num:newNum, id:newId, status:'boot', hits:oldHits };
      pods.push(newPodRef);
      flowSet('shf',[4],'orange');
      setHeal(\`<span style="color:var(--orange)">🆕 K8s tạo \${newId} — pulling image, khởi động... (kế thừa \${oldHits} reqs từ Redis)</span>\`);
      log(\` \${newId} boot → thay \${podId} (kế thừa state Redis: \${oldHits} hits)\`, '#fb923c');
      render();
    }
  }, 3000);

  // t=5s: healthy
  setTimeout(() => {
    // Remove dead pod, release old num
    pods = pods.filter(p => !(p.id===podId && p.status==='dead'));
    usedNums.delete(oldNum);

    if (newPodRef) {
      newPodRef.status = 'alive';
      setTL(3,'done'); setTL(4,'done'); setTL(5,'done');
      flowSet('shf',[5],'green');
      const t5 = document.getElementById('tl5-body');
      if (t5) t5.textContent = \`\${newPodRef.id} healthy — \${oldHits} hits kế thừa từ Redis\`;
      setHeal(\`<span style="color:var(--green)"> \${newPodRef.id} LIVE! Hits: \${newPodRef.hits} — đã thay \${podId}. 0 downtime.</span>\`);
      log(\` Self-Healing: \${newPodRef.id} healthy → thay \${podId} | 0 data loss\`, '#4ade80');
      toast(\` \${newPodRef.id} thay thế \${podId}! 0 downtime\`, 'green', 4000);
    }
    healLock = false;
    render();
    setTimeout(() => flowReset('shf', 6), 4000);
  }, 5000);
}

function setHeal(html) {
  document.getElementById('heal-status').innerHTML = html;
}

// ════════════════════════════════════════════════
// DECLARATIVE — MANUAL DELETE (DEMO)
// ════════════════════════════════════════════════
function manualDelete() {
  const alive = pods.filter(p=>p.status==='alive');
  if (!alive.length) { toast('Không có pod để xóa','red',2000); return; }
  const target = alive[0];
  log(\`🗑 kubectl delete pod \${target.id} → K8s đang reconcile...\`, '#fbbf24');
  toast(\`K8s phát hiện thiếu 1 replica → đang tạo lại...\`, 'orange', 3000);
  killPod(target.id);
}

// ════════════════════════════════════════════════
// RESET
// ════════════════════════════════════════════════
function resetAll() {
  clearInterval(stressIv); stressIv = null;
  clearInterval(trafficIv); trafficIv = null;
  clearTimeout(sdTimer); sdTimer = null;
  healLock = false;
  hpaCpu = 8; hpaPhase = 'idle';
  totalRequests = 0; rrIndex = 0; scenario = 'normal';
  initPods();
  document.getElementById('rps-val').textContent = '0';
  document.getElementById('traffic-fill').style.width = '0%';
  document.getElementById('heal-status').innerHTML = '— Chưa có sự kiện';
  document.getElementById('hpa-log').innerHTML = '';
  document.getElementById('log').innerHTML = '';
  document.getElementById('stop-stress-btn').disabled = true;
  flowReset('hf', 5); flowReset('shf', 6); resetTL();
  render();
  log('↺ Reset về trạng thái ban đầu — 3 Pods, 0 requests', '#38bdf8');
  toast(' Reset thành công!', 'green', 2000);
}

// ════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

// ── Auto-traffic when Flash Sale ──
setInterval(() => {
  if (scenario === 'flash') {
    for (let i = 0; i < 3; i++) {
      const p = pickPod();
      if (p) { p.hits++; totalRequests++; }
    }
    render();
  }
}, 300);

// ── Initial render ──
render();
log('☸ Kubernetes cluster khởi động — 3 Pods sẵn sàng', '#4ade80');
log(' Chọn "⚡ Flash Sale" để xem toàn bộ 4 tính chất hoạt động', '#38bdf8');
hpaLog('INFO: HPA controller started — watching CPU metrics');
hpaLog('INFO: minReplicas=3 maxReplicas=15 targetCPU=50%');
</script>
<script>
// ════════════════════════════════════════════════════════════════
// SSE BRIDGE — kết nối Minikube server.js với k8s-demo.html UI
// Inject vào HTML trước </body> — chạy sau tất cả scripts của page
// ════════════════════════════════════════════════════════════════
(function() {
  // Chờ cho đến khi state vars của k8s-demo.html sẵn sàng
  function waitReady(cb) {
    if (typeof pods !== 'undefined' && typeof render === 'function' &&
        typeof totalRequests !== 'undefined') cb();
    else setTimeout(() => waitReady(cb), 50);
  }

  waitReady(function() {
    // ── SSE connection ──
    const es = new EventSource('/events');
    es.onmessage = function(ev) {
      const d = JSON.parse(ev.data);
      if (d.type === 'hello') {
        window._srvLabel = d.label;
        log('☸ Redis connected — ' + d.label + ' | Shared state active', '#4ade80');
        // Load total từ Redis ngay khi connect
        _loadRedisState();
      }
      if (d.type === 'hit') {
        // Đồng bộ total với Redis (tránh drift)
        if (d.total > totalRequests) totalRequests = d.total;
        document.getElementById('total-req').textContent = totalRequests.toLocaleString();
      }
      if (d.type === 'reset') {
        window._srvLabel = d.myLabel;
        // Gọi resetAll gốc (đã được override bên dưới, dùng bản gốc)
        _origReset();
        log('↺ Redis cleared — ' + d.myLabel + ' | Cluster restarted', '#38bdf8');
      }
    };
    es.onerror = function() { /* tự reconnect */ };

    // Load Redis state — luôn ghi đè totalRequests kể cả khi = 0
    function _loadRedisState() {
      fetch('/api/state').then(r=>r.json()).then(d => {
        totalRequests = d.total || 0;
        document.getElementById('total-req').textContent = totalRequests.toLocaleString();
        render();
      }).catch(()=>{});
    }

    // ── Lưu bản gốc để dùng trong SSE handler ──
    const _origReset = window.resetAll;

    // ── Override sendOneRequest: local + Redis ──
    window.sendOneRequest = async function() {
      const p = pickPod();
      if (!p) { toast('Không có pod alive!','red',2000); return; }
      p.hits++;
      totalRequests++;
      document.getElementById('total-req').textContent = totalRequests.toLocaleString();
      log(' Request → ' + p.id + ' (total: ' + totalRequests + ', pod hits: ' + p.hits + ')', '#7dd3fc');
      render();
      // Ghi Redis bất đồng bộ
      fetch('/api/hit', {method:'POST'}).catch(()=>{});
    };

    // ── Override sendBurst: local (fast) + Redis (sampled) ──
    window.sendBurst = async function() {
      const btn = document.querySelector('button[onclick="sendBurst()"]');
      if (btn) { btn.disabled=true; btn.textContent='⚡ Đang gửi...'; }
      log(' 100 requests (Flash Sale burst)...', '#fbbf24');
      for (let i = 0; i < 100; i++) {
        const p = pickPod();
        if (!p) break;
        p.hits++;
        totalRequests++;
        if (i % 10 === 0) {
          document.getElementById('total-req').textContent = totalRequests.toLocaleString();
          render();
          await new Promise(r => setTimeout(r, 25));
        }
        // Ghi Redis mỗi 10 req
        if (i % 10 === 0) fetch('/api/hit',{method:'POST'}).catch(()=>{});
      }
      document.getElementById('total-req').textContent = totalRequests.toLocaleString();
      render();
      log('100 requests xong! Total: ' + totalRequests, '#4ade80');
      toast(' 100 requests phân phối đều vào '+pods.filter(p=>p.status==='alive').length+' Pods','green',3000);
      if (btn) { btn.disabled=false; btn.textContent='⚡ Gửi 100 Requests'; }
    };

    // ── Override resetAll: xóa Redis rồi reset local ngay (không chờ SSE) ──
    window.resetAll = async function() {
      try {
        await fetch('/api/reset', {method:'POST'});
        _origReset(); // Gọi trực tiếp sau khi fetch xong
      } catch(e) {
        _origReset();
        log('↺ Reset local (offline mode)', '#94a3b8');
      }
    };

    // Auto-traffic trong Flash Sale cũng ghi Redis (sampled)
    let _flashCount = 0;
    const _origFlashInterval = setInterval(function() {
      if (typeof scenario !== 'undefined' && scenario === 'flash') {
        _flashCount++;
        if (_flashCount % 10 === 0) {
          fetch('/api/hit',{method:'POST'}).catch(()=>{});
        }
      }
    }, 300);

    _loadRedisState();
  });
})();
</script>
</body>
</html>
`;

// ── HTTP Server ──────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + req.headers.host);
  res.setHeader("Access-Control-Allow-Origin", "*");

  // K8s liveness / readiness probe
  if (
    url.pathname === "/health" ||
    url.pathname === "/ready" ||
    url.pathname === "/live"
  ) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({ ok: true, pod: POD_HOSTNAME, label: MY_LABEL }),
    );
  }

  // SSE stream
  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(
      "data: " +
        JSON.stringify({ type: "hello", pod: POD_HOSTNAME, label: MY_LABEL }) +
        "\n\n",
    );
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  // /api/hit — ghi Redis, trả total
  if (url.pathname === "/api/hit" && req.method === "POST") {
    try {
      const total = await store.incr("total_hits");
      const podHits = await store.hIncrBy("pod_hits", POD_HOSTNAME, 1);
      broadcast({ type: "hit", label: MY_LABEL, total, podHits });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ total, label: MY_LABEL, podHits }));
    } catch (e) {
      res.writeHead(500);
      res.end("{}");
    }
    return;
  }

  // /api/state — snapshot Redis
  if (url.pathname === "/api/state") {
    try {
      const total = parseInt((await store.get("total_hits")) || 0);
      const podHits = (await store.hGetAll("pod_hits")) || {};
      const podLabels = (await store.hGetAll("pod_labels")) || {};
      const hb = (await store.hGetAll("pod_hb")) || {};
      const now = Date.now();
      const alive = Object.entries(hb)
        .filter(([, t]) => now - parseInt(t) < 8000)
        .map(([h]) => h);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          total,
          podHits,
          podLabels,
          alive,
          myPod: POD_HOSTNAME,
          myLabel: MY_LABEL,
        }),
      );
    } catch (e) {
      res.writeHead(500);
      res.end("{}");
    }
    return;
  }

  // /api/crash-self — K8s tự restart pod
  if (url.pathname === "/api/crash-self" && req.method === "POST") {
    slog("CRASH SELF");
    await store.hDel("pod_hb", POD_HOSTNAME).catch(() => {});
    broadcast({ type: "pod_dead", label: MY_LABEL });
    res.writeHead(200);
    res.end("{}");
    setTimeout(() => process.exit(1), 300);
    return;
  }

  // /api/reset — xóa Redis, gán lại label
  if (url.pathname === "/api/reset" && req.method === "POST") {
    await store
      .del([
        "total_hits",
        "pod_hits",
        "pod_labels",
        "pod_label_counter",
        "pod_hb",
      ])
      .catch(() => {});
    MY_LABEL = null;
    await initLabel();
    slog("RESET → " + MY_LABEL);
    broadcast({ type: "reset", myLabel: MY_LABEL });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, myLabel: MY_LABEL }));
    return;
  }

  // Serve HTML
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML);
});

server.listen(3000, () => slog("K8s Demo :3000"));