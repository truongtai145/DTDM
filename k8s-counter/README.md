# ☸️ K8s Counter Demo - Hướng dẫn chạy

## Cấu trúc project
```
k8s-counter/
├── app/
│   ├── server.js      ← Node.js app + giao diện web
│   ├── package.json
│   └── Dockerfile
├── k8s/
│   ├── redis.yaml     ← Redis Deployment + Service
│   └── counter.yaml   ← Counter Deployment (3 Pod) + Service
└── README.md
```

## Các bước chạy

### Bước 1: Mở PowerShell, vào thư mục project
```powershell
cd C:\k8s-counter
```

### Bước 2: Trỏ Docker vào Minikube
```powershell
minikube docker-env | Invoke-Expression
```

### Bước 3: Build image
```powershell
cd app
docker build -t k8s-counter:1.0 .
cd ..
```

### Bước 4: Deploy Redis trước
```powershell
kubectl apply -f k8s/redis.yaml
kubectl get pods   # Chờ redis Running
```

### Bước 5: Deploy Counter App
```powershell
kubectl apply -f k8s/counter.yaml
kubectl get pods   # Chờ 3 Pod counter Running
```

### Bước 6: Mở trình duyệt
```powershell
minikube service counter-service
```

## Demo các khái niệm

### Pod
```powershell
kubectl get pods                        # Xem 3 Pod
kubectl describe pod <tên-pod>          # Chi tiết Pod
kubectl logs <tên-pod>                  # Log của Pod
```

### Deployment
```powershell
kubectl get deployments
kubectl scale deployment counter-deployment --replicas=5   # Scale lên
kubectl scale deployment counter-deployment --replicas=2   # Scale xuống
```

### Service
```powershell
kubectl get services
# Nhấn F5 nhiều lần → thấy Pod name thay đổi = load balancing!
```

### Self-healing
```powershell
kubectl delete pod <tên-pod>   # Xóa 1 Pod
kubectl get pods --watch        # Thấy K8s tự tạo lại Pod mới!
```

## Dọn dẹp
```powershell
kubectl delete -f k8s/
minikube stop
```
