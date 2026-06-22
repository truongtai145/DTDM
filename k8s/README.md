# ☸️ K8s Demo — Đã Fix Toàn Bộ Lỗi

## 🔴 Các lỗi đã phát hiện và sửa

| File | Lỗi cũ | Đã sửa |
|---|---|---|
| `redis.yaml` | **Nội dung sai hoàn toàn** — chứa HPA config thay vì Redis Deployment | Viết lại đúng Redis Deployment + Service |
| `counter.yaml` | Chỉ có `livenessProbe`, thiếu `readinessProbe` | Thêm đủ cả 2 probe |
| `server.js` | `/health` thiếu `Content-Type` header | Thêm header JSON đầy đủ |
| `server.js` | `getPodId()` tính lại index mỗi lần → đổi liên tục khi Pod chết/sống | Dùng Redis lưu **pod-id ổn định** (Pod-1, Pod-2...) qua `INCR` |
| `server.js` | Không có cách nào biết Self-Healing đã xong | Polling `/api/state` so sánh `pod` hiện tại với `myPod` ban đầu |

---

## Cấu trúc
```
k8s-fixed/
├── app/
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
└── k8s/
    ├── redis.yaml      ← ĐÃ FIX: Redis thật
    ├── counter.yaml    ← ĐÃ FIX: đủ liveness + readiness probe
    └── hpa.yaml
```

## Chạy

```powershell
cd k8s-fixed

minikube docker-env | Invoke-Expression
cd app
docker build -t k8s-counter:2.0 .
cd ..

minikube addons enable metrics-server   # cần cho HPA

kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/counter.yaml
kubectl apply -f k8s/hpa.yaml

kubectl get pods --watch    # chờ tất cả Running

minikube service counter-service
```

## Kiểm tra Redis đã chạy đúng chưa

```powershell
kubectl get pods
# Phải thấy:  redis-xxxxx   1/1   Running

kubectl logs <tên-pod-counter>
# Không được có lỗi "ECONNREFUSED" hoặc "Redis error"
```

## Demo 4 tính chất

1. **Load Balancing** — nhấn "MÔ PHỎNG 3 CLIENT" → xem Pod-1/2/3 nhận đều
2. **Self-Healing** — nhấn "CRASH POD NÀY" → xem Pod ID tự đổi sang Pod mới
3. **Auto-Scaling** — nhấn "STRESS CPU" → `kubectl get hpa --watch` xem replicas tăng
4. **Declarative Config** — sửa `replicas: 3` → `5` trong `counter.yaml` → `kubectl apply -f k8s/counter.yaml`
