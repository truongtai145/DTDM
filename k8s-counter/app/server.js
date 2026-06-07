const http = require('http');
const os = require('os');
const redis = require('redis');

const client = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  }
});

client.connect().catch(console.error);

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
    return;
  }

  if (req.url === '/api/count') {
    try {
      const count = await client.incr('visit_count');
      const podVisits = await client.incr(`pod:${os.hostname()}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total: count,
        pod: os.hostname(),
        podVisits
      }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Redis error' }));
    }
    return;
  }

  if (req.url === '/api/reset') {
    await client.set('visit_count', 0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Serve HTML
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

const HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>K8s Counter Demo</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --border: #1e1e2e;
      --accent: #00ff88;
      --accent2: #ff6b6b;
      --accent3: #6b9fff;
      --text: #e0e0e0;
      --muted: #555566;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'DM Sans', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      overflow: hidden;
    }

    /* Animated grid background */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(0,255,136,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,255,136,0.03) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
    }

    .wrapper {
      width: 100%;
      max-width: 720px;
      position: relative;
      z-index: 1;
    }

    /* Header */
    .header {
      text-align: center;
      margin-bottom: 40px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(0,255,136,0.08);
      border: 1px solid rgba(0,255,136,0.2);
      color: var(--accent);
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 16px;
      letter-spacing: 1px;
    }

    .badge::before {
      content: '';
      width: 6px; height: 6px;
      background: var(--accent);
      border-radius: 50%;
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.8); }
    }

    h1 {
      font-size: clamp(1.8rem, 5vw, 2.8rem);
      font-weight: 600;
      letter-spacing: -1px;
      line-height: 1.1;
    }

    h1 span { color: var(--accent); }

    .subtitle {
      color: var(--muted);
      margin-top: 8px;
      font-size: 0.95rem;
    }

    /* Counter card */
    .counter-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 40px;
      text-align: center;
      margin-bottom: 20px;
      position: relative;
      overflow: hidden;
    }

    .counter-card::after {
      content: '';
      position: absolute;
      top: 0; left: 50%;
      transform: translateX(-50%);
      width: 200px; height: 1px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
    }

    .count-label {
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      color: var(--muted);
      letter-spacing: 3px;
      text-transform: uppercase;
      margin-bottom: 12px;
    }

    .count-number {
      font-family: 'Space Mono', monospace;
      font-size: clamp(4rem, 15vw, 7rem);
      font-weight: 700;
      color: var(--accent);
      line-height: 1;
      text-shadow: 0 0 40px rgba(0,255,136,0.3);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .count-number.bump {
      transform: scale(1.15);
      text-shadow: 0 0 60px rgba(0,255,136,0.6);
    }

    .count-sub {
      color: var(--muted);
      font-size: 0.85rem;
      margin-top: 8px;
    }

    /* Hit button */
    .btn-hit {
      width: 100%;
      padding: 18px;
      background: var(--accent);
      color: #000;
      border: none;
      border-radius: 12px;
      font-family: 'Space Mono', monospace;
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: 1px;
      cursor: pointer;
      transition: all 0.15s ease;
      margin-bottom: 20px;
    }

    .btn-hit:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(0,255,136,0.3);
    }

    .btn-hit:active {
      transform: translateY(0) scale(0.98);
    }

    /* Info grid */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
    }

    .info-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
    }

    .info-card .label {
      font-size: 0.7rem;
      color: var(--muted);
      font-family: 'Space Mono', monospace;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .info-card .value {
      font-family: 'Space Mono', monospace;
      font-size: 0.85rem;
      word-break: break-all;
    }

    .pod-name { color: var(--accent3); }
    .pod-visits { color: var(--accent2); font-size: 1.4rem !important; }

    /* K8s concept pills */
    .concepts {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }

    .pill {
      flex: 1;
      min-width: 120px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 16px;
      font-size: 0.8rem;
    }

    .pill .pill-icon { font-size: 1.2rem; margin-bottom: 4px; }
    .pill .pill-name {
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      color: var(--accent);
      margin-bottom: 2px;
    }
    .pill .pill-desc { color: var(--muted); font-size: 0.72rem; line-height: 1.4; }

    /* Reset button */
    .btn-reset {
      width: 100%;
      padding: 12px;
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
      border-radius: 10px;
      font-family: 'Space Mono', monospace;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-reset:hover {
      border-color: var(--accent2);
      color: var(--accent2);
    }

    /* Status indicator */
    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 16px;
      font-size: 0.75rem;
      color: var(--muted);
      font-family: 'Space Mono', monospace;
    }

    .dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--accent);
      animation: pulse 2s ease-in-out infinite;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="badge">☸ KUBERNETES DEMO</div>
      <h1>Visit <span>Counter</span></h1>
      <p class="subtitle">Mỗi lần nhấn → Redis tăng 1, Pod phục vụ có thể khác nhau</p>
    </div>

    <div class="counter-card">
      <div class="count-label">TỔNG SỐ LƯỢT TRUY CẬP</div>
      <div class="count-number" id="count">—</div>
      <div class="count-sub">Lưu trong Redis · Shared giữa tất cả Pod</div>
    </div>

    <button class="btn-hit" onclick="hit()">[ NHẤN ĐỂ TĂNG ĐẾM ] +1</button>

    <div class="info-grid">
      <div class="info-card">
        <div class="label">POD ĐANG PHỤC VỤ</div>
        <div class="value pod-name" id="pod-name">—</div>
      </div>
      <div class="info-card">
        <div class="label">LƯỢT CỦA POD NÀY</div>
        <div class="value pod-visits" id="pod-visits">—</div>
      </div>
    </div>

    <div class="concepts">
      <div class="pill">
        <div class="pill-icon">📦</div>
        <div class="pill-name">POD</div>
        <div class="pill-desc">Chứa container app Node.js này</div>
      </div>
      <div class="pill">
        <div class="pill-icon">⚙️</div>
        <div class="pill-name">DEPLOYMENT</div>
        <div class="pill-desc">Duy trì 3 Pod luôn sống</div>
      </div>
      <div class="pill">
        <div class="pill-icon">🌐</div>
        <div class="pill-name">SERVICE</div>
        <div class="pill-desc">Load balance giữa các Pod</div>
      </div>
      <div class="pill">
        <div class="pill-icon">🗄️</div>
        <div class="pill-name">REDIS</div>
        <div class="pill-desc">Shared state cho mọi Pod</div>
      </div>
    </div>

    <button class="btn-reset" onclick="reset()">↺ RESET BỘ ĐẾM</button>

    <div class="status">
      <div class="dot"></div>
      <span id="status-text">Đang kết nối...</span>
    </div>
  </div>

  <script>
    let prevCount = 0;

    async function hit() {
      try {
        const res = await fetch('/api/count');
        const data = await res.json();

        const el = document.getElementById('count');
        el.textContent = data.total;
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
        setTimeout(() => el.classList.remove('bump'), 400);

        document.getElementById('pod-name').textContent = data.pod;
        document.getElementById('pod-visits').textContent = data.podVisits;
        document.getElementById('status-text').textContent =
          'Redis OK · K8s Service đang load balance';
      } catch (e) {
        document.getElementById('status-text').textContent = 'Lỗi kết nối Redis!';
      }
    }

    async function reset() {
      await fetch('/api/reset');
      document.getElementById('count').textContent = '0';
      document.getElementById('pod-visits').textContent = '0';
    }

    // Load count on start
    hit();
  </script>
</body>
</html>`;

server.listen(3000, () => console.log('🚀 Server running on port 3000'));
