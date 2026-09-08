# ☸️ Kubernetes Flash Sale Simulator

Mô phỏng và giám sát 4 tính chất cốt lõi của Kubernetes — **Declarative Configuration, Load Balancing, Self-Healing, Horizontal Pod Autoscaling** — bằng một ứng dụng Node.js + Redis, chạy trên **Minikube**, có giám sát **Prometheus + Grafana** và báo cáo **Simulation Summary** (không dùng Database, chỉ lưu RAM).

---

## 1. Kiến trúc tổng thể

```
Client (trình duyệt)
   │
   ▼
counter-service (K8s Service)  ────────► Load Balancing + Service Discovery
   │
   ▼
counter-deployment (3–10 Pod Node.js)  ─► HPA co giãn theo CPU
   │  liveness/readiness probe          ─► Self-Healing
   ▼
redis-service → redis (1 Pod)          ─► shared state (RAM)

Mỗi Pod counter tự expose /metrics
   │
   ▼
Prometheus (tự phát hiện Pod qua K8s API, RBAC)
   │
   ▼
Grafana (datasource = Prometheus) → Dashboard: CPU, Memory, Total Requests,
Requests/Second, Response Time (p95), Pod Count, Redis Status
```

Ứng dụng có 3 trang web (cùng 1 server Node.js, phục vụ qua `counter-service`):

| Trang | Đường dẫn | Nội dung |
|---|---|---|
| Demo Flash Sale | `/` | Nút mô phỏng traffic, Crash Pod, Stress CPU — demo trực quan 4 tính chất K8s |
| Dashboard Tổng Quan | `/dashboard` | Pod/Service/HPA hiện tại, sơ đồ kiến trúc, log sự kiện (đọc từ Redis) |
| Simulation Summary | `/summary` | Bắt đầu/kết thúc phiên Flash Sale, tự tổng hợp Duration, Total Requests, Peak Requests/s, Peak Pods, Scale Up/Down, Self-Healing, CPU/Memory trung bình — toàn bộ chỉ lưu trong RAM (Redis), không dùng Database |

Ngoài ra: `/metrics` (Prometheus scrape), `/health` `/ready` `/live` (probe của K8s).

---

## 2. Cấu trúc thư mục

```
k8s/
├── README.md                      <- file này
├── DEMO_GUIDE.md                  <- kịch bản demo chi tiết từng tính chất
├── app/
│   ├── server.js                  <- toàn bộ logic app (3 trang + API + /metrics)
│   ├── package.json
│   └── Dockerfile
└── k8s/
    ├── redis.yaml                 <- Deployment + Service Redis
    ├── counter.yaml               <- Deployment + Service app Node.js (có annotation Prometheus)
    ├── hpa.yaml                   <- HorizontalPodAutoscaler
    └── monitoring/
        ├── prometheus-k8s.yaml    <- RBAC + ConfigMap + Deployment + Service Prometheus
        ├── prometheus.yml         <- nội dung cấu hình Prometheus (tham khảo/độc lập)
        ├── grafana-k8s.yaml       <- ConfigMap datasource/provider + Deployment + Service Grafana
        └── grafana-dashboard.json <- Dashboard "Kubernetes Flash Sale Simulator" (8 panel)
```

---

## 3. Yêu cầu môi trường (Windows)

- Docker Desktop (đã bật, dùng làm driver cho Minikube)
- Minikube — kiểm tra bằng `minikube version`
- kubectl — kiểm tra bằng `kubectl version --client`
- PowerShell (mặc định trên Windows) — tất cả lệnh dưới đây chạy trong PowerShell

---

## 4. Triển khai từng bước (PowerShell)

### Bước 1 — Khởi động cluster

```powershell
minikube start --driver=docker
minikube addons enable metrics-server   # bắt buộc để HPA và kubectl top hoạt động
```

### Bước 2 — Build image app vào bên trong Docker của Minikube

```powershell
minikube docker-env | Invoke-Expression
cd app
docker build -t k8s-counter:2.0 .
cd ..
```

`minikube docker-env | Invoke-Expression` trỏ Docker CLI của bạn vào Docker engine bên trong Minikube, nên image build ra Minikube dùng được ngay, không cần push lên registry.

### Bước 3 — Triển khai workload chính

```powershell
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/counter.yaml
kubectl apply -f k8s/hpa.yaml

kubectl get pods --watch
```

Chờ tất cả Pod chuyển sang `Running` rồi bấm `Ctrl+C` để thoát watch.

