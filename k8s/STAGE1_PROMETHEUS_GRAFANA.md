# Giai đoạn 1 — Prometheus + Grafana Monitoring

## Những gì đã thay đổi

| File | Thay đổi |
|---|---|
| `app/package.json` | Thêm dependency `prom-client` |
| `app/server.js` | Thêm khối metrics (Registry, Counter, Histogram, Gauge...), middleware đo thời gian mọi request, endpoint `GET /metrics` |
| `k8s/prometheus.yml` | File cấu hình gốc của Prometheus (tham khảo / dùng ngoài K8s nếu cần) |
| `k8s/prometheus-k8s.yaml` | RBAC + ConfigMap + Deployment + Service cho Prometheus |
| `k8s/grafana-k8s.yaml` | ConfigMap datasource/provider + Deployment + Service cho Grafana |
| `k8s/grafana-dashboard.json` | Định nghĩa Dashboard Grafana (8 panel theo yêu cầu) |

Toàn bộ chức năng cũ (Load Balancing demo, HPA, Self-Healing, Redis counter, SSE...) **giữ nguyên không đổi**.

## Giải thích các metric đã thêm

- `http_requests_total{method,route,status}` — Counter, tăng mỗi khi có request trả response xong. Dùng để tính **Total Requests**.
- `response_time_seconds{method,route,status}` — Histogram đo thời gian xử lý. Dùng để tính **Response Time (p95)** và, qua `_count`, tính **Requests/Second** (`rate(...)`).
- `process_cpu_seconds_total`, `process_resident_memory_bytes`, `nodejs_heap_size_used_bytes`, `nodejs_eventloop_lag_seconds` — tự động có sẵn nhờ `promClient.collectDefaultMetrics()`, không cần code thêm. Dùng cho **CPU Usage**, **Memory Usage**.
- `redis_connection_status` — Gauge 0/1, cập nhật theo sự kiện `connect/ready/end/error` của Redis client. Dùng cho **Redis Status**.
- `current_pod_count` — Gauge, đọc số Pod có heartbeat còn "sống" trong Redis (`pod_hb`) mỗi 5 giây. Vì mọi Pod đều ghi/đọc chung Redis nên số liệu **giống nhau trên mọi Pod** — đúng bản chất "trạng thái cụm" chứ không phải "trạng thái riêng từng Pod".
- `event_loop_delay_seconds` — Gauge, dùng `perf_hooks.monitorEventLoopDelay()` để phát hiện Node.js bị nghẽn xử lý.

`/metrics` trả dữ liệu ở định dạng text Prometheus (`# HELP`, `# TYPE`, rồi các dòng `metric_name{labels} value`).

## Cách triển khai trên Minikube (test sau mỗi bước)

### Bước 1 — Build lại image ứng dụng (đã có prom-client)

```bash
cd app
eval $(minikube docker-env)      # build image thẳng vào Docker của Minikube
docker build -t k8s-counter:2.0 .
```

### Bước 2 — Áp dụng lại Deployment/Service ứng dụng + Redis (nếu chưa chạy)

```bash
kubectl apply -f ../k8s/redis.yaml
kubectl apply -f ../k8s/counter.yaml
kubectl apply -f ../k8s/hpa.yaml
kubectl rollout restart deployment/counter-deployment   # nếu đã chạy từ trước
```

**Kiểm thử bước 2:** chạy `kubectl port-forward svc/counter-service 8080:80` rồi mở
`http://localhost:8080/metrics` — phải thấy danh sách metric dạng text (http_requests_total, process_cpu_seconds_total...).

### Bước 3 — Triển khai Prometheus

```bash
kubectl apply -f ../k8s/prometheus-k8s.yaml
```

**Kiểm thử bước 3:**
```bash
minikube service prometheus-service --url
```
Mở URL đó trên trình duyệt → vào menu **Status → Targets**. Phải thấy target `nodejs-counter` với state **UP**, hiển thị đủ số Pod đang chạy (Prometheus tự tìm qua `kubernetes_sd_configs`, không cần sửa IP tay).

### Bước 4 — Triển khai Grafana

```bash
# 4a. Tạo ConfigMap chứa dashboard JSON (không để trong grafana-k8s.yaml vì khá dài)
kubectl create configmap grafana-dashboards \
  --from-file=k8s-simulator-dashboard.json=../k8s/grafana-dashboard.json

# 4b. Áp dụng Grafana
kubectl apply -f ../k8s/grafana-k8s.yaml
```

**Kiểm thử bước 4:**
```bash
minikube service grafana-service --url
```
Đăng nhập `admin` / `admin` (hoặc xem ngay vì đã bật Anonymous Viewer).
Vào **Dashboards → Kubernetes Simulator** → mở dashboard **"Kubernetes Flash Sale Simulator"**.
Phải thấy 8 panel: CPU Usage, Memory Usage, Pod Count, Total Requests, Requests/Second, Redis Status, Response Time (p95), NodeJS Health — tất cả có dữ liệu (không phải "No Data").

Nếu panel "No Data": bấm nút **Flash Sale / Gửi requests** trên dashboard demo (`http://<counter-service-url>/`) vài lần để sinh traffic, đợi ~10–15s cho Prometheus scrape.

### Bước 5 — Xác nhận HPA vẫn hoạt động bình thường

```bash
kubectl get hpa counter-hpa --watch
```
Tạo tải (dùng nút Flash Sale hoặc `kubectl run load --image=busybox -it --rm -- /bin/sh -c "while true; do wget -q -O- http://counter-service; done"`), quan sát Pod Count tăng cả trong `kubectl get hpa` lẫn panel Grafana **Pod Count**.

---

Khi bạn xác nhận Giai đoạn 1 chạy ổn, mình sẽ làm tiếp **Giai đoạn 2 (Simulation Summary + Cluster Event Log trong RAM)** rồi **Giai đoạn 3 (nâng cấp Dashboard hiện tại để hiển thị các số liệu mới)**.
