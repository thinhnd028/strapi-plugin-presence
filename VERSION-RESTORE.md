# Presence Plugin – Version Snapshot & Restore

Chi tiết hành vi snapshot và restore của plugin.

---

## 1. Snapshot lưu gì khi tạo version?

Mỗi lần publish hoặc cập nhật (tuỳ cấu hình), plugin lưu một snapshot gồm:

- **Fields thông thường** (string, number, rich text, uid…)
- **Components** (single, repeatable)
- **Dynamic zones** (toàn bộ blocks và dữ liệu con)
- **Danh sách documentId** (+ locale nếu i18n) của relation/media

**Lưu ý**: Không clone bản ghi relation, chỉ lưu trạng thái liên kết (ID nào đang gắn).

### Quá trình leanify

- `leanifySnapshot`: Chuyển relation/media sang `{ documentId, locale? }` để giảm dung lượng
- `stripSystemFields`: Loại createdAt, updatedAt, createdBy, updatedBy… khỏi nested objects

---

## 2. Khi Restore

- Ghi đè **toàn bộ field** của document
- Đặt lại **relation** theo danh sách ID đã lưu
- Relations hiện có nhưng không có trong version cũ → **bị remove**
- Thứ tự many-to-many → **giữ nguyên**

### Format Strapi 5

- `oneToMany`/`manyToMany`: `{ set: [documentId, ...] }` hoặc `{ set: [{ documentId, locale }, ...] }` nếu i18n
- `oneToOne`: `documentId` hoặc `{ set: [{ documentId, locale }] }`
- `manyWay`/`morph`: `{ set: [...] }`

---

## 3. Những gì KHÔNG làm

- **Không phục hồi nội dung** của bản ghi relation đã bị sửa sau đó
- **Không tạo lại relation** nếu bản ghi đó đã bị xóa (ID không tồn tại → bỏ qua)

---

## 4. Các loại relation

| Loại | Khi restore |
|------|-------------|
| oneToOne | Gán lại documentId |
| oneToMany | Gán lại danh sách documentId |
| manyToMany | Gán lại danh sách + order |
| morph | Gán theo snapshot |