### Bước 4 — Triển khai Prometheus (giám sát)

```powershell
kubectl apply -f k8s/monitoring/prometheus-k8s.yaml
kubectl get pods -l app=prometheus --watch
```

### Bước 5 — Tạo ConfigMap chứa dashboard rồi triển khai Grafana

`grafana-k8s.yaml` cố tình không nhúng sẵn nội dung `grafana-dashboard.json` (vì file khá dài) — tạo ConfigMap này bằng lệnh:

```powershell
kubectl create configmap grafana-dashboards `
  --from-file=k8s/monitoring/grafana-dashboard.json

kubectl apply -f k8s/monitoring/grafana-k8s.yaml
kubectl get pods -l app=grafana --watch
```

Nếu sau này sửa `grafana-dashboard.json`, phải xoá và tạo lại ConfigMap rồi restart Pod Grafana:

```powershell
kubectl delete configmap grafana-dashboards
kubectl create configmap grafana-dashboards --from-file=k8s/monitoring/grafana-dashboard.json
kubectl rollout restart deployment grafana
```

### Bước 6 — Mở các dịch vụ

Mở 3 cửa sổ PowerShell riêng (mỗi `minikube service` giữ 1 tunnel sống, không đóng cửa sổ):

```powershell
minikube service counter-service      # app chính: / , /dashboard , /summary
minikube service prometheus-service   # Prometheus UI (port 9090)
minikube service grafana-service      # Grafana UI (port 3000)
```

Đăng nhập Grafana bằng **admin / admin** (đã cấu hình sẵn trong `grafana-k8s.yaml`; anonymous viewer cũng được bật nên có thể xem dashboard không cần đăng nhập).

Vào Grafana, chọn Dashboards, rồi mở thư mục "Kubernetes Simulator" và dashboard "Kubernetes Flash Sale Simulator" để xem 8 panel: CPU Usage, Memory Usage, Pod Count, Total Requests, Requests/Second, Redis Status, Response Time (p95), NodeJS Health.

---

## 5. Kiểm tra nhanh mọi thứ đã chạy đúng

```powershell
kubectl get pods
kubectl get hpa
kubectl top pods
```

`kubectl get pods` phải thấy `redis`, `counter-deployment` (x3), `prometheus`, `grafana` đều `Running`. `kubectl top pods` cần metrics-server đã bật ở Bước 1 mới có số liệu.

Mở Prometheus UI, vào mục Status rồi Targets: job `nodejs-counter` phải có đủ số dòng bằng số Pod counter đang chạy, trạng thái UP — đây là bằng chứng Prometheus đã tự phát hiện Pod qua `kubernetes_sd_configs`.

---

## 6. Kịch bản demo 4 tính chất Kubernetes

| Tính chất | Thao tác | Quan sát |
|---|---|---|
| Declarative Config | Sửa `replicas: 3` thành `5` trong `counter.yaml`, chạy `kubectl apply -f k8s/counter.yaml` | `kubectl get pods --watch` thấy K8s tự tạo thêm Pod để khớp khai báo |
| Load Balancing / Service Discovery | Trên trang `/`, bấm "MÔ PHỎNG 3 CLIENT" hoặc "Gửi 100 Requests" | Request được rải đều cho nhiều Pod (`kubectl logs <pod>` hoặc xem `/dashboard`) |
| Self-Healing | Bấm "CRASH POD NÀY" trên trang `/` | Pod tự khởi động lại; xem `kubectl get pods --watch` và log sự kiện trên `/dashboard` |
| HPA (Auto Scaling) | Bấm "STRESS CPU (Flash Sale)"; chạy song song `kubectl get hpa --watch` | Số REPLICAS tăng dần khi %CPU vượt 50%, giảm dần khi hết tải |

Chi tiết từng bước xem thêm trong `DEMO_GUIDE.md`.

---

## 7. Demo Prometheus + Grafana (giám sát)

1. Mở `/summary`, bấm "Bắt đầu phiên mới" để có traffic ổn định làm nền.
2. Trên trang `/`, bấm "STRESS CPU" để tạo tải.
3. Mở Grafana Dashboard, dữ liệu tự làm mới mỗi 5 giây — quan sát đồng thời: CPU Usage tăng khi Stress, Pod Count tăng khi HPA scale up (đối chiếu với `kubectl get hpa --watch`), Requests/Second phản ánh traffic đang gửi, Redis Status luôn UP trừ khi Redis Pod lỗi.
4. Ở Prometheus UI có thể gõ PromQL trực tiếp để minh hoạ, ví dụ:

```
rate(http_requests_total[1m])
histogram_quantile(0.95, sum(rate(response_time_seconds_bucket[1m])) by (le))
up{job="nodejs-counter"}
```

### Yêu cầu tên metric (quan trọng để Grafana hiển thị đúng)

`grafana-dashboard.json` và `prometheus.yml` truy vấn đúng các tên metric sau — ứng dụng Node.js (`server.js`) phải expose chính xác các tên này tại `/metrics` thì dashboard mới có số liệu:

| Metric | Loại | Ý nghĩa |
|---|---|---|
| `process_cpu_seconds_total` | Counter | Tổng thời gian CPU đã dùng (mặc định của prom-client) |
| `process_resident_memory_bytes` | Gauge | RAM (RSS) hiện tại (mặc định của prom-client) |
| `nodejs_heap_size_used_bytes` | Gauge | Heap V8 đang dùng (mặc định của prom-client) |
| `http_requests_total` | Counter | Tổng số request (tự định nghĩa trong app) |
| `response_time_seconds_bucket` | Histogram | Response time, dùng tính p95 (tự định nghĩa) |
| `current_pod_count` | Gauge | Số Pod app đang thấy (tự định nghĩa) |
| `redis_connection_status` | Gauge | 1 là Redis UP, 0 là DOWN (tự định nghĩa) |
| `up{job="nodejs-counter"}` | — | Metric có sẵn của Prometheus, tự sinh cho mỗi target scrape |

Nếu Panel nào trên Grafana hiện "No data", việc đầu tiên cần kiểm tra là tên metric trong `server.js` (dùng thư viện prom-client) có khớp đúng bảng trên không — đây là nguyên nhân phổ biến nhất.

---

## 8. Demo Simulation Summary (không dùng Database)

1. Mở `/summary`, bấm "Bắt đầu phiên mới".
2. Chạy vài kịch bản ở trang `/` (gửi request, crash pod, stress CPU) để tạo dữ liệu.
3. Quan sát khối "Phiên hiện tại" tự cập nhật mỗi 2 giây: Duration, Total Requests, Peak Requests/s, Peak Pods, Scale Up/Down, Self-Healing, CPU/Memory trung bình.
4. Bấm "Kết thúc phiên & Lưu báo cáo" — một dòng mới xuất hiện trong bảng "Lịch sử phiên" (tối đa 20 phiên gần nhất).

Vì sao không dùng Database: toàn bộ số liệu phiên nằm trong các key Redis (tiền tố `session:`), và Redis tự thân là một in-memory data store (dữ liệu sống trong RAM). Khi bấm "Kết thúc phiên", các key đếm tạm thời bị xoá, chỉ bản tóm tắt cuối cùng được đẩy vào danh sách lịch sử (giới hạn 20 phần tử) — không có bảng, schema hay file nào được ghi ra ngoài.

---

## 9. Dọn dẹp

```powershell
kubectl delete -f k8s/monitoring/grafana-k8s.yaml
kubectl delete configmap grafana-dashboards
kubectl delete -f k8s/monitoring/prometheus-k8s.yaml
kubectl delete -f k8s/hpa.yaml
kubectl delete -f k8s/counter.yaml
kubectl delete -f k8s/redis.yaml

minikube stop
```

Dùng `minikube stop` để tạm dừng cluster và giữ lại cho lần sau, hoặc `minikube delete` để xoá hẳn.

---

## 10. Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `kubectl top pods` báo metrics not available yet | metrics-server vừa bật, chưa kịp thu thập | Đợi 1-2 phút rồi chạy lại |
| HPA không scale dù CPU cao | metrics-server chưa bật, hoặc thiếu `resources.requests.cpu` trong `counter.yaml` | Bật `minikube addons enable metrics-server`; kiểm tra lại `counter.yaml` |
| Prometheus Target nodejs-counter không lên UP | Thiếu annotation `prometheus.io/scrape` trên Pod, hoặc RBAC chưa đủ quyền | Kiểm tra `counter.yaml` có annotation; kiểm tra `kubectl get clusterrolebinding prometheus` tồn tại |
| Grafana không có Dashboard Kubernetes Simulator | ConfigMap `grafana-dashboards` chưa tạo hoặc tạo sai thời điểm | Xem lại Bước 5; chạy `kubectl rollout restart deployment grafana` sau khi tạo ConfigMap |





