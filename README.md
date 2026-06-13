I.               Giới thiệu
1.    Bối cảnh công nghệ
-        Sự bùng nổ của Container: Thay thế ảo hóa truyền thống (Virtual Machine).Đóng gói ứng dụng nhẹ. Đồng nhất môi trường.
-        Thách thức quản lý lớn: Hệ thống có hàng trăm container. Việc vận hành thủ công bị quá tải. Định tuyến mạng phức tạp.
-        Giải pháp tất yếu ra đời: Các hệ thống điều phối container xuất hiện. Kubernetes là công nghệ dẫn đầu.
2.    Định nghĩa và vai trò
-        Kubernetes (K8s) là gì? : Là nền tảng mã nguồn mở. Dùng để tự động hóa triển khai. Hỗ trợ mở rộng quy mô. Quản lý ứng dụng dạng container.
-        Vai trò:
§  Điều phối container (Orchestration): Tự động sắp xếp, định tuyến và phân bổ container vào các máy chủ phù hợp dựa trên chỉ số CPU và RAM.
§  Quản lý trạng thái mong muốn (Desired State): Hệ thống tự động giám sát liên tục. Tự động sửa đổi, khởi tạo lại nếu có sai lệch cấu hình.
3.    Bốn đặc tính cơ bản
-        Tự động co giãn (Scaling): Tự tăng/giảm container theo lưu lượng truy cập và tải phần cứng thực tế của hệ thống.
-        Tự phục hồi (Self-healing): Tự động khởi động lại các container bị lỗi, tiêu hủy và thay thế các Pod không phản hồi bài kiểm tra sức khỏe, đảm bảo ứng dụng luôn hoạt động.
-        Cân bằng tải và phát hiện dịch vụ (Load Balancing & Service Discovery): Tự động cấp một định danh (DNS/IP) cố định cho nhóm Pod và phân phối đều lưu lượng mạng, tránh tình trạng quá tải cục bộ.
-        Quản lý cấu hình khai báo (Declarative Configuration): Định nghĩa trạng thái mong muốn qua file YAML; K8s tự động theo dõi và duy trì đúng như mô tả.
-        Ví dụ thực tế: Website thương mại điện tử ngày Flash Sale
-        Quản lý khai báo (Declarative): DevOps cấu hình file YAML: "Luôn duy trì hệ thống chạy từ 3 đến 30 Pod". K8s tiếp nhận và tự động quản lý.
-        Tự động co giãn (Scaling): Khách tăng đột biến, K8s tự động nhân bản hệ thống từ 3 Pod lên 30 Pod để chịu tải.
-        Cân bằng tải (Load Balancing): K8s tự động chia đều hàng triệu lượt truy cập của khách hàng vào 30 Pod này, tránh nghẽn mạng.
-        Tự phục hồi (Self-healing): Nếu 1 Pod bị sập lỗi, K8s lập tức phát hiện, tự tiêu hủy và bật ngay Pod mới thay thế. Hệ thống không bị gián đoạn.
II.            TỔNG QUAN LÝ THUYẾT
1.	Minikube
-        Khái niệm: Là công cụ giả lập K8s mã nguồn mở. Tạo một cụm (Cluster) gồm một Node duy nhất. Chạy cục bộ trên máy tính cá nhân.
-        Vai trò chính:
§  Cung cấp môi trường thử nghiệm K8s gọn nhẹ.
§  Phục vụ học tập và phát triển ứng dụng (Development).
§  Kiểm thử file cấu hình (YAML) trước khi triển khai lên Cloud thật.
2.	Pod
-        Khái niệm: Là đối tượng nhỏ nhất trong Kubernetes. Là đơn vị tính toán cơ bản nhất. Chứa một hoặc một nhóm container.
-        Vai trò chính:
§  Đại diện cho một tiến trình đang chạy.
§  Chia sẻ chung tài nguyên mạng và ổ đĩa.
§  K8s chỉ quản lý Pod, không quản lý container riêng lẻ.
-        Ví dụ cụ thể: Một Pod chứa 2 container chạy chung: Container 1 chạy ứng dụng Web chính. Container 2 làm nhiệm vụ thu thập log hệ thống.
3.	Deployment
-        Khái niệm: Là bộ quản trị bậc cao trong K8s. Dùng để định nghĩa trạng thái hoạt động của Pod.
-        Vai trò chính:
§  Tự động duy trì số lượng bản sao Pod.
§  Cập nhật ứng dụng không gây gián đoạn (Rolling Update).
§  Hỗ trợ quay lại phiên bản cũ khi lỗi (Rollback).
-        Ví dụ cụ thể: Khai báo Deployment quản lý ứng dụng Web luôn chạy 3 Pod. Khi cập nhật ứng dụng từ bản v1 lên bản v2, Deployment sẽ tắt dần từng Pod v1 và bật dần Pod v2. Hệ thống luôn online.
4.	Service
-        Khái niệm: Là thành phần trừu tượng hóa mạng nội bộ. Định nghĩa chính sách truy cập cho một nhóm Pod.
-        Vai trò chính:
§  Cung cấp một địa chỉ IP tĩnh cố định.
§  Khắc phục nhược điểm đổi IP liên tục của Pod.
§  Đóng vai trò làm bộ cân bằng tải nội bộ.
-        Ví dụ cụ thể: Hệ thống có 3 Pod chạy Backend (IP của 3 Pod này thay đổi liên tục). Tạo một backend-service có IP cố định là 10.96.0.1. Khi Frontend cần gọi Backend, nó chỉ cần gọi duy nhất IP 10.96.0.1. Service tự điều hướng đến Pod còn sống.
5.	Mối liên hệ giữa Kubernetes và Cloud Computing
-        Định vị công nghệ: Kubernetes (K8s) là nền tảng điều phối container cốt lõi trong môi trường Điện toán đám mây hiện đại.
-        Bảo chứng cho các đặc tính Cloud: Các thành phần đối tượng của K8s hỗ trợ trực tiếp cho 4 đặc tính sống còn của hạ tầng Cloud:
§  Elasticity (Tính co giãn): Tăng giảm tài nguyên linh hoạt theo nhu cầu (nhờ đặc tính Scaling)
§  High Availability (Tính sẵn sàng cao): Giúp hệ thống luôn online, không bị gián đoạn (nhờ Self-healing và Deployment)
§  Resource Pooling (Gộp tài nguyên): Tối ưu hóa hiệu suất phần cứng thô của Cloud (nhờ K8s tự phân bổ Pod vào các máy chủ còn trống)
§  Automation (Tự động hóa): Giảm thiểu tối đa việc can thiệp thủ công của con người (nhờ cấu hình dạng file YAML)
-        Sản phẩm thực tế trên thị trường: K8s được tích hợp sâu và trở thành dịch vụ quản trị chiến lược của các "ông lớn" công nghệ:
§  AWS: Dịch vụ Amazon EKS.
§  Azure: Dịch vụ Azure AKS.
§  Google Cloud: Dịch vụ Google GKE.
·        Sơ đồ luồng kiến trúc phân cấp

