# ☸ Kubernetes Demo — Hướng Dẫn Demo Từng Tính Chất

---

## Chạy lần đầu

```powershell
cd k8s-v5

# Bước 1: Trỏ Docker vào Minikube
minikube docker-env | Invoke-Expression

# Bước 2: Build image
cd app
docker build -t k8s-counter:2.0 .
cd ..

# Bước 3: Enable metrics (cho HPA)
minikube addons enable metrics-server

# Bước 4: Deploy
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/counter.yaml
kubectl apply -f k8s/hpa.yaml

# Bước 5: Chờ tất cả Running
kubectl get pods --watch

# Bước 6: Mở web
minikube service counter-service
```

---

## Tại sao Pod có tên counter-deployment-xxx thay vì Pod-1?

Đó là **hostname thật** của K8s (không thể đổi).
`counter.yaml` dùng `fieldRef: metadata.name` để đọc tên đó và truyền vào app qua env var `POD_NAME`.
App dùng `POD_NAME` để đăng ký ID ổn định (Pod-1, Pod-2...) trong Redis.
Trên web bạn sẽ thấy **Pod-1 / Pod-2 / Pod-3** thay vì hostname dài.

Nếu muốn xem trong PowerShell:
```powershell
kubectl get pods
# counter-deployment-abc-xyz → web hiển thị là "Pod-1"
# counter-deployment-abc-yyy → web hiển thị là "Pod-2"
```

---

## Demo từng tính chất — CÁC BƯỚC CỤ THỂ

---

### 1. LOAD BALANCING & SERVICE DISCOVERY

**Mục tiêu thấy:** request chia đều vào các Pod khác nhau.

```powershell
# Terminal 1: theo dõi Pod nào nhận request
kubectl logs -f -l app=counter --prefix=true
```

Trên web:
1. Nhấn **"MÔ PHỎNG 3 CLIENT"** → 90 requests gửi song song
2. Nhìn **Load Balancing Distribution** → Pod-1 / Pod-2 / Pod-3 đều có bar gần bằng nhau
3. Nhìn log terminal → thấy 3 Pod cùng in log xen kẽ nhau

**Giải thích:** Service nhận 90 requests rồi chia đều cho 3 Pod qua Round Robin.

---

### 2. SELF-HEALING

**Mục tiêu thấy:** Pod crash → K8s tự tạo Pod mới → Web phát hiện.

```powershell
# Mở terminal trước khi crash:
kubectl get pods --watch
```

Trên web:
1. Nhấn **"CRASH POD NÀY"** → xác nhận
2. Nhìn terminal: Pod cũ → `Error` → `Terminating` → Pod mới → `ContainerCreating` → `Running`
3. Nhìn web: heal-box đổi màu đỏ → cam → xanh → "Self-Healing thành công!"
4. **Web không bị ngắt** vì Service chuyển sang Pod còn sống

**Thời gian:** 5–15 giây.

---

### 3. AUTO-SCALING (HPA)

**Mục tiêu thấy:** CPU cao → HPA tăng số Pod tự động.

```powershell
# Terminal 1: xem HPA realtime
kubectl get hpa --watch

# Terminal 2: xem Pod tăng
kubectl get pods --watch
```

Trên web:
1. Nhấn **"STRESS CPU 15s"**
2. Chờ ~30 giây → HPA check CPU mỗi 30s
3. Terminal 1: `REPLICAS` tăng từ 3 → 5 → 7...
4. Terminal 2: Pod mới xuất hiện → `Running`
5. CPU giảm → sau vài phút HPA scale down lại

**Lưu ý:** Nếu HPA không scale, chạy `kubectl top pods` để xác nhận metrics-server đang hoạt động.

---

### 4. DECLARATIVE CONFIGURATION

**Mục tiêu thấy:** thay đổi YAML → K8s tự đồng bộ trạng thái.

```powershell
# Thử 1: Scale thủ công qua YAML
# Sửa counter.yaml: replicas: 3 → replicas: 5
kubectl apply -f k8s/counter.yaml
kubectl get pods --watch
# → K8s tự tạo thêm 2 Pod!

# Thử 2: Scale nhanh không cần sửa file
kubectl scale deployment counter-deployment --replicas=2
kubectl get pods --watch
# → K8s xóa bớt 1 Pod (vì HPA minReplicas=3, sẽ tự về 3)

# Thử 3: Xem trạng thái khai báo vs thực tế
kubectl describe deployment counter-deployment
```

---

## Lỗi đã fix trong version này

| Lỗi cũ | Fix |
|---|---|
| Self-healing thông báo liên tục | Dùng `crashedPodHostname` + state machine, KHÔNG compare `d.pod !== myPod` mỗi lần refresh |
| Pod name hiển thị hostname dài | `POD_NAME` từ `fieldRef` → Redis stable ID → web hiển thị Pod-1/2/3 |
| `redis.yaml` bị ghi sai nội dung | Viết lại đúng Redis Deployment + Service |
| Thiếu `readinessProbe` | Đã thêm đủ cả 2 probe |
